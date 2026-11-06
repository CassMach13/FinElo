"""Authorized policy: raw workers, cross-policy upgrades, tabs and pending work.

No SW observer suffix is used. Only the original UI can accept an update.
Financial POSTs are held and then refused by the synthetic HTTP transport.
"""
import argparse
import json
import runpy
import shutil
import time
import traceback
from pathlib import Path
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend, A, B, safe
from pwa_r1_observation import Observer, ROOT, TOOLS, OUT, DIST, ORIGIN, SNAPSHOT, digest, disk_http, write

BASE = runpy.run_path(str(Path(__file__).with_name('pwa-r1-validate.py')), run_name='pwa_helpers')
ready, choose, ledger = (BASE[name] for name in ['ready','choose','ledger'])
wait_evaluated, Server = (BASE[name] for name in ['wait_evaluated','Server'])
RAW_SNAPSHOT = SNAPSHOT.replace('controllerVersion:await window.__pwaR1ControllerVersion?.(),','controllerVersion:null,').replace('waitingVersion:await window.__pwaR1WorkerVersion?.(registration?.waiting),','waitingVersion:null,')

def resource_contract(records, files):
    for name, hashes in records.items():
        assert name in files, 'Resource from another version: '+name
        assert hashes, 'Resource response was not observed: '+name
        assert all(value == files[name] for value in hashes), 'Resource bytes mismatch: '+name

def resource_canary():
    rejected=[]
    for records in [{'assets/runtime-a.js':['a']},{'assets/shared.js':['wrong']}]:
        try:
            resource_contract(records,{'assets/runtime-b.js':'b','assets/shared.js':'shared'})
        except AssertionError:
            rejected.append(True)
    assert len(rejected)==2
    resource_contract({'assets/shared.js':['shared']},{'assets/shared.js':'shared'})
    write('applied-resource-canary.json',{'wrongGenerationRejected':True,'wrongBytesRejected':True,'sharedBytesAllowed':True})

class AppliedObserver(Observer):
    def __init__(self,name):
        super().__init__(name)
        self.assets={}
        self.documents={}

    def attach(self,context):
        super().attach(context)
        def new_page(page):
            self.assets[page]={}
            def finished(request):
                if not request.url.startswith(ORIGIN+'/'):
                    return
                path=unquote(urlparse(request.url).path).lstrip('/')
                if path.startswith('_vercel/'):
                    return
                response=request.response()
                if not response or response.status != 200:
                    return
                if request.resource_type=='document' or any(path.endswith(ext)for ext in ['.js','.css','.png','.svg','.ico','.webp','.woff','.woff2']):
                    hashed=digest(response.body())
                    if request.resource_type=='document':
                        self.documents[page]=hashed
                    else:
                        self.assets[page].setdefault(path,[]).append(hashed)
            page.on('requestfinished',finished)
        context.on('page',new_page)

    def snapshot(self,page,label):
        value=page.evaluate(RAW_SNAPSHOT)
        self.snapshots.append({'label':label,'time':time.time(),'diskHttp':disk_http(),'browser':value})
        self.save()
        return value

    def audit(self,page,manifest):
        entries=page.evaluate("performance.getEntriesByType('resource').map(e=>e.name)")
        paths=set()
        for url in entries:
            if url.startswith(ORIGIN+'/'):
                name=unquote(urlparse(url).path).lstrip('/')
                if name and name!='sw.js' and not name.startswith('_vercel/') and any(name.endswith(ext)for ext in ['.js','.css','.png','.svg','.ico','.webp','.woff','.woff2']):
                    paths.add(name)
        records={name:self.assets[page].get(name,[])for name in sorted(paths)}
        invariant=[]
        if 'favicon.ico'in records and not records['favicon.ico']:
            # Chromium's browser-owned favicon request has timing but no Page
            # response event. It cannot distinguish these versions: prove its
            # bytes invariant in ALL builds, then verify the browser cache copy.
            builds=json.loads((OUT/'builds.json').read_text(encoding='utf8'))
            expected={row['files']['favicon.ico']for row in builds}
            assert len(expected)==1,'Unobserved favicon differs across versions'
            cached=page.evaluate('''async()=>{
              const values=[];
              for(const key of await caches.keys()){
                const c=await caches.open(key);
                for(const request of await c.keys())if(new URL(request.url).pathname==='/favicon.ico'){
                  const data=await(await c.match(request)).arrayBuffer();
                  values.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join(''));
                }
              }return values;
            }''')
            assert cached and set(cached)==expected
            records['favicon.ico']=cached
            invariant.append('favicon.ico: original response unobservable; identical in all four builds; cache SHA verified')
        resource_contract(records,manifest['files'])
        worker_hashes=self.assets[page].get('sw.js',[])
        assert all(value in self.allowed_worker_hashes for value in worker_hashes),'Unrecognized worker bytes'
        assert self.documents.get(page)==manifest['indexSHA256'],'Document bytes mismatch'
        return {'status':'PASS','resources':records,'workerScriptFetches':worker_hashes,'invariantAssetEvidence':invariant,'documentSHA256':self.documents[page]}

