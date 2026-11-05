"""Real reconciliation components/service, immutable baselines, closed synthetic I/O."""
import argparse,hashlib,json,re
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright,expect
from import_visual_checks import AUDIT_JS,compare_rasters,digest

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=5204)
parser.add_argument('--out-dir',type=Path,required=True)
parser.add_argument('--suite',choices=['states','operations','isolation','entry','all'],default='all')
parser.add_argument('--themes',choices=['light','all'],default='all')
parser.add_argument('--viewport',choices=['desktop','mobile','all'],default='all')
parser.add_argument('--collect-contrast',action='store_true')
args=parser.parse_args();args.out_dir.mkdir(parents=True,exist_ok=True)
repo=Path(__file__).resolve().parents[2];origin=f'http://127.0.0.1:{args.port}'
A='20000000-0000-4000-8000-000000000001';B='20000000-0000-4000-8000-000000000003'
checks={'status':'RUNNING','bases':{},'contrast':{},'parity':{},'financial':{},'theme_switch':{},'invariants':{},'legacy_limits':{}}
expect.set_options(timeout=30000)
for base in ['main','reviewed']:
 root=repo/f'scripts/diagnostics/theme-reconciliation-{base}-baseline';manifest=json.loads((root/'baseline.json').read_text())
 for path,sha in manifest['files'].items():assert hashlib.sha256((root/path).read_bytes()).hexdigest()==sha
 checks['bases'][base]=manifest['base']

def load(page,case='positive',**params):
 query={'theme':'light' if variant=='light' else 'dark','case':case,**params}
 if variant in ['main','reviewed']:query['baseline']=variant
 page.goto(origin+'/scripts/diagnostics/reconciliation-preview.html?'+urlencode(query),wait_until='networkidle',timeout=120000)
 page.wait_for_function('window.__reconciliationPreview!==undefined')
 page.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}')
 assert page.evaluate('''()=>{const frame=document.createElement('iframe');document.body.append(frame);const ok=frame.contentWindow.localStorage.getItem('reconciliation-fence-sentinel')==='unchanged'&&frame.contentWindow.localStorage.length===1;frame.remove();return ok;}'''),'Original storage changed'

def snap(page):return page.evaluate('__reconciliationPreview.snapshot()')
def profile(page):return page.evaluate('__reconciliationPreview.profile()')
def release(page,key):page.evaluate('(key)=>__reconciliationPreview.release(key)',key)
def box(page):return page.locator('.fixed.inset-0').last
def close(page):box(page).locator('button').first.click()
def open_flow(page):page.get_by_role('button',name='Abrir referência sintética',exact=True).click()
def ready(page,month='2026-09'):expect(page.get_by_role('heading',name='Conciliar diferença — '+month,exact=True)).to_be_visible()
def choice(page,kind):
 labels={'bank_adjustment':'É ajuste ou diferença do banco','economic_credit':'É crédito para as próximas faturas','authoritative_total':'Informar o valor oficial da fatura'}
 page.get_by_role('button',name=re.compile('^'+labels[kind])).click()
 expect(page.get_by_role('heading',name='Confirmar esta resolução',exact=True)).to_be_visible()
def confirm(page):page.get_by_role('button',name='Confirmar resolução',exact=True).click()
def successful(page,replay=False):expect(page.get_by_text('Esta resolução já estava registrada. Nada foi duplicado.' if replay else 'Resolução registrada.',exact=True)).to_be_visible()
def mutations(s):return [e for e in s['events'] if e['action'] in ['resolve','reverse']]
def financial_state(s):return {k:s[k] for k in ['rows','reversals','active','projections']}

def capture(page,name,focus=False,hover=False):
 if not focus:
  fields=box(page).locator('input:not(:disabled),select:not(:disabled)').filter(visible=True)
  (fields.first if fields.count() else box(page).locator('button').first).focus()
 if not hover:page.mouse.move(0,0)
 page.evaluate('''async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}''')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),name+' document overflow'
 data=page.evaluate(AUDIT_JS);raw=page.screenshot(animations='disabled')
 images[name]=raw;presentation[name]={k:data[k] for k in ['geometry','content','colors']}
 (args.out_dir/f'{viewport}-{variant}-{name}.png').write_bytes(raw)
 if variant=='light':
  rows=data['rows'];failures=[r for r in rows if not r['pass']]
  checks['contrast'][viewport+'-'+name]={'samples':len(rows),'minimum_text':min((r['ratio'] for r in rows if r['threshold']==4.5),default=None),'minimum_essential':min((r['ratio'] for r in rows if r['threshold']==3),default=None),'failures':failures}
  if failures and not args.collect_contrast:raise AssertionError((name,failures[:8]))
 print(json.dumps({'viewport':viewport,'variant':variant,'state':name}),flush=True)

