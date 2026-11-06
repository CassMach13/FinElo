"""Independent local PWA matrix. Original and proposed policy are separate results.

The proposal is compiled from a disposable copy; vite.config.ts is never written.
No OS installation, remote Auth, RLS or financial offline cache is certified.
"""
import argparse
import difflib
import json
import os
import shutil
import subprocess
import time
import traceback
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend, A, B
from pwa_r1_observation import Observer, ROOT, TOOLS, OUT, DIST, ORIGIN, digest, disk_http, write

CONFIG = 'scripts/diagnostics/pwa-r1.config.ts'
ENV = {**os.environ, 'GEMINI_API_KEY': '', 'VITE_SUPABASE_URL': 'https://integrated-fixture.invalid',
       'VITE_SUPABASE_PUBLISHABLE_KEY': 'synthetic-public-key', 'VITE_SUPABASE_ANON_KEY': 'synthetic-public-key',
       'VITE_APPEARANCE_PILOT': 'true', 'VITE_OPEN_FINANCE_ENABLED': 'false', 'VITE_ATOMIC_IMPORTS_ENABLED': 'false',
       'VITE_CARD_ENGINE_FORCE': 'false', 'VITE_CARD_V2_FORCE': 'false', 'VITE_CARD_V2_SHADOW_FORCE': 'false',
       'VITE_CARD_V2_ROLLOUT_PERCENT': '0', 'VITE_INVESTMENT_PORTFOLIOS_ENABLED': 'false',
       'VITE_NET_WORTH_COMPONENTS_V2_ENABLED': 'false', 'VITE_DASHBOARD_OWNER_SCOPE_ENABLED': 'false'}
FINANCIAL = ['accounts', 'transactions', 'economicEvents', 'categories', 'assets', 'goals', 'budgets']
HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0

def build_all():
    original = (ROOT / 'vite.config.ts').read_text(encoding='utf8')
    assert original.count('skipWaiting: true,') == 1
    proposal = original.replace('skipWaiting: true,', 'skipWaiting: false,')
    disposable = ROOT / '.pwa-r1-proposed-vite.config.ts'
    assert not disposable.exists(), 'Do not overwrite an existing config'
    disposable.write_text(proposal, encoding='utf8')
    patch = ''.join(difflib.unified_diff(original.splitlines(True), proposal.splitlines(True),
                                         fromfile='a/vite.config.ts', tofile='b/vite.config.ts', n=0))
    (ROOT / 'docs/temas/proposta-pwa-prompt-4d-r1.patch').write_text(patch, encoding='utf8')
    builds = []
    try:
        for policy in ['original', 'proposed-prompt']:
            for revision in ['a', 'b']:
                destination = TOOLS / 'builds' / (policy + '-' + revision)
                assert not destination.exists(), 'Build snapshots are immutable'
                started = time.time()
                with (TOOLS / f'build-{policy}-{revision}.log').open('w', encoding='utf8') as log:
                    result = subprocess.run(['node', 'node_modules/vite/bin/vite.js', 'build', '--mode', 'staging', '--config', CONFIG],
                                            cwd=ROOT, env={**ENV, 'FINELO_QA_BUILD': revision, 'FINELO_PWA_R1_POLICY': policy},
                                            stdout=log, stderr=log, creationflags=HIDDEN, timeout=240)
                assert result.returncode == 0, f'Build failed: {policy}/{revision}'
                shutil.copytree(DIST, destination)
                sw = (destination / 'sw.js').read_text(encoding='utf8')
                row = {'policy': policy, 'revision': revision, 'started': started, 'finished': time.time(),
                       'indexSHA256': digest((destination / 'index.html').read_bytes()),
                       'swSHA256': digest((destination / 'sw.js').read_bytes()),
                       'skipWaitingMessageHandler': 'SKIP_WAITING' in sw,
                       'files': {p.relative_to(destination).as_posix(): digest(p.read_bytes()) for p in destination.rglob('*') if p.is_file()}}
                assert row['skipWaitingMessageHandler'] == (policy == 'proposed-prompt')
                builds.append(row)
                write('builds.json', builds)
                print(json.dumps({key: row[key] for key in ['policy', 'revision', 'indexSHA256', 'swSHA256'] }), flush=True)
    finally:
        assert disposable.read_text(encoding='utf8') == proposal
        disposable.unlink()
        assert (ROOT / 'vite.config.ts').read_text(encoding='utf8') == original

