"""Original unclassification/archive handlers, with unchanged monetary positions."""
import runpy
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('investment-validate-themes.py')),run_name='investment_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 for v in VARIANTS:
  for w,h in [(1440,1000),(390,844)]:
   p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-05T12:00:00Z');p.on('pageerror',lambda err:errors.append(str(err)));p.route('**/*',lambda r:r.continue_()if r.request.url.startswith('http://127.0.0.1:5206/')else(r.abort(),blocked.append(r.request.url)))
   load(p,v,'v2');before=snap(p);p.locator('button[data-classification-badge]').filter(visible=True).first.click();p.locator('#classify-portfolio').focus();click(p,'Remover da carteira');p.locator('.fixed.inset-0 button').last.focus();p.mouse.move(0,0);capture(p,v,'v2',w,'undo-confirm');click(p,'Cancelar');p.locator('#classify-portfolio').focus();capture(p,v,'v2',w,'undo-cancel');assert not snap(p)['events'];click(p,'Remover da carteira');click(p,'Remover');expect(p.locator('#classify-portfolio')).to_have_count(0);p.mouse.move(0,0);p.evaluate('document.activeElement?.blur()');capture(p,v,'v2',w,'undo-saved')
   p.get_by_role('button',name='Gerenciar carteira Reserva sintética QA',exact=True).click();click(p,'Arquivar');p.locator('.fixed.inset-0 button').last.focus();p.mouse.move(0,0);capture(p,v,'v2',w,'archive-confirm');click(p,'Arquivar');expect(p.locator('.fixed.inset-0').last.locator('button').filter(has_text=re.compile('^Desarquivar$'))).to_be_visible();p.mouse.move(0,0);p.locator('.fixed.inset-0 button').first.focus();capture(p,v,'v2',w,'archive-saved');click(p,'Desarquivar');expect(p.locator('.fixed.inset-0').last.locator('button').filter(has_text=re.compile('^Arquivar$'))).to_be_visible();p.mouse.move(0,0);p.locator('.fixed.inset-0 button').first.focus();capture(p,v,'v2',w,'unarchive-saved')
   after=snap(p);assert[(r['id'],r['balance'],r['user_id'],r['reference_month'])for r in before['db']['investments']]==[(r['id'],r['balance'],r['user_id'],r['reference_month'])for r in after['db']['investments']];assert after['source']['transactions']==before['source']['transactions'];assert after['source']['economicEvents']==before['source']['economicEvents'];p.close()
 b.close()
(OUT/'run-classification-undo-all.json').write_text(json.dumps({'records':records,'pageErrors':errors,'blockedNetwork':blocked},ensure_ascii=False,indent=2),encoding='utf8')
assert not errors,errors
assert not blocked,blocked
print(json.dumps({'captures':len(records),'pageErrors':errors,'blockedNetwork':blocked}),flush=True)