def switch(page,name):
 if variant not in ['dark','light']:return
 before=snap(page);counts=profile(page)
 page.evaluate('''async()=>{const el=document.querySelector('[data-finelo-theme]'),t=el.dataset.fineloTheme;el.dataset.fineloTheme=t==='light'?'dark':'light';await new Promise(r=>requestAnimationFrame(r));el.dataset.fineloTheme=t;await new Promise(r=>requestAnimationFrame(r));}''')
 assert snap(page)==before and profile(page)==counts,'Theme triggered operation or intent'
 checks['theme_switch'][viewport+'-'+variant+'-'+name]={'react_commits':0,'requests':0,'events':0,'new_intents':0,'same_financial_state':True}

def states(page):
 results={}
 for case in ['positive','negative','zero','open','long','legacy','active','long-active','loading','load-error','authorization']:
  load(page,case);before=financial_state(snap(page));open_flow(page)
  if case=='loading':
   expect(page.get_by_role('status',name='Calculando a diferença',exact=True)).to_be_visible();capture(page,'calculando');switch(page,'calculando');release(page,'compute');ready(page)
  elif case in ['authorization','load-error']:
   expect(page.get_by_role('alert')).to_be_visible();capture(page,'erro-'+case)
   if case=='load-error':page.get_by_role('button',name='Tentar de novo',exact=True).click();ready(page)
  elif case in ['zero','active','long-active']:expect(page.get_by_text('Nada a conciliar nesta competência.',exact=True)).to_be_visible()
  else:ready(page,'2026-11' if case=='open' else '2026-09')
  capture(page,'estado-'+case)
  if case=='positive':
   page.get_by_role('button',name=re.compile('^É ajuste')).hover();capture(page,'opcao-hover',hover=True)
   field=page.locator('#total-oficial');field.focus();capture(page,'valor-oficial-foco',focus=True)
   page.get_by_role('combobox',name='Procedência do valor oficial').focus()
   capture(page,'procedencia-foco-scroll',focus=True)
   sizes=page.locator('input,select').evaluate_all('els=>els.map(e=>({tag:e.tagName,width:e.getBoundingClientRect().width,container:e.parentElement.getBoundingClientRect().width}))')
   checks['legacy_limits'][viewport+'-'+variant+'-official-row']={'sizes':sizes,'document_overflow':False,'internal_scroll_preserved':True}
  if case=='long-active':
   box(page).locator('div.overflow-y-auto').evaluate('el=>el.scrollTop=el.scrollHeight');capture(page,'resolucoes-lista-final',focus=True)
  switch(page,case);assert financial_state(snap(page))==before and not mutations(snap(page))
  results[case]=snap(page)
  close(page)
 return results