class Server:
    def __init__(self):
        self.process = None
        self.log = None

    def start(self):
        self.log = (TOOLS / 'matrix-server.log').open('a', encoding='utf8')
        self.process = subprocess.Popen(['node', 'node_modules/vite/bin/vite.js', 'preview', '--mode', 'staging',
                                         '--config', CONFIG, '--host', '127.0.0.1', '--port', '5210', '--strictPort'],
                                        cwd=ROOT, env=ENV, stdout=self.log, stderr=self.log, creationflags=HIDDEN)
        (TOOLS / 'matrix-server.pid').write_text(str(self.process.pid), encoding='utf8')
        for _ in range(100):
            if self.process.poll() is not None:
                raise RuntimeError('Preview failed; check matrix-server.log')
            try:
                with urlopen(ORIGIN, timeout=1):
                    return
            except OSError:
                time.sleep(.1)
        raise RuntimeError('Preview not ready')

    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=10)
        if self.log:
            self.log.close()
        self.process = None

def publish(policy, revision, observer):
    source = TOOLS / 'builds-observed' / (policy + '-' + revision)
    assert source.is_dir()
    observer.event('publish-start', policy=policy, revision=revision)
    # Publish already completed artifacts, assets first, entry and worker last.
    # Keep prior hashed assets available for the old page until it navigates.
    for file in sorted(source.rglob('*')):
        if not file.is_file() or file.name in ['index.html', 'sw.js']:
            continue
        target = DIST / file.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)
    for name in ['index.html', 'sw.js']:
        shutil.copyfile(source / name, DIST / name)
    observer.event('publish-end', policy=policy, revision=revision, values=disk_http())

def ready(page, actor=A, revision=None, financial=True):
    # All conditions must hold in ONE document. Separate waits could accept actor
    # and ledger from A, then the HTML/runtime marker from a still-loading B.
    page.wait_for_function('''({actor,revision,financial})=>{
      const snapshot=window.__integratedQa?.snapshot();
      return Boolean(snapshot&&snapshot.actor===actor&&(!financial||snapshot.initialDataLoadStatus==='ready')&&
        (!revision||(document.querySelector('meta[name=qa-build]')?.content===revision&&document.documentElement.dataset.pwaR1Build===revision)));
    }''', arg={'actor':actor,'revision':revision,'financial':financial})

def ledger(page):
    snapshot = page.evaluate('window.__integratedQa.snapshot()')
    return {key: snapshot[key] for key in FINANCIAL}

def choose(page, preference):
    page.evaluate('(theme)=>window.__integratedQa.theme(theme)', preference)
    expected = 'light' if preference in ['light', 'system'] else 'dark'
    page.wait_for_function('(t)=>document.querySelector("[data-qa-eligible]").dataset.fineloTheme===t', arg=expected)

CACHE_B = """async () => {
 for(const key of await caches.keys()) {
  const cache=await caches.open(key);
  for(const request of await cache.keys()) {
   if(new URL(request.url).pathname==='/index.html' && (await (await cache.match(request)).text()).includes('name="qa-build" content="b"')) return true;
  }
 } return false;
}"""

def update(page):
    page.evaluate('()=>{window.__r1PreviousController=navigator.serviceWorker.controller;void navigator.serviceWorker.ready.then(r=>r.update())}')

