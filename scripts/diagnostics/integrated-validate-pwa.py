"""Real browser service worker/cache on loopback; not an OS-installed PWA test."""
import json,os,subprocess,time,hashlib
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend,A,B

ROOT=Path.cwd();TOOLS=ROOT/'node_modules/.finelo-cycle4d-tools';OUT=TOOLS/'evidence';OUT.mkdir(exist_ok=True)
env={**os.environ,'GEMINI_API_KEY':'','VITE_SUPABASE_URL':'https://integrated-fixture.invalid','VITE_SUPABASE_PUBLISHABLE_KEY':'synthetic-public-key','VITE_SUPABASE_ANON_KEY':'synthetic-public-key','VITE_APPEARANCE_PILOT':'true','VITE_CARD_ENGINE_FORCE':'false','VITE_CARD_V2_FORCE':'false'}
results=[]
def record(name,status='PASS',**detail):results.append({'scenario':name,'status':status,**detail});print(json.dumps(results[-1],ensure_ascii=True),flush=True)
def ready(p,actor=A):p.wait_for_function('window.__integratedQa!==undefined');p.wait_for_function('(id)=>window.__integratedQa.snapshot().actor===id',arg=actor,timeout=30000)
def theme(p):return p.locator('[data-qa-eligible]').get_attribute('data-finelo-theme')
def screenshot(p,name):p.screenshot(path=str(OUT/f'pwa-{name}.png'))

