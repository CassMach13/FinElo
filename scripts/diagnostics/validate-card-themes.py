"""Four-way visual/financial checks of real card UI with synthetic in-memory I/O."""
import argparse,hashlib,json,re
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright,expect
from import_visual_checks import AUDIT_JS,digest,compare_rasters

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=5203)
parser.add_argument('--out-dir',type=Path,required=True)
parser.add_argument('--suite',choices=['core','payments','manual','cycles','controls','supplement','all'],default='all')
parser.add_argument('--themes',choices=['light','all'],default='all')
parser.add_argument('--engines',default='legacy,v2,new')
parser.add_argument('--viewport',choices=['desktop','mobile','all'],default='all')
parser.add_argument('--collect-contrast',action='store_true')
args=parser.parse_args();args.out_dir.mkdir(parents=True,exist_ok=True)
repo=Path(__file__).resolve().parents[2]
origin=f'http://127.0.0.1:{args.port}'
expect.set_options(timeout=30000)
checks={'status':'RUNNING','bases':{},'contrast':{},'parity':{},'financial':{},'theme_switch':{},'accessibility':{}}
for baseline in ['main','reviewed']:
 root=repo/f'scripts/diagnostics/theme-card-{baseline}-baseline'
 manifest=json.loads((root/'baseline.json').read_text())
 for path,sha in manifest['files'].items():assert hashlib.sha256((root/path).read_bytes()).hexdigest()==sha
 checks['bases'][baseline]=manifest['base']
images={};presentations={}

def load(page,**query):
 params={'theme':'light' if variant=='light' else 'dark','engine':engine,**query}
 if variant in ['main','reviewed']:params['baseline']=variant
 page.goto(origin+'/scripts/diagnostics/card-preview.html?'+urlencode(params),wait_until='networkidle',timeout=120000)
 page.wait_for_function('window.__cardPreview!==undefined')
 page.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}')
 assert page.evaluate('''()=>{const f=document.createElement('iframe');document.body.append(f);const ok=f.contentWindow.localStorage.getItem('card-fence-sentinel')==='unchanged'&&f.contentWindow.localStorage.length===1;f.remove();return ok;}'''),'Real storage changed'

def snapshot(page):return page.evaluate('__cardPreview.snapshot()')
def ledger(page):return snapshot(page)['rows']
def release(page,key):page.evaluate('(key)=>__cardPreview.release(key)',key)
def overlay(page):return page.locator('.fixed.inset-0').filter(has=page.locator('button')).last
def button(page,name):return overlay(page).get_by_role('button',name=name,exact=True).last
def close(page):overlay(page).locator('button').first.click()

def capture(page,name,keep_focus=False,hover=False,audit=True):
 if not keep_focus:
  if page.locator('.fixed.inset-0').filter(has=page.locator('button')).count():
   fields=overlay(page).locator('input:not(:disabled):not([type=file]),select:not(:disabled),textarea:not(:disabled)').filter(visible=True)
   (fields.first if fields.count() else overlay(page).locator('button').first).focus()
  else:page.evaluate('document.activeElement?.blur()')
 if not hover:page.mouse.move(0,0)
 page.evaluate('''async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}''')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(engine,viewport,name,'Document overflow')
 data=page.evaluate(AUDIT_JS)
 png=page.screenshot(animations='disabled')
 images[name]=png;presentations[name]={key:data[key] for key in ['geometry','content','colors']}
 (args.out_dir/f'{viewport}-{engine}-{variant}-{name}.png').write_bytes(png)
 if variant=='light' and audit:
  bars=page.evaluate('''()=>{
   const rgba=s=>(s.match(/[\\d.]+/g)||[]).map(Number);
   const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
   const bg=el=>el?blend(rgba(getComputedStyle(el).backgroundColor),bg(el.parentElement)):[255,255,255];
   const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   return [...document.querySelectorAll('[data-finance~="card-chart-bar"]')].filter(el=>el.getClientRects().length).map(el=>{const a=lum(bg(el)),b=lum(bg(el.parentElement)),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);return{kind:'chart-bar',text:el.closest('[role="tab"]').getAttribute('aria-label'),ratio:+ratio.toFixed(3),threshold:3,pass:ratio>=3};});
  }''')
  samples=data['rows']+bars;failures=[row for row in samples if not row['pass']]
  checks['contrast'][viewport+'-'+engine+'-'+name]={'samples':len(samples),'minimum_text':min((r['ratio'] for r in samples if r['threshold']==4.5),default=None),'minimum_essential':min((r['ratio'] for r in samples if r['threshold']==3),default=None),'failures':failures}
  if failures and not args.collect_contrast:raise AssertionError((name,failures[:10]))
 print(json.dumps({'viewport':viewport,'engine':engine,'variant':variant,'state':name}),flush=True)