class PendingBackend(Backend):
    def __init__(self):
        super().__init__()
        self.rewrite_documents=False
        self.pending=[]
        self.attempts=[]
        self.deliveries=[]

    def route(self,route):
        request=route.request
        if urlparse(request.url).hostname=='integrated-fixture.invalid' and urlparse(request.url).path=='/rest/v1/financial_goals' and request.method=='POST':
            self.attempts.append({'table':'financial_goals','body':safe(request.post_data_json)})
            self.pending.append(route)
            return
        return super().route(route)

    def refuse_pending(self):
        routes=self.pending;self.pending=[]
        for route in routes:
            try:
                self.fulfill(route,{'message':'Synthetic refusal; no financial persistence'},403)
                self.deliveries.append('refusal-delivered')
            except Exception:
                self.deliveries.append('client-no-longer-receives-response')

def publish(policy,revision,observer):
    source=TOOLS/'builds'/(policy+'-'+revision)
    assert source.is_dir()
    observer.event('publish-start',policy=policy,revision=revision,rawWorker=True)
    for file in sorted(source.rglob('*')):
        if not file.is_file() or file.name in ['index.html','sw.js']:
            continue
        target=DIST/file.relative_to(source);target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(file,target)
    for name in ['index.html','sw.js']:
        shutil.copyfile(source/name,DIST/name)
    observer.event('publish-end',policy=policy,revision=revision,values=disk_http())

def state(page):
    return page.evaluate('''()=>({html:document.querySelector('meta[name=qa-build]')?.content,
      runtime:document.documentElement.dataset.pwaR1Build,draft:document.querySelector('#goal-name')?.value??null,
      target:document.querySelector('#goal-target')?.value??null,
      saving:Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.includes('Salvando'))),
      theme:document.querySelector('[data-qa-eligible]')?.dataset.fineloTheme,
      actor:window.__integratedQa?.snapshot().actor,ready:window.__integratedQa?.snapshot().initialDataLoadStatus})''')

def financial_equal(page,before,name,phase):
    after=ledger(page)
    different=[key for key in before if before[key]!=after[key]]
    if different:
        write(name+'-'+phase+'-financial-difference.json',{'different':different,'before':before,'after':after,'page':state(page)})
    assert not different,'Financial snapshot differs: '+','.join(different)

def loaded_goals(page,backend,actor=A):
    if page.evaluate('window.__integratedQa.snapshot().view')!='goals':
        page.get_by_role('button',name='Objetivos',exact=True).filter(visible=True).first.click()
    count=len([row for row in backend.db['financial_goals']if row['user_id']==actor])
    page.wait_for_function('(n)=>window.__integratedQa.snapshot().goals.length===n',arg=count)

