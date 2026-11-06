"""Passive diagnostics for disposable, synthetic loopback PWA experiments."""
import hashlib
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'node_modules/.finelo-cycle4d-r1-tools'
OUT = TOOLS / 'evidence'
OUT.mkdir(parents=True, exist_ok=True)
DIST = ROOT / 'node_modules/.finelo-cycle4d-tools/pwa-dist'
ORIGIN = 'http://127.0.0.1:5210'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')

def http(path):
    assert path in ['/', '/app', '/index.html', '/sw.js']
    request = Request(ORIGIN + path, headers={'Accept': 'text/html' if path != '/sw.js' else '*/*', 'Cache-Control': 'no-cache'})
    with urlopen(request, timeout=10) as response:
        content = response.read()
        return {'status': response.status, 'sha256': digest(content), 'bytes': len(content),
                'revision': 'b' if b'name="qa-build" content="b"' in content else 'a' if b'name="qa-build" content="a"' in content else None,
                'headers': {key: response.headers.get(key) for key in ['Content-Type', 'Cache-Control', 'ETag', 'Last-Modified']}}

def disk_http():
    result = {'time': time.time(), 'disk': {}, 'http': {}}
    for name in ['index.html', 'sw.js']:
        data = (DIST / name).read_bytes()
        result['disk'][name] = {'sha256': digest(data), 'bytes': len(data),
                                'revision': 'b' if b'name="qa-build" content="b"' in data else 'a' if b'name="qa-build" content="a"' in data else None}
    for path in ['/', '/app', '/index.html', '/sw.js']:
        try:
            result['http'][path] = http(path)
        except Exception as error:
            result['http'][path] = {'error': str(error)}
    return result

SNAPSHOT = """async () => {
 const hash = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const registration = await navigator.serviceWorker.getRegistration().catch(()=>null);
 const entries = [];
 for (const name of await caches.keys()) {
  const cache = await caches.open(name);
  for (const request of await cache.keys()) {
   const path = new URL(request.url).pathname;
   const response = await cache.match(request);
   const data = await response.arrayBuffer();
   const html = path.endsWith('.html') ? new TextDecoder().decode(data) : '';
   entries.push({cache:name,url:request.url,bytes:data.byteLength,sha256:await hash(data),
    revision:html.match(/name="qa-build" content="([ab])"/)?.[1] ?? null});
  }
 }
 const responses = {};
 for (const path of ['/index.html','/app','/sw.js']) {
  try {
   const response = await fetch(path,{cache:'no-store',headers:{Accept:path==='/sw.js'?'*/*':'text/html'}});
   const data = await response.arrayBuffer();
   responses[path]={sha256:await hash(data),status:response.status,bytes:data.byteLength};
  } catch(error) { responses[path]={error:String(error)}; }
 }
 return {url:location.href,revision:document.querySelector('meta[name=qa-build]')?.content,
  executedRuntime:document.documentElement.dataset.pwaR1Build,
  theme:document.querySelector('[data-qa-eligible]')?.dataset.fineloTheme,
  actor:window.__integratedQa?.snapshot()?.actor,
  initialDataLoadStatus:window.__integratedQa?.snapshot()?.initialDataLoadStatus,
  registration:window.__pwaR1State?.(registration), caches:entries,responses,
  controllerVersion:await window.__pwaR1ControllerVersion?.(),
  waitingVersion:await window.__pwaR1WorkerVersion?.(registration?.waiting),
  needRefreshVisible:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Atualizar Agora')};
}"""

class Observer:
    def __init__(self, name):
        self.name = name
        self.events = []
        self.responses = []
        self.snapshots = []

    def event(self, event, **detail):
        self.events.append({'event': event, 'hostTime': time.time(), **detail})

    def attach(self, context):
        context.expose_binding('__pwaR1Report', lambda source, payload: self.event('browser', detail=payload))
        context.add_init_script(path=str(ROOT / 'scripts/diagnostics/pwa-r1-observe.js'))
        def page_created(page):
            def response_seen(response):
                if response.url.startswith(ORIGIN) and (response.request.resource_type == 'document' or response.url.endswith('/sw.js')):
                    try:
                        self.responses.append({'time': time.time(), 'url': response.url, 'status': response.status,
                                               'fromServiceWorker': response.from_service_worker,
                                               'sha256': digest(response.body())})
                    except Exception as error:
                        self.event('response-observation-error', reason=str(error))
            page.on('response', response_seen)
            page.on('console', lambda message: self.event('reload-prompt-console', text=message.text)
                    if message.text.startswith(('[PWA Update]', 'SW Registered:', 'SW registration error')) else None)
        context.on('page', page_created)

    def snapshot(self, page, label):
        value = page.evaluate(SNAPSHOT)
        self.snapshots.append({'label': label, 'time': time.time(), 'diskHttp': disk_http(), 'browser': value})
        self.save()
        return value

    def save(self):
        write(self.name + '.json', {'events': self.events, 'responses': self.responses, 'snapshots': self.snapshots})
