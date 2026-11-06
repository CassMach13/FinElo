"""Native counterexample: a new worker gate cannot remove an old page's timer.

Uses immutable A artifacts and a deliberately MODIFIED diagnostic B worker.
This is not the release build or acceptance of a complete R2 implementation.
"""
import json
import runpy
import time
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

M = runpy.run_path(str(Path(__file__).with_name('pwa-r1-applied-validate.py')), run_name='r2_boundary_helpers')
globals().update({key: M[key] for key in ['ROOT','TOOLS','OUT','DIST','ORIGIN','AppliedObserver',
    'PendingBackend','publish','boot','choose','draft','waiting','state','ready','wait_evaluated','digest','Server','write']})

INVENTORY = """async()=>{
 const r=await navigator.serviceWorker.getRegistration();
 return await new Promise(resolve=>{
   const channel=new MessageChannel();
   const timer=setTimeout(()=>{channel.port1.close();resolve({status:'NO_RESPONSE'});},1500);
   channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};
   r.waiting.postMessage({namespace:'FINELO_PWA_R2',protocol:1,type:'INVENTORY',requestId:crypto.randomUUID()},[channel.port2]);
 });
}"""

def one(browser, channel, policy):
    name='r2-boundary-'+channel+'-'+policy
    observer=AppliedObserver(name)
    manifests=json.loads((OUT/'builds.json').read_text())
    initial=next(row for row in manifests if row['policy']==policy and row['revision']=='a')
    publish(policy,'a',observer)
    backend=PendingBackend()
    context=browser.new_context(viewport={'width':390,'height':844},color_scheme='light',timezone_id='America/Sao_Paulo')
    observer.attach(context);context.route('**/*',backend.route)
    result={'name':name,'channel':channel,'browserVersion':browser.version,'policyA':policy,
            'kind':'counterexample, not R2 acceptance','status':'FAIL','workerB':'diagnostic prefix gate; not raw release',
            'historicalArtifactsModified':False,'productSourcesModified':False}
    try:
        page=context.new_page();boot(page);choose(page,'light')
        second=context.new_page();second.goto(ORIGIN+'/app?view=goals',wait_until='networkidle');ready(second,revision='a')
        draft(second,'R2_OTHER_TAB_DRAFT');draft(page,'R2_INITIATOR_DRAFT')
        publish('proposed-prompt','b',observer)
        original=(DIST/'sw.js').read_bytes()
        gate=(ROOT/'scripts/diagnostics/pwa-r2/activation-gate-proposal.js').read_bytes()
        experimental=gate+b'\n'+original
        (DIST/'sw.js').write_bytes(experimental)
        result['diagnosticWorkerSHA256']=digest(experimental)
        observer.allowed_worker_hashes={initial['swSHA256'],digest(experimental)}
        for current in [page,second]:waiting(current)
        inventory=page.evaluate(INVENTORY)
        assert inventory['status']=='INVENTORY_ONLY' and len(inventory['clients'])==2
        assert all(row['readiness']=='unknown'for row in inventory['clients'])
        result['inventory']=inventory
        # Only the initiating tab subscribes. A silent legacy tab does not
        # appear as a BroadcastChannel destination or yield an acknowledgement.
        seen=page.evaluate("""async()=>{
          const bc=new BroadcastChannel('finelo-r2-boundary-only');let replies=0;
          bc.onmessage=()=>replies++;bc.postMessage({type:'ARE_YOU_READY'});
          await new Promise(resolve=>setTimeout(resolve,300));bc.close();return replies;
        }""")
        assert seen==0
        result['broadcastReplies']=seen
        result['before']=[state(page),state(second)]
        page.screenshot(path=str(OUT/(name+'-before.png')))
        page.get_by_role('button',name='Atualizar Agora',exact=True).click()
        # Eventual readiness is sampled; this does not extend the product timer.
        wait_evaluated(page,"()=>Boolean(window.__integratedQa?.snapshot().initialDataLoadStatus==='ready'&&!document.querySelector('#goal-form'))")
        result['after']=[state(page),state(second)]
        sw=page.evaluate("""async()=>{const r=await navigator.serviceWorker.getRegistration();return{
          waiting:r.waiting?.state,active:r.active?.state,controllerIsActive:navigator.serviceWorker.controller===r.active};}""")
        assert sw['waiting']=='installed' and sw['controllerIsActive']
        assert result['after'][0]['html']=='a' and result['after'][0]['runtime']=='a'
        assert result['after'][0]['draft'] is None
        assert result['after'][1]['draft']=='R2_OTHER_TAB_DRAFT'
        assert not backend.attempts
        result.update(counterexampleReproduced=True,workerState=sw,
            reason='Old initiating page discarded its draft using its own 1s fallback reload, even though new worker activation was refused')
        page.screenshot(path=str(OUT/(name+'-after.png')))
    except Exception as error:
        result.update(harnessOrUnexpectedFailure=True,reason=str(error),traceback=traceback.format_exc())
    finally:
        observer.event('result',result=result);observer.save();context.close()
    return result

if __name__=='__main__':
    # Loopback server only, after the baseline matrix has closed its own server.
    observer=AppliedObserver('r2-boundary-start');publish('proposed-prompt','a',observer)
    server=Server();server.start();results=[]
    try:
        with sync_playwright()as p:
            for channel in ['msedge','chrome']:
                browser=p.chromium.launch(channel=channel,headless=True)
                try:
                    for policy in ['proposed-prompt','original']:
                        results.append(one(browser,channel,policy));write('r2-boundary-matrix.json',results)
                        print(json.dumps(results[-1],ensure_ascii=True),flush=True)
                finally:browser.close()
    finally:server.stop()
    # Do not turn a reproduced safety failure into an acceptance PASS.
    raise SystemExit(1 if any(row['status']=='FAIL'for row in results)else 0)
