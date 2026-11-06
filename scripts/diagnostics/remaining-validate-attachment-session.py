"""Pending window lifetime against the real UI; no real popup, URL or storage request."""
import runpy,json
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('remaining-validate-themes.py')),run_name='remaining_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
report=[]
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True)
 for w,h in [(1440,1000),(390,844)]:
  for theme in ['dark','light']:
   for mode in ['direct','logout','same-id','navigate','error-after-switch']:
    p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-06T12:00:00Z');load(p,theme,'help',popup='synthetic');p.locator('#help-tab-history').click();p.get_by_role('button',name='Ver arquivo anexado',exact=True).first.wait_for();p.evaluate("window.__remainingPreview.hold('storage')");p.get_by_role('button',name='Ver arquivo anexado',exact=True).first.click();settle(p)
    assert p.evaluate('window.__remainingPreview.popups()')==[{'closed':False,'navigations':[]}]
    if mode=='same-id':p.evaluate("window.__remainingPreview.authEvent('TOKEN_REFRESHED')")
    elif mode=='navigate':action(p,'Objetivos').click()
    else:
     if mode=='logout':p.evaluate('window.__remainingPreview.auth(null)');settle(p)
     p.evaluate("window.__remainingPreview.auth('10000000-0000-4000-8000-000000000002')")
    settle(p)
    if mode!='same-id':assert p.evaluate('window.__remainingPreview.popups()[0].closed')is True
    p.evaluate("()=>{window.__remainingPreview.release('storage');"+("window.__remainingPreview.fail('storage');"if mode=='error-after-switch'else'')+"}");settle(p)
    actual=p.evaluate('window.__remainingPreview.popups()')[0];expected=mode=='same-id';assert bool(actual['navigations'])==expected,(mode,actual)
    assert not action(p,'Entendi').count(),'A cancelled old request must not open a global error in B'
    p.screenshot(path=str(OUT/f'attachment-session-{mode}-{w}-{theme}.png'));report.append({'theme':theme,'width':w,'mode':mode,'pass':True,'popup':actual});p.close()
 b.close()
(OUT/'attachment-session-validation.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps({'cases':len(report),'pass':True}))
