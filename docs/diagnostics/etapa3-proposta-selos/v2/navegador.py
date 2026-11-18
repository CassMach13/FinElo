from pathlib import Path
import hashlib, re
from urllib.parse import urlparse, parse_qs
from uuid import uuid4
from time import time
import base64
import json
from playwright.sync_api import sync_playwright, expect



accounts = {
    label: dict(id=f"90000000-0000-4000-8000-00000000000{i}", email=f"{label.lower()}@qa.example.test",
                user_metadata={"full_name": f"Conta {label}", "terms_accepted_version": "v_2026_03_17_consumer_rights"}, app_metadata={}, aud="authenticated", role="authenticated",
                created_at="2026-01-01T00:00:00Z")
    for i, label in enumerate("ABC", 1)
}
users = {a["email"]: a for a in accounts.values()}
access = {}
refresh = {}
logins = []
logouts = []

def encode(data):
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")

def session(user):
    token = encode({"alg": "HS256", "typ": "JWT"}) + "." + encode({
        "sub": user["id"], "session_id": str(uuid4()), "exp": int(time()) + 3600, "aud": "authenticated"
    }) + "." + encode(str(uuid4()))
    refresh_token = str(uuid4())
    access[token] = user
    refresh[refresh_token] = user
    return dict(user=user, access_token=token, refresh_token=refresh_token, token_type="bearer",
                expires_in=3600, expires_at=int(time()) + 3600)

def backend(route):
    request = route.request
    parsed = urlparse(request.url)
    args = parse_qs(parsed.query)
    headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization,apikey,x-client-info,x-supabase-api-version,content-type,prefer,range,accept-profile,content-profile",
        "access-control-allow-methods": "GET,POST,OPTIONS",
    }
    bearer = request.headers.get("authorization", "").removeprefix("Bearer ")
    user = access.get(bearer)
    def send(status, data=None):
        route.fulfill(status=status, headers=headers, json=data)
    if request.method == "OPTIONS":
        return route.fulfill(status=204, headers=headers)
    if parsed.path == "/auth/v1/token":
        body = request.post_data_json
        grant = args.get("grant_type", [""])[0]
        if grant == "password":
            identity = users.get(body["email"])
            if identity and body["password"] == "fixture-password":
                logins.append(identity["email"])
                return send(200, session(identity))
            return send(400, {"code": 400, "error_code": "invalid_credentials", "msg": "Credenciais inválidas"})
        if grant == "refresh_token" and body["refresh_token"] in refresh:
            return send(200, session(refresh[body["refresh_token"]]))
    if parsed.path == "/auth/v1/user":
        if user:
            return send(200, user)
        return send(403, {"code": 403, "error_code": "session_not_found", "msg": "Sessão encerrada"})
    if parsed.path == "/auth/v1/logout":
        if user:
            logouts.append((user["email"], args.get("scope", [""])[0]))
            access.pop(bearer, None)
        return route.fulfill(status=204, headers=headers)
    return send(200, [])


import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

parser = argparse.ArgumentParser()
parser.add_argument('candidate', type=Path)
parser.add_argument('flag_off', type=Path)
args = parser.parse_args()

class Spa(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/seed.txt':
            self.send_response(200)
            self.send_header('Content-type','text/plain')
            self.end_headers()
            return
        if not Path(self.translate_path(self.path)).is_file():
            self.path = '/index.html'
        try:
            super().do_GET()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass  # A navegação pode cancelar o download de um recurso da tela anterior.
    def log_message(self, *args):
        pass

def serve(directory):
    if not (directory/'sw.js').exists(): raise ValueError('PWA build required')
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Spa, directory=str(directory)))
    Thread(target=server.serve_forever, daemon=True).start()
    return 'http://127.0.0.1:' + str(server.server_port)

base = serve(args.candidate)
legacy = serve(args.flag_off)
link = {}
writes = []
providers = []
def service(route):
    req = route.request
    url = urlparse(req.url)
    query = parse_qs(url.query)
    headers = {'access-control-allow-origin':'*','access-control-allow-methods':'*','access-control-allow-headers':'*'}
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=headers)
    if url.path.endswith('/recover'):
        link.update(challenge=req.post_data_json['code_challenge'], url=query['redirect_to'][0])
        return route.fulfill(json={}, headers=headers)
    if url.path.endswith('/authorize'):
        providers.append(query['provider'][0])
        link.update(challenge=query['code_challenge'][0], url=query['redirect_to'][0])
        return route.fulfill(status=302, headers={'location':link['url']+'&code=browser-code'})
    if query.get('grant_type') == ['pkce']:
        data=req.post_data_json
        assert data['auth_code']=='browser-code'
        assert base64.urlsafe_b64encode(hashlib.sha256(data['code_verifier'].encode()).digest()).decode().rstrip('=')==link['challenge']
        return route.fulfill(json=session(accounts['B']), headers=headers)
    if url.path.endswith('/user') and req.method=='PUT':
        user = access[req.headers['authorization'].removeprefix('Bearer ')]
        if 'password' in req.post_data_json: writes.append(user['id'])
        return route.fulfill(json=user,headers=headers)
    return backend(route)

