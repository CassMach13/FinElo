"""Use original store and mounted route lifetime with two synthetic accounts only."""
import runpy,json
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('remaining-validate-themes.py')),run_name='remaining_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
A='10000000-0000-4000-8000-000000000001';B='10000000-0000-4000-8000-000000000002';report=[]
def foreign(row):return row['actor']==B and any(x in row['text']+' '.join(row['fields'])for x in ['Rascunho_PRIVADO_A','Reserva_A_QA','Imóvel_A_QA','Conta_A_QA','Cartão_A_QA','Chamado_A_QA','Pessoa_A_QA','Contato_A_QA'])
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True)
 for w,h in [(1440,1000),(390,844)]:
  for theme in ['dark','light']:
   for view in ['goals','settings','help']:
    for mode in ['direct','logout-login','same-id']:
     p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-06T12:00:00Z');load(p,theme,view)
     if view=='goals':action(p,'+ Novo objetivo').click();field=p.locator('#goal-name')
     elif view=='settings':p.locator('#settings-manage-accounts').get_by_role('button',name='Adicionar Novo').click();field=p.get_by_label('Nome da Conta',exact=True)
     else:
      x=action(p,'Novo Chamado',False)
      if x.count():x.click()
      field=p.locator('input,textarea').filter(visible=True).first
     field.fill('Rascunho_PRIVADO_A');settle(p)
     n=p.evaluate('window.__remainingPreview.trace().length')
     if mode=='same-id':p.evaluate("window.__remainingPreview.authEvent('TOKEN_REFRESHED')");p.evaluate("window.__remainingPreview.authEvent('USER_UPDATED')");settle(p);assert field.input_value()=='Rascunho_PRIVADO_A'
     else:
      if mode=='logout-login':p.evaluate('window.__remainingPreview.auth(null)');settle(p)
      p.evaluate('(id)=>window.__remainingPreview.auth(id)',B);settle(p)
      rows=p.evaluate('window.__remainingPreview.trace()')[n:];assert rows and not any(foreign(r)for r in rows),(theme,view,mode,rows)
      assert 'Rascunho_PRIVADO_A'not in p.locator('body').inner_text();assert not any('Rascunho_PRIVADO_A'in v for v in p.locator('input,textarea').filter(visible=True).evaluate_all('(es)=>es.map(e=>e.value)'))
     p.screenshot(path=str(OUT/f'session-{view}-{mode}-{w}-{theme}.png'));report.append({'view':view,'mode':mode,'width':w,'theme':theme,'pass':True});p.close()
   # A late query is released only after B is mounted; every React commit is inspected.
   p=b.new_page(viewport={'width':w,'height':h});load(p,theme,'goals');action(p,'+ Novo objetivo').click();p.locator('#goal-name').fill('Rascunho_PRIVADO_A');p.locator('#goal-target').fill('1234,56');p.evaluate("window.__remainingPreview.hold('write:financial_goals')");action(p,'Salvar').click();settle(p);n=p.evaluate('window.__remainingPreview.trace().length');p.evaluate('(id)=>window.__remainingPreview.auth(id)',B);p.evaluate("window.__remainingPreview.release('write:financial_goals')");settle(p);assert not any(foreign(r)for r in p.evaluate('window.__remainingPreview.trace()')[n:]);report.append({'view':'goals','mode':'pending-create','width':w,'theme':theme,'pass':True});p.close()
 b.close()
(OUT/'session-validation.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps({'sessionCases':len(report),'pass':all(r['pass']for r in report)}))
