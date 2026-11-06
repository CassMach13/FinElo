"""Actual App print, reviewed Dark/current Dark/current Light."""
from pathlib import Path
import json,hashlib
import pymupdf
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend
from integrated_validate_helpers import launch,boot,navigate,settle,OUT

PDF=OUT/'print';PDF.mkdir(exist_ok=True);records={}
def pages(file):
 doc=pymupdf.open(file);data=[]
 for page in doc:
  pix=page.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False);data.append({'dimensions':list(page.rect),'text':page.get_text(),'rasterSHA256':hashlib.sha256(pix.samples).hexdigest()})
 doc.close();return data
def run():
 with sync_playwright()as pw:
  browser=launch(pw,'edge')
  for variant in['reviewed','dark','light']:
   backend=Backend(preference='dark');context=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='America/Sao_Paulo',accept_downloads=True);context.route('**/*',backend.route);p=context.new_page();p.clock.set_fixed_time('2026-11-06T12:00:00Z');boot(p,baseline='reviewed'if variant=='reviewed'else None)
   if variant=='light':p.evaluate("window.__integratedQa.theme('light')");settle(p)
   for name in['dashboard','transactions','investments','goal-form']:
    navigate(p,'goals'if name=='goal-form'else name)
    if name=='goal-form':p.get_by_role('button',name='+ Novo objetivo',exact=True).click()
    p.evaluate('document.activeElement?.blur()');settle(p);file=PDF/f'{name}-{variant}.pdf';p.pdf(path=str(file),format='A4',print_background=True,prefer_css_page_size=True);records[name+'-'+variant]={'file':file.name,'pages':pages(file)};print(json.dumps({'pdf':file.name,'pages':len(records[name+'-'+variant]['pages'])}),flush=True)
    if name=='goal-form':p.get_by_role('button',name='Cancelar',exact=True).click()
   context.close()
  browser.close()
 comparison=[]
 for name in['dashboard','transactions','investments','goal-form']:
  for v in['dark','light']:comparison.append({'scenario':name,'variant':v,'status':'PASS'if records[name+'-reviewed']['pages']==records[name+'-'+v]['pages']else'FAIL'})
 report={'files':records,'comparisons':comparison,'pdfs':len(records),'pages':sum(len(r['pages'])for r in records.values())};(PDF/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'pdfs':report['pdfs'],'pages':report['pages'],'comparisons':comparison}));return report
if __name__=='__main__':run()
