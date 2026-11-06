"""Exercise original handlers/parser/services against the closed synthetic transport."""
import runpy
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('investment-validate-themes.py')),run_name='investment_tools')
globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
BOOKS=Path('node_modules/.finelo-cycle4b-tools/workbooks')

def edit_fields(p):
 fields=p.locator('.fixed.inset-0 input');fields.nth(0).fill('Instituição manual QA');fields.nth(1).fill('Renda Fixa');fields.nth(2).fill('Posição manual QA');fields.nth(3).fill('1234.56');fields.nth(4).fill('1000.01');fields.nth(5).fill('2026-10-15');fields.nth(6).fill('2027-01-20')

def operations(p,v,e,w):
 load(p,v,e);click(p,'Adicionar');edit_fields(p);click(p,'Salvar');expect(p.locator('.fixed.inset-0')).to_have_count(0);capture(p,v,e,w,'op-manual-saved')
 assert any(x['body'][0]['balance']==1234.56 for x in snap(p)['events']if x['table']=='investments'and x['method']=='POST')
 row_action(p,'Editar');p.locator('.fixed.inset-0 input[type=number]').first.fill('2345.67');click(p,'Salvar');expect(p.locator('.fixed.inset-0')).to_have_count(0);capture(p,v,e,w,'op-manual-edited')
 # Write failure must retain inputs and allow cancellation, never fabricate success.
 load(p,v,e,writeError='true');click(p,'Adicionar');edit_fields(p);click(p,'Salvar');expect(p.locator('.fixed.inset-0 [class*="bg-red-"]')).to_be_visible();capture(p,v,e,w,'op-manual-write-error');assert all(x['denied']for x in snap(p)['events']);click(p,'Cancelar')
 # The real XP parser consumes every synthetic workbook (including corrupt bytes).
 for kind in ['invalid','empty','corrupt','valid']:
  load(p,v,e);click(p,'Importar Planilha');p.locator('input[type=file]').set_input_files(str(BOOKS/(kind+'.xlsx')))
  if kind=='valid':
   expect(p.get_by_text('Pronto para importar!',exact=True)).to_be_visible();capture(p,v,e,w,'op-import-preview');click(p,'Confirmar Importação');expect(p.locator('.fixed.inset-0')).to_have_count(0);p.wait_for_function('__investmentPreview.snapshot().db.investments.some(x=>x.source_file==="valid.xlsx")');capture(p,v,e,w,'op-import-saved')
   added=[r for r in snap(p)['db']['investments']if r.get('source_file')=='valid.xlsx'];assert sum(round(r['balance']*100)for r in added)==1713597;assert all(r['user_id']==A and r['reference_month']=='2026-11-01'for r in added)
   click(p,'Importar Planilha');p.locator('input[type=file]').set_input_files(str(BOOKS/'valid.xlsx'));expect(p.get_by_text('Pronto para importar!',exact=True)).to_be_visible();click(p,'Confirmar Importação');expect(p.get_by_text(re.compile('já foi importado'))).to_be_visible();capture(p,v,e,w,'op-import-duplicate');assert len([x for x in snap(p)['events']if x['table']=='investments'and x['method']=='POST'])==1
  else:
   expect(p.locator('.fixed.inset-0 [class*="bg-red-"]')).to_be_visible();capture(p,v,e,w,'op-import-'+kind);assert not snap(p)['events']
 load(p,v,e,writeError='true');click(p,'Importar Planilha');p.locator('input[type=file]').set_input_files(str(BOOKS/'valid.xlsx'));expect(p.get_by_text('Pronto para importar!',exact=True)).to_be_visible();click(p,'Confirmar Importação');expect(p.locator('.fixed.inset-0 [class*="bg-red-"]')).to_be_visible();capture(p,v,e,w,'op-import-write-error');assert all(x['denied']for x in snap(p)['events'])
 if e=='v2':
  load(p,v,e);click(p,'Nova carteira');p.locator('#portfolio-name').fill('Nova carteira QA');click(p,'Criar carteira');expect(p.locator('#portfolio-name')).to_have_count(0);capture(p,v,e,w,'op-portfolio-created')
  p.get_by_role('button',name='Gerenciar carteira Nova carteira QA',exact=True).click();click(p,'Renomear');p.locator('#portfolio-name').fill('Carteira renomeada QA');click(p,'Salvar nome');expect(p.locator('#portfolio-name')).to_have_count(0);capture(p,v,e,w,'op-portfolio-renamed')
  click(p,'Novo ativo');p.get_by_label('Nome do ativo',exact=True).fill('Ativo novo QA');p.get_by_label('Instituição (opcional)',exact=True).fill('Banco QA');click(p,'Salvar');expect(p.get_by_label('Nome do ativo',exact=True)).to_have_count(0);capture(p,v,e,w,'op-holding-created');click(p,'Arquivar');capture(p,v,e,w,'op-archive-confirm');click(p,'Cancelar');capture(p,v,e,w,'op-archive-cancel')
  p.locator('.fixed.inset-0').last.get_by_role('button',name='Fechar',exact=True).click()
  p.locator('button[data-classification-badge]').filter(visible=True).first.click();p.locator('#classify-portfolio').select_option(label='Longo prazo QA');p.locator('.fixed.inset-0 button[type=submit]').click();expect(p.locator('#classify-portfolio')).to_have_count(0);capture(p,v,e,w,'op-classified')

with sync_playwright()as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 for v in ([args.variant]if args.variant else VARIANTS):
  for w,h in [(1440,1000),(390,844)]:
   p=browser.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-05T12:00:00Z');p.on('pageerror',lambda err:errors.append(str(err)))
   p.route('**/*',lambda r:r.continue_()if r.request.url.startswith('http://127.0.0.1:5206/')else(r.abort(),blocked.append(r.request.url)))
   for e in ['legacy','v2']:operations(p,v,e,w)
   p.close()
 browser.close()
(OUT/f'run-operations-{args.variant or "all"}.json').write_text(json.dumps({'records':records,'pageErrors':errors,'blockedNetwork':blocked},ensure_ascii=False,indent=2),encoding='utf8')
assert not errors,errors
assert not blocked,blocked
print(json.dumps({'captures':len(records),'pageErrors':errors,'blockedNetwork':blocked}),flush=True)
