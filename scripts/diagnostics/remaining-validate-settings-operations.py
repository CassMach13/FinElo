"""Original Settings handlers and financial payloads with a closed synthetic backend."""
import runpy,json
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('remaining-validate-themes.py')),run_name='remaining_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True)
 for v in VARIANTS:
  p=b.new_page(viewport={'width':1440,'height':1000},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-06T12:00:00Z');p.on('dialog',lambda d:d.accept());load(p,v,'settings')
  # Create/edit/category changes retain the actual field parsing and store actions.
  root=p.locator('#settings-categories');root.get_by_role('button',name='Adicionar Novo').click();p.locator('#category-name').fill('Categoria sintética nova');p.locator('#category-type').select_option('Despesa');action(p,'Salvar').click();settle(p);action(p,'Entendi').click()if action(p,'Entendi').count()else None;settle(p);cap(p,v,1440,'ops-category-created','#settings-categories')
  row=root.locator('tr').filter(has_text='Categoria sintética nova');row.get_by_role('button',name='Editar').click();p.locator('#category-name').fill('Categoria sintética editada');action(p,'Salvar').click();settle(p);action(p,'Entendi').click()if action(p,'Entendi').count()else None;settle(p);cap(p,v,1440,'ops-category-edited','#settings-categories')
  root=p.locator('#settings-manage-accounts');root.get_by_role('button',name='Adicionar Novo').click();p.locator('[name=Nome_Conta]').fill('Conta sintética nova');p.locator('[name=saldoAtual]').fill('321.09');action(p,'Salvar').click();settle(p);action(p,'Entendi').click()if action(p,'Entendi').count()else None;settle(p);cap(p,v,1440,'ops-account-created','#settings-manage-accounts')
  root=p.locator('#settings-rules');root.get_by_role('button',name='Adicionar Novo').click();p.locator('[name=Texto_Contido_Descricao]').fill('MERCADO TESTE')if p.locator('[name=Texto_Contido_Descricao]').count()else p.locator('#mapping-rule-form input').first.fill('MERCADO TESTE');p.locator('#mapping-rule-form input').nth(1).fill('Regra sintética');p.locator('#rule-category').select_option('Categoria_A_QA');action(p,'Salvar').click();settle(p);action(p,'Entendi').click()if action(p,'Entendi').count()else None;settle(p);cap(p,v,1440,'ops-rule-created','#settings-rules')
  snapshot=p.evaluate('window.__remainingPreview.snapshot()');assert not any(e.get('table')in['transactions','economic_events']for e in snapshot['events']);p.close()
 b.close()
r=compare('4c1-operations');assert not r['issues'],r['issues'][:10]
