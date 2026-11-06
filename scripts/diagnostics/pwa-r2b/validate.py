"""Native-browser acceptance of an isolated protocol, not FinElo integration."""
import argparse,hashlib,json,sys,time,traceback,shutil
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
TOOLS=ROOT/'node_modules/.finelo-cycle4d-r2b-tools';OUT=TOOLS/'evidence';OUT.mkdir(exist_ok=True)
sys.path.insert(0,str(TOOLS/'python'))
from playwright.sync_api import sync_playwright
from server import Lab,ORIGIN,NEUTRAL,manifest

def write(name,value):(OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
def snap(page):return page.evaluate('window.__r2b.snapshot()')
def wait(page,predicate,timeout=5000):page.wait_for_function(predicate,timeout=timeout,polling=50)
def boot(context,query='',ready=True):
    page=context.new_page();page.goto(ORIGIN+'/'+query,wait_until='networkidle')
    if page.locator('#enter').is_visible()and page.locator('#enter').inner_text()=='Entrar no protótipo':
        page.locator('#enter').click();page.wait_for_load_state('networkidle')
    if ready:wait(page,'window.__r2b?.snapshot().booted')
    return page
def publish(lab,page):
    lab.state.publish('b');page.locator('#check').click()
    wait(page,"(()=>{const b=document.getElementById('update');return !b.disabled})()")
def edit(page,value='DRAFT_1250'):
    page.locator('#edit').click();page.locator('#draft').fill(value)
def operation(page,kind,cents=1250):
    edit(page);page.locator('#amount').fill(str(cents));page.locator('#outcome').select_option(kind);page.locator('#save').click()
    wait(page,"window.__r2b.snapshot().operation!==undefined||window.__r2b.events.some(e=>e.type==='result-observed'||e.type==='result-uncertain')")
def blocked(page):
    page.locator('#update').click();wait(page,"window.__r2b.snapshot().phase==='blocked'")
    assert page.evaluate("async()=>!!(await navigator.serviceWorker.getRegistration()).waiting")
def unchanged(page,expected='DRAFT_1250'):
    assert snap(page)['build']=='a'and snap(page)['draft']==expected
    assert page.evaluate("document.querySelector('meta[name=prototype-build]').content")== 'a'
def commit(owner):
    owner.locator('#update').click();wait(owner,"window.__r2b.snapshot().phase==='draining'")
def cache_audit(page):
    data=page.evaluate("""async()=>{const rows=[];for(const name of await caches.keys()){
      const cache=await caches.open(name);for(const req of await cache.keys()){
        const body=await(await cache.match(req)).arrayBuffer();rows.push({name,path:new URL(req.url).pathname,
          sha:[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(v=>v.toString(16).padStart(2,'0')).join('')});}}
      return rows;}""")
    for row in data:
        parts=row['path'].split('/');assert parts[1]=='v'and parts[2]in['a','b']
        assert row['sha']==manifest(parts[2])[parts[3]]
    assert data and not any('/api/'in row['path']for row in data)
    return data
def page_audit(page):
    value=snap(page);build=value['build']
    assert page.evaluate("document.querySelector('meta[name=prototype-build]').content")==build
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--artifact-version').trim()")==build
    resources=page.evaluate("performance.getEntriesByType('resource').map(e=>new URL(e.name).pathname).filter(p=>p.startsWith('/v/'))")
    assert resources and all(path.startswith('/v/'+build+'/')for path in resources)
    return {'snapshot':value,'resources':resources,'caches':cache_audit(page)}
def watch_activation(context,page,origin=ORIGIN):
    session=context.new_cdp_session(page);versions={}
    session.on('ServiceWorker.workerVersionUpdated',lambda event:versions.update({v['versionId']:v for v in event['versions']}))
    session.send('ServiceWorker.enable');deadline=time.monotonic()+3
    while time.monotonic()<deadline:
        candidates=[v for v in versions.values()if v['status']=='installed'and v['scriptURL']==origin+'/sw.js']
        if candidates:return session,candidates[-1]['versionId'],versions
        page.wait_for_timeout(50)
    session.detach();raise AssertionError('No native waiting version before handoff')
def activation_done(watch,page):
    session,version_id,versions=watch
    session.send('ServiceWorker.disable');session.send('ServiceWorker.enable')
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        if versions.get(version_id,{}).get('status')=='activated':
            observed=versions[version_id].copy();session.detach();return observed
        page.wait_for_timeout(50)
    session.detach();raise AssertionError('No natural activation after clients left')
def finish(owner,peers,context,result):
    result['beforeVoluntaryExit']=[snap(page)for page in [owner,*peers]]
    assert all(row['state']=='clean'and row['frozen']for row in result['beforeVoluntaryExit'])
    observation=watch_activation(context,owner)
    for peer in peers:
        peer.locator('#leave').click();peer.wait_for_url(NEUTRAL+'/',timeout=5000)
    owner.locator('#leave').click();owner.wait_for_url(NEUTRAL+'/',timeout=5000)
    # Worker observation is DevTools-only. The neutral page never polls the app
    # origin or claims activation success. It offers only an explicit return.
    result['activation']=activation_done(observation,owner)
    owner.locator('#return').click();owner.wait_for_load_state('networkidle');wait(owner,'window.__r2b?.snapshot().booted')
    assert snap(owner)['build']=='b';result['after']=page_audit(owner)

def stop_waiting_worker(context,page):
    session=context.new_cdp_session(page);versions=[]
    session.on('ServiceWorker.workerVersionUpdated',lambda event:versions.extend(event['versions']))
    session.send('ServiceWorker.enable')
    deadline=time.monotonic()+3;selected=None
    while time.monotonic()<deadline:
        candidates=[v for v in versions if v['status']=='installed'and v['scriptURL']==ORIGIN+'/sw.js']
        if candidates:selected=candidates[-1];break
        page.wait_for_timeout(50)
    assert selected,'No waiting worker in native CDP inventory'
    session.send('ServiceWorker.stopWorker',{'versionId':selected['versionId']});page.wait_for_timeout(100)
    return session,selected['versionId']

def case(browser,channel,scenario,theme,label):
    lab=Lab();lab.start();context=browser.new_context(viewport={'width':390,'height':844}if theme=='light'else{'width':1280,'height':800},color_scheme='light')
    result={'name':f'{label}-{channel}-{theme}-{scenario}','scenario':scenario,'theme':theme,'browser':channel,'browserVersion':browser.version,'status':'PASS','scope':'isolated prototype, no product integration','checks':{}}
    navigations=[];responses=[];lifecycle=[]
    context.expose_binding('__r2bLifecycle',lambda source,payload:lifecycle.append({'page':id(source['page']),**payload}))
    def attach(page):
        page.on('framenavigated',lambda frame:navigations.append({'page':id(page),'url':frame.url})if frame==page.main_frame else None)
        def response_seen(response):
            if response.status==200 and(response.request.resource_type=='document'or'/v/'in response.url):
                try:responses.append({'url':response.url,'sha256':hashlib.sha256(response.body()).hexdigest(),'sw':response.from_service_worker})
                except Exception:pass
        page.on('response',response_seen)
    context.on('page',attach)
    try:
        query=f'?theme={theme}'
        if scenario in ['new-before-commit','closed-before-commit','uncovered-unknown','expiry','owner-script-suspended-expiry']:query+='&pause=afterPrepare'
        if scenario in ['new-after-final-check','unknown-after-final-check']:query+='&pause=beforeHandoff'
        owner=boot(context,query);peers=[]
        if scenario in ['clean','dirty','pending','uncertain','three-mixed','silent','script-suspended','new-before-commit','closed-before-commit','late-work','uncovered-unknown','restart','concurrent','cancel','owner-script-suspended-expiry','closed-after-commit','unknown-client','lifecycle-event-contract']:
            peer=boot(context,'?fault=silent'if scenario=='silent'else'');peers=[peer]
        baseline=snap(owner);result['before']=page_audit(owner)
        if scenario in ['dirty','three-mixed']:edit(peers[0])
        if scenario in ['pending','uncertain']:operation(peers[0],'held'if scenario=='pending'else'accepted_lost')
        if scenario=='uncertain':wait(peers[0],"window.__r2b.snapshot().state==='unknown'")
        if scenario=='three-mixed':
            third=boot(context);peers.append(third);operation(third,'held')
        if scenario in ['offline-before-write','offline-after-commit','delayed-result','negative','zero','refused']:
            if scenario=='offline-before-write':
                edit(owner);context.set_offline(True);owner.locator('#save').click();wait(owner,"window.__r2b.snapshot().state==='unknown'");context.set_offline(False)
            else:operation(owner,'held'if scenario in['offline-after-commit','delayed-result']else'refused'if scenario=='refused'else'accepted',-250 if scenario=='negative'else 0 if scenario=='zero'else 1250)
        start_nav=len(navigations);publish(lab,owner)
        if scenario=='lifecycle-event-contract':
            edit(peers[0],'LIFECYCLE_DRAFT');peers[0].evaluate("document.dispatchEvent(new Event('freeze'))")
            wait(peers[0],"window.__r2b.snapshot().state==='unknown'");blocked(owner);unchanged(peers[0],'LIFECYCLE_DRAFT')
            peers[0].locator('#resume-client').click();wait(peers[0],"window.__r2b.snapshot().state==='dirty'");peers[0].locator('#discard').click()
            result['emulation']='Synthetic lifecycle event contract, not physical freeze';result['checks']['lifecycleUnknownUntilExplicitResume']='PASS'
        if scenario=='unknown-client':
            unknown=context.new_page();unknown.goto(ORIGIN+'/unknown');peers.append(unknown)
        frozen_session=None
        if scenario=='script-suspended':
            owner.bring_to_front()
            frozen_session=context.new_cdp_session(peers[0]);frozen_session.send('Emulation.setScriptExecutionDisabled',{'value':True})
            result['emulation']='CDP script execution disabled, not physical/native freeze'
        if scenario in ['dirty','pending','uncertain','three-mixed','silent','script-suspended','unknown-client','offline-before-write','offline-after-commit','delayed-result']:
            blocked(owner);assert len(navigations)==start_nav+(1 if scenario=='unknown-client'else 0)
            assert snap(owner)['build']=='a';result['checks']['blockedWithoutNavigation']='PASS'
            if scenario in ['dirty','pending','uncertain']:unchanged(peers[0])
            if scenario in ['pending','uncertain']:assert peers[0].locator('#draft').is_disabled()and peers[0].locator('#amount').is_disabled()
            if scenario=='three-mixed':
                unchanged(peers[0]);unchanged(peers[1]);assert lab.state.snapshot()['writes']==[]
            if frozen_session:frozen_session.send('Emulation.setScriptExecutionDisabled',{'value':False});frozen_session.detach()
            if scenario in ['silent','script-suspended','unknown-client','three-mixed','offline-before-write']:return result
            if scenario=='dirty':peers[0].locator('#discard').click()
            elif scenario=='uncertain':peers[0].locator('#reconcile').click();wait(peers[0],"window.__r2b.snapshot().state==='clean'")
            else:
                source=peers[0]if scenario=='pending'else owner
                job=snap(source)['operation'];assert len(lab.state.snapshot()['attempts'])==1
                if scenario=='offline-after-commit':context.set_offline(True)
                lab.state.release(job,'accepted')
                if scenario=='offline-after-commit':
                    wait(source,"window.__r2b.snapshot().state==='unknown'");context.set_offline(False);source.locator('#reconcile').click()
                wait(source,"window.__r2b.snapshot().state==='clean'")
                result['checks']['responseObservedBeforeHandoff']='PASS'
        if scenario in ['negative','zero','refused']:
            wait(owner,"window.__r2b.snapshot().operation===undefined")
            if scenario=='refused':blocked(owner);owner.locator('#discard').click()
        if scenario in ['new-before-commit','closed-before-commit','uncovered-unknown','expiry','owner-script-suspended-expiry']:
            owner.locator('#update').click();wait(owner,"window.__r2b.snapshot().phase==='prepared'")
            if scenario=='new-before-commit':peers.append(boot(context,ready=False))
            if scenario=='closed-before-commit':peers[0].close()
            if scenario=='uncovered-unknown':peers[0].evaluate('window.__r2b.injectUnknown()')
            if scenario=='owner-script-suspended-expiry':
                peers[0].bring_to_front()
                cdp=context.new_cdp_session(owner);cdp.send('Emulation.setScriptExecutionDisabled',{'value':True});peers[0].wait_for_timeout(8300)
                result['emulation']='CDP owner script execution disabled, not physical/native freeze'
                admitted=peers[0].evaluate('window.__r2b.edit()')
                result['newWorkAfterExpiredRound']=admitted
                if admitted:peers[0].locator('#draft').fill('NEW_AFTER_ABORT')
                cdp.send('Emulation.setScriptExecutionDisabled',{'value':False});cdp.detach()
            elif scenario=='expiry':owner.wait_for_timeout(8300)
            owner.evaluate('window.__r2b.resume()');wait(owner,"window.__r2b.snapshot().phase==='blocked'")
            if scenario=='owner-script-suspended-expiry':
                assert owner.evaluate("async()=>!!(await navigator.serviceWorker.getRegistration()).waiting")
                if result['newWorkAfterExpiredRound']:unchanged(peers[0],'NEW_AFTER_ABORT')
            assert snap(owner)['build']=='a';result['checks']['revalidationDenied']='PASS';return result
        commit(owner)
        if scenario=='late-work':
            assert peers[0].evaluate('window.__r2b.edit()')is False;assert lab.state.snapshot()['attempts']==[]
            result['checks']['lateWorkDenied']='PASS'
        if scenario=='concurrent':
            blocked(peers[0]);assert snap(owner)['frozen'];result['checks']['singleCoordinator']='PASS'
        if scenario=='cancel':
            owner.locator('#cancel').click();wait(owner,'!window.__r2b.snapshot().frozen');assert peers[0].evaluate('window.__r2b.edit()')is True;unchanged(owner,'');return result
        if scenario=='restart':
            before=owner.evaluate('window.__r2b.version()');session,worker_id=stop_waiting_worker(context,owner)
            owner.locator('#leave').click();wait(owner,"window.__r2b.snapshot().phase==='blocked'")
            after=owner.evaluate('window.__r2b.version()');assert before['generation']!=after['generation'];session.detach()
            result['checks']['workerRestartDeniedStaleRound']='PASS';result['stoppedWorkerVersion']=worker_id;return result
        if scenario in ['new-after-final-check','unknown-after-final-check']:
            owner.locator('#leave').click();owner.wait_for_timeout(100)
            if scenario=='new-after-final-check':late=boot(context,ready=False)
            else:
                late=context.new_page();late.goto(ORIGIN+'/unknown');late.locator('#unknown-draft').fill('UNCOOPERATIVE_DRAFT')
            owner.evaluate('window.__r2b.resume()');owner.wait_for_url(NEUTRAL+'/',timeout=5000)
            late.wait_for_timeout(300)
            waiting=late.evaluate("async()=>!!(await navigator.serviceWorker.getRegistration()).waiting")
            assert waiting,'New late client did not block natural activation'
            if scenario=='new-after-final-check':
                late.locator('#enter').click();wait(late,'window.__r2b.snapshot().booted');edit(late);unchanged(late)
                owner.locator('#return').click();owner.wait_for_load_state('networkidle');wait(owner,'window.__r2b.snapshot().booted')
                assert snap(owner)['build']=='a';unchanged(late);page_audit(owner)
                result['checks']['prematureReturnDoesNotClaimSuccess']='PASS'
            else:assert late.locator('#unknown-draft').input_value()=='UNCOOPERATIVE_DRAFT'
            result['checks']['lateClientPreventsActivation']='PASS';return result
        if scenario=='closed-after-commit':peers[0].close();peers=[]
        finish(owner,peers,context,result)
        expected='dark'if theme=='dark'else'light'
        assert snap(owner)['theme']==expected and snap(owner)['actor']==baseline['actor']
        assert int(snap(owner)['balance'])==lab.state.balances['QA-A']
        result['checks']['naturalActivationAndPinnedResources']='PASS'
        result['checks']['themeIdentityBalancePreserved']='PASS'
        if theme=='light':owner.screenshot(path=str(OUT/(result['name']+'-b.png')))
        return result
    except Exception as error:
        result.update(status='FAIL',reason=str(error),traceback=traceback.format_exc())
        try:owner.screenshot(path=str(OUT/(result['name']+'-failure.png')));result['failureState']=snap(owner);result['clientEvents']=owner.evaluate('window.__r2b.events')
        except Exception:pass
        return result
    finally:
        result['finance']=lab.state.snapshot();result['navigations']=navigations;result['responses']=responses;result['lifecycle']=lifecycle
        # Compare every observed static response against immutable build bytes.
        for response in responses:
            path=response['url'].split('?',1)[0]
            if '/v/'in path:
                suffix=path.split('/v/',1)[1];build,name=suffix.split('/',1)
                if response['sha256']!=manifest(build)[name]:result.update(status='FAIL',reason='Observed resource bytes mismatch')
        attempts=result['finance']['attempts']
        if len({row['id']for row in attempts})!=len(attempts):result.update(status='FAIL',reason='Repeated financial write')
        context.close()
        for operation_id,item in list(lab.state.held.items()):
            if not item['event'].is_set():lab.state.release(operation_id,'refused')
        lab.stop();write(result['name']+'.json',result)

CORE=['clean','dirty','pending','uncertain']
ADVERSARIAL=['three-mixed','silent','script-suspended','unknown-client','new-before-commit','new-after-final-check','unknown-after-final-check','late-work','uncovered-unknown','closed-before-commit','closed-after-commit','restart','expiry','owner-script-suspended-expiry','concurrent','cancel','offline-before-write','offline-after-commit','delayed-result','negative','zero','refused','lifecycle-event-contract']
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--channels',nargs='+',default=['msedge','chrome']);parser.add_argument('--smoke',action='store_true');parser.add_argument('--only',nargs='+');parser.add_argument('--label',default='cooperative-final');args=parser.parse_args()
    sources=TOOLS/'sources'/args.label;assert not sources.exists(),'Never overwrite a source snapshot';sources.mkdir(parents=True)
    source_hashes={}
    for file in HERE.iterdir():
        if file.is_file()and file.suffix in ['.py','.js','.html','.css']:
            shutil.copyfile(file,sources/file.name);source_hashes[file.name]=hashlib.sha256(file.read_bytes()).hexdigest()
    write(args.label+'-sources.json',{'files':source_hashes,'artifacts':{b:manifest(b)for b in['a','b']}})
    results=[]
    with sync_playwright()as p:
        for channel in args.channels:
            browser=p.chromium.launch(channel=channel,headless=True)
            try:
                matrix=[('clean','light')]if args.smoke else[(s,t)for t in['dark','light','system']for s in CORE]+[(s,['dark','light','system'][i%3])for i,s in enumerate(ADVERSARIAL)]
                if args.only:matrix=[item for item in matrix if item[0]in args.only]
                for scenario,theme in matrix:
                    row=case(browser,channel,scenario,theme,args.label);results.append(row);write(args.label+'-matrix.json',results)
                    print(json.dumps({k:row[k]for k in ['name','status','checks','reason']if k in row}),flush=True)
            finally:browser.close()
    raise SystemExit(1 if any(row['status']=='FAIL'for row in results)else 0)
