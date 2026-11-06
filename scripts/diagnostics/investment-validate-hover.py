import runpy
from pathlib import Path
c=runpy.run_path('scripts/diagnostics/investment-validate-themes.py',run_name='helpers');globals().update({k:v for k,v in c.items()if not k.startswith('__')})
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 for v in VARIANTS:
  for w,h in [(1440,1000),(390,844)]:
   p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-05T12:00:00Z')
   for e in ['legacy','v2']:
    load(p,v,e);hint=p.get_by_text('Saldo Investido',exact=True).locator('..').locator('div[class*="group/tooltip"]').first;hint.evaluate('(e)=>e.scrollIntoView({block:"start",inline:"nearest"})');hint.hover();capture(p,v,e,w,'a11y-existing-hint-hover')
   p.close()
 b.close()
(OUT/'run-hint-hover-four-way.json').write_text(json.dumps({'records':records}),encoding='utf8')
