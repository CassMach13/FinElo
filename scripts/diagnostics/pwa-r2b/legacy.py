"""Four native legacy sessions; residual loss stays FAIL, never incompatibility PASS."""
import copy,hashlib,json,runpy,sys,threading,time,traceback
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
TOOLS=ROOT/'node_modules/.finelo-cycle4d-r2b-tools';OUT=TOOLS/'evidence'
sys.path[:0]=[str(TOOLS/'python'),str(ROOT/'scripts/diagnostics')]
from playwright.sync_api import sync_playwright
from validate import watch_activation,activation_done
M=runpy.run_path(str(ROOT/'scripts/diagnostics/pwa-r1-applied-validate.py'),run_name='r2b_legacy_helpers')
BASE=M['BASE'];NEUTRAL='http://127.0.0.1:5222/'

class AcceptingFixture(M['PendingBackend']):
    def __init__(self):super().__init__();self.committed=[];self.lost=[]
    def accept(self,deliver=True):
        routes=self.pending;self.pending=[]
        for route in routes:
            rows=copy.deepcopy(route.request.post_data_json)
            for row in rows:
                row.update(id=f'20000000-0000-4000-8000-{len(self.committed)+1:012d}',created_at='2026-11-06T12:00:00Z',updated_at='2026-11-06T12:00:00Z',archived_at=None)
                self.db['financial_goals'].append(row);self.committed.append(copy.deepcopy(row))
            if deliver:self.fulfill(route,rows,201)
            else:self.lost.append(route)

