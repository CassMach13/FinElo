"""Session lifetime regression, family consolidation and keyboard/hover evidence."""
import runpy
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('investment-validate-themes.py')),run_name='investment_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
checks=[]

def session_cases(p,v,e,w):
 for modal in ['edit','import']+(['classify','manager']if e=='v2'else[]):
  load(p,v,e)
  if modal=='edit':row_action(p,'Editar')
  elif modal=='import':
   click(p,'Importar Planilha');p.locator('input[type=file]').set_input_files('node_modules/.finelo-cycle4b-tools/workbooks/valid.xlsx');expect(p.get_by_text('Pronto para importar!',exact=True)).to_be_visible()
  elif modal=='classify':p.locator('button[data-classification-badge]').filter(visible=True).first.click()
  else:p.get_by_role('button',name='Gerenciar carteira Reserva sintética QA',exact=True).click();click(p,'Novo ativo');p.get_by_label('Nome do ativo',exact=True).fill('Ativo privado A QA')
  p.evaluate('(id)=>__investmentPreview.auth(id)',A);assert p.locator('.fixed.inset-0').count();start=len(p.evaluate('__investmentPreview.trace()'));p.evaluate('(id)=>__investmentPreview.hold("detail:"+id)',C);p.evaluate('(id)=>__investmentPreview.auth(id)',C);p.wait_for_timeout(150)
  if v in ['dark','light']:assert not p.locator('.fixed.inset-0').count(),(v,e,w,modal,'old dialog during loading')
  p.evaluate('(id)=>__investmentPreview.release("detail:"+id)',C);p.wait_for_function('(id)=>__investmentPreview.snapshot().visible.rows.some(r=>r.user_id===id)',arg=C)
  trace=p.evaluate('__investmentPreview.trace()')[start:];bad=[f for f in trace if f['actor']==C and(bool(f['dialogs'])or any(r['user_id']!=C for r in f['rows'])or any('Produto A QA'in x or'Ativo privado A QA'in x for x in f['fields'])or any(x['user_id']!=C for x in f['visibleOwnerLabels'])or any(x.startswith('Produto A QA')for x in f['visibleProductNames']))]
  item={'variant':v,'engine':e,'width':w,'modal':modal,'entry':p.evaluate('__investmentPreview.sessionEntry()'),'renders':len(trace),'foreignRenders':len(bad),'result':'FAIL'if bad else'PASS','expected':'PASS'if v in ['dark','light']else'baseline observation'};checks.append(item)
  (OUT/f'session-{e}-{w}-{modal}-{v}.json').write_text(json.dumps({'check':item,'trace':trace},ensure_ascii=False),encoding='utf8')
  if v in ['dark','light']:assert not bad,item
  assert not snap(p)['events']

def accessibility(p,v,e,w):
 load(p,v,e)
 hint=p.locator('[data-finance~="investment-hint-trigger"]').filter(visible=True).first
 hint.evaluate('(e)=>e.scrollIntoView({block:"start",inline:"nearest"})');p.mouse.move(0,0);p.keyboard.press('Tab');hint.focus();expect(hint).to_have_attribute('aria-describedby',re.compile('.+'));tip=hint.locator('[data-finance~="investment-hint"]');expect(tip).to_have_css('visibility','visible');capture(p,v,e,w,'a11y-hint-focus');p.keyboard.press('Escape');expect(tip).to_have_css('visibility','hidden');assert hint.evaluate('(e)=>e===document.activeElement');p.evaluate('document.activeElement.blur()');hint.hover();tip.hover();expect(tip).to_have_css('visibility','visible');capture(p,v,e,w,'a11y-hint-hover');p.keyboard.press('Escape');expect(tip).to_have_css('visibility','hidden')
 p.mouse.move(0,0);click(p,'Adicionar');dialog=p.locator('[data-finance~="investment-dialog"]');controls=dialog.locator('button:visible,input:visible,select:visible,textarea:visible,[tabindex="0"]:visible');controls.last.focus();p.keyboard.press('Tab');assert controls.first.evaluate('(e)=>e===document.activeElement');p.keyboard.press('Shift+Tab');assert controls.last.evaluate('(e)=>e===document.activeElement');p.locator('input[type=date]').first.focus();capture(p,v,e,w,'a11y-native-date');p.locator('input').first.focus();p.keyboard.press('Escape');expect(dialog).to_have_count(0)
 click(p,'Importar Planilha');trigger=p.get_by_role('button',name='Selecionar arquivo mensal de investimentos',exact=True);trigger.focus();capture(p,v,e,w,'a11y-native-file')
 trigger.focus();assert trigger.evaluate('(e)=>e===document.activeElement')
 with p.expect_file_chooser()as chooser:p.keyboard.press('Enter')
 chooser.value.set_files('node_modules/.finelo-cycle4b-tools/workbooks/valid.xlsx');expect(p.get_by_text('Pronto para importar!',exact=True)).to_be_visible();p.get_by_text('Confirmar Importação',exact=True).hover();capture(p,v,e,w,'a11y-import-hover')
 checks.append({'variant':v,'engine':e,'width':w,'keyboard':'hint focus, Escape, persistent hover, dialog Tab/ShiftTab, native date, file Enter','result':'PASS'})

with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 for v in ([args.variant]if args.variant else VARIANTS):
  for w,h in [(1440,1000),(390,844)]:
   p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-05T12:00:00Z');p.on('pageerror',lambda err:errors.append(str(err)));p.route('**/*',lambda r:r.continue_()if r.request.url.startswith('http://127.0.0.1:5206/')else(r.abort(),blocked.append(r.request.url)))
   for e in ['legacy','v2']:
    session_cases(p,v,e,w)
    if v in ['dark','light']:accessibility(p,v,e,w)
   # Consolidation uses the real associated Dashboard; Investments has no family option.
   load(p,v,'family',view='dashboard');p.wait_for_function('document.querySelector("#dashboard-owner")?.options.length>=3');capture(p,v,'family',w,'self')
   options=p.locator('#dashboard-owner option').all_text_contents();p.locator('#dashboard-owner').select_option(label='Família (consolidado)');p.wait_for_function('__investmentPreview.snapshot().props.some(x=>x.component==="CurrentNetWorthCard"&&x.props.status==="ready")');capture(p,v,'family',w,'consolidated');checks.append({'variant':v,'width':w,'familyOptions':options,'result':'PASS'})
   p.close()
 b.close()
(OUT/f'run-session-a11y-{args.variant or "all"}.json').write_text(json.dumps({'checks':checks,'records':records,'pageErrors':errors,'blockedNetwork':blocked},ensure_ascii=False,indent=2),encoding='utf8')
assert not errors,errors
assert not blocked,blocked
print(json.dumps({'checks':checks,'captures':len(records),'pageErrors':errors,'blockedNetwork':blocked},ensure_ascii=True),flush=True)
