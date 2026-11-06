"""Installed SDK + actual App, native storage/locks/BroadcastChannel, synthetic HTTP.
Does not certify remote Auth, server token revocation, real accounts or physical devices.
"""
import json,argparse
from pathlib import Path
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend,A,B,ADMIN
from integrated_validate_helpers import launch,boot,navigate,settle,OUT

def ready(p,actor=A):p.wait_for_function('window.__integratedQa!==undefined');p.wait_for_function('(id)=>window.__integratedQa.snapshot().actor===id&&window.__integratedQa.snapshot().initialDataLoadStatus===\'ready\'',arg=actor);settle(p)
def theme(p,value):p.evaluate('(t)=>window.__integratedQa.theme(t)',value);p.wait_for_function('(t)=>window.__integratedQa.snapshot().user.user_metadata.appearance_theme===t',arg=value);settle(p)
def current(p):return p.locator('[data-qa-eligible]').get_attribute('data-finelo-theme')
def fin_calls(backend):return[c for c in backend.calls if c['path'].startswith('/rest/v1/')and'/rpc/'not in c['path']]
def unchanged(backend,before):assert before==backend.db and not any(w['kind']=='data'and w['table']!='product_events'for w in backend.writes)
def privacy(p,n):
 rows=p.evaluate('window.__integratedQa.trace()')[n:];assert any(r['actor']==B for r in rows)
 assert not any(r['actor']==B and('_A_QA'in r['text']or'RASCUNHO_PRIVADO_A'in' '.join(r['fields']))for r in rows)
def end_terms(p):
 region=p.get_by_role('region',name='Texto dos Termos e Condições');region.focus();p.keyboard.press('Control+End');region.evaluate("e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll',{bubbles:true}))}")

def cases(p,context,backend,name):
 original=json.loads(json.dumps(backend.db));metrics={}
 if name=='choices-reload-system':
  assert current(p)=='dark';navigate(p,'settings');pilot=p.get_by_role('region',name='Piloto de aparência')
  for label,value in[('Claro','light'),('Escuro','dark'),('Automático','system')]:
   pilot.get_by_label(label,exact=True).click();p.wait_for_function('(v)=>window.__integratedQa.snapshot().user.user_metadata.appearance_theme===v',arg=value);settle(p)
  p.emulate_media(color_scheme='light');p.wait_for_function("document.querySelector('[data-qa-eligible]').dataset.fineloTheme==='light'");p.emulate_media(color_scheme='dark');p.wait_for_function("document.querySelector('[data-qa-eligible]').dataset.fineloTheme==='dark'");theme(p,'light');p.reload(wait_until='networkidle');ready(p);assert current(p)=='light'
 elif name=='two-tabs-rapid-save':
  other=context.new_page();other.clock.set_fixed_time('2026-11-06T12:00:00Z');boot(other,login='none');count=len(fin_calls(backend));theme(p,'light');other.wait_for_function("document.querySelector('[data-qa-eligible]').dataset.fineloTheme==='light'");metrics['readsAfterAppearance']=[c['path']for c in fin_calls(backend)[count:]]
  backend.held.add('appearance:'+A);p.evaluate("()=>{window.__qaRapid=null;void Promise.allSettled([window.__integratedQa.theme('dark'),window.__integratedQa.theme('light')]).then(r=>window.__qaRapid=r.map(x=>x.status))}");p.wait_for_timeout(200);assert len(backend.waiting)==1,{'pendingWrites':len(backend.waiting)};backend.release('appearance:'+A);p.wait_for_function('window.__qaRapid!==null');assert sorted(p.evaluate('window.__qaRapid'))==['fulfilled','rejected'];theme(p,'light');other.wait_for_function("document.querySelector('[data-qa-eligible]').dataset.fineloTheme==='light'")
 elif name=='profile-refresh-offline-reconnect':
  theme(p,'light');backend.stale=True;p.evaluate("async()=>{await Promise.all([window.__integratedQa.metadata({full_name:'Perfil_A_QA atualizado'}),window.__integratedQa.refresh()])}");settle(p);assert current(p)=='light';backend.stale=False
  backend.offline=True;context.set_offline(True);p.evaluate("async()=>{window.__qaOffline=await window.__integratedQa.theme('dark').then(()=>false,()=>true)}");assert p.evaluate('window.__qaOffline')and current(p)=='light';backend.offline=False;context.set_offline(False);p.wait_for_timeout(800);assert current(p)=='light';p.evaluate('window.__integratedQa.refresh()');assert p.evaluate('window.__integratedQa.sdkName()')=='Perfil_A_QA atualizado'
 elif name=='switch-form-late-read-logout':
  theme(p,'light');navigate(p,'goals');p.get_by_role('button',name='+ Novo objetivo',exact=True).click();p.get_by_label('Nome',exact=True).fill('RASCUNHO_PRIVADO_A');n=len(p.evaluate('window.__integratedQa.trace()'));p.evaluate("window.__integratedQa.login('b')");ready(p,B);privacy(p,n);assert current(p)=='dark'and p.locator('#goal-name').count()==0;assert p.evaluate('window.__integratedQa.sdkActor()')==B
  p.evaluate('window.__integratedQa.logout()');p.wait_for_function('window.__integratedQa.snapshot().actor===null');assert current(p)=='dark';p.reload(wait_until='networkidle');p.wait_for_function('window.__integratedQa!==undefined');p.wait_for_timeout(400);assert p.evaluate('window.__integratedQa.snapshot().actor')is None;p.evaluate("window.__integratedQa.login('a')");ready(p);assert current(p)=='light'
 elif name=='pending-profile-after-login-b':
  theme(p,'light');backend.held.add('profile:'+A);p.evaluate("()=>{void window.__integratedQa.metadata({full_name:'Perfil_PRIVADO_A'})}");p.wait_for_timeout(200);assert backend.waiting;n=len(p.evaluate('window.__integratedQa.trace()'));p.evaluate("window.__integratedQa.login('b')");ready(p,B);backend.release('profile:'+A);settle(p);privacy(p,n);assert p.evaluate('window.__integratedQa.sdkActor()')==B and current(p)=='dark'
 elif name=='pending-terms-after-login-b':
  # Force consent through the real App by SDK refresh; no version or payload change.
  backend.users[A]['user_metadata'].pop('terms_accepted_version',None);backend.users[B]['user_metadata'].pop('terms_accepted_version',None);p.evaluate('window.__integratedQa.refresh()');p.get_by_role('region',name='Texto dos Termos e Condições').wait_for();end_terms(p);backend.held.add('profile:'+A);p.get_by_role('button',name='Li e Concordo com os Termos',exact=True).click();p.wait_for_timeout(200);assert backend.waiting;n=len(p.evaluate('window.__integratedQa.trace()'));p.evaluate("window.__integratedQa.login('b')");ready(p,B);backend.release('profile:'+A);settle(p);privacy(p,n);assert p.evaluate('window.__integratedQa.sdkActor()')==B;assert p.get_by_role('button',name='Li e Concordo com os Termos').is_disabled();assert not backend.users[B]['user_metadata'].get('terms_accepted_version')
 elif name=='modal-focus-restoration':
  navigate(p,'goals');trigger=p.get_by_role('button',name='+ Novo objetivo',exact=True);trigger.focus();p.keyboard.press('Enter');p.get_by_label('Nome',exact=True).wait_for();p.keyboard.press('Escape');p.locator('#goal-form').wait_for(state='detached');settle(p);assert trigger.evaluate('e=>e===document.activeElement'),{'active':p.evaluate('document.activeElement?.outerHTML')}
 elif name=='late-goals-read-theme-switch-and-b':
  theme(p,'light');backend.held.add('read:financial_goals');p.evaluate("window.__integratedQa.navigate('goals')");p.wait_for_timeout(200);assert backend.waiting;theme(p,'dark');n=len(p.evaluate('window.__integratedQa.trace()'));p.evaluate("window.__integratedQa.login('b')");ready(p,B);backend.release('read:financial_goals');p.wait_for_function('window.__integratedQa.snapshot().goals.length>0');privacy(p,n);assert all(g['user_id']==B for g in p.evaluate('window.__integratedQa.snapshot().goals'))
 elif name=='admin-metrics-pending-replaced-by-b':
  p.evaluate("window.__integratedQa.login('admin')");ready(p,ADMIN);p.evaluate("window.__integratedQa.navigate('admin')");p.get_by_role('heading',name='Gestão da Plataforma (Admin)',exact=True).wait_for();backend.held.add('rpc:get_admin_metrics');p.get_by_role('button',name='Métricas',exact=True).click();p.wait_for_timeout(200);assert backend.waiting;n=len(p.evaluate('window.__integratedQa.trace()'));p.evaluate("window.__integratedQa.login('b')");ready(p,B);backend.release('rpc:get_admin_metrics');settle(p);privacy(p,n);assert p.evaluate('window.__integratedQa.snapshot().adminMetrics')is None;assert 'Gestão da Plataforma'not in p.locator('body').inner_text()
 unchanged(backend,original)
 return metrics