def boot(page):
    page.goto(ORIGIN+'/?login=a',wait_until='networkidle')
    ready(page,revision='a')
    page.evaluate('navigator.serviceWorker.ready')
    page.wait_for_function('navigator.serviceWorker.controller!==null')
    page.wait_for_timeout(1700)
    close=page.locator('.driver-popover-close-btn').filter(visible=True)
    if close.count():
        page.once('dialog',lambda dialog:dialog.accept());close.first.click()
        page.locator('.driver-overlay').wait_for(state='detached')

def draft(page,name):
    page.get_by_role('button',name='Objetivos',exact=True).filter(visible=True).first.click()
    page.get_by_role('button',name='+ Novo objetivo',exact=True).click()
    page.locator('#goal-name').fill(name)
    page.locator('#goal-target').fill('1234,56')

def wait_pending(page,backend):
    deadline=time.monotonic()+10
    while not backend.pending and time.monotonic()<deadline:
        page.wait_for_timeout(100)
    assert len(backend.pending)==1,'Original UI did not start the intended POST'
    assert len(backend.attempts)==1

def waiting(page):
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    page.get_by_role('button',name='Atualizar Agora',exact=True).wait_for(timeout=30000)
    wait_evaluated(page,"async()=>{const r=await navigator.serviceWorker.getRegistration();return Boolean(r.waiting?.state==='installed'&&r.active===navigator.serviceWorker.controller)}")

def cache_contract(snapshot,manifests,only_b=False):
    files={}
    for manifest in manifests:
        for name,hashed in manifest['files'].items():files.setdefault(name,set()).add(hashed)
    if only_b:
        files={name:{hashed}for name,hashed in manifests[-1]['files'].items()}
    for entry in snapshot['caches']:
        assert entry['url'].startswith(ORIGIN+'/')
        name=unquote(urlparse(entry['url']).path).lstrip('/')
        assert not any(name.startswith(path)for path in ['auth/','rest/','functions/','storage/'])
        assert name in files and entry['sha256']in files[name],'Cached resource mismatch: '+name
    assert snapshot['caches']

