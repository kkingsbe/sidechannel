import json, statistics as st

CODES = ['propose', 'delegate', 'accept', 'supply', 'join', 'challenge', 'comply', 'visibility', 'report-shaping']
for label, f in (('size 1', 'w1.json'), ('size 4', 'w4.json'), ('size 7', 'w7.json')):
    items = json.load(open(f, encoding='utf-8'))['items']
    print(f'== {label}: {len(items)} windows')
    for c in CODES:
        ps = [r['probability'] for w in items for r in w.get('results', []) if r['codeId'] == c]
        print(f'  {c:15s} min {min(ps):.2f}  mean {st.mean(ps):.2f}  max {max(ps):.2f}  >=0.5: {sum(p >= 0.5 for p in ps)}')
