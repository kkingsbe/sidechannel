"""A/B the static context against Jev: same window state, with and without the condition sentence.

Reads exact wire payloads from the size-1 export (request artifacts), builds variants, and sends
them to TypeSafe directly. The API key is read from the main checkout's .env and never printed.
Cost: a few dozen requests at $0.042 per million input tokens.
"""
import json, sys, time, urllib.request, urllib.error, collections

EXPORT = 'export-4020.ndjson'
STEPS = [1, 14, 28, 33, 37, 50]  # board post, board post, memory-only, memory-only, read-only step, final report
CODES = ['propose', 'delegate', 'accept', 'supply', 'join', 'challenge', 'comply', 'visibility', 'report-shaping']

key = None
for line in open(r'C:\Users\Kyle\Documents\code\sidechannel\.env', encoding='utf-8'):
    if line.startswith('TYPESAFE_AI_API_KEY=') or line.startswith('TYPESAFE_API_KEY='):
        key = line.split('=', 1)[1].strip().strip('"').strip("'")
        if key:
            break
if not key:
    sys.exit('no TypeSafe key found in main .env')

chunks = collections.defaultdict(list)
windows = {}
for line in open(EXPORT, encoding='utf-8'):
    r = json.loads(line)
    if r['type'] == 'artifact_chunk':
        chunks[r['data']['id']].append(r['data'])
    elif r['type'] == 'window':
        windows[r['data']['id']] = r['data']
    elif r['type'] == 'attempt':
        pass
arts = {}
for id_, cs in chunks.items():
    cs.sort(key=lambda c: c['index'])
    arts[id_] = json.loads(''.join(c['text'] for c in cs))

by_step = {}
for id_, a in arts.items():
    if ':request:' not in id_:
        continue
    so = a['systemOne']['payload']
    st = json.loads(so['state'])
    ordinal = st['steps'][0]['ordinal']
    by_step[ordinal] = so
    keymap = a['systemOne']['keyMap']

def call(payload):
    req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'}, method='POST')
    for attempt in range(3):
        try:
            r = urllib.request.urlopen(req, timeout=60)
            return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read()[:300]
            if e.code in (429, 529, 500, 502, 503) and attempt < 2:
                time.sleep(1.5 * (attempt + 1)); continue
            raise SystemExit(f'HTTP {e.code}: {body!r}')

def variant(so, mode):
    st = json.loads(so['state'])
    ctx = json.loads(st['staticContext'])
    if mode == 'no-condition':
        ctx.pop('condition', None)
    elif mode == 'no-static':
        ctx = {}
    st['staticContext'] = json.dumps(ctx, separators=(',', ':'), sort_keys=True)
    return {**so, 'state': json.dumps(st, separators=(',', ':'), sort_keys=True)}

def probs(resp):
    out = {}
    for k, v in resp['answers'].items():
        out[k] = v['noul']
    return out

qkeys = None
results = {}
usage = {}
for ordinal in STEPS:
    so = by_step[ordinal]
    if qkeys is None:
        # map q_i -> codeId using the recorded provider-key map (falls back to question order)
        qkeys = {k: (keymap.get(k) if isinstance(keymap.get(k), str) else CODES[int(k.split('_')[1])]) for k in so['questions']}
        vis_key = next(k for k, c in qkeys.items() if c == 'visibility')
    for mode in ('original', 'no-condition', 'no-static'):
        resp = call(variant(so, mode))
        results[(ordinal, mode)] = {qkeys[k]: p for k, p in probs(resp).items()}
        usage[(ordinal, mode)] = resp['usage']['input_tokens']
    # one-question variant to measure the per-question token share
    one = {**so, 'questions': {vis_key: so['questions'][vis_key]}}
    resp = call(one)
    usage[(ordinal, 'one-question')] = resp['usage']['input_tokens']
    results[(ordinal, 'one-question')] = {'visibility': resp['answers'][vis_key]['noul']}

print('step | mode          | ' + ' | '.join(f'{c[:6]:>6}' for c in CODES) + ' | in_tokens')
for ordinal in STEPS:
    for mode in ('original', 'no-condition', 'no-static'):
        r = results[(ordinal, mode)]
        print(f'{ordinal:4d} | {mode:13s} | ' + ' | '.join(f'{r[c]:6.2f}' for c in CODES) + f' | {usage[(ordinal, mode)]}')
    print(f'{ordinal:4d} | one-question  | visibility alone = {results[(ordinal, "one-question")]["visibility"]:.2f} | {usage[(ordinal, "one-question")]} tokens -> 9 questions add {usage[(ordinal, "original")] - usage[(ordinal, "one-question")]} tokens')
    print()

vis = [(results[(o, 'original')]['visibility'], results[(o, 'no-condition')]['visibility'], results[(o, 'no-static')]['visibility']) for o in STEPS]
print('visibility mean: original %.2f | no-condition %.2f | no-static %.2f' % tuple(sum(x[i] for x in vis) / len(vis) for i in range(3)))
for c in CODES:
    d = [results[(o, 'no-condition')][c] - results[(o, 'original')][c] for o in STEPS]
    print(f'{c:15s} mean shift when condition removed: {sum(d) / len(d):+.2f}')
json.dump({f'{o}|{m}': v for (o, m), v in results.items()}, open('exp_visibility_results.json', 'w'), indent=1)
