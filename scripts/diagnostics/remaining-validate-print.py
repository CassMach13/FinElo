"""Existing print contracts, exact page/text/dimension/raster comparisons."""
import runpy,hashlib,json,sys
from pathlib import Path
import pymupdf
ctx=runpy.run_path(str(Path(__file__).with_name('remaining-validate-themes.py')),run_name='remaining_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
PDF=OUT/'print';PDF.mkdir(exist_ok=True);result={}
cases=[('goals','goals','complete'),('goals-long','goals','long'),('goal-form','goals','complete'),('accounts','accounts','complete'),('settings','settings','complete'),('asset-detail','settings','complete'),('help','help','complete'),('admin','admin','complete'),('pricing','pricing','complete'),('success','success','complete')]
stage=sys.argv[1]if len(sys.argv)>1 else'all'
if stage=='4c1':cases=cases[:6]
elif stage=='4c2':cases=cases[6:]
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 for v in VARIANTS:
  p=b.new_page(viewport={'width':1440,'height':1000},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-06T12:00:00Z');p.route('**/*',lambda r:r.continue_()if r.request.url.startswith('http://127.0.0.1:5207/')else r.abort())
  for name,view,case in cases:
   load(p,v,view,case,**({'admin':'true'}if name=='admin'else{}))
   if name=='goal-form':action(p,'+ Novo objetivo').click()
   if name=='asset-detail':p.locator('#settings-manage-assets').get_by_title('Ver detalhes do financiamento / consórcio').filter(visible=True).first.click()
   settle(p);file=PDF/f'{name}-{v}.pdf';p.pdf(path=str(file),format='A4',print_background=True,prefer_css_page_size=True)
   doc=pymupdf.open(file);pages=[]
   for i,page in enumerate(doc):
    pix=page.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False);png=PDF/f'{name}-{v}-{i+1}.png';pix.save(png);pages.append({'dimensions':list(page.rect),'text':page.get_text(),'rasterSHA256':hashlib.sha256(pix.samples).hexdigest(),'rasterFile':png.name})
   result[name+'-'+v]={'file':file.name,'pages':pages};doc.close();print(f'PDF {name}-{v}: {len(pages)}',flush=True)
  p.close()
 b.close()
comparisons=[]
for name,_,_ in cases:
 main=result[name+'-main']['pages']
 for v in ['reviewed','dark','light']:
  actual=result[name+'-'+v]['pages'];comparisons.append({'state':name,'variant':v,'pass':main==actual or len(main)==len(actual)and all(all(a[k]==b[k]for k in ['dimensions','text','rasterSHA256'])for a,b in zip(main,actual))})
report={'files':result,'comparisons':comparisons};(PDF/(stage+'-validation.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'PDFs':len(result),'pages':sum(len(r['pages'])for r in result.values()),'failures':[r for r in comparisons if not r['pass']]}));assert all(r['pass']for r in comparisons)