def wait_evaluated(page, expression, timeout=30000):
    # wait_for_function treats a Promise as truthy in the installed driver. Evaluate
    # and await the resolved BOOLEAN explicitly; never accept a Promise handle.
    deadline = time.monotonic() + timeout/1000
    while time.monotonic() < deadline:
        try:
            if page.evaluate(expression) is True:
                return
        except Exception as error:
            if 'Execution context was destroyed' not in str(error):
                raise
        page.wait_for_timeout(100)
    raise TimeoutError('Resolved async predicate remained false')

def active_b(page):
    wait_evaluated(page, CACHE_B)
    wait_evaluated(page, '''async()=>{
      const r=await navigator.serviceWorker.getRegistration();
      const controller=navigator.serviceWorker.controller;
      if(r.installing||r.waiting||r.active!==controller||r.active?.state!=='activated')return false;
      const version=await window.__pwaR1ControllerVersion();
      return version?.revision==='b';
    }''')

def b_available(page):
    # Prompt mode may offer a waiting worker. Do not invent automatic activation.
    wait_evaluated(page, '''async()=>{
      const r=await navigator.serviceWorker.getRegistration();
      if((await window.__pwaR1ControllerVersion())?.revision==='b')return true;
      return (await window.__pwaR1WorkerVersion(r?.waiting))?.revision==='b';
    }''')

def financial_match(page, before, name):
    after = ledger(page)
    different = [key for key in FINANCIAL if before[key] != after[key]]
    if different:
        write(name+'-financial-difference.json', {'different':different,'before':before,'after':after})
    assert not different, 'Financial snapshot mismatch: '+','.join(different)

def async_wait_canary(browser, channel):
    # No application or network: this tests only the installed driver's wait API.
    context = browser.new_context()
    context.route('**/*', lambda route: route.abort())
    page = context.new_page()
    try:
        returned = page.wait_for_function('async()=>false', timeout=1000).json_value()
        assert returned is False, 'Driver semantics changed; review the historical canary'
        rejected_false = False
        try:
            wait_evaluated(page, 'async()=>false', timeout=200)
        except TimeoutError:
            rejected_false = True
        assert rejected_false
        page.evaluate('()=>{window.__canary=false;setTimeout(()=>{window.__canary=true},150)}')
        wait_evaluated(page, 'async()=>window.__canary', timeout=1000)
        write('async-wait-canary-'+channel+'.json', {'nativeWaitResolvedValue':returned,
              'explicitBooleanPollRejectedFalse':rejected_false,'delayedTruePassed':True,
              'networkRequests':0,'applicationTest':False})
    finally:
        context.close()

def validate_static_cache(snapshot):
    entries = snapshot['caches']
    assert entries
    for entry in entries:
        assert entry['url'].startswith(ORIGIN + '/')
        assert not any(path in entry['url'] for path in ['/auth/', '/rest/', '/functions/', '/storage/'])
    html = [entry for entry in entries if entry['revision'] == 'b']
    assert len(html) == 1
    assert html[0]['sha256'] == disk_http()['disk']['index.html']['sha256']