def run_case(browser,channel,transition,preference,scenario,label,manifests):
    name=f'{label}-{channel}-{transition}-{preference}-{scenario}'
    observer=AppliedObserver(name)
    old_policy='original' if transition=='legacy-to-current' else 'proposed-prompt'
    initial=manifests[(old_policy,'a')];target=manifests[('proposed-prompt','b')]
    observer.allowed_worker_hashes={initial['swSHA256'],target['swSHA256']}
    publish(old_policy,'a',observer)
    backend=PendingBackend()
    original_db=json.dumps(backend.db,sort_keys=True)
    context=browser.new_context(viewport={'width':390,'height':844},color_scheme='light',timezone_id='America/Sao_Paulo')
    observer.attach(context);context.route('**/*',backend.route)
    page=context.new_page();pages=[page]
    result={'name':name,'channel':channel,'browserVersion':browser.version,'transition':transition,'preference':preference,
            'scenario':scenario,'status':'PASS','rawWorkers':True,'osInstallation':'NOT TESTED','remoteAuth':'BLOCKED','checks':{}}
    try:
        boot(page);choose(page,preference)
        page.get_by_role('button',name='Objetivos',exact=True).filter(visible=True).first.click()
        loaded_goals(page,backend)
        before=ledger(page)
        if scenario=='single-reopened-offline':
            page.close();page=context.new_page();pages=[page]
            page.goto(ORIGIN+'/app?view=goals',wait_until='networkidle');ready(page,revision='a');loaded_goals(page,backend)
            context.set_offline(True);backend.offline=True
            page.reload(wait_until='domcontentloaded');ready(page,revision='a',financial=False)
            assert state(page)['theme']==('dark'if preference=='dark'else'light')
            result['checks']['offlineAppearance']='PASS'
            backend.offline=False;context.set_offline(False)
            page.reload(wait_until='networkidle');ready(page,revision='a');loaded_goals(page,backend)
            financial_equal(page,before,name,'reconnection')
            result['checks']['reconnection']='PASS'
            draft(page,'PWA_R1_DRAFT_A')
        else:
            second=context.new_page();pages.append(second)
            second.goto(ORIGIN+'/app?view=goals',wait_until='networkidle');ready(second,revision='a');loaded_goals(second,backend)
            if scenario in ['tabs-dirty','tabs-pending']:
                draft(second,'PWA_R1_DRAFT_A')
            if scenario=='tabs-pending':
                second.get_by_role('button',name='Salvar',exact=True).click()
                wait_pending(second,backend)
                assert state(second)['saving']
        for index,current in enumerate(pages):
            loaded_goals(current,backend)
            result.setdefault('resourcesBefore',[]).append(observer.audit(current,initial))
            observer.snapshot(current,f'a-ready-{index}')
        publish('proposed-prompt','b',observer)
        for current in pages:waiting(current)
        markers=[state(current)for current in pages]
        observer.event('before-confirmation',pages=markers,pendingPosts=len(backend.pending))
        for current in pages:
            current.wait_for_timeout(800)
        for index,current in enumerate(pages):
            observed=state(current)
            assert observed['html']=='a'and observed['runtime']=='a','Automatic navigation before confirmation'
            financial_equal(current,before,name,'before-confirmation-'+str(index))
            if scenario=='single-reopened-offline' or(index==1 and scenario in ['tabs-dirty','tabs-pending']):
                assert observed['draft']=='PWA_R1_DRAFT_A'
            if index==1 and scenario=='tabs-pending':
                assert observed['saving']and len(backend.pending)==1
            observer.snapshot(current,f'waiting-before-confirmation-{index}')
            if preference=='light'and transition=='legacy-to-current':
                current.screenshot(path=str(OUT/f'{name}-waiting-{index}.png'))
            observer.audit(current,initial)
        result['checks']['noAutomaticInterruptionBeforeConfirmation']='PASS'
        if preference=='system':
            page.emulate_media(color_scheme='dark')
            page.wait_for_function('document.querySelector("[data-qa-eligible]").dataset.fineloTheme==="dark"')
            page.emulate_media(color_scheme='light')
        if scenario=='single-reopened-offline':
            context.set_offline(True);backend.offline=True;page.wait_for_timeout(250)
            assert state(page)['draft']=='PWA_R1_DRAFT_A'
            context.set_offline(False);backend.offline=False
            page.keyboard.press('Escape');page.locator('#goal-form').wait_for(state='detached')
        observer.event('explicit-confirmation',page=0)
        page.get_by_role('button',name='Atualizar Agora',exact=True).click()
        ready(page,revision='b');page.wait_for_load_state('networkidle')
        if len(pages)>1:
            second=pages[1]
            second.wait_for_timeout(1800)
            wait_evaluated(second,"()=>Boolean(window.__integratedQa&&window.__integratedQa.snapshot().initialDataLoadStatus==='ready')")
            secondary=state(second);result['secondaryAfterOtherTabConfirmation']=secondary
            if scenario in ['tabs-dirty','tabs-pending']:
                protected=secondary['draft']=='PWA_R1_DRAFT_A'and secondary['html']=='a'
                result['checks']['otherTabPendingWorkPreserved']='PASS'if protected else'FAIL'
                if not protected:
                    result.update(status='FAIL',safetyFailure=True,reason='Other tab reloaded without its own confirmation and discarded '+('a pending financial operation'if scenario=='tabs-pending'else'an unsaved form'))
            else:
                ready(second,revision='b')
        backend.refuse_pending()
        for index,current in enumerate(pages):
            current_state=state(current)
            revision=current_state['html']
            assert revision in ['a','b'] and current_state['runtime']==revision
            ready(current,revision=revision)
            loaded_goals(current,backend)
            financial_equal(current,before,name,'after-confirmation-'+str(index))
            manifest=target if revision=='b'else initial
            result.setdefault('resourcesAfter',[]).append(observer.audit(current,manifest))
            wait_evaluated(current,"async()=>{const r=await navigator.serviceWorker.getRegistration();return r.active?.state==='activated'}")
            snapshot=observer.snapshot(current,f'after-confirmation-{index}')
            cache_contract(snapshot,[initial,target],only_b=True)
            current.screenshot(path=str(OUT/f'{name}-{index}.png'))
        result['checks']['resourceVersionsAndBytes']='PASS'
        result['checks']['financialCollectionsEquivalent']='PASS'
        result['financialSHA256']={key:digest(json.dumps(value,sort_keys=True).encode())for key,value in before.items()}
        result['intentionalFinancialPostAttempts']=backend.attempts
        result['syntheticRefusalDelivery']=backend.deliveries
        if scenario=='tabs-pending':assert len(backend.attempts)==1,'Duplicate financial request'
        else:assert not backend.attempts
        assert json.dumps(backend.db,sort_keys=True)==original_db
        assert not[w for w in backend.writes if w['kind']=='data'and w['table']!='product_events']
        assert len([w for w in backend.writes if w['kind']=='auth'and'appearance_theme'in w['data']])==1
        result['checks']['noDuplicateOrPersistedFinancialWrite']='PASS'
        page.evaluate('window.__integratedQa.logout()');page.wait_for_function('window.__integratedQa.snapshot().actor===null')
        page.evaluate("window.__integratedQa.login('b')");ready(page,B,revision='b')
        loaded_goals(page,backend,B)
        assert '_A_QA'not in page.locator('body').inner_text() and A not in json.dumps(ledger(page))
        assert state(page)['theme']=='dark'
        result['checks']['accountIsolation']='PASS'
        return result
    except Exception as error:
        result.update(status='FAIL',harnessOrUnexpectedFailure=True,reason=str(error),traceback=traceback.format_exc())
        try:
            observer.snapshot(page,'failure');page.screenshot(path=str(OUT/f'{name}-failure.png'))
        except Exception:pass
        return result
    finally:
        backend.refuse_pending()
        observer.event('result',result=result);observer.save();context.close()

