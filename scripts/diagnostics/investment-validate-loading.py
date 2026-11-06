"""Deterministic native parsing/persistence states with the original parser/services."""
import runpy
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('investment-validate-themes.py')),run_name='investment_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
checks=[]
with sync_playwright()as pw:
 b=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 for v in VARIANTS:
  for w,h in [(1440,1000),(390,844)]:
   p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-05T12:00:00Z');p.on('pageerror',lambda err:errors.append(str(err)));p.route('**/*',lambda r:r.continue_()if r.request.url.startswith('http://127.0.0.1:5206/')else(r.abort(),blocked.append(r.request.url)))
   for e in ['legacy','v2']:
    load(p,v,e);click(p,'Adicionar');fields=p.locator('.fixed.inset-0 input');fields.nth(0).fill('Banco QA');fields.nth(1).fill('Renda Fixa');fields.nth(3).fill('0');click(p,'Salvar');assert fields.nth(3).evaluate('(e)=>e.validity.rangeUnderflow');p.mouse.move(0,0);fields.first.focus();capture(p,v,e,w,'manual-zero-validation');assert not snap(p)['events'];click(p,'Cancelar')
    click(p,'Importar Planilha')
    p.evaluate('()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){await new Promise(r=>window.__resumeInvestmentFile=r);return original.call(this)}}')
    p.locator('input[type=file]').set_input_files('node_modules/.finelo-cycle4b-tools/workbooks/valid.xlsx');expect(p.get_by_text('Lendo planilha...',exact=True)).to_be_visible();expect(p.locator('.fixed.inset-0 select')).to_be_disabled();expect(p.locator('.fixed.inset-0 button').filter(has_text=re.compile('^Cancelar$'))).to_be_disabled();p.mouse.move(0,0);p.locator('.fixed.inset-0 button').first.focus();capture(p,v,e,w,'import-parsing-disabled');assert not snap(p)['events']
    p.evaluate('__resumeInvestmentFile()');expect(p.get_by_text('Pronto para importar!',exact=True)).to_be_visible();p.evaluate('__investmentPreview.hold("write:investments")');click(p,'Confirmar Importação');expect(p.get_by_text('Salvando...',exact=True)).to_be_visible();p.mouse.move(0,0);capture(p,v,e,w,'import-persisting-disabled');assert not any(x.get('source_file')=='valid.xlsx'for x in snap(p)['db']['investments'])
    p.evaluate('__investmentPreview.release("write:investments")');expect(p.locator('.fixed.inset-0')).to_have_count(0);p.wait_for_function('__investmentPreview.snapshot().props.some(x=>x.component==="PortfolioSummary"&&x.props.summary.positionCount===9)');checks.append({'variant':v,'engine':e,'width':w,'parserAndPersistence':'PASS','noPrematureWrites':True,'nativeZeroBlocked':True})
    if v in ['dark','light']:
     load(p,v,e);click(p,'Importar Planilha');p.evaluate('()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){await new Promise(r=>window.__resumeInvestmentFile=r);return original.call(this)}}');p.locator('input[type=file]').set_input_files('node_modules/.finelo-cycle4b-tools/workbooks/valid.xlsx');expect(p.get_by_text('Lendo planilha...',exact=True)).to_be_visible();start=len(p.evaluate('__investmentPreview.trace()'));p.evaluate('(id)=>__investmentPreview.auth(id)',C);p.evaluate('__resumeInvestmentFile()');p.wait_for_function('(id)=>__investmentPreview.snapshot().visible.rows.some(r=>r.user_id===id)',arg=C);p.wait_for_timeout(200);trace=p.evaluate('__investmentPreview.trace()')[start:];assert not[f for f in trace if f['actor']==C and(f['dialogs']or any(r['user_id']!=C for r in f['rows']))];assert not snap(p)['events'];checks.append({'variant':v,'engine':e,'width':w,'interruptedParserSession':'PASS','renders':len(trace)});(OUT/f'parser-interrupted-{e}-{w}-{v}.json').write_text(json.dumps(trace),encoding='utf8')
   p.close()
 b.close()
(OUT/'run-loading-all.json').write_text(json.dumps({'records':records,'checks':checks,'pageErrors':errors,'blockedNetwork':blocked},ensure_ascii=False,indent=2),encoding='utf8')
assert not errors,errors
assert not blocked,blocked
print(json.dumps({'captures':len(records),'checks':checks,'pageErrors':errors,'blockedNetwork':blocked},ensure_ascii=True),flush=True)