def run():
 # Reproducible initial revision; the prior rejected update attempt is retained separately.
 with(TOOLS/'pwa-build-a-accepted.log').open('w',encoding='utf8')as build_log:
  build=subprocess.run(['node','node_modules/vite/bin/vite.js','build','--mode','staging','--config','scripts/diagnostics/integrated-pwa.config.ts'],env={**env,'FINELO_QA_BUILD':'a'},stdout=build_log,stderr=build_log,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt'else 0)
 assert build.returncode==0,'QA build A failed'
 log=(TOOLS/'pwa-server.log').open('w',encoding='utf8');server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--mode','staging','--config','scripts/diagnostics/integrated-pwa.config.ts','--host','127.0.0.1','--port','5210','--strictPort'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt'else 0);(TOOLS/'pwa-server.pid').write_text(str(server.pid),encoding='utf8')
 try:
  for _ in range(60):
   try:urlopen('http://127.0.0.1:5210',timeout=1);break
   except Exception:time.sleep(.25)
  with sync_playwright()as pw:
   browser=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu']);context=browser.new_context(viewport={'width':390,'height':844},timezone_id='America/Sao_Paulo');backend=Backend();backend.rewrite_documents=False;context.route('**/*',backend.route);p=context.new_page()
   try:
    p.goto('http://127.0.0.1:5210/?login=a',wait_until='networkidle');ready(p);p.wait_for_timeout(1700);close=p.locator('.driver-popover-close-btn').filter(visible=True)
    if close.count():p.once('dialog',lambda d:d.accept());close.first.click()
    p.evaluate("window.__integratedQa.theme('light')");p.wait_for_function("document.querySelector('[data-qa-eligible]').dataset.fineloTheme==='light'");p.evaluate('navigator.serviceWorker.ready');p.wait_for_function('navigator.serviceWorker.controller!==null');scope=p.evaluate('navigator.serviceWorker.ready.then(r=>({scope:r.scope,state:r.active.state}))');a_sha=hashlib.sha256((TOOLS/'pwa-dist/sw.js').read_bytes()).hexdigest();record('native-service-worker-registration',scope=scope,build='a',serviceWorkerSHA256=a_sha,notOsInstalled=True);screenshot(p,'registered-light')
    context.set_offline(True);backend.offline=True;p.reload(wait_until='domcontentloaded');ready(p);assert theme(p)=='light';record('offline-reload-cached-auth-appearance',theme=theme(p),financialDataCacheCertified=False);screenshot(p,'offline-light')
    backend.offline=False;context.set_offline(False);p.reload(wait_until='networkidle');ready(p);p.wait_for_function("window.__integratedQa.snapshot().initialDataLoadStatus==='ready'");assert theme(p)=='light';financial=p.evaluate('window.__integratedQa.snapshot()');record('online-recovery')
    p.close();p=context.new_page();p.goto('http://127.0.0.1:5210/app',wait_until='networkidle');ready(p);assert theme(p)=='light';record('new-browser-page-same-context-preference',notStandaloneApp=True)
    print('BUILD_B_START',flush=True)
    with(TOOLS/'pwa-build-b.log').open('w',encoding='utf8')as build_log:
     build=subprocess.run(['node','node_modules/vite/bin/vite.js','build','--mode','staging','--config','scripts/diagnostics/integrated-pwa.config.ts'],env={**env,'FINELO_QA_BUILD':'b'},stdout=build_log,stderr=build_log,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt'else 0)
    assert build.returncode==0,'QA build B failed'
    b_sha=hashlib.sha256((TOOLS/'pwa-dist/sw.js').read_bytes()).hexdigest();assert b_sha!=a_sha
    # Activation does not replace an already rendered document. The current
    # prompt+skipWaiting policy can also bypass needRefresh. First observe the
    # controller transition, then exercise explicit browser reload. The original
    # update UI is tested independently by the R1 comparison matrix.
    p.evaluate('()=>{window.__qaPreviousController=navigator.serviceWorker.controller;void navigator.serviceWorker.ready.then(r=>r.update())}')
    p.wait_for_function('navigator.serviceWorker.controller!==window.__qaPreviousController',timeout=30000)
    p.reload(wait_until='networkidle')
    p.locator('meta[name=qa-build][content=b]').wait_for(state='attached',timeout=30000);ready(p);assert theme(p)=='light';after=p.evaluate('window.__integratedQa.snapshot()');assert all(financial[k]==after[k]for k in['accounts','transactions','assets','categories','budgets']);cache_b=p.evaluate("async()=>{for(const key of await caches.keys()){const c=await caches.open(key);for(const req of await c.keys()){if(new URL(req.url).pathname==='/index.html'){const r=await c.match(req);if((await r.text()).includes('name=\"qa-build\" content=\"b\"'))return true}}}return false}");assert cache_b;record('native-worker-update-a-to-b-precache-appearance',serviceWorkerSHA256=b_sha,financialEquivalent=True,explicitBrowserReload=True,automaticDocumentReloadCertified=False);screenshot(p,'updated-light')
    p.evaluate('window.__integratedQa.logout()');p.wait_for_function('window.__integratedQa.snapshot().actor===null');assert theme(p)=='dark';p.evaluate("window.__integratedQa.login('b')");ready(p,B);assert theme(p)=='dark';assert not p.locator('body').inner_text().find('Pessoa_A_QA')>=0;record('logout-login-b-in-existing-cache',sdkActor=p.evaluate('window.__integratedQa.sdkActor()'));screenshot(p,'account-b-dark')
    p.evaluate('async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k)}');assert p.evaluate('navigator.serviceWorker.getRegistrations().then(r=>r.length)')==0;p.evaluate("navigator.serviceWorker.register('/sw.js')");p.evaluate('navigator.serviceWorker.ready');record('synthetic-origin-worker-unregister-register',notOsUninstallReinstall=True)
   except Exception as e:
    diagnostic={}
    try:diagnostic=p.evaluate("()=>({url:location.href,revision:document.querySelector('meta[name=qa-build]')?.content,api:Boolean(window.__integratedQa),actor:window.__integratedQa?.snapshot()?.actor,theme:document.querySelector('[data-qa-eligible]')?.dataset.fineloTheme})")
    except Exception:diagnostic={'realm':'navigation in progress'}
    record('pwa-sequence','FAIL',reason=str(e),diagnostic=diagnostic)
    try:screenshot(p,'failure')
    except Exception:pass
   finally:
    record('os-install-standalone-close-reopen-remove-reinstall','NOT TESTED',reason='No physical/OS installation in this isolated headless profile; manual runbook required');browser.close()
  (OUT/'pwa-validation.json').write_text(json.dumps({'cases':results,'transport':'synthetic HTTP, real browser service worker/cache','remoteAuth':'BLOCKED'},ensure_ascii=False,indent=2),encoding='utf8')
 finally:server.terminate();server.wait(timeout=10);log.close()
 return results
if __name__=='__main__':run()
