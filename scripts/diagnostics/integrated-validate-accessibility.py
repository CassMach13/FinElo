"""Bounded keyboard/reflow/system preference probes; no screen-reader certification."""
import json
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend,A,fixture
from integrated_validate_helpers import launch,boot,navigate,settle,OUT
from remaining_visual_checks import AUDIT_JS

def metrics(p):return p.evaluate("()=>({width:innerWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,mainOverflow:document.querySelector('main')?.scrollWidth-document.querySelector('main')?.clientWidth,unnamedNav:[...document.querySelectorAll('[data-appearance-part=shell-nav] button')].filter(e=>e.getClientRects().length&&!e.innerText.trim()&&!e.getAttribute('aria-label')&&!e.title).length})")
def run():
 results=[]
 with sync_playwright()as pw:
  for engine in['edge','chrome','firefox','webkit']:
   try:b=launch(pw,engine)
   except Exception as e:results.append({'engine':engine,'status':'BLOCKED','reason':str(e)});continue
   backend=Backend();context=b.new_context(viewport={'width':1440,'height':1000},timezone_id='America/Sao_Paulo',reduced_motion='reduce');context.route('**/*',backend.route);p=context.new_page();p.clock.set_fixed_time('2026-11-06T12:00:00Z');boot(p,capture_styles=False);p.evaluate("window.__integratedQa.theme('light')");settle(p)
   try:
    first=p.locator('[data-appearance-part=shell-nav]').first.get_by_role('button',name='Dashboard',exact=True);first.focus();visited=[]
    for view in['dashboard','transactions','import','investments','goals','settings']:
     if view!='dashboard':p.keyboard.press('Tab')
     p.keyboard.press('Enter');p.wait_for_function('(v)=>window.__integratedQa.snapshot().view===v',arg=view);visited.append(view)
    p.keyboard.press('Tab');p.keyboard.press('Tab');p.keyboard.press('Enter');p.wait_for_function("window.__integratedQa.snapshot().view==='help'");results.append({'engine':engine,'scenario':'keyboard-navigation','status':'PASS','views':visited+['help']})
   except Exception as e:results.append({'engine':engine,'scenario':'keyboard-navigation','status':'FAIL','reason':str(e)})
   for width,label in[(720,'reflow-equivalent-200'),(360,'reflow-equivalent-400'),(844,'landscape-viewport')]:
    navigate(p,'dashboard');p.set_viewport_size({'width':width,'height':390 if width==844 else 1000});settle(p);m=metrics(p);results.append({'engine':engine,'scenario':label,'status':'FAIL'if m['documentOverflow']>0 or m['unnamedNav']else'PASS','nativeBrowserZoom':False,**m});p.screenshot(path=str(OUT/f'a11y-{engine}-{label}.png'))
   p.set_viewport_size({'width':390,'height':844});navigate(p,'goals');p.get_by_role('button',name='+ Novo objetivo',exact=True).click();p.locator('#goal-month').fill('2027-12');p.locator('#goal-month').focus();p.keyboard.press('Tab');audit=p.evaluate(AUDIT_JS);results.append({'engine':engine,'scenario':'native-month-control','status':'PASS'if all(r['pass']for r in audit['rows'])else'FAIL','inputType':p.locator('#goal-month').evaluate('e=>e.type'),'rows':audit['rows']});p.keyboard.press('Escape')
   p.emulate_media(forced_colors='active');effective=p.evaluate("matchMedia('(forced-colors: active)').matches");results.append({'engine':engine,'scenario':'forced-colors-emulation','status':'PASS'if effective else'NOT TESTED','effective':effective,'screenReaderTest':False});p.screenshot(path=str(OUT/f'a11y-{engine}-forced-colors.png'));p.emulate_media(forced_colors='none')
   # A loading state, not screenshot-injected animation suppression.
   loading=context.new_page();boot(loading,login='none',capture_styles=False);backend.held.add('read:financial_goals');loading.evaluate("window.__integratedQa.navigate('goals')");loading.wait_for_timeout(100);running=loading.evaluate("document.getAnimations().filter(a=>a.playState==='running').map(a=>({animationName:a.animationName||null,iterations:a.effect?.getTiming().iterations===Infinity?'infinite':a.effect?.getTiming().iterations}))");results.append({'engine':engine,'scenario':'reduced-motion-observed','status':'FAIL'if running else'PASS','running':running,'effective':loading.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches")});backend.release('read:financial_goals');context.close();b.close()
  # Reproduce the legacy delayed tour using the approved baseline and current.
  for baseline in['reviewed',None]:
   b=launch(pw,'edge');backend=Backend();context=b.new_context(viewport={'width':1440,'height':1000});context.route('**/*',backend.route);p=context.new_page();boot(p,baseline=baseline,dismiss_tour=False);p.evaluate("window.__integratedQa.navigate('transactions')");p.wait_for_timeout(2000);visible=p.locator('.driver-popover').filter(visible=True).count()>0;title=p.locator('.driver-popover-title').inner_text()if visible else'';results.append({'scenario':'legacy-delayed-tour-after-navigation','baseline':baseline or'current','status':'FAIL'if visible and'Bem-vindo'in title else'PASS','tourTitle':title,'currentView':p.evaluate('window.__integratedQa.snapshot().view')});p.screenshot(path=str(OUT/f'legacy-delayed-tour-{baseline or"current"}.png'));context.close();b.close()
 (OUT/'accessibility-validation.json').write_text(json.dumps({'cases':results,'nativeZoom':'NOT TESTED','screenReaders':'NOT TESTED','physicalTouch':'NOT TESTED'},ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps([{k:v for k,v in r.items()if k not in['rows','running']}for r in results],ensure_ascii=True));return results
if __name__=='__main__':run()
