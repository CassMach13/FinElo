"""Native CSV/XLSX downloads from the actual transaction UI, synthetic data only."""
import json,hashlib,zipfile
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend
from integrated_validate_helpers import launch,boot,navigate,settle,OUT
DEST=OUT/'exports';DEST.mkdir(exist_ok=True)
def canonical(file):
 if file.suffix=='.csv':return{'csv':hashlib.sha256(file.read_bytes()).hexdigest()}
 with zipfile.ZipFile(file)as z:return{n:hashlib.sha256(z.read(n)).hexdigest()for n in z.namelist()if n.startswith('xl/worksheets/')or n in['xl/sharedStrings.xml','xl/styles.xml']}
def run():
 rows=[]
 with sync_playwright()as pw:
  b=launch(pw,'edge')
  for v in['reviewed','dark','light']:
   backend=Backend(preference='dark');context=b.new_context(accept_downloads=True,viewport={'width':1440,'height':1000},timezone_id='America/Sao_Paulo');context.route('**/*',backend.route);p=context.new_page();p.clock.set_fixed_time('2026-11-06T12:00:00Z');boot(p,baseline='reviewed'if v=='reviewed'else None)
   if v=='light':p.evaluate("window.__integratedQa.theme('light')");settle(p)
   navigate(p,'transactions')
   for kind,ext in[('csv','csv'),('excel','xlsx')]:
    selector=p.locator('select').filter(has=p.locator('option[value='+kind+']')).filter(visible=True)
    with p.expect_download()as pending:selector.select_option(kind)
    download=pending.value;file=DEST/f'{v}.{ext}';download.save_as(file);row={'variant':v,'format':ext,'file':file.name,'bytes':file.stat().st_size,'canonical':canonical(file),'financialWrites':[w for w in backend.writes if w['kind']=='data'and w['table']!='product_events']};rows.append(row);print(json.dumps({k:x for k,x in row.items()if k!='canonical'}),flush=True)
   context.close()
  b.close()
 comparisons=[]
 for ext in['csv','xlsx']:
  original=next(r for r in rows if r['variant']=='reviewed'and r['format']==ext)
  for v in['dark','light']:
   current=next(r for r in rows if r['variant']==v and r['format']==ext);comparisons.append({'variant':v,'format':ext,'status':'PASS'if original['canonical']==current['canonical']and not current['financialWrites']else'FAIL'})
 (DEST/'validation.json').write_text(json.dumps({'files':rows,'comparisons':comparisons},ensure_ascii=False,indent=2),encoding='utf8');return comparisons
if __name__=='__main__':run()
