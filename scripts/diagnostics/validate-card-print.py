"""Preserve the application's existing print output, including its legacy exclusions."""
import argparse,hashlib,json,re
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode
import pymupdf
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=5203)
parser.add_argument('--out-dir',type=Path,required=True)
args=parser.parse_args();args.out_dir.mkdir(parents=True,exist_ok=True)
origin=f'http://127.0.0.1:{args.port}'
checks={'status':'RUNNING','documents':{}}
expect.set_options(timeout=30000)
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 context=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='America/Sao_Paulo',color_scheme='dark',service_workers='block')
 remote=[]
 def route(r):
  if r.request.url.startswith(origin+'/'):r.continue_()
  else:remote.append(r.request.url);r.abort()
 context.route('**/*',route)
 page=context.new_page();page.clock.set_fixed_time(datetime(2026,11,5,12,0,tzinfo=timezone.utc))
 for engine in ['legacy','v2','new']:
  for state in ['multi-card','paid','history-open']:
   reference=None
   for variant in ['main','reviewed','dark','light']:
    params={'engine':engine,'theme':'light' if variant=='light' else 'dark','case':'multi-card' if state=='history-open' else state}
    if variant in ['main','reviewed']:params['baseline']=variant
    page.goto(origin+'/scripts/diagnostics/card-preview.html?'+urlencode(params),wait_until='networkidle',timeout=120000)
    page.wait_for_function('window.__cardPreview!==undefined')
    page.wait_for_function('!document.querySelector("[aria-busy=true]")')
    initial=page.evaluate('__cardPreview.snapshot().rows')
    if state=='history-open':
     page.get_by_role('button',name='Histórico',exact=True).first.click()
     expect(page.get_by_role('tab').first).to_be_visible()
    page.evaluate('''async()=>{document.activeElement?.blur();window.scrollTo(0,0);await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}''')
    pdf=page.pdf(format='A4',print_background=True,prefer_css_page_size=True)
    name=f'{engine}-{state}-{variant}'
    target=args.out_dir/(name+'.pdf');target.write_bytes(pdf)
    doc=pymupdf.open(target);text='\n'.join(p.get_text() for p in doc)
    assert 'Cartão Sintético QA' in text or 'CARTÃO SINTÉTICO QA' in text,'Missing card identity'
    assert ('100,00' in text if state=='paid' else '123,45' in text and '900,00' in text),'Missing financial fixture'
    if state!='paid':assert '20/11/2026' in text and '20/12/2026' in text,'Missing due dates across competences'
    rasters=[]
    for i,p in enumerate(doc):
     pix=p.get_pixmap();rasters.append({'size':[pix.width,pix.height,pix.n],'sha256':hashlib.sha256(pix.samples).hexdigest()})
     if variant in ['main','light']:pix.save(args.out_dir/f'{name}-page-{i+1}.png')
    if reference is None:reference={'rasters':rasters,'text':text}
    else:assert rasters==reference['rasters'] and text==reference['text'],(name,'Print content/pagination/color regression')
    assert page.evaluate('__cardPreview.snapshot().rows')==initial,'Printing changed ledger'
    checks['documents'][name]={'pages':len(doc),'raster_identical':True,'text_sha256':hashlib.sha256(text.encode()).hexdigest(),'pdf_sha256':hashlib.sha256(pdf).hexdigest(),'page_rasters':rasters}
    (args.out_dir/(name+'.txt')).write_text(text,encoding='utf8')
   print(engine+' '+state+' PASS',flush=True)
 assert not remote,remote
 checks['remote_requests']=len(remote)
 browser.close()
checks['status']='PASS'
(args.out_dir/'validation.json').write_text(json.dumps(checks,indent=2),encoding='utf8')
