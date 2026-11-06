"""Validate financial snapshots, dark paint/geometry/raster and computed light AA."""
from pathlib import Path
import argparse,json
from investment_visual_checks import compare_rasters,digest
ap=argparse.ArgumentParser();ap.add_argument('--out',default='node_modules/.finelo-cycle4b-tools/visual');args=ap.parse_args();root=Path(args.out)
data={};failures=[];financial=[];parity=[];aa=[];roundtrips=0
for file in root.glob('*.json'):
 r=json.loads(file.read_text(encoding='utf8'))
 if not isinstance(r,dict)or'key'not in r:continue
 data[r['key']]=r
for key,r in data.items():
 roundtrips+=1
 if r['themeRoundtrip']['before']!=r['themeRoundtrip']['after']:failures.append({'key':key,'kind':'theme work'})
 if r['variant']=='light':
  aa.extend(dict(row,key=key)for row in r['audit']['rows'])
  failures.extend({'key':key,'kind':'AA','row':row}for row in r['audit']['rows']if not row['pass'])
 if r['variant']!='main':continue
 group=key.removesuffix('-main')
 for v in ['reviewed','dark','light']:
  actual=data.get(group+'-'+v)
  if actual is None:failures.append({'key':group,'kind':'missing','variant':v});continue
  if 'direct-session' in key:continue # approved privacy exception, evaluated by dedicated traces
  financial_equal=r['financial']==actual['financial']
  financial.append({'state':group,'variant':v,'pass':financial_equal,'sha256':digest(actual['financial'])})
  if not financial_equal:
   fields=[f for f in r['financial']if r['financial'][f]!=actual['financial'].get(f)];failures.append({'key':group,'kind':'financial','variant':v,'fields':fields})
  if v=='light':continue
  diffs=[field for field in ['geometry','content','colors','svgPaint']if r['audit'][field]!=actual['audit'][field]]
  result={'state':group,'variant':v,'computedDifferences':diffs,'pass':not diffs}
  if diffs:failures.append({'key':group,'kind':'computed','variant':v,'fields':diffs})
  else:
   try:result['raster']=compare_rasters((root/(key+'.png')).read_bytes(),(root/(actual['key']+'.png')).read_bytes())
   except AssertionError as error:result['pass']=False;failures.append({'key':group,'kind':'raster','variant':v,'error':str(error)})
  parity.append(result)
summary={'captures':len(data),'financialComparisons':financial,'darkComparisons':parity,'lightSamples':len(aa),'lightDistinctSamples':len({(r['kind'],r['text'],r['ratio'])for r in aa}),'lightMinText':min((r['ratio']for r in aa if r['kind']in ['text','field','placeholder']),default=None),'lightMinEssential':min((r['ratio']for r in aa if r['kind']not in ['text','field','placeholder']),default=None),'themeZeroWorkChecks':roundtrips,'failures':failures}
(root/'comparison.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:v for k,v in summary.items()if k not in ['financialComparisons','darkComparisons']},ensure_ascii=True,indent=2))
if failures:raise SystemExit(1)
