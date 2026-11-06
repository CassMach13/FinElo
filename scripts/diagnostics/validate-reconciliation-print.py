"""Compare the existing print contract through real card/reconciliation entry points."""
import argparse,hashlib,json
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode
import pymupdf
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=5204);parser.add_argument('--out-dir',type=Path,required=True)
args=parser.parse_args();args.out_dir.mkdir(parents=True,exist_ok=True);origin=f'http://127.0.0.1:{args.port}'
checks={'status':'RUNNING','documents':{}};reference={};expect.set_options(timeout=30000)
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1,timezone_id='America/Sao_Paulo',color_scheme='dark',service_workers='block');remote=[];errors=[]
 def route(r):
  if r.request.url.startswith(origin+'/'):r.continue_()
  else:remote.append(r.request.url);r.abort()
 context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.clock.set_fixed_time(datetime(2026,11,5,12,0,tzinfo=timezone.utc))
 for variant in ['main','reviewed','dark','light']:
  query={'case':'paid','view':'entry','engine':'new','theme':'light' if variant=='light' else 'dark'}
  if variant in ['main','reviewed']:query['baseline']=variant
  page.goto(origin+'/scripts/diagnostics/reconciliation-preview.html?'+urlencode(query),wait_until='networkidle',timeout=120000)
  page.get_by_role('button',name='Ver diferença',exact=True).first.click()
  expect(page.get_by_role('heading',name='Conciliar diferença — 2026-09',exact=True)).to_be_visible()
  for state in ['pending','confirmation','resolved','reversed']:
   if state=='confirmation':page.get_by_role('button',name='É ajuste ou diferença do banco',exact=False).click()
   if state=='resolved':
    page.get_by_role('button',name='Confirmar resolução',exact=True).click();expect(page.get_by_text('Resolução registrada.',exact=True)).to_be_visible()
   if state=='reversed':
    page.locator('.fixed.inset-0').last.locator('button').first.click()
    page.get_by_role('button',name='Conciliação',exact=True).first.click();page.get_by_role('button',name='Desfazer',exact=True).click()
    expect(page.get_by_role('heading',name='Conciliar diferença — 2026-09',exact=True)).to_be_visible()
   page.evaluate('''async()=>{document.activeElement?.blur();window.scrollTo(0,0);await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}''')
   before=page.evaluate('({reconciliation:__reconciliationPreview.snapshot(),card:__cardPreview.snapshot()})')
   name=f'{variant}-{state}';raw=page.pdf(format='A4',print_background=True,prefer_css_page_size=True)
   target=args.out_dir/(name+'.pdf');target.write_bytes(raw);doc=pymupdf.open(target)
   text='\n'.join(p.get_text() for p in doc);assert '100,22' in text and 'Cartão Sintético QA' in text,'Financial fixture missing from existing print'
   rasters=[]
   for index,p in enumerate(doc):
    pix=p.get_pixmap();rasters.append({'size':[pix.width,pix.height,pix.n],'sha256':hashlib.sha256(pix.samples).hexdigest()})
    if variant in ['main','light']:pix.save(args.out_dir/f'{name}-page-{index+1}.png')
   if state not in reference:reference[state]={'rasters':rasters,'text':text,'financial':before}
   else:
    assert reference[state]['rasters']==rasters and reference[state]['text']==text,(name,'Print regression')
    assert reference[state]['financial']==before,(name,'Financial regression')
   after=page.evaluate('({reconciliation:__reconciliationPreview.snapshot(),card:__cardPreview.snapshot()})')
   assert before==after,'Print changed financial state or calls'
   (args.out_dir/(name+'.txt')).write_text(text,encoding='utf8')
   (args.out_dir/('financial-'+name+'.json')).write_text(json.dumps(before,ensure_ascii=False,indent=2),encoding='utf8')
   checks['documents'][name]={'pages':len(doc),'raster_identical':True,'text_sha256':hashlib.sha256(text.encode()).hexdigest(),'pdf_sha256':hashlib.sha256(raw).hexdigest(),'page_rasters':rasters}
   print(name+' PASS',flush=True)
 assert not remote,remote;assert not errors,errors;browser.close()
checks.update({'status':'PASS','remote_requests':len(remote),'javascript_errors':errors})
(args.out_dir/'validation.json').write_text(json.dumps(checks,indent=2),encoding='utf8')
