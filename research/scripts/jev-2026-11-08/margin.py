import json, statistics as st

def load(f):
    return json.load(open(f, encoding='utf-8'))['items']

rows = []  # (label, bytes, preflight_total, actual)
for label, pf, af, wf in (('size4', 'preview4.json', 'a4.json', 'w4.json'), ('size7', 'preview7.json', 'a7.json', 'w7.json')):
    pv = json.load(open(pf, encoding='utf-8'))
    total = {(w['startOrdinal'], w['endOrdinal']): sum(b['estimatedTokens'] for b in w['budget']['budget']['batches']) for w in pv['windows']}
    att = {a['windowId']: a for a in load(af) if a.get('status') == 'succeeded'}
    for w in load(wf):
        a = att.get(w['id'])
        if a:
            rows.append((label, w['inputBytes'], total[(w['startOrdinal'], w['endOrdinal'])], a['usage']['inputTokens']))

# size 1 baseline: actual usage is known, preflight total under the new estimator = ceil(0.6*bytes) + question share
# (the question share is constant per codebook: take it from the size-4 job, where total - ceil(0.6*bytes) is identical per window)
q = rows[0][2] - -(-int(rows[0][1] * 0.6 * 1000) // 1000)
print('question share in preflight total ~', q)
w1 = load('w1.json')
a1 = {a['windowId']: a for a in load('a1.json') if a.get('status') == 'succeeded'}
for w in w1:
    a = a1.get(w['id'])
    if a:
        rows.append(('size1', w['inputBytes'], -(-w['inputBytes'] * 6 // 10) + q, a['usage']['inputTokens']))

print('n windows', len(rows))
for label in ('size1', 'size4', 'size7'):
    r = [x[3] / x[2] for x in rows if x[0] == label]
    print(f'{label}: actual / preflight total  min {min(r):.2f} mean {st.mean(r):.2f} max {max(r):.2f}')
allr = [x[3] / x[2] for x in rows]
print(f'ALL: max {max(allr):.2f}  -> preflight total is {1 / max(allr):.2f}x the worst real usage')

# least squares: actual = a * bytes + b
xs = [x[1] for x in rows]; ys = [x[3] for x in rows]
mx, my = st.mean(xs), st.mean(ys)
a = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
b = my - a * mx
res = [y - (a * x + b) for x, y in zip(xs, ys)]
print(f'fit over all windows: actual = {a:.3f} * bytes + {b:.0f}   (max residual {max(res):+.0f}, min {min(res):+.0f})')
# largest window that still passes preflight at default limits: 30000 effective single, with the largest single question
print('real tokens at the preflight ceiling (30000 est):', 'state bytes <=', int((30000 - q) / 0.6), '-> real ~', int(a * int((30000 - q) / 0.6) + b))
