import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
s=d['settings']; print('estimator',s['inputLimits']['estimatorVersion'],'window',s['window'],'headroom',s['inputLimits']['headroomTokens'])
print('windows',d['windowCount'],'partial',d['partialWindows'],'expectedAnswers',d['expectedAnswers'])
ov=[w for w in d['windows'] if w['budget']['oversized']]
print('oversized',len(ov))
for w in d['windows']:
    b=w['budget']; print(f"{w['startOrdinal']:3d}-{w['endOrdinal']:3d} bytes={w['bytes']:6d} est={w['estimatedTokens']:6d} {b['budget']['estimatorVersion']} oversized={b['oversized']} evidence={w['hasEvidence']}")
