"""Four-way verification of existing browser print; no print redesign."""
import runpy, hashlib
from pathlib import Path
import pymupdf
ctx=runpy.run_path(str(Path(__file__).with_name('investment-validate-themes.py')),run_name='investment_tools')
globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
PDF=OUT/'print';PDF.mkdir(exist_ok=True);results={}
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 for v in VARIANTS:
  p=b.new_page(viewport={'width':1440,'height':1000},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-05T12:00:00Z')
  p.route('**/*',lambda r:r.continue_()if r.request.url.startswith('http://127.0.0.1:5206/')else r.abort())
  for name,e,case in [('legacy-positions','legacy','complete'),('v2-positions','v2','complete'),('v2-incomplete-history','v2','incomplete'),('asset-financing','assets','complete')]:
   if e=='assets':
    load(p,v,e,view='assets');p.locator('#settings-manage-assets').get_by_title('Ver detalhes do financiamento / consórcio').filter(visible=True).first.click()
   else:load(p,v,e,case)
   settle(p);file=PDF/f'{name}-{v}.pdf';p.pdf(path=str(file),format='A4',print_background=True,prefer_css_page_size=True)
   doc=pymupdf.open(file);pages=[]
   for i,page in enumerate(doc):
    pix=page.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False);png=PDF/f'{name}-{v}-page-{i+1}.png';pix.save(png)
    pages.append({'dimensions':list(page.rect),'text':page.get_text(),'rasterSHA256':hashlib.sha256(pix.samples).hexdigest(),'rasterFile':png.name})
   results[f'{name}-{v}']={'file':file.name,'pages':pages};doc.close();print(f'PDF {name}-{v}: {len(pages)} pages',flush=True)
  p.close()
 b.close()
comparisons=[]
for name in ['legacy-positions','v2-positions','v2-incomplete-history','asset-financing']:
 main=results[name+'-main']['pages']
 for v in ['reviewed','dark','light']:
  actual=results[name+'-'+v]['pages'];ok=len(main)==len(actual)and all(all(a[k]==c[k]for k in ['dimensions','text','rasterSHA256'])for a,c in zip(main,actual));comparisons.append({'state':name,'variant':v,'pass':ok})
(PDF/'validation.json').write_text(json.dumps({'files':results,'comparisons':comparisons},ensure_ascii=False,indent=2),encoding='utf8')
assert all(x['pass']for x in comparisons),comparisons
print(json.dumps({'PDFs':len(results),'pages':sum(len(x['pages'])for x in results.values()),'comparisons':comparisons}),flush=True)
