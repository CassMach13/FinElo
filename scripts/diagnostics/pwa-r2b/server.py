"""Two loopback origins; synthetic in-memory finance only. No FinElo service imports."""
import copy
import hashlib
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE=Path(__file__).resolve().parent
ORIGIN='http://127.0.0.1:5221'
NEUTRAL='http://127.0.0.1:5222'

class State:
    def __init__(self):
        self.current='a';self.lock=threading.Lock();self.balances={'QA-A':100000,'QA-B':200000}
        self.attempts=[];self.writes=[];self.results={};self.held={};self.deliveries=[]
    def publish(self,version):
        assert version in ['a','b'];self.current=version
    def release(self,operation,outcome='accepted'):
        with self.lock:
            item=self.held[operation];item['outcome']=outcome;item['event'].set()
    def snapshot(self):
        with self.lock:return copy.deepcopy({'balances':self.balances,'attempts':self.attempts,'writes':self.writes,'results':self.results})

def artifact(name,build):
    assert build in ['a','b']
    if name=='marker.svg':return f'<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" rx="6" fill="#075985"/><text x="11" y="25" fill="white" font-size="23">{build.upper()}</text></svg>'.encode()
    assert name in ['index.html','client.js','style.css','worker.js']
    return (HERE/name).read_text(encoding='utf8').replace('__BUILD__',build).encode('utf8')

def manifest(build):
    return {name:hashlib.sha256(artifact(name,build)).hexdigest()for name in ['index.html','client.js','style.css','marker.svg','worker.js']}

class Lab:
    def __init__(self):self.state=State();self.servers=[];self.threads=[]
    def start(self):
        state=self.state
        class Handler(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.0'
            def log_message(self,*_):pass
            def send(self,body,status=200,kind='application/json',immutable=False):
                if not isinstance(body,bytes):body=json.dumps(body).encode('utf8')
                self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)))
                self.send_header('Cache-Control','public,max-age=31536000,immutable'if immutable else'no-store')
                self.send_header('Referrer-Policy','no-referrer');self.end_headers()
                try:self.wfile.write(body)
                except (BrokenPipeError,ConnectionResetError):pass
            def do_GET(self):
                url=urlparse(self.path);query={k:v[-1]for k,v in parse_qs(url.query).items()}
                if self.server.server_port==5222:
                    body=(HERE/'neutral.html').read_text(encoding='utf8').replace('__APP_ORIGIN__',ORIGIN).encode('utf8')
                    return self.send(body,kind='text/html; charset=utf-8')
                if url.path=='/sw.js':return self.send(artifact('worker.js',state.current),kind='application/javascript')
                if url.path in ['/','/app']:return self.send(artifact('index.html',state.current),kind='text/html; charset=utf-8')
                if url.path.startswith('/v/'):
                    parts=url.path.split('/');build,name=parts[2:4]
                    try:data=artifact(name,build)
                    except (AssertionError,ValueError):return self.send({},404)
                    kinds={'index.html':'text/html','client.js':'application/javascript','style.css':'text/css','marker.svg':'image/svg+xml'}
                    return self.send(data,kind=kinds[name],immutable=True)
                if url.path=='/unknown':return self.send(b'<!doctype html><title>Cliente sem protocolo</title><p id="unknown">Unknown client</p><input id="unknown-draft">',kind='text/html')
                if url.path=='/unknown-worker.js':return self.send(b'setInterval(()=>{},1000);',kind='application/javascript')
                if url.path=='/api/balance':return self.send({'cents':state.balances.get(query.get('actor'),0)})
                if url.path=='/api/result':
                    with state.lock:result=copy.deepcopy(state.results.get(query.get('id')))
                    return self.send(result if result and result['actor']==query.get('actor')else{'status':'unknown'})
                return self.send({},404)
            def do_POST(self):
                if self.server.server_port!=5221 or urlparse(self.path).path!='/api/operation':return self.send({},403)
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                assert body['actor']in ['QA-A','QA-B'] and type(body['cents'])is int
                with state.lock:state.attempts.append(copy.deepcopy(body))
                outcome=body['outcome']
                if outcome=='held':
                    item={'event':threading.Event(),'outcome':None}
                    with state.lock:state.held[body['id']]=item
                    if not item['event'].wait(30):
                        self.close_connection=True;return
                    outcome=item['outcome']
                accepted=outcome in ['accepted','accepted_lost']
                result={'status':'accepted'if accepted else'refused','actor':body['actor'],'id':body['id']}
                with state.lock:
                    if accepted:
                        # Deliberately no idempotency compensation: a duplicated
                        # POST would increment twice and fail the assertions.
                        state.balances[body['actor']]+=body['cents'];state.writes.append(copy.deepcopy(body))
                    state.results[body['id']]=result
                if outcome=='accepted_lost':
                    self.close_connection=True
                    try:self.connection.shutdown(socket.SHUT_RDWR)
                    except OSError:pass
                    self.connection.close();return
                self.send(result,201 if accepted else 403)
        for port in [5221,5222]:
            server=ThreadingHTTPServer(('127.0.0.1',port),Handler);server.daemon_threads=True
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();self.servers.append(server);self.threads.append(thread)
    def stop(self):
        for server in self.servers:server.shutdown();server.server_close()
        for thread in self.threads:thread.join(timeout=2)

if __name__=='__main__':
    import argparse,time
    parser=argparse.ArgumentParser();parser.add_argument('--serve',action='store_true');args=parser.parse_args()
    if args.serve:
        lab=Lab();lab.start()
        try:
            while True:time.sleep(1)
        except KeyboardInterrupt:pass
        finally:lab.stop()