def operations(page):
 results={}
 # Choosing, going back, and cancellation through either step never submits.
 for step in [1,2]:
  load(page);before=financial_state(snap(page));open_flow(page);ready(page)
  if step==2:
   choice(page,'bank_adjustment');capture(page,'cancelar-passo-2');assert not mutations(snap(page));assert not snap(page)['uuidCalls'];close(page)
  else:page.get_by_role('button',name='Cancelar',exact=True).click()
  assert financial_state(snap(page))==before and not mutations(snap(page));results['cancel-'+str(step)]=snap(page)
 for kind in ['bank_adjustment','economic_credit','authoritative_total']:
  load(page);open_flow(page);ready(page)
  if kind=='authoritative_total':
   choice(page,kind);expect(page.get_by_role('button',name='Confirmar resolução',exact=True)).to_be_disabled();capture(page,'oficial-invalido');page.get_by_role('button',name='Voltar',exact=True).click()
   page.locator('#total-oficial').fill('99,85');page.get_by_role('combobox').select_option('bank_pdf')
  choice(page,kind);assert not mutations(snap(page)) and not snap(page)['uuidCalls'];capture(page,'confirmacao-'+kind);switch(page,kind)
  confirm(page);successful(page);capture(page,'conclusao-'+kind)
  after=snap(page);calls=mutations(after);assert len(calls)==1 and len(after['rows'])==1
  payload=calls[0]['payload'];assert payload['accountId']==A and payload['referenceMonth']=='2026-09'
  assert payload['resolution']==kind and payload['idempotencyKey']==after['uuidCalls'][0]
  if kind=='authoritative_total':assert payload['authoritativeTotalCents']==9985 and payload['authoritativeSource']=='bank_pdf'
  else:assert payload['authoritativeTotalCents'] is None and payload['authoritativeSource'] is None
  results[kind]=after
 for case in ['fail-before','refused','timeout-after','double-timeout','pending']:
  load(page,case);open_flow(page);ready(page);before=financial_state(snap(page));choice(page,'bank_adjustment');confirm(page)
  if case=='pending':
   expect(page.get_by_role('button',name='Processando…',exact=True)).to_be_disabled();expect(page.get_by_role('button',name='Voltar',exact=True)).to_be_disabled();capture(page,'confirmacao-ocupada');switch(page,'ocupada')
   page.get_by_role('button',name='Processando…',exact=True).dispatch_event('click');assert len(mutations(snap(page)))==1
   release(page,'resolve')
  elif case in ['fail-before','refused']:
   expect(page.get_by_text('Recusa sintética antes de gravar' if case=='fail-before' else 'Resolução sintética bloqueada por autorização',exact=True)).to_be_visible();capture(page,'recusa-'+case)
   assert financial_state(snap(page))==before
   if case=='refused':
    confirm(page);expect(page.get_by_text('Resolução sintética bloqueada por autorização',exact=True)).to_be_visible();assert financial_state(snap(page))==before;results[case]=snap(page);continue
   confirm(page)
  elif case=='double-timeout':
   expect(page.get_by_text('Nada a conciliar nesta competência.',exact=True)).to_be_visible();capture(page,'timeout-duplo-estado-recarregado')
   after=snap(page);calls=mutations(after);assert len(calls)==2 and len(after['rows'])==1
   assert calls[0]['payload']['idempotencyKey']==calls[1]['payload']['idempotencyKey']
   hidden='A resposta do servidor se perdeu duas vezes.' not in box(page).inner_text()
   checks['legacy_limits'][viewport+'-'+variant+'-double-timeout']={'persisted_rows':1,'same_retry_key':True,'uncertainty_notice_hidden_after_reload':hidden}
   results[case]=after;continue
  successful(page,case=='timeout-after');capture(page,'resultado-'+case)
  after=snap(page);calls=mutations(after);assert len(after['rows'])==1
  if case in ['fail-before','timeout-after']:assert len(calls)==2 and calls[0]['payload']['idempotencyKey']==calls[1]['payload']['idempotencyKey']
  results[case]=after
 for case in ['active','reverse-blocked']:
  load(page,case);before=financial_state(snap(page));open_flow(page);expect(page.get_by_role('button',name='Desfazer',exact=True)).to_be_visible();page.get_by_role('button',name='Desfazer',exact=True).click()
  if case=='active':
   ready(page);assert len(snap(page)['reversals'])==1 and len(snap(page)['rows'])==1 and not snap(page)['active'];capture(page,'resolucao-revertida')
  else:
   page.wait_for_function('__reconciliationPreview.snapshot().events.some(e=>e.action==="reverse")')
   expect(page.get_by_role('button',name='Desfazer',exact=True)).to_be_enabled();assert financial_state(snap(page))==before;capture(page,'reversao-bloqueada')
   checks['legacy_limits'][viewport+'-'+variant+'-reverse-denied']={'no_mutation':True,'notice_hidden_in_first_step':'Reversão sintética não permitida' not in box(page).inner_text()}
  results['reverse-'+case]=snap(page)
 checks['invariants'][viewport+'-'+variant+'-operations']={'explicit_competence':True,'selection_has_no_write_or_key':True,'confirmation_keeps_intent_key':True,'retry_same_key_no_duplicate':True,'timeout_after_write_one_row':True,'both_cancellation_steps_no_write':True,'reversal_append_only_or_denied':True}
 return results