def run_case(browser, channel, server, mode, preference='light', policy='original'):
    name = f'{channel}-{policy}-{mode}-{preference}'
    observer = Observer(name)
    publish(policy, 'a', observer)
    backend = Backend()
    backend.rewrite_documents = False
    context = browser.new_context(viewport={'width':390, 'height':844}, color_scheme='light',
                                  timezone_id='America/Sao_Paulo', service_workers='block' if mode=='service-worker-blocked' else 'allow')
    observer.attach(context)
    context.route('**/*', backend.route)
    page = context.new_page()
    row = {'name': name, 'channel': channel, 'policy': policy, 'mode': mode, 'preference': preference,
           'status': 'PASS', 'notOsInstalled': True, 'remoteAuth': 'BLOCKED'}
    try:
        page.goto(ORIGIN+'/?login=a', wait_until='networkidle')
        ready(page, revision='a')
        page.wait_for_timeout(1700)
        close = page.locator('.driver-popover-close-btn').filter(visible=True)
        if close.count():
            page.once('dialog', lambda dialog: dialog.accept())
            close.first.click()
            page.locator('.driver-overlay').wait_for(state='detached')
        assert page.locator('[data-qa-eligible]').get_attribute('data-finelo-theme') == 'dark'
        if mode != 'service-worker-blocked':
            page.evaluate('navigator.serviceWorker.ready')
            page.wait_for_function('navigator.serviceWorker.controller!==null')
        choose(page, preference)
        if mode == 'original-update-ui-restored':
            page.close()
            page = context.new_page()
            page.goto(ORIGIN+'/app', wait_until='networkidle')
            ready(page, revision='a')
        before = ledger(page)
        original_db = json.dumps(backend.db, sort_keys=True)
        page.evaluate('window.__pwaR1InitialController=navigator.serviceWorker.controller')
        observer.snapshot(page, 'initial-a')
        if mode == 'manual-update-explicit-reload':
            context.set_offline(True)
            backend.offline = True
            page.reload(wait_until='domcontentloaded')
            ready(page, revision='a', financial=False)
            assert page.locator('[data-qa-eligible]').get_attribute('data-finelo-theme') == ('dark' if preference=='dark' else 'light')
            row['offlineAppearance'] = 'PASS'
            row['offlineFinancialDataCacheCertified'] = False
            backend.offline = False
            context.set_offline(False)
            page.reload(wait_until='networkidle')
            ready(page, revision='a')
            assert ledger(page) == before
            row['reconnectionFinancialEquivalent'] = True
        publish(policy, 'b', observer)
        observer.snapshot(page, 'b-published-page-still-a')
        if mode == 'service-worker-blocked':
            page.reload(wait_until='networkidle')
        elif mode == 'fresh-context-no-cache':
            context.close()
            context = browser.new_context(viewport={'width':390, 'height':844}, color_scheme='light')
            observer.attach(context)
            context.route('**/*', backend.route)
            page = context.new_page()
            page.goto(ORIGIN+'/?login=a', wait_until='networkidle')
        elif mode in ['normal-navigation', 'old-cache-server-kept']:
            # Navigation runs the original App mount update check; no manual r.update here.
            page.goto(ORIGIN+'/app', wait_until='networkidle')
            b_available(page)
            waiting = page.evaluate('navigator.serviceWorker.getRegistration().then(r=>Boolean(r.waiting))')
            if waiting:
                observer.snapshot(page, 'navigation-offered-waiting-b-original-ui')
                row['navigationRequiredOriginalConfirmation'] = True
                page.get_by_role('button', name='Atualizar Agora', exact=True).click()
            else:
                active_b(page)
                page.goto(ORIGIN+'/app', wait_until='networkidle')
        elif mode == 'old-cache-server-restarted':
            server.stop()
            rejected = page.evaluate('async()=>{try{await(await navigator.serviceWorker.getRegistration()).update();return false}catch{return true}}')
            assert rejected, 'Interruption did not reject the update request'
            row['interruptedUpdateRejected'] = True
            observer.event('update-interruption-confirmed')
            server.start()
            update(page)
            active_b(page)
            page.reload(wait_until='networkidle')
        elif mode in ['original-update-ui','original-update-ui-restored']:
            # Original App focus listener discovers the worker; original button owns acceptance.
            page.evaluate("window.dispatchEvent(new Event('focus'))")
            if policy == 'original':
                b_available(page)
                if page.locator('meta[name=qa-build]').get_attribute('content') == 'a':
                    button = page.get_by_role('button', name='Atualizar Agora', exact=True)
                    if button.count():
                        observer.snapshot(page, 'original-policy-offers-button-after-activation')
                        button.click()
                        row['originalButtonOffered'] = True
                    else:
                        ready(page, revision='a')
                        original_policy_state = observer.snapshot(page, 'original-policy-active-b-without-update-prompt')
                        validate_static_cache(original_policy_state)
                        financial_match(page, before, name)
                        assert json.dumps(backend.db, sort_keys=True) == original_db
                        assert not [w for w in backend.writes if w['kind']=='data' and w['table']!='product_events']
                        row['financialEquivalent'] = True
                        row['financialWriteAttempts'] = 0
                        page.screenshot(path=str(OUT/(name+'.png')))
                        row.update(status='FAIL', knownOriginalPolicyFailure=True, reason='Worker B active; waiting/needRefresh bypassed; original update button absent; document A')
                        return row
                else:
                    row['reloadObservedWithoutButton'] = True
            else:
                page.get_by_role('button', name='Atualizar Agora', exact=True).wait_for(timeout=30000)
                before_click = observer.snapshot(page, 'proposal-waiting-before-original-button')
                assert before_click['registration']['waiting'] is not None
                assert before_click['revision'] == 'a'
                page.get_by_role('button', name='Atualizar Agora', exact=True).click()
        else:
            update(page)
            active_b(page)
            before_reload = observer.snapshot(page, 'active-b-before-navigation')
            assert before_reload['revision'] == 'a'
            if mode == 'new-tab-same-profile':
                page = context.new_page()
                page.goto(ORIGIN+'/app', wait_until='networkidle')
            else:
                page.reload(wait_until='networkidle')
        ready(page, revision='b')
        financial_match(page, before, name)
        assert page.locator('[data-qa-eligible]').get_attribute('data-finelo-theme') == ('dark' if preference=='dark' else 'light')
        after = observer.snapshot(page, 'rendered-document-and-runtime-b')
        if mode != 'service-worker-blocked':
            page.evaluate('navigator.serviceWorker.ready')
            active_b(page)
            after = observer.snapshot(page, 'active-b-static-cache')
            validate_static_cache(after)
        row['financialSHA256'] = {key:digest(json.dumps(before[key],sort_keys=True).encode()) for key in FINANCIAL}
        row['renderedHTML'] = 'b'
        row['executedRuntime'] = page.locator('html').get_attribute('data-pwa-r1-build')
        if preference == 'system':
            page.emulate_media(color_scheme='dark')
            page.wait_for_function('document.querySelector("[data-qa-eligible]").dataset.fineloTheme==="dark"')
            page.emulate_media(color_scheme='light')
            page.wait_for_function('document.querySelector("[data-qa-eligible]").dataset.fineloTheme==="light"')
            row['systemMediaSwitch'] = 'PASS'
        page.screenshot(path=str(OUT/(name+'.png')))
        if mode == 'manual-update-explicit-reload' or policy == 'proposed-prompt':
            page.evaluate('window.__integratedQa.logout()')
            page.wait_for_function('window.__integratedQa.snapshot().actor===null')
            page.evaluate("window.__integratedQa.login('b')")
            ready(page, B, revision='b')
            assert '_A_QA' not in page.locator('body').inner_text()
            assert A not in json.dumps(ledger(page))
            assert page.locator('[data-qa-eligible]').get_attribute('data-finelo-theme') == 'dark'
            page = context.new_page()
            page.goto(ORIGIN+'/app', wait_until='networkidle')
            ready(page, B, revision='b')
            assert page.locator('[data-qa-eligible]').get_attribute('data-finelo-theme') == 'dark'
            assert '_A_QA' not in page.locator('body').inner_text()
            final = observer.snapshot(page, 'new-page-account-b-after-logout-login')
            validate_static_cache(final)
            row['logoutLoginBAndNewPage'] = 'PASS'
        assert json.dumps(backend.db, sort_keys=True) == original_db
        financial_writes = [w for w in backend.writes if w['kind']=='data' and w['table']!='product_events']
        assert financial_writes == []
        row['financialWriteAttempts'] = len(financial_writes)
        row['appearanceWrites'] = len([w for w in backend.writes if w['kind']=='auth' and 'appearance_theme' in w['data']])
        assert row['appearanceWrites'] == 1
        return row
    except Exception as error:
        row.update(status='FAIL', reason=str(error), traceback=traceback.format_exc(), unexpected=True)
        try:
            observer.snapshot(page, 'unexpected-failure')
            page.screenshot(path=str(OUT/(name+'-unexpected.png')))
        except Exception:
            pass
        return row
    finally:
        observer.event('case-result', result=row)
        observer.save()
        context.close()