def open_history(page):
 page.get_by_role('button',name='Histórico',exact=True).first.click()
 expect(page.get_by_role('heading',name='Histórico de faturas — Cartão Sintético QA',exact=True)).to_be_visible()

def open_payment(page):
 page.get_by_role('button',name='Pagar',exact=True).first.click()
 expect(page.get_by_role('heading',name='Pagar fatura do cartão',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Registrar pagamento',exact=True)).to_be_enabled()

def core(page):
 results={}
 scenarios=['open','closed','paid','partial','second-payment','late','weekend','refund-before','refund-after','installments','legacy-competence','empty','multi-card','insufficient','already-paid','cancel','load-error','authorization-error','loading']
 for scenario in scenarios:
  load(page,case=scenario)
  capture(page,'cartoes-'+scenario)
  before=ledger(page)
  open_history(page)
  if scenario in ['load-error','authorization-error']:
   expect(page.get_by_text(re.compile('Não foi possível carregar o histórico|Falha sintética|Acesso sintético'))).to_be_visible()
  elif scenario=='loading':
   expect(page.get_by_text('Carregando faturas…',exact=True)).to_be_visible()
   capture(page,'historico-carregando');release(page,'confirmations')
   expect(page.get_by_text('Carregando faturas…',exact=True)).to_have_count(0)
  elif scenario=='empty':expect(page.get_by_text(re.compile('Nenhuma fatura encontrada'))).to_be_visible()
  else:expect(page.get_by_role('tab').first).to_be_visible()
  capture(page,'historico-'+scenario)
  assert ledger(page)==before,'Read-only history changed ledger'
  if scenario=='weekend':
   cards=snapshot(page)['history'][0]['cards']
   assert any(c['dueDate'].endswith('11-21') or c['dueDate'].endswith('11-23') for c in cards),'Weekend fixture lost due metadata'
  results[scenario]=snapshot(page)
  close(page)
  if variant in ['dark','light']:
   # CSS switching must not render React or call any data/financial operation.
   profile=page.evaluate('__cardPreview.profile()');before=snapshot(page)
   page.evaluate('''async()=>{const root=document.querySelector('[data-finelo-theme]'),theme=root.dataset.fineloTheme;root.dataset.fineloTheme=theme==='light'?'dark':'light';await new Promise(resolve=>requestAnimationFrame(resolve));root.dataset.fineloTheme=theme;await new Promise(resolve=>requestAnimationFrame(resolve));}''')
   assert page.evaluate('__cardPreview.profile()')==profile,'Theme switch triggered React/data work'
   assert snapshot(page)==before,'Theme switch changed financial state'
   checks['theme_switch'][viewport+'-'+engine+'-'+variant+'-'+scenario]={'react_commits':0,'requests':0,'financial_events':0,'same_financial_state':True}
 return results

def payments(page):
 results={}
 for scenario in ['cancel','second-payment','persist-error','persist-loading']:
  load(page,case=scenario)
  before=ledger(page);open_payment(page)
  capture(page,'pagamento-'+scenario)
  if scenario=='cancel':
   button(page,'Cancelar').click();assert ledger(page)==before;results[scenario]=snapshot(page);continue
  if scenario=='second-payment':
   expect(overlay(page).locator('input[inputmode="decimal"]')).to_have_value('60,00')
   overlay(page).locator('input[inputmode="decimal"]').fill('20,00');capture(page,'pagamento-parcial-previa')
   overlay(page).locator('input[inputmode="decimal"]').fill('60,00')
  button(page,'Registrar pagamento').click()
  if scenario=='persist-loading':
   expect(page.get_by_role('button',name='Registrando…',exact=True)).to_be_disabled()
   capture(page,'pagamento-carregando');assert ledger(page)==before
   release(page,'persist')
  if scenario=='persist-error':
   expect(page.get_by_text('Não foi possível registrar o pagamento. Nada foi lançado. Tente novamente.',exact=True)).to_be_visible()
   capture(page,'pagamento-erro');assert ledger(page)==before
   button(page,'Entendi').click()
   capture(page,'pagamento-erro-preserva-formulario')
   button(page,'Registrar pagamento').click()
  expect(page.get_by_text('Pagamento registrado com sucesso.',exact=True)).to_be_visible()
  capture(page,'pagamento-sucesso-'+scenario)
  button(page,'Entendi').click()
  expect(page.get_by_role('heading',name='Pagar fatura do cartão',exact=True)).to_have_count(0)
  after=snapshot(page)
  assert len(after['rows'])==len(before)+2
  added=[e for e in after['events'] if e['action']=='add'][-1]['payload']
  assert len(added)==2 and round(added[0]['Valor']*100)==-round(added[1]['Valor']*100)
  if scenario=='second-payment':
   assert round(added[0]['Valor']*100)==6000
   assert any(c['referenceMonth']=='2026-09' and round(c['openBalance']*100)==0 for c in after['history'][0]['cards'])
  results[scenario]=after
 load(page,case='already-paid');before=ledger(page);open_history(page)
 page.get_by_role('button',name=re.compile('Saldo em aberto .*toque')).click()
 page.get_by_role('button',name='Sim, está pago',exact=True).click()
 capture(page,'ja-paga-confirmacao')
 button(page,'Cancelar').click();assert ledger(page)==before
 page.get_by_role('button',name='Sim, está pago',exact=True).click()
 dialog=overlay(page)
 # Final label comes from the existing paidInvoiceConfirmationCopy contract.
 dialog.get_by_role('button',name=re.compile('Confirmar',re.I)).last.click()
 expect(page.get_by_text(re.compile('Você confirmou que'))).to_be_visible()
 capture(page,'ja-paga-resultado')
 assert ledger(page)==before,'User confirmation must not invent a transaction'
 results['already_paid']=snapshot(page)
 page.get_by_role('button',name='Desfazer',exact=True).click();capture(page,'desfazer-paga-confirmacao')
 button(page,'Cancelar').click();assert ledger(page)==before
 page.get_by_role('button',name='Desfazer',exact=True).click();button(page,'Desfazer').click()
 expect(page.get_by_role('button',name='Sim, está pago',exact=True)).to_be_visible()
 capture(page,'desfazer-paga-resultado');assert ledger(page)==before
 results['undo_confirmation']=snapshot(page)
 return results

def manual(page):
 results={}
 for kind in ['purchase','refund','invoice_payment']:
  load(page,case='closed');before=ledger(page)
  page.get_by_role('button',name='Adicionar Lançamento',exact=True).click()
  page.locator('select[name="ID_Conta"]').select_option('20000000-0000-4000-8000-000000000001')
  capture(page,'manual-cartao-sem-tipo')
  page.locator('input[name="Nome_Fantasia"]').fill('Estorno QA teclado' if kind=='refund' else 'Pagamento de Fatura QA' if kind=='invoice_payment' else 'Compra QA teclado')
  page.locator('select[name="cardEntryKind"]').select_option(kind)
  if kind=='refund':page.wait_for_function('document.querySelector(\'select[name="refundReferenceMonth"]\')?.options.length>=2')
  if kind=='invoice_payment':expect(page.get_by_role('button',name='Registrar pagamento',exact=True)).to_be_enabled()
  capture(page,'manual-'+kind)
  if kind=='invoice_payment':
   # The product redirects immediately when its dedicated payment callback exists.
   if page.get_by_role('button',name='Ir para Pagar fatura',exact=True).count():page.get_by_role('button',name='Ir para Pagar fatura',exact=True).click()
   expect(page.get_by_role('heading',name='Pagar fatura do cartão',exact=True)).to_be_visible()
   capture(page,'manual-para-pagamento');button(page,'Cancelar').click()
  else:
   page.locator('input[name="Nome_Fantasia"]').fill('Compra QA teclado' if kind=='purchase' else 'Estorno QA teclado')
   page.locator('input[name="Valor"]').fill('123.45')
   page.locator('select[name="Categoria"]').select_option('Compras' if kind=='purchase' else 'Estorno')
   if kind=='purchase':
    page.locator('#isRecurrent').check();overlay(page).locator('input[type="number"]').last.fill('3')
    capture(page,'manual-parcelas')
   capture(page,'manual-preenchido-'+kind)
   button(page,'Cancelar').click()
  assert ledger(page)==before
  results[kind]=snapshot(page)
 for kind in ['purchase','refund']:
  load(page,case='closed');before=ledger(page)
  page.get_by_role('button',name='Adicionar Lançamento',exact=True).click()
  page.locator('select[name="ID_Conta"]').select_option('20000000-0000-4000-8000-000000000001')
  page.locator('input[name="Nome_Fantasia"]').fill('Compra manual QA' if kind=='purchase' else 'Estorno manual QA')
  page.locator('select[name="Tipo"]').select_option('Despesa' if kind=='purchase' else 'Renda')
  page.locator('select[name="cardEntryKind"]').select_option(kind)
  page.locator('input[name="Valor"]').fill('123.45')
  page.locator('select[name="Categoria"]').select_option('Compras' if kind=='purchase' else 'Estorno')
  if kind=='purchase':
   page.locator('input[name="Data"]').fill('2026-10-04')
   page.locator('input[name="Data_Pagamento"]').fill('2026-11-20')
   page.locator('#isRecurrent').check();overlay(page).locator('input[type="number"]').last.fill('3')
  else:
   page.wait_for_function('document.querySelector(\'select[name="refundReferenceMonth"]\')?.options.length>=2')
   page.locator('select[name="refundReferenceMonth"]').select_option('2026-10')
  button(page,'Gerar 3 Lançamentos' if kind=='purchase' else 'Salvar').click()
  expect(page.get_by_role('heading',name='Adicionar Lançamento',exact=True)).to_have_count(0)
  capture(page,'manual-sucesso-'+kind)
  after=snapshot(page);payload=[e for e in after['events'] if e['action']=='add'][-1]['payload']
  if isinstance(payload,dict):payload=[payload]
  assert len(payload)==(3 if kind=='purchase' else 1)
  assert sum(round(row['Valor']*100) for row in payload)==(-12345 if kind=='purchase' else 12345)
  assert len(after['rows'])==len(before)+len(payload)
  results['saved_'+kind]=after
 return results

def cycles(page):
 results={}
 for scenario in ['empty','legacy-competence','installments']:
  load(page,case=scenario,view='cycles',all='true')
  before=ledger(page)
  expect(page.get_by_role('heading',name=re.compile('Faturas pelo histórico'))).to_be_visible()
  capture(page,'ciclos-'+scenario)
  if scenario!='empty':
   field=page.locator('input[placeholder="MM/AAAA"]').first
   field.fill('99/0000');capture(page,'ciclos-validacao-'+scenario)
   # The real validator is exercised, but no valid competence update is submitted.
   page.get_by_role('button',name='Salvar competências',exact=True).click()
   expect(page.get_by_role('button',name='Entendi',exact=True)).to_be_visible()
   capture(page,'ciclos-erro-'+scenario);button(page,'Entendi').click()
  close(page);assert ledger(page)==before
  results[scenario]=snapshot(page)
 if engine=='new':
  load(page,case='installments',view='cycles')
  before=ledger(page)
  page.get_by_role('button',name='Auditar sem alterar dados',exact=True).click()
  expect(page.get_by_role('button',name='Entendi',exact=True)).to_be_visible(timeout=60000)
  capture(page,'auditoria-resumo');button(page,'Entendi').click()
  sections=overlay(page).locator('p.font-semibold').filter(has_text=re.compile(r'^\s*Sprint'))
  for section in range(sections.count()):
   page.evaluate('document.activeElement?.blur()')
   sections.nth(section).scroll_into_view_if_needed()
   capture(page,'auditoria-sprint-'+str(section+1),keep_focus=True)
  details=page.locator('details')
  for index in range(details.count()):
   item=details.nth(index);item.evaluate('el=>el.open=true');item.locator('summary').scroll_into_view_if_needed()
   capture(page,'auditoria-painel-'+str(index+1),keep_focus=True)
   sections=item.locator('p.font-semibold').filter(has_text=re.compile('^Sprint'))
   for section in range(sections.count()):
    sections.nth(section).scroll_into_view_if_needed()
    capture(page,'auditoria-secao-'+str(section+1),keep_focus=True)
  if not details.count():capture(page,'auditoria-paineis')
  assert ledger(page)==before
  results['read_only_audit']=snapshot(page)
 return results

def controls(page):
 results={}
 load(page,case='installments');before=ledger(page);open_history(page)
 page.get_by_role('tab').last.click();capture(page,'grafico-selecao')
 page.get_by_role('tab').first.hover();capture(page,'grafico-hover',hover=True)
 if variant in ['dark','light']:
  tabs=page.get_by_role('tab');tabs.first.focus();page.keyboard.press('End')
  expect(tabs.last).to_have_attribute('aria-selected','true')
  page.keyboard.press('Home');expect(tabs.first).to_have_attribute('aria-selected','true')
 else:
  tabs=page.get_by_role('tab');tabs.first.click();tabs.first.focus()
 tabs.first.focus();page.keyboard.press('Tab');page.keyboard.press('Shift+Tab')
 capture(page,'grafico-foco',keep_focus=True)
 page.get_by_role('button',name=re.compile('Auditoria da fatura')).click()
 capture(page,'lancamentos-auditoria')
 page.get_by_role('button',name='Voltar ao histórico',exact=True).click()
 page.get_by_role('button',name=re.compile('Pagamentos, saldo e fontes')).click()
 capture(page,'composicao-fontes')
 page.get_by_role('button',name='Voltar ao histórico',exact=True).click();close(page)
 assert ledger(page)==before;results['history_drilldown']=snapshot(page)
 load(page,case='closed');before=ledger(page)
 trigger=page.get_by_role('button',name='✓ Cartão consistente',exact=True)
 trigger.first.click();capture(page,'diagnostico')
 if variant in ['dark','light']:
  dialog=page.get_by_role('dialog',name='Revisar cartão',exact=True)
  first=dialog.get_by_role('button').first;last=dialog.get_by_role('button').last
  first.focus();page.keyboard.press('Shift+Tab');expect(last).to_be_focused()
  page.keyboard.press('Tab');expect(first).to_be_focused()
  page.keyboard.press('Escape');expect(trigger.first).to_be_focused()
  checks['accessibility'][viewport+'-'+engine+'-'+variant]={'chart_arrows_home_end':True,'diagnostics_focus_loop_escape_restore':True}
 else:close(page)
 assert ledger(page)==before;results['diagnostics']=snapshot(page)
 load(page,case='closed');before=ledger(page);open_payment(page)
 date=overlay(page).locator('input[type="date"]');date.focus();page.keyboard.press('Tab');page.keyboard.press('Shift+Tab')
 capture(page,'pagamento-data-foco',keep_focus=True)
 amount=overlay(page).locator('input[inputmode="decimal"]');amount.focus();amount.press('Control+a')
 capture(page,'pagamento-valor-selecao',keep_focus=True)
 amount.fill('inválido');button(page,'Registrar pagamento').click()
 expect(page.get_by_text('Informe o valor pago, por exemplo 2.000,00.',exact=True)).to_be_visible()
 capture(page,'pagamento-valor-invalido');assert ledger(page)==before
 button(page,'Cancelar').click();results['native_fields']=snapshot(page)
 for extra in [{'funding':'none'},{'categories':'none'}]:
  load(page,case='closed',**extra);before=ledger(page)
  page.get_by_role('button',name='Pagar',exact=True).first.click()
  expect(page.get_by_role('heading',name='Pagar fatura do cartão',exact=True)).to_be_visible()
  if 'categories' in extra:
   page.get_by_role('button',name='Registrar pagamento',exact=True).click()
   expect(page.get_by_text('Escolha a categoria do pagamento.',exact=True)).to_be_visible()
  else:expect(page.get_by_role('button',name='Registrar pagamento',exact=True)).to_be_disabled()
  capture(page,'pagamento-sem-'+list(extra)[0]);button(page,'Cancelar').click();assert ledger(page)==before
  results['no_'+list(extra)[0]]=snapshot(page)
 load(page,case='closed');page.evaluate("document.querySelector('[data-finelo-theme]').removeAttribute('data-finelo-theme')")
 capture(page,'flag-desligada',audit=False);results['flag_off']=snapshot(page)
 return results

def supplement(page):
 load(page,case='closed');before=ledger(page)
 result=page.evaluate('''async()=>{
  const baseline=new URLSearchParams(location.search).get('baseline');
  const prefix=baseline==='main'||baseline==='reviewed'?`/scripts/diagnostics/theme-card-${baseline}-baseline/src`:'/src';
  const {projectCardTwoLedger}=await window.__cardNativeModule(location.origin+prefix+'/domain/credit-card/twoLedgerProjection.ts');
  const {diagnoseCreditCard}=await window.__cardNativeModule(location.origin+prefix+'/domain/credit-card/cardDiagnostics.ts');
  const {default:Diagnostic}=await window.__cardNativeModule(location.origin+prefix+'/components/modals/CardDiagnosticsModal.tsx');
  const moduleSource=await (await fetch('/scripts/diagnostics/card-preview-runtime.tsx')).text();
  const resources=[...moduleSource.matchAll(/from "([^"]+)"/g)].map(match=>new URL(match[1],location.origin).href);
  const reactUrl=resources.find(url=>new URL(url).pathname.endsWith('/react.js'));
  const domUrl=resources.find(url=>new URL(url).pathname.endsWith('/react-dom_client.js'));
  if(!reactUrl||!domUrl||new URL(reactUrl).origin!==location.origin||new URL(domUrl).origin!==location.origin)throw Error('React fixture modules unavailable');
  const react=await import(reactUrl),React=react.default??react,dom=await import(domUrl),{createRoot}=dom.default??dom;
  const facts=[['2026-03','2026-04-10',500,0],['2026-05','2026-06-10',1000,1000],['2026-07','2026-08-10',300,0],['2026-08','2026-09-10',0,50]].map(([referenceMonth,dueDate,statementTotal,totalPayments])=>({referenceMonth,dueDate,statementTotal,totalPayments}));
  const projection=projectCardTwoLedger(facts,{asOf:'2026-11-05'});
  const diagnostics=diagnoseCreditCard({competences:projection.competences});
  if(!diagnostics.length)throw Error('Fixture must contain real domain findings');
  document.getElementById('root').style.display='none';
  const host=document.createElement('div');host.dataset.fineloTheme=new URLSearchParams(location.search).get('theme');host.className='bg-theme-canvas text-theme-content min-h-screen p-4 sm:p-6';document.body.append(host);
  function Sample(){const [open,setOpen]=React.useState(true);return open?React.createElement(Diagnostic,{accountName:'Cartão Sintético QA — alertas',diagnosticos:diagnostics,onClose:()=>setOpen(false),onOpenHistory:(reference)=>{window.__cardDiagnosticNavigation=reference??null;setOpen(false);}}):React.createElement('p',{role:'status'},'Referência de diagnóstico encerrada.');}
  createRoot(host).render(React.createElement(Sample));
  return{facts,projection,diagnostics};
 }''')
 expect(page.get_by_role('heading',name='Revisar cartão',exact=True)).to_be_visible()
 capture(page,'diagnostico-atencao')
 overlay(page).locator('div.overflow-y-auto').first.evaluate('el=>el.scrollTop=el.scrollHeight')
 capture(page,'diagnostico-final-lista',keep_focus=True)
 overlay(page).get_by_role('button',name=re.compile('Ver essas faturas|Ver a fatura')).first.click()
 expect(page.get_by_role('status')).to_have_text('Referência de diagnóstico encerrada.')
 assert ledger(page)==before
 result['navigation']=page.evaluate('window.__cardDiagnosticNavigation')
 result['financial']=snapshot(page)
 load(page,case='closed');before=ledger(page)
 page.get_by_title('Clique para editar Cartão Sintético QA',exact=True).click()
 expect(page.get_by_role('heading',name='Editar Conta',exact=True)).to_be_visible()
 capture(page,'configuracao-limite')
 button(page,'Cancelar').click();assert ledger(page)==before
 result['limit_config']=snapshot(page)
 return result

with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts','--disable-partial-raster','--run-all-compositor-stages-before-draw'])
 context=browser.new_context(device_scale_factor=1,timezone_id='America/Sao_Paulo',color_scheme='dark',service_workers='block')
 context.add_init_script("localStorage.setItem('card-fence-sentinel','unchanged')")
 remote=[];page_errors=[]
 def route(r):
  if r.request.url.startswith(origin+'/'):r.continue_()
  else:remote.append(r.request.url);r.abort()
 context.route('**/*',route)
 page=context.new_page();page.set_default_timeout(30000)
 page.on('pageerror',lambda error:page_errors.append(str(error)))
 page.clock.set_fixed_time(datetime(2026,11,5,12,0,tzinfo=timezone.utc))
 for viewport,width,height in [('desktop',1440,1000),('mobile',390,844)]:
  if args.viewport!='all' and args.viewport!=viewport:continue
  page.set_viewport_size({'width':width,'height':height})
  for engine in args.engines.split(','):
   reference=None;dark=None
   for variant in (['light'] if args.themes=='light' else ['reviewed','main','dark','light']):
    images={};presentations={};result={}
    if args.suite in ['core','all']:result['core']=core(page)
    if args.suite in ['payments','all']:result['payments']=payments(page)
    if args.suite in ['manual','all']:result['manual']=manual(page)
    if args.suite in ['cycles','all']:result['cycles']=cycles(page)
    if args.suite in ['controls','all']:result['controls']=controls(page)
    if args.suite in ['supplement','all']:result['supplement']=supplement(page)
    assert result,'Suite not implemented'
    name=viewport+'-'+engine+'-'+variant
    (args.out_dir/f'financial-{name}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    if reference is None:reference={'result':result,'images':images.copy(),'presentation':presentations.copy()}
    elif args.themes=='all':
     assert result==reference['result'],(name,'Financial regression')
     assert images.keys()==reference['images'].keys()
     if variant in ['main','dark']:
      checks['parity'][name]={}
      for state,png in images.items():
       for key in ['geometry','content','colors']:
        if presentations[state][key]!=reference['presentation'][state][key]:
         (args.out_dir/f'failed-parity-{name}-{state}.json').write_text(json.dumps({'reference':reference['presentation'][state],'actual':presentations[state]},ensure_ascii=False,indent=2),encoding='utf8')
         raise AssertionError((name,state,key,'Presentation differs'))
       try:checks['parity'][name][state]=compare_rasters(reference['images'][state],png)
       except AssertionError as error:raise AssertionError((name,state,*error.args)) from error
       if not checks['parity'][name][state]['exact']:
        proof={'reference':reference['presentation'][state],'actual':presentations[state]}
        target=f'raster-proof-{name}-{state}.json';raw=json.dumps(proof,ensure_ascii=False,indent=2).encode()
        (args.out_dir/target).write_bytes(raw);checks['parity'][name][state].update({'presentation_proof':target,'presentation_proof_sha256':hashlib.sha256(raw).hexdigest()})
     if variant=='light':
      for state in presentations:
       for key in ['geometry','content']:assert presentations[state][key]==dark[state][key],(name,state,key,'Light/dark differs')
    if variant=='dark':dark=presentations.copy()
    checks['financial'][name]={'equivalent':True,'sha256':digest(result),'states':list(images),'presentation':{state:{key:digest(value) for key,value in values.items()} for state,values in presentations.items()}}
 assert not remote,remote
 assert not page_errors,page_errors
 browser.close()
checks['remote_requests']=len(remote);checks['javascript_errors']=page_errors
failures=sum(len(v['failures']) for v in checks['contrast'].values())
checks['status']='FAIL_CONTRAST' if failures else 'PASS'
contracts=json.loads((repo/'tests/appearance/card-presentation-baseline.json').read_text())
sources=[*contracts['files'],'src/components/ui/DialogFocusManager.tsx','src/components/appearance/financial.css','scripts/diagnostics/card-fixtures.ts','scripts/diagnostics/card-preview-runtime.tsx','scripts/diagnostics/card-preview.tsx','scripts/diagnostics/validate-card-themes.py']
checks['source_sha256']={path:hashlib.sha256((repo/path).read_bytes()).hexdigest() for path in sources}
(args.out_dir/'validation.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'status':checks['status'],'captures':sum(len(v['states']) for v in checks['financial'].values()),'contrast_samples':sum(v['samples'] for v in checks['contrast'].values()),'contrast_failures':failures}),flush=True)