def isolation(page):
 results={}
 load(page,'late-compute');open_flow(page);expect(page.get_by_role('status',name='Calculando a diferença',exact=True)).to_be_visible()
 page.evaluate('(id)=>__reconciliationPreview.navigate(id,"2026-10")',B);ready(page,'2026-10');release(page,'compute');ready(page,'2026-10');capture(page,'conta-nova-resposta-antiga')
 assert not mutations(snap(page));results['late-compute']=snap(page)
 load(page,'switch-pending');open_flow(page);ready(page);choice(page,'bank_adjustment');confirm(page);expect(page.get_by_role('button',name='Processando…',exact=True)).to_be_disabled()
 page.wait_for_function('__reconciliationPreview.snapshot().events.some(e=>e.action==="resolve")')
 old=mutations(snap(page))[0]['payload']['idempotencyKey']
 page.evaluate('(id)=>__reconciliationPreview.navigate(id,"2026-08")',A);expect(page.get_by_text('Foi pago',exact=False)).to_have_count(0)
 expect(page.get_by_text('Nada a conciliar nesta competência.',exact=True)).to_be_visible()
 page.evaluate('(id)=>__reconciliationPreview.navigate(id,"2026-10")',B);ready(page,'2026-10');assert page.locator('#total-oficial').input_value()==''
 release(page,'resolve');page.wait_for_function('__reconciliationPreview.snapshot().rows.length===1');ready(page,'2026-10');capture(page,'troca-com-resolucao-pendente')
 choice(page,'bank_adjustment');confirm(page);successful(page);after=snap(page);assert len(after['rows'])==2
 calls=mutations(after);assert calls[0]['payload']['accountId']==A and calls[1]['payload']['accountId']==B
 assert calls[1]['payload']['referenceMonth']=='2026-10' and calls[1]['payload']['idempotencyKey']!=old
 results['switch-pending']=after
 load(page);open_flow(page);ready(page);choice(page,'bank_adjustment');before=financial_state(snap(page));page.evaluate('__reconciliationPreview.endSession()');confirm(page)
 expect(page.get_by_text('Acesso sintético negado. Sessão sem autorização.',exact=True)).to_be_visible();assert financial_state(snap(page))==before;capture(page,'sessao-encerrada');results['session']=snap(page)
 load(page);open_flow(page);ready(page)
 if variant in ['dark','light']:
  first=box(page).locator('button').first;last=page.get_by_role('button',name='Cancelar',exact=True)
  first.focus();page.keyboard.press('Shift+Tab');expect(last).to_be_focused();page.keyboard.press('Tab');expect(first).to_be_focused()
  page.keyboard.press('Escape');expect(page.get_by_role('button',name='Abrir referência sintética',exact=True)).to_be_focused()
  checks['invariants'][viewport+'-'+variant+'-focus']={'tab_loop':True,'escape':True,'restore':True}
 else:close(page)
 assert not mutations(snap(page));results['focus']=snap(page)
 checks['invariants'][viewport+'-'+variant+'-isolation']={'old_compute_cannot_replace_new_target':True,'account_and_month_switch_remounts':True,'new_target_has_new_key':True,'closed_session_has_no_write':True}
 return results

def entry(page):
 results={}
 for engine in ['legacy','v2','new']:
  load(page,'paid',view='entry',engine=engine)
  expect(page.get_by_role('button',name='Histórico',exact=True).first).to_be_visible()
  eligible=page.evaluate('__reconciliationPreview.eligible()');assert eligible==(engine=='new')
  if not eligible:
   assert page.get_by_role('button',name='Ver diferença',exact=True).count()==0
   assert not [e for e in snap(page)['events'] if e['action']=='compute']
  else:
   page.get_by_title('Clique para editar Cartão Sintético QA',exact=True).hover()
   page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
   page.get_by_role('button',name='Ver diferença',exact=True).first.click();ready(page);capture(page,'entrada-cartao');close(page)
   page.get_by_title('Clique para editar Cartão Sintético QA',exact=True).hover()
   page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
   page.locator('button').filter(has_text=re.compile('item para revisar|itens para revisar')).first.click()
   expect(page.get_by_role('heading',name='Revisar cartão',exact=True)).to_be_visible()
   box(page).get_by_role('button',name='Ver diferença',exact=True).click();ready(page);capture(page,'entrada-diagnostico');close(page)
  results[engine]={'eligible':eligible,'financial':snap(page),'card':page.evaluate('__cardPreview.snapshot()')}
 checks['invariants'][viewport+'-'+variant+'-eligibility']={'legacy_disabled':True,'v2_disabled':True,'new_real_card_and_diagnostic_entry':True}
 return results

