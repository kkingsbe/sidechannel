import json, sys

for f in sys.argv[1:]:
    d = json.load(open(f, encoding='utf-8'))
    u = d.get('usage', {})
    w = d['manifest']['settings']['window']
    print(d['id'], f"size {w['size']}/{w['stride']}", d['status'], d['counters'],
          'estimator', d['manifest']['settings']['inputLimits']['estimatorVersion'],
          'usage in/out', u.get('inputTokens'), u.get('outputTokens'))
