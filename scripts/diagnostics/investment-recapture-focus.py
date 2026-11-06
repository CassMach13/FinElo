"""Equalize native-control focus across versions before raster comparison."""
import runpy
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('investment-validate-themes.py')),run_name='investment_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 for v in VARIANTS:
  for w,h in [(1440,1000),(390,844)]:
   p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-05T12:00:00Z');p.route('**/*',lambda r:r.continue_()if r.request.url.startswith('http://127.0.0.1:5206/')else r.abort())
   for e in ['legacy','v2']:
    load(p,v,e);click(p,'Adicionar');fields=p.locator('.fixed.inset-0 input');fields.nth(0).fill('Instituição manual QA');fields.nth(1).fill('Renda Fixa');fields.nth(2).fill('Posição manual QA');fields.nth(3).fill('1234.56');fields.nth(4).fill('1000.01');fields.nth(5).fill('2026-10-15');fields.nth(6).fill('2027-01-20');fields.first.focus();p.mouse.move(0,0);capture(p,v,e,w,'add-filled');click(p,'Cancelar')
    row_action(p,'Editar');p.locator('.fixed.inset-0 input').first.focus();p.mouse.move(0,0);capture(p,v,e,w,'edit');click(p,'Cancelar')
    if e=='v2':
     p.locator('button[data-classification-badge]').filter(visible=True).first.click();p.locator('#classify-portfolio').focus();p.mouse.move(0,0);capture(p,v,e,w,'classification');p.locator('#classify-portfolio').select_option(label='Longo prazo QA');capture(p,v,e,w,'classification-move')
   p.close()
 b.close()
(OUT/'run-recapture-focus.json').write_text(json.dumps({'records':records,'reason':'same native focus and pointer state; no product change or larger raster tolerance'},ensure_ascii=False,indent=2),encoding='utf8')