def write(name,value):(OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
def fingerprint(page):
    return page.evaluate("""()=>({preferences:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('finelo.appearance.'))),
      users:Object.entries(localStorage).filter(([k])=>k.startsWith('sb-')).map(([,v])=>{try{return JSON.parse(v).user?.id}catch{return null}}).filter(Boolean)})""")
def waiting(page):
    M['waiting'](page)
    assert page.evaluate("async()=>!!(await navigator.serviceWorker.getRegistration()).waiting")
def run(browser,channel,policy):
    name=f'legacy-{channel}-{policy}';rows=[];observer=M['AppliedObserver'](name);backend=AcceptingFixture()
    M['publish'](policy,'a',observer)
    context=browser.new_context(viewport={'width':390,'height':844},color_scheme='light',timezone_id='America/Sao_Paulo');observer.attach(context);context.route('**/*',backend.route)
    def item(step,status='PASS',**details):
        rows.append({'name':name+'-'+step,'session':name,'browser':channel,'browserVersion':browser.version,'installedPolicy':policy,'step':step,'status':status,**details});write(name+'.json',rows)
    try:
        owner=context.new_page();M['boot'](owner);M['choose'](owner,'light');M['loaded_goals'](owner,backend)
        initial=copy.deepcopy(backend.db);original_ledger=BASE['ledger'](owner)
        peer=context.new_page();peer.goto(M['ORIGIN']+'/app?view=goals',wait_until='networkidle');M['ready'](peer,revision='a');M['loaded_goals'](peer,backend);M['draft'](peer,'LEGACY_RETAINED')
        M['publish']('proposed-prompt','b',observer)
        raw=(M['DIST']/'sw.js').read_bytes();gate=(ROOT/'scripts/diagnostics/pwa-r2/activation-gate-proposal.js').read_bytes()
        experimental=gate+b'\n'+raw;(M['DIST']/'sw.js').write_bytes(experimental)
        for page in[owner,peer]:waiting(page)
        owner.wait_for_timeout(800);assert M['state'](peer)['draft']=='LEGACY_RETAINED';item('defer-dirty',workerWaiting=True,experimentalBSHA256=hashlib.sha256(experimental).hexdigest())
        context.set_offline(True);backend.offline=True;peer.wait_for_timeout(400);assert M['state'](peer)['draft']=='LEGACY_RETAINED'
        backend.offline=False;context.set_offline(False);peer.wait_for_timeout(400);assert M['state'](peer)['draft']=='LEGACY_RETAINED';waiting(owner);item('offline-reconnect',draftPreserved=True)
        M['draft'](owner,'LEGACY_INITIATOR');owner.screenshot(path=str(OUT/(name+'-before-button.png')))
        owner.get_by_role('button',name='Atualizar Agora',exact=True).click()
        M['wait_evaluated'](owner,"()=>Boolean(window.__integratedQa?.snapshot().initialDataLoadStatus==='ready'&&!document.querySelector('#goal-form'))")
        assert M['state'](owner)['html']=='a'and M['state'](peer)['draft']=='LEGACY_RETAINED';waiting(owner)
        item('old-button','FAIL',residual=True,reason='Own legacy 1s reload discarded its draft; B still waiting');owner.screenshot(path=str(OUT/(name+'-after-button.png')))
        M['draft'](owner,'LEGACY_MANUAL_REFRESH');owner.reload(wait_until='networkidle');M['ready'](owner,revision='a');assert M['state'](owner)['draft']is None;waiting(owner)
        item('manual-refresh','FAIL',residual=True,reason='Voluntary manual refresh discarded unsaved legacy draft')
        assert M['state'](peer)['draft']=='LEGACY_RETAINED';peer.close();waiting(owner)
        item('close-dirty','FAIL',residual=True,reason='User closed a legacy document with unsaved work; protocol cannot retain that DOM state')
        owner.set_viewport_size({'width':1440,'height':1000})
        peer=context.new_page();peer.goto(M['ORIGIN']+'/app?view=goals',wait_until='networkidle');M['ready'](peer,revision='a');M['loaded_goals'](peer,backend)
        peer.set_viewport_size({'width':1440,'height':1000})
        M['draft'](peer,'LEGACY_SAVED');peer.get_by_role('button',name='Salvar',exact=True).click();M['wait_pending'](peer,backend);backend.accept()
        peer.locator('#goal-form').wait_for(state='detached');assert len(backend.committed)==1
        peer.wait_for_function('(id)=>window.__integratedQa.snapshot().goals.some(g=>g.id===id)',arg=backend.committed[0]['id'],polling=50)
        assert backend.committed[0]['target_amount']==1234.56;item('save-observed',committed=1,observedByClient=True,viewport='1440x1000, desktop only; no mobile accessibility claim')
        M['draft'](peer,'LEGACY_ACCEPTED_UNOBSERVED');peer.get_by_role('button',name='Salvar',exact=True).click()
        deadline=time.monotonic()+5
        while not backend.pending and time.monotonic()<deadline:peer.wait_for_timeout(50)
        assert len(backend.pending)==1 and M['state'](peer)['saving'];waiting(owner);owner.wait_for_timeout(600)
        assert M['state'](peer)['saving'];item('defer-pending',requestAttempts=len(backend.attempts),workerWaiting=True)
        backend.accept(deliver=False);assert len(backend.committed)==2 and M['state'](peer)['saving'];peer.close();waiting(owner)
        item('close-accepted-unobserved','FAIL',residual=True,reason='Synthetic commit without delivered response; manual close loses client feedback',committed=2,requestAttempts=len(backend.attempts))
        stored=fingerprint(owner);observation=watch_activation(context,owner,M['ORIGIN']);owner.goto(NEUTRAL,wait_until='networkidle')
        activated=activation_done(observation,owner);item('natural-after-voluntary-exit',allLegacyApplicationClientsGone=True,nativeActivation=activated)
        owner.goto(M['ORIGIN']+'/app?view=goals',wait_until='networkidle');M['ready'](owner,revision='b');M['loaded_goals'](owner,backend)
        assert fingerprint(owner)==stored and M['state'](owner)['theme']=='light'
        final_ledger=BASE['ledger'](owner)
        assert all(final_ledger[key]==original_ledger[key]for key in original_ledger if key!='goals')
        assert len(backend.attempts)==2 and len(backend.committed)==2
        for key in initial:
            if key!='financial_goals':assert backend.db[key]==initial[key]
        assert len(final_ledger['goals'])==len(original_ledger['goals'])+2
        item('identity-preferences-finance',account=M['A'],committed=2,requestAttempts=2,otherFinancialCollectionsUnchanged=True,
             submittedPayloadSHA256=hashlib.sha256(json.dumps(backend.attempts,sort_keys=True).encode()).hexdigest())
    except Exception as error:item('unexpected-failure','FAIL',unexpected=True,reason=str(error),traceback=traceback.format_exc())
    finally:context.close();write(name+'.json',rows)
    return rows

if __name__=='__main__':
    class Neutral(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_GET(self):
            body=(HERE/'neutral.html').read_text().replace('__APP_ORIGIN__',M['ORIGIN']).encode();self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Referrer-Policy','no-referrer');self.end_headers();self.wfile.write(body)
    neutral=ThreadingHTTPServer(('127.0.0.1',5222),Neutral);threading.Thread(target=neutral.serve_forever,daemon=True).start()
    M['publish']('proposed-prompt','a',M['AppliedObserver']('legacy-start'));server=M['Server']();server.start();results=[]
    try:
        with sync_playwright()as p:
            for channel in['msedge','chrome']:
                browser=p.chromium.launch(channel=channel,headless=True)
                try:
                    for policy in['original','proposed-prompt']:
                        rows=run(browser,channel,policy);results+=rows;write('legacy-final-matrix.json',results)
                        print(json.dumps({'session':channel+'-'+policy,'steps':len(rows),'FAIL':sum(r['status']=='FAIL'for r in rows),'unexpected':sum(bool(r.get('unexpected'))for r in rows)}),flush=True)
                finally:browser.close()
    finally:server.stop();neutral.shutdown();neutral.server_close()
    raise SystemExit(1 if any(row['status']=='FAIL'for row in results)else 0)