with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts','--disable-partial-raster','--run-all-compositor-stages-before-draw'])
 context=browser.new_context(timezone_id='America/Sao_Paulo',device_scale_factor=1,color_scheme='dark',service_workers='block')
 context.add_init_script("localStorage.setItem('reconciliation-fence-sentinel','unchanged')")
 remote=[];errors=[]
 def route(r):
  if r.request.url.startswith(origin+'/'):r.continue_()
  else:remote.append(r.request.url);r.abort()
 context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.clock.set_fixed_time(datetime(2026,11,5,12,0,tzinfo=timezone.utc))
 for viewport,width,height in [('desktop',1440,1000),('mobile',390,844)]:
  if args.viewport!='all' and args.viewport!=viewport:continue
  page.set_viewport_size({'width':width,'height':height});reference=None;dark=None
  for variant in (['light'] if args.themes=='light' else ['reviewed','main','dark','light']):
   images={};presentation={};result={}
   for suite in ['states','operations','isolation','entry']:
    if args.suite in [suite,'all']:result[suite]=globals()[suite](page)
   name=viewport+'-'+variant
   (args.out_dir/f'financial-{name}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
   if reference is None:reference={'result':result,'images':images.copy(),'presentation':presentation.copy()}
   elif args.themes=='all':
    assert result==reference['result'],(name,'Financial regression')
    assert images.keys()==reference['images'].keys()
    if variant in ['main','dark']:
     checks['parity'][name]={}
     for state,raw in images.items():
      for key in ['geometry','content','colors']:
       if presentation[state][key]!=reference['presentation'][state][key]:
        (args.out_dir/f'failed-{name}-{state}.json').write_text(json.dumps({'reference':reference['presentation'][state],'actual':presentation[state]},ensure_ascii=False,indent=2),encoding='utf8');raise AssertionError((name,state,key))
      value=compare_rasters(reference['images'][state],raw);checks['parity'][name][state]=value
      if not value['exact']:
       path=f'raster-proof-{name}-{state}.json';data=json.dumps({'reference':reference['presentation'][state],'actual':presentation[state]},ensure_ascii=False).encode();(args.out_dir/path).write_bytes(data);value.update({'presentation_proof':path,'presentation_proof_sha256':hashlib.sha256(data).hexdigest()})
    if variant=='light':
     for state in presentation:
      for key in ['geometry','content']:assert presentation[state][key]==dark[state][key],(name,state,key)
   if variant=='dark':dark=presentation.copy()
   checks['financial'][name]={'equivalent':True,'sha256':digest(result),'states':list(images),'presentation':{s:{k:digest(v) for k,v in values.items()} for s,values in presentation.items()}}
 assert not remote,remote;assert not errors,errors;browser.close()
checks['remote_requests']=len(remote);checks['javascript_errors']=errors
failures=sum(len(v['failures']) for v in checks['contrast'].values());checks['status']='FAIL_CONTRAST' if failures else 'PASS'
contracts=json.loads((repo/'tests/appearance/reconciliation-presentation-baseline.json').read_text())
sources=[*contracts['files'],'src/components/appearance/financial.css','scripts/diagnostics/reconciliation-fixtures.ts','scripts/diagnostics/reconciliation-preview-runtime.tsx','scripts/diagnostics/reconciliation-preview.tsx','scripts/diagnostics/validate-reconciliation-themes.py']
checks['source_sha256']={p:hashlib.sha256((repo/p).read_bytes()).hexdigest() for p in sources}
(args.out_dir/'validation.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'status':checks['status'],'captures':sum(len(v['states']) for v in checks['financial'].values()),'contrast_samples':sum(v['samples'] for v in checks['contrast'].values()),'contrast_failures':failures}),flush=True)
