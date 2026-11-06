"""Existing Dashboard print contract; original SVG geometry and financial payloads."""
import argparse,json,hashlib
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode
import pymupdf
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=5205);p.add_argument('--out-dir',type=Path,required=True);a=p.parse_args();a.out_dir.mkdir(parents=True,exist_ok=True)
origin=f'http://127.0.0.1:{a.port}';checks={'status':'RUNNING','documents':{}};refs={}
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 c=b.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1,timezone_id='America/Sao_Paulo',color_scheme='dark',service_workers='block');remote=[];errors=[]
 def route(r):
  if r.request.url.startswith(origin+'/'):r.continue_()
  else:remote.append(r.request.url);r.abort()
 c.route('**/*',route);page=c.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.clock.set_fixed_time(datetime(2026,11,5,12,0,tzinfo=timezone.utc))
 for variant in ['main','reviewed','dark','light']:
  for name,params in [('current',{}),('legacy-compare',{'networth':'legacy','scope':'off','compare':'true','period':'yearly'}),('family',{'case':'family'})]:
   q={'theme':'light' if variant=='light' else 'dark',**params}
   if variant in ['main','reviewed']:q['baseline']=variant
   page.goto(origin+'/scripts/diagnostics/dashboard-preview.html?'+urlencode(q),wait_until='networkidle',timeout=120000);page.wait_for_function('window.__dashboardPreview!==undefined');page.wait_for_function('!document.body.innerText.includes("Carregando a posição patrimonial atual")')
   page.evaluate('''async()=>{window.scrollTo(0,0);document.activeElement?.blur();await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}''');page.wait_for_timeout(200)
   page.evaluate('()=>{window.__printCalls=0;window.print=()=>{window.__printCalls++}}');page.get_by_role('button',name='Exportar PDF',exact=True).click();page.wait_for_function('__printCalls===1')
   before=page.evaluate('__dashboardPreview.snapshot()');page.emulate_media(media='print');page.wait_for_timeout(300)
   svg=page.locator('#dashboard-annual-evolution svg[role=img]').evaluate('(e)=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,viewBox:e.getAttribute("viewBox"),paths:e.querySelectorAll("path").length})')
   assert svg['width']>0 and svg['height']>0 and svg['paths']>0
   raw=page.pdf(format='A4',print_background=True,prefer_css_page_size=True);target=a.out_dir/f'{variant}-{name}.pdf';target.write_bytes(raw);doc=pymupdf.open(target)
   text='\n'.join(p.get_text() for p in doc);assert 'Evolução anual' in text and 'patrimônio' in text.lower() and 'R$' in text and '2026' in text
   rasters=[]
   for index,pdfpage in enumerate(doc):
    pix=pdfpage.get_pixmap();rasters.append({'dimensions':list(pdfpage.rect),'size':[pix.width,pix.height,pix.n],'sha256':hashlib.sha256(pix.samples).hexdigest(),'drawings':len(pdfpage.get_drawings())})
    if variant in ['main','light']:pix.save(a.out_dir/f'{variant}-{name}-page-{index+1}.png')
   values={k:before[k] for k in ['fixture','source','financialProps','financialCents','events','currentView']}
   record={'rasters':rasters,'text':text,'values':values,'svg':svg}
   if variant=='main':refs[name]=record
   else:assert refs[name]==record,(variant,name,'print differs')
   after=page.evaluate('__dashboardPreview.snapshot()');assert before==after,'Print changed financial source or requests'
   (a.out_dir/f'{variant}-{name}.txt').write_text(text,encoding='utf8');(a.out_dir/f'{variant}-{name}-financial.json').write_text(json.dumps(before,ensure_ascii=False,indent=2),encoding='utf8')
   checks['documents'][variant+'-'+name]={'pages':len(doc),'sha256':hashlib.sha256(raw).hexdigest(),'raster_identical':True,'text_sha256':hashlib.sha256(text.encode()).hexdigest(),'page_rasters':rasters,'annual_svg':svg}
   print(variant+' '+name+' PASS '+str(len(doc))+' pages',flush=True);page.emulate_media(media='screen')
 assert not remote,remote;assert not errors,errors;b.close()
checks.update({'status':'PASS','remote_requests':0,'javascript_errors':errors});(a.out_dir/'validation.json').write_text(json.dumps(checks,indent=2),encoding='utf8')