def observed_builds():
    manifests = json.loads((OUT/'builds.json').read_text(encoding='utf8'))
    observed = []
    for build in manifests:
        name = build['policy']+'-'+build['revision']
        source = TOOLS/'builds'/name
        target = TOOLS/'builds-observed'/name
        original = (source/'sw.js').read_bytes()
        assert digest(original) == build['swSHA256']
        version = {'revision':build['revision'],'policy':build['policy'],'generatedSW_SHA256':build['swSHA256']}
        # Read-only observer, no registration/cache/skipWaiting/activation operation.
        suffix = ('\nself.addEventListener("message",event=>{if(event.data?.type==="PWA_R1_VERSION"&&event.ports[0])event.ports[0].postMessage('+json.dumps(version)+');});\n').encode()
        if not target.exists():
            shutil.copytree(source,target)
            (target/'sw.js').write_bytes(original+suffix)
        assert (target/'sw.js').read_bytes() == original+suffix
        observed.append({**version,'observedSW_SHA256':digest(original+suffix),'instrumentation':'read-only version message; generated worker bytes retained as prefix'})
    write('observed-builds.json',observed)

def matrix(channels, selected_modes=None, output='independent-matrix.json', proposal=True):
    results = []
    observed_builds()
    observer = Observer('matrix-start')
    publish('original', 'a', observer)
    server = Server()
    server.start()
    try:
        with sync_playwright() as playwright:
            for channel in channels:
                browser = playwright.chromium.launch(channel=channel, headless=True)
                try:
                    async_wait_canary(browser, channel)
                    modes = ['normal-navigation','service-worker-blocked','manual-update-explicit-reload','original-update-ui','original-update-ui-restored',
                             'new-tab-same-profile','fresh-context-no-cache','old-cache-server-restarted','old-cache-server-kept']
                    for mode in (selected_modes if selected_modes is not None else modes):
                        for preference in (['dark','light','system'] if mode=='manual-update-explicit-reload' else ['light']):
                            result = run_case(browser, channel, server, mode, preference)
                            results.append(result)
                            write(output, results)
                            print(json.dumps(result, ensure_ascii=True), flush=True)
                    for mode,preference in ([('original-update-ui',p)for p in ['dark','light','system']]+[('original-update-ui-restored','light')] if proposal else []):
                        result = run_case(browser, channel, server, mode, preference, 'proposed-prompt')
                        results.append(result)
                        write(output, results)
                        print(json.dumps(result, ensure_ascii=True), flush=True)
                finally:
                    browser.close()
    finally:
        server.stop()
    assert not any(row.get('unexpected') for row in results), 'Unexpected matrix failures; inspect evidence'
    return results

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['build','matrix'], required=True)
    parser.add_argument('--channels', nargs='+', default=['msedge','chrome'])
    parser.add_argument('--modes', nargs='+')
    parser.add_argument('--output', default='independent-matrix.json')
    parser.add_argument('--no-proposal', action='store_true')
    parser.add_argument('--proposal-only', action='store_true')
    args = parser.parse_args()
    if args.phase == 'build':
        build_all()
    else:
        matrix(args.channels, [] if args.proposal_only else args.modes, args.output, not args.no_proposal)
