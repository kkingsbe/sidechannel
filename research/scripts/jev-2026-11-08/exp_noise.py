"""Repeat identical Jev requests to measure run-to-run noise in the returned probabilities."""
import json, sys, time, statistics as st, urllib.request, urllib.error, collections

EXPORT = 'export-4020.ndjson'
STEPS = [3, 19, 28]   # delegate spike, mixed comply/accept, memory-only
REPEATS = 6
CODES = ['propose', 'delegate', 'accept', 'supply', 'join', 'challenge', 'comply', 'visibility', 'report-shaping']

key = None
for line in open(r'C:\Users\Kyle\Documents\code\sidechannel\.env', encoding='utf-8'):
    if line.startswith('TYPESAFE_AI_API_KEY=') or line.startswith('TYPESAFE_API_KEY='):
        key = line.split('=', 1)[1].strip().strip('"').strip("'")
        if key:
            break
if not key:
    sys.exit('no key')

chunks = collections.defaultdict(list)
for line in open(EXPORT, encoding='utf-8'):
    r = json.loads(line)
    if r['type'] == 'artifact_chunk' and ':request:' in r['data']['id']:
        chunks[r['data']['id']].append(r['data'])
by_step = {}
for id_, cs in chunks.items():
    cs.sort(key=lambda c: c['index'])
    a = json.loads(''.join(c['text'] for c in cs))
    so = a['systemOne']['payload']
    by_step[json.loads(so['state'])['steps'][0]['ordinal']] = (so, a['systemOne']['keyMap'])

def call(payload):
    req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'}, method='POST')
    for attempt in range(3):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            if e.code in (429, 529, 500, 502, 503) and attempt < 2:
                time.sleep(1.5 * (attempt + 1)); continue
            raise SystemExit(f'HTTP {e.code}: {e.read()[:300]!r}')

stored = {}
for line in open(EXPORT, encoding='utf-8'):
    r = json.loads(line)
    if r['type'] == 'result':
        stored[(r['data']['windowId'], r['data']['codeId'])] = r['data']['probability']
window_of = {}
for line in open(EXPORT, encoding='utf-8'):
    r = json.loads(line)
    if r['type'] == 'window':
        window_of[r['data']['startOrdinal']] = r['data']['id']

print(f'{REPEATS} identical requests per step; per code: stored | mean ± sd | min..max')
all_sd = []
for ordinal in STEPS:
    so, keymap = by_step[ordinal]
    runs = []
    for _ in range(REPEATS):
        resp = call(so)
        runs.append({keymap[k]: v['noul'] for k, v in resp['answers'].items()})
    print(f'-- step {ordinal}')
    for c in CODES:
        xs = [r[c] for r in runs]
        sd = st.pstdev(xs); all_sd.append(sd)
        print(f'   {c:15s} stored {stored[(window_of[ordinal], c)]:.2f} | {st.mean(xs):.2f} ± {sd:.3f} | {min(xs):.2f}..{max(xs):.2f}')
print(f'overall: mean sd {st.mean(all_sd):.3f}, max sd {max(all_sd):.3f}')
