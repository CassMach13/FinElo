"""Compact synthesis; preserves failures and never promotes missing cases to PASS."""
from pathlib import Path
import json
ROOT=Path('node_modules/.finelo-cycle4d-tools');OUT=ROOT/'evidence'
def read(name):
 p=OUT/name
 return json.loads(p.read_text(encoding='utf8'))if p.exists()else None
def run():
 nav=read('navigation-validation.json');auth={}
 for name in['auth-validation.json','auth-targeted-confirmation.json','auth-additional-validation.json']:
  data=read(name)
  if data:
   for r in data['cases']:auth[(r['engine'],r.get('scenario','browser'))]=r
 canonical={'cases':list(auth.values()),'expectedGroups':36,'remoteAuth':'BLOCKED','transport':'synthetic HTTP; installed SDK and actual browser storage/locks/BroadcastChannel'}
 (OUT/'auth-canonical.json').write_text(json.dumps(canonical,ensure_ascii=False,indent=2),encoding='utf8')
 aa=nav['computedAA'];light=[r for r in aa if r['preference']!='dark'];dark=[r for r in aa if r['preference']=='dark']
 a11y=read('accessibility-validation.json');pwa=read('pwa-validation.json');pdf=read('print/validation.json');exports=read('exports/validation.json')
 summary={'navigation':{'captures':nav['captures'],'browsers':nav['availability'],'financialComparisons':len(nav['financial']),'financialFailures':sum(not r['pass']for r in nav['financial']),'darkParities':len(nav['parity']),'darkExact':sum(r.get('exact',False)for r in nav['parity']),'issues':nav['issues']},'contrast':{'total':len(aa),'light':len(light),'lightFailures':sum(not r['pass']for r in light),'dark':len(dark),'darkFailures':sum(not r['pass']for r in dark),'minimumLightText':min(r['ratio']for r in light if r['threshold']==4.5),'minimumLightEssential':min(r['ratio']for r in light if r['threshold']==3)},'auth':{'groups':len(auth),'expected':36,'results':[{'engine':r['engine'],'scenario':r.get('scenario'),'status':r['status']}for r in auth.values()]},'accessibility':{'results':[{k:v for k,v in r.items()if k not in['rows','running']}for r in a11y['cases']]}if a11y else None,'pwa':pwa,'print':{'pdfs':pdf['pdfs'],'pages':pdf['pages'],'comparisons':pdf['comparisons']}if pdf else None,'exports':{'files':len(exports['files']),'comparisons':exports['comparisons']}if exports else None}
 (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(summary,ensure_ascii=True,indent=2));return summary
if __name__=='__main__':run()
