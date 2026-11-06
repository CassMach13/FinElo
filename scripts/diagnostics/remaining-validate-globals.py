"""Authenticated residual surfaces. SW/install/clipboard are test boundaries, never OS actions."""
import runpy,json,sys
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('remaining-validate-themes.py')),run_name='remaining_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
SW="""export function useRegisterSW(){const R=window.__remainingReact,p=new URLSearchParams(location.search),[offline,setOffline]=R.useState(p.get('pwa')==='offline'),[update,setUpdate]=R.useState(p.get('pwa')==='update');return{offlineReady:[offline,setOffline],needRefresh:[update,setUpdate],updateServiceWorker:()=>{window.__syntheticUpdateRequests=(window.__syntheticUpdateRequests||0)+1}}}"""
def routing(route):
 u=route.request.url
 if 'virtual:pwa-register' in u or 'virtual%3Apwa-register'in u:route.fulfill(status=200,content_type='application/javascript',body=SW)
 elif '/_vercel/'in u:route.fulfill(status=200,content_type='application/javascript',body='')
 elif u.startswith('http://127.0.0.1:5207/'):route.continue_()
 else:route.abort()
def one(p,v,w,name):
 extra={};view='goals'
 if name.startswith('terms'):extra['terms']='readonly'
 if name.startswith('pin'):extra['lock']='on'
 if name=='auth-checking':extra['checking']='true'
 if name.startswith('pwa-'):extra['pwa']=name.split('-')[1]
 if name.startswith('install'):extra['install']='standalone'
 if name.startswith('tour-'):view=name.split('-')[1];extra['admin']='true'if view=='admin'else'false'
 load(p,v,view,**extra)
 if name=='account-menu':p.get_by_text('Pe',exact=True).filter(visible=True).first.click()
 if name.startswith('dialog-'):p.evaluate('(k)=>window.__remainingPreview.dialog(k)',name.split('-')[1])
 if name=='terms-bottom':p.evaluate("()=>{const e=[...document.querySelectorAll('div')].find(e=>e.classList.contains('max-h-[60vh]'));e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll',{bubbles:true}))}")
 if name=='pin-entered':action(p,'5').click();action(p,'4').click()
 if name=='pin-unlocked':
  for x in ['5','4','3','2']:action(p,x).click()
  p.get_by_role('heading',name='Objetivos',exact=True).wait_for()
 if name.startswith('install'):
  p.evaluate("()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=()=>{window.__syntheticInstallRequests=(window.__syntheticInstallRequests||0)+1};window.dispatchEvent(e)}");settle(p)
  if name=='install-instructions':action(p,'Instalar Agora').filter(visible=True).last.click()
 if name.startswith('tour-'):
  action(p,'Iniciar Tutorial').click()
  if name=='tour-admin':p.get_by_text('Não há tutorial específico para esta tela ainda.',exact=True).wait_for()
  else:p.locator('.driver-popover').wait_for()
 cap(p,v,w,'global-'+name)
def run_global(probe=False):
 states=['shell','account-menu','dialog-warning','dialog-danger','dialog-info','terms-top','terms-bottom','pin-locked','pin-entered','pin-unlocked','auth-checking','pwa-offline','pwa-update','install-card','install-instructions','tour-settings','tour-help','tour-admin']
 with sync_playwright()as pw:
  b=pw.chromium.launch(channel='msedge',headless=True,args=RENDER_ARGS)
  for w,h in[(1440,1000),(390,844)]:
   for v in ['light']if probe else VARIANTS:
    for name in states:
     options={'viewport':{'width':w,'height':h},'timezone_id':'America/Sao_Paulo'}
     if name=='install-instructions':options['user_agent']='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
     p=b.new_page(**options);p.clock.set_fixed_time('2026-11-06T12:00:00Z');p.route('**/*',routing);errors=[];p.on('pageerror',lambda e:errors.append(str(e)));one(p,v,w,name);assert not errors,(name,errors);p.close()
  b.close()
 if not probe:return compare('4c3')
 failures=[{'state':r['state'],'width':r['width'],**row}for r in RESULTS for row in r['audit']['rows']if not row['pass']];(OUT/'4c3-probe.json').write_text(json.dumps({'captures':len(RESULTS),'failures':failures},ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'captures':len(RESULTS),'failures':failures},ensure_ascii=True));return{'issues':failures}
if __name__=='__main__':r=run_global('--probe'in sys.argv);sys.exit(bool(r['issues']))