def run(selected=None,output='auth-validation.json'):
 results=[]
 with sync_playwright()as pw:
  for engine in['edge','chrome','firefox','webkit']:
   try:b=launch(pw,engine)
   except Exception as e:results.append({'engine':engine,'status':'BLOCKED','reason':str(e)});continue
   for name in(selected or['choices-reload-system','two-tabs-rapid-save','profile-refresh-offline-reconnect','switch-form-late-read-logout','pending-profile-after-login-b','pending-terms-after-login-b','modal-focus-restoration']):
    backend=Backend();context=b.new_context(viewport={'width':390 if engine in['chrome','webkit']else 1440,'height':844 if engine in['chrome','webkit']else 1000},timezone_id='America/Sao_Paulo',color_scheme='dark');context.route('**/*',backend.route);p=context.new_page();p.clock.set_fixed_time('2026-11-06T12:00:00Z')
    row={'engine':engine,'scenario':name,'status':'PASS','transport':'synthetic HTTP; installed SDK APIs unchanged'}
    try:boot(p);row.update(cases(p,context,backend,name))
    except Exception as e:
     row.update(status='FAIL',reason=str(e))
     try:row['failureState']={'snapshot':p.evaluate('window.__integratedQa?.snapshot()'),'url':p.url,'active':p.evaluate('document.activeElement?.tagName')}
     except Exception:pass
    try:p.screenshot(path=str(OUT/f'auth-{engine}-{name}.png'))
    except Exception:pass
    row['requests']=backend.calls;row['writes']=backend.writes;results.append(row);print(json.dumps({k:v for k,v in row.items()if k not in['requests','writes']},ensure_ascii=True),flush=True);context.close()
   b.close()
 (OUT/output).write_text(json.dumps({'cases':results},ensure_ascii=False,indent=2),encoding='utf8');return results
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--cases');parser.add_argument('--output',default='auth-validation.json');args=parser.parse_args();run(args.cases.split(',')if args.cases else None,args.output)
