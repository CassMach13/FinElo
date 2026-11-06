"""Real App public boundary and synthetic flag/cohort sample, never a rollout."""
import runpy,json,sys
from pathlib import Path
from urllib.parse import urlencode
ctx=runpy.run_path(str(Path(__file__).with_name('remaining-validate-themes.py')),run_name='remaining_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
checks=[]
A='10000000-0000-4000-8000-000000000001';B='10000000-0000-4000-8000-000000000002'

def boot(p,port,**q):
 p.goto(f'http://127.0.0.1:{port}/scripts/diagnostics/remaining-preview.html?'+urlencode(q),wait_until='networkidle',timeout=120000);p.wait_for_function('window.__remainingPreview!==undefined');settle(p)

def ok(name,w,**details):checks.append({'scenario':name,'width':w,'pass':True,**details});print(json.dumps(checks[-1]),flush=True)
def sample(p,theme):p.wait_for_function("t=>document.querySelector('[aria-label=\"Piloto de aparência\"] [data-finelo-theme]')?.dataset.fineloTheme===t",arg=theme)

def run_boundaries():
 with sync_playwright()as pw:
  b=pw.chromium.launch(channel='msedge',headless=True,args=RENDER_ARGS)
  for w,h in[(1440,1000),(390,844)]:
   p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo',color_scheme='dark');p.route('**/*',lambda r:r.continue_()if r.request.url.startswith(('http://127.0.0.1:5207/','http://127.0.0.1:5208/'))else r.abort());p.clock.set_fixed_time('2026-11-06T12:00:00Z')
   for port,pilot in[(5207,'eligible'),(5208,'ineligible')]:
    boot(p,port,view='settings',theme='dark',pilot=pilot,preference='light');assert p.get_by_role('region',name='Piloto de aparência').count()==0 and p.locator('[data-finelo-theme=light]').count()==0;ok('flag-off'if port==5207 else'outside-cohort',w)
   boot(p,5208,view='settings',theme='dark',pilot='eligible',preference='dark');pilot=p.get_by_role('region',name='Piloto de aparência');pilot.wait_for();sample(p,'dark');before=p.evaluate('window.__remainingPreview.snapshot()')
   for choice,theme in[('Claro','light'),('Escuro','dark'),('Automático','dark')]:
    pilot.get_by_label(choice,exact=True).check();sample(p,theme);p.wait_for_function("()=>!document.querySelector('[aria-label=\"Piloto de aparência\"] fieldset').disabled")
   p.emulate_media(color_scheme='light');sample(p,'light');p.emulate_media(color_scheme='dark');sample(p,'dark')
   after=p.evaluate('window.__remainingPreview.snapshot()');assert before['db']==after['db'] and before['events']==after['events'];assert p.locator('#main-layout').evaluate("e=>e.closest('[data-finelo-theme]').dataset.fineloTheme")=='dark';ok('sample-dark-light-automatic-os-no-finance-global-dark',w)
   p.evaluate("window.__remainingPreview.fail('appearance:'+window.__remainingPreview.snapshot().actor)");pilot.get_by_label('Claro',exact=True).click();pilot.get_by_role('alert').wait_for();sample(p,'dark');ok('sample-save-failure-keeps-confirmed',w)
   p.evaluate("window.__remainingPreview.release('appearance:'+window.__remainingPreview.snapshot().actor)");pilot.get_by_label('Claro',exact=True).check();sample(p,'light');p.evaluate("window.__remainingPreview.authEvent('TOKEN_REFRESHED')");sample(p,'light');p.evaluate("window.__remainingPreview.authEvent('USER_UPDATED')");sample(p,'light');ok('confirmed-after-auth-events',w)
   p.evaluate('(id)=>window.__remainingPreview.auth(id)',B);settle(p);assert p.get_by_role('region',name='Piloto de aparência').count()==0 and p.locator('[data-finelo-theme=light]').count()==0;ok('switch-to-ineligible-no-previous-sample',w)
   for route in ['/','/login','/pricing','/update-password']:
    boot(p,5208,actual='true',anonymous='true',route=route,view='settings',pilot='eligible',preference='light');assert p.locator('[data-finelo-theme=light]').count()==0 and p.get_by_role('region',name='Piloto de aparência').count()==0;assert not p.evaluate("document.body.innerText.includes('Pessoa_A_QA')");file=f'public-{route.strip("/")or"landing"}-{w}.png';p.screenshot(path=str(OUT/file));ok('public-excluded-'+route,w,image=file)
   # Actual application has no encompassing Light theme, even with a saved Light preference.
   boot(p,5208,actual='true',route='/app?view=settings',view='settings',pilot='eligible',preference='light');p.locator('#main-layout').wait_for();sample(p,'light');assert p.locator('#main-layout').evaluate("e=>e.closest('[data-finelo-theme]')===null");p.evaluate('window.__remainingPreview.auth(null)');settle(p);assert p.locator('#main-layout').count()==0 and p.locator('[data-finelo-theme=light]').count()==0;ok('actual-app-light-only-in-sample-logout-clears',w)
   p.close()
  b.close()
 (OUT/'4c3-boundaries.json').write_text(json.dumps({'checks':checks},ensure_ascii=False,indent=2),encoding='utf8')
if __name__=='__main__':run_boundaries()
