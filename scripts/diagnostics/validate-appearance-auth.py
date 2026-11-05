"""Authenticated staging-only check. Credentials are read from a private, untracked file."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--credentials', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
qa = json.loads(args.credentials.read_text())
assert qa['email'] == 'qa-e864-pr96-20261104@example.com'
origin = 'http://127.0.0.1:5198'
stage = 'https://sxmmrnwbxntccscojmfh.supabase.co/'
checks = {}

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge', headless=True)
    ctx = browser.new_context(service_workers='block')
    ctx.route('**/*', lambda r: r.continue_() if r.request.url.startswith((origin + '/', stage)) else r.abort())
    page = ctx.new_page()
    financial_reads = []
    page.on('request', lambda req: financial_reads.append(1) if '/rest/v1/transactions' in req.url else None)
    page.set_default_timeout(60000)
    page.goto(origin + '/login', wait_until='networkidle', timeout=120000)
    page.get_by_label('Email', exact=True).fill(qa['email'])
    page.get_by_label('Senha', exact=True).fill(qa['password'])
    page.get_by_role('button', name='Entrar', exact=True).click()
    page.wait_for_url('**/app**', timeout=120000)
    page.goto(origin + '/app?view=settings', wait_until='networkidle')
    expect(page.get_by_role('radio', name='Claro', exact=True)).to_be_visible()
    financial_before = len(financial_reads)
    # Abort ONLY the optional SDK refresh to reproduce the stale cached user after a successful PUT.
    block_refresh = lambda r: r.abort()
    page.route('**/auth/v1/token?grant_type=refresh_token', block_refresh)
    page.get_by_role('radio', name='Claro', exact=True).click()
    expect(page.get_by_role('radio', name='Claro', exact=True)).to_be_checked()
    checks['confirmed_with_stale_sdk'] = page.evaluate('''async () => {
      const source=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/supabaseClient.ts').name;
      const {supabase} = await import(source);
      const {data:{session}} = await supabase.auth.getSession();
      const stale = session.user.user_metadata.appearance_theme;
      window.__finEloDebug.getAppState().setUser(session.user);
      return {sdk_stale: stale !== 'light', confirmed: window.__finEloDebug.getAppState().user.user_metadata.appearance_theme === 'light'};
    }''')
    assert all(checks['confirmed_with_stale_sdk'].values())
    page.unroute('**/auth/v1/token?grant_type=refresh_token', block_refresh)
    page.evaluate('''async () => {
      const source=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/supabaseClient.ts').name;
      const {supabase} = await import(source);
      const {error} = await supabase.auth.refreshSession(); if(error) throw Error('refresh failed');
    }''')
    expect(page.get_by_role('radio', name='Claro', exact=True)).to_be_checked()
    checks['token_refreshed'] = page.evaluate('''async () => {
      const source=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/supabaseClient.ts').name;
      const {supabase} = await import(source);
      return (await supabase.auth.getSession()).data.session.user.user_metadata.appearance_theme === 'light';
    }''')
    assert checks['token_refreshed']
    page.evaluate('''async () => {
      const source=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/supabaseClient.ts').name;
      const {supabase} = await import(source);
      const {error} = await supabase.auth.updateUser({data:{appearance_validation_marker:'qa-theme-cycle2'}});
      if(error) throw Error('user update failed');
    }''')
    expect(page.get_by_role('radio', name='Claro', exact=True)).to_be_checked()
    checks['user_updated'] = True
    checks['appearance_financial_reads'] = len(financial_reads) - financial_before
    assert checks['appearance_financial_reads'] == 0
    second = ctx.new_page()
    second.set_default_timeout(60000)
    second.goto(origin + '/app?view=settings', wait_until='networkidle')
    expect(second.get_by_role('radio', name='Claro', exact=True)).to_be_checked()
    second.get_by_role('radio', name='Automático', exact=True).click()
    expect(second.get_by_role('radio', name='Automático', exact=True)).to_be_checked()
    expect(page.get_by_role('radio', name='Automático', exact=True)).to_be_checked()
    checks['two_tabs'] = True
    # Overlap two tabs deterministically: the held first write reaches Auth last.
    held = []
    def hold_put(route):
        if route.request.method == 'PUT': held.append(route)
        else: route.continue_()
    page.route('**/auth/v1/user', hold_put)
    page.evaluate('''async () => {
      window.__qaThemeSave = window.__finEloDebug.getAppState().updateUserPreferences({appearance_theme:'light'}).then(()=>true);
      return true;
    }''')
    page.wait_for_timeout(200)
    assert len(held) == 1
    second.evaluate('''async () => {
      await window.__finEloDebug.getAppState().updateUserPreferences({appearance_theme:'dark'});
    }''')
    held[0].continue_()
    page.evaluate('async () => { await window.__qaThemeSave; delete window.__qaThemeSave; }')
    page.unroute('**/auth/v1/user', hold_put)
    expect(page.get_by_role('radio',name='Claro',exact=True)).to_be_checked()
    expect(second.get_by_role('radio',name='Claro',exact=True)).to_be_checked()
    checks['concurrent_two_tabs_last_server_write'] = True
    # Same-tab double submit rejects the second operation rather than racing two writes.
    checks['concurrent_saves'] = page.evaluate('''async () => {
      const a=window.__finEloDebug.getAppState().updateUserPreferences({appearance_theme:'light'});
      const b=window.__finEloDebug.getAppState().updateUserPreferences({appearance_theme:'dark'});
      const result=await Promise.allSettled([a,b]);
      return result[0].status === 'fulfilled' && result[1].status === 'rejected';
    }''')
    assert checks['concurrent_saves']
    expect(second.get_by_role('radio', name='Claro', exact=True)).to_be_checked()
    ctx.set_offline(True)
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    expect(page.get_by_role('radio', name='Claro', exact=True)).to_be_checked()
    ctx.set_offline(False)
    page.evaluate("window.dispatchEvent(new Event('online'))")
    expect(page.get_by_role('radio', name='Claro', exact=True)).to_be_checked()
    checks['offline_reconnect'] = True
    page.reload(wait_until='networkidle')
    expect(page.get_by_role('radio', name='Claro', exact=True)).to_be_checked()
    checks['reload_signed_in'] = True
    second.close()
    page.evaluate('''async () => {
      const {useAppStore} = await import('/src/hooks/useAppStore.ts'); await window.__finEloDebug.getAppState().signOut();
    }''')
    page.goto(origin + '/login', wait_until='networkidle')
    page.get_by_label('Email', exact=True).fill(qa['email'])
    page.get_by_label('Senha', exact=True).fill(qa['password'])
    page.get_by_role('button', name='Entrar', exact=True).click()
    page.wait_for_url('**/app**')
    page.goto(origin + '/app?view=settings', wait_until='networkidle')
    expect(page.get_by_role('radio', name='Claro', exact=True)).to_be_checked()
    checks['logout_login'] = True
    page.evaluate('''async () => {
      const {useAppStore} = await import('/src/hooks/useAppStore.ts'); await window.__finEloDebug.getAppState().signOut();
    }''')
    browser.close()

args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(checks, indent=2))
print(json.dumps(checks, indent=2))
