import json, statistics as st

CODES = ['propose', 'delegate', 'accept', 'supply', 'join', 'challenge', 'comply', 'visibility', 'report-shaping']

def load(f):
    return json.load(open(f, encoding='utf-8'))['items']

def scores(items):
    out = {}
    for w in items:
        if w.get('results'):
            out[(w['startOrdinal'], w['endOrdinal'])] = {r['codeId']: r['probability'] for r in w['results']}
    return out

s1 = scores(load('w1.json'))

for label, wf, af in (('SIZE 4', 'w4.json', 'a4.json'), ('SIZE 7', 'w7.json', 'a7.json')):
    items = load(wf)
    att = {a['windowId']: a for a in load(af) if a.get('status') == 'succeeded'}
    print(f'===== {label}')
    ratios = []
    for w in sorted(items, key=lambda w: w['startOrdinal']):
        a = att.get(w['id'])
        actual = a['usage']['inputTokens'] if a else None
        est = w['estimatedTokens']
        ratios.append(actual / est if actual else None)
        print(f"{w['startOrdinal']:3d}-{w['endOrdinal']:3d} {w['status']:9s} bytes={w['inputBytes']:6d} est={est:6d} actual={actual if actual else '-':>6} actual/est={(actual / est if actual else 0):.2f}")
    r = [x for x in ratios if x]
    print(f'actual/est: min {min(r):.2f} mean {st.mean(r):.2f} max {max(r):.2f}  (>1.0 means the estimate undercounted)')
    sc = scores(items)
    print('-- window score minus max over its member steps (size-1 job), mean | worst (most negative) | most positive')
    for c in CODES:
        diffs = []
        for (a, b), v in sc.items():
            members = [s1[(k, k)][c] for k in range(a, b + 1) if (k, k) in s1]
            if members:
                diffs.append(v[c] - max(members))
        print(f'  {c:15s} mean {st.mean(diffs):+.3f}  min {min(diffs):+.2f}  max {max(diffs):+.2f}')
    print('-- windows where any code is >= 0.5 and differs from the member-step max by more than 0.25')
    for (a, b), v in sorted(sc.items()):
        for c in CODES:
            members = [s1[(k, k)][c] for k in range(a, b + 1) if (k, k) in s1]
            if members and abs(v[c] - max(members)) > 0.25 and max(v[c], max(members)) >= 0.5:
                print(f'  {a}-{b} {c}: window {v[c]:.2f} vs max single {max(members):.2f}')