with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True,args=['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])
    ctx=browser.new_context(service_workers='allow')
    ctx.route('**/*',lambda route: route.continue_() if route.request.url.startswith((base+'/',legacy+'/')) else service(route) if route.request.url.startswith('https://example.supabase.co/') else route.abort())
    page=ctx.new_page()
    page.set_default_timeout(25000)
    def seed():
        page.goto(base+'/seed.txt')
        a = session(accounts['A'])
        page.evaluate("""([a,id,email]) => {
          localStorage.setItem('finelo.sessionAccounts.v1',JSON.stringify({version:1,accounts:[{userId:id,email,addedAt:1,lastUsedAt:1,signedOut:false}]}))
          localStorage.setItem('sb-example-auth-token.account.'+id,JSON.stringify(a))
          sessionStorage.setItem('finelo.sessionAccounts.active.v1',id)
          sessionStorage.setItem('finelo.deviceAccounts.openAdd.v1','1')
        }""",[a,accounts['A']['id'],accounts['A']['email']])
        page.goto(base+'/app')
    def add_panel():
        return page.get_by_role('dialog',name='Adicionar outra conta')
    seed()
    dialog=add_panel()
    dialog.get_by_text('Esqueceu sua senha?').click()
    dialog.locator('input[type=email]').fill(accounts['B']['email'])
    dialog.get_by_role('button',name='Enviar Link de Recuperação').click()
    expect(dialog.get_by_text(re.compile('Se o e-mail estiver correto'))).to_be_visible()
    callback_url = link['url']+'&code=browser-code'
    with page.expect_popup() as popup:
        page.evaluate('(url) => { window.open(url); }', callback_url)
    other=popup.value
    expect(other.get_by_text(re.compile('Tentativa inválida'))).to_be_visible()
    page.reload()
    page.evaluate("localStorage.setItem('finelo_app_pin', '1234')")
    page.goto(callback_url)
    expect(page.get_by_text('FinElo Bloqueado')).to_be_visible()
    for digit in '1234':
        page.get_by_role('button',name=digit,exact=True).click()
    page.evaluate("localStorage.removeItem('finelo_app_pin')")
    expect(page.get_by_label('Nova senha')).to_be_visible()
    assert urlparse(page.url).query==''
    page.get_by_label('Nova senha').fill('synthetic-browser-password')
    page.get_by_role('button',name='Salvar nova senha').click()
    expect(page.get_by_text('Senha atualizada.')).to_be_visible()
    assert writes==[accounts['B']['id']]
    assert page.evaluate("sessionStorage.getItem('finelo.sessionAccounts.active.v1')")==accounts['A']['id']
    page.goto(base+'/update-password')
    expect(page.get_by_text(re.compile('Tentativa inválida'))).to_be_visible()
    print('Recovery: A active, one PUT B, zero PUT A; original tab reload, other tab rejected, clean URL, direct route denied.',flush=True)
    for provider in ['Google','GitHub']:
        page.evaluate("sessionStorage.setItem('finelo.deviceAccounts.openAdd.v1','1')")
        page.goto(base+'/app')
        add_panel().get_by_role('button',name=re.compile(provider,re.I)).click()
        expect(page.get_by_text('Conta disponível neste dispositivo.',exact=True)).to_be_visible()
        assert page.evaluate("sessionStorage.getItem('finelo.sessionAccounts.active.v1')")==accounts['A']['id']
    assert providers==['google','github']
    assert len(page.evaluate("JSON.parse(localStorage.getItem('finelo.sessionAccounts.v1')).accounts")) == 2
    print('Google + GitHub: real form, popup, PKCE, callback in original tab. A active, B remembered once.',flush=True)
    page.goto(base+'/app')
    page.evaluate("async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready }")
    page.reload()
    page.wait_for_function('!!navigator.serviceWorker.controller')
    assert page.evaluate("sessionStorage.getItem('finelo.sessionAccounts.active.v1')")==accounts['A']['id']
    menu_button=page.get_by_role('button',name='Menu da conta').first
    menu_button.click()
    with page.expect_navigation(wait_until='domcontentloaded'):
        page.get_by_role('button',name='Alternar para '+accounts['B']['email'],exact=True).first.click()
    page.wait_for_function("(id)=>sessionStorage.getItem('finelo.sessionAccounts.active.v1')===id",arg=accounts['B']['id'])
    page.wait_for_load_state('domcontentloaded')
    assert page.evaluate("performance.getEntriesByType('navigation')[0].type") == 'reload'
    print('PWA controlled by service worker, reload retains A, explicit switch reloads B.',flush=True)
    page.goto(legacy+'/login')
    expect(page.get_by_text('Acessar Conta',exact=True)).to_be_visible()
    page.locator('input[type=email]').fill(accounts['A']['email'])
    page.locator('input[type=password]').fill('fixture-password')
    page.locator('button[type=submit]').click()
    page.wait_for_url('**/app')
    page.get_by_role('button',name='Menu da conta').first.click()
    expect(page.get_by_role('button',name='Sair da Conta').first).to_be_visible()
    assert page.get_by_text('Adicionar outra conta',exact=True).count()==0
    assert not page.evaluate("localStorage.getItem('finelo.sessionAccounts.v1')")
    page.get_by_role('button',name='Sair da Conta',exact=True).first.click()
    page.get_by_role('button',name='Sair',exact=True).click()
    page.wait_for_function("!localStorage.getItem('sb-example-auth-token')")
    assert logouts and logouts[-1][0] == accounts['A']['email']
    print('Flag off: legacy password login and confirmed logout; registry absent.',flush=True)
    browser.close()