def run(args):
    manifests={(row['policy'],row['revision']):row for row in json.loads((OUT/'builds.json').read_text(encoding='utf8'))}
    resource_canary()
    observer=AppliedObserver('applied-start');publish('proposed-prompt','a',observer)
    server=Server();server.start();results=[]
    try:
        with sync_playwright()as playwright:
            for channel in args.channels:
                browser=playwright.chromium.launch(channel=channel,headless=True)
                try:
                    for transition in args.transitions:
                        for preference in args.themes:
                            for scenario in args.scenarios:
                                row=run_case(browser,channel,transition,preference,scenario,args.label,manifests)
                                results.append(row);write(args.label+'-matrix.json',results)
                                print(json.dumps({key:value for key,value in row.items()if key not in ['resourcesBefore','resourcesAfter','financialSHA256']},ensure_ascii=True),flush=True)
                finally:browser.close()
    finally:server.stop()
    return results

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--channels',nargs='+',default=['msedge','chrome'])
    parser.add_argument('--transitions',nargs='+',default=['current-to-current','legacy-to-current'])
    parser.add_argument('--themes',nargs='+',default=['dark','light','system'])
    parser.add_argument('--scenarios',nargs='+',default=['single-reopened-offline','tabs-idle','tabs-dirty','tabs-pending'])
    parser.add_argument('--label',default='applied')
    rows=run(parser.parse_args())
    raise SystemExit(1 if any(row['status']!='PASS'for row in rows)else 0)
