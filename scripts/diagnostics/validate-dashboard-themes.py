"""Four immutable/rendered Dashboard variants; synthetic SDK transport, original financial code."""
import argparse,json,hashlib,re
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright,expect
from dashboard_visual_checks import AUDIT_JS,compare_rasters,digest
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=5205);p.add_argument('--out-dir',type=Path,required=True);p.add_argument('--suite',choices=['states','interactions','extras','a11y','premium'],default='states');p.add_argument('--viewport',choices=['all','desktop','mobile'],default='all');p.add_argument('--collect-contrast',action='store_true');p.add_argument('--themes',choices=['all','light'],default='all');a=p.parse_args();a.out_dir.mkdir(parents=True,exist_ok=True)
origin=f'http://127.0.0.1:{a.port}';repo=Path(__file__).resolve().parents[2]
checks={'status':'RUNNING','bases':{},'contrast':{},'parity':{},'financial':{},'theme_switch':{},'legacy_dark':{}};refs={};expect.set_options(timeout=30000)
for base in ['main','reviewed']:
 folder=repo/f'scripts/diagnostics/theme-dashboard-{base}-baseline';m=json.loads((folder/'baseline.json').read_text())
 for path,sha in m['files'].items():assert hashlib.sha256((folder/path).read_bytes()).hexdigest()==sha
 checks['bases'][base]=m['base']
def settle(page):
 page.evaluate('''async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}''');page.wait_for_timeout(120)
def load(page,case='complete',**extra):
 q={'theme':'light' if variant=='light' else 'dark','case':case,**extra}
 if variant in ['main','reviewed']:q['baseline']=variant
 page.goto(origin+'/scripts/diagnostics/dashboard-preview.html?'+urlencode(q),wait_until='networkidle',timeout=120000);page.wait_for_function('window.__dashboardPreview!==undefined')
 page.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}')
 settle(page)
 if case not in ['loading','load-error','position-loading']:
  page.wait_for_function('!document.body.innerText.includes("Carregando a posição patrimonial atual")');settle(page)
 assert page.evaluate('''()=>{const f=document.createElement('iframe');document.body.append(f);const ok=f.contentWindow.localStorage.getItem('dashboard-fence-sentinel')==='unchanged'&&f.contentWindow.localStorage.length===1;f.remove();return ok}'''),'Real storage changed'
def snap(page):return page.evaluate('__dashboardPreview.snapshot()')
def capture(page,name,selector=None,keep=False,hover=False):
 if not keep:page.evaluate('document.activeElement?.blur()')
 if not hover:page.mouse.move(0,0)
 if selector:page.locator(selector).evaluate('(e)=>e.scrollIntoView({block:"start",inline:"nearest"})')
 if not hover:page.mouse.move(0,0)
 settle(page);page.wait_for_timeout(750)
 # Recreate paint layers identically; restore the exact body style and keep focus/layout.
 page.evaluate('''async()=>{const b=document.body,v=b.style.opacity;b.style.opacity='0';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));b.style.opacity=v;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}''')
 data=page.evaluate(AUDIT_JS);raw=page.screenshot(animations='disabled');key=viewport+'-'+name
 overflow=page.evaluate('document.documentElement.scrollWidth-innerWidth');checks.setdefault('overflow',{})[key+'-'+variant]=overflow
 assert overflow<=0 or name in ['custom-dates','long-period','native-date-focus','comparison-hover'],(key,'document overflow')
 presentation={k:data[k] for k in ['geometry','content','colors','svgPaint']}
 (a.out_dir/f'{key}-{variant}.png').write_bytes(raw)
 (a.out_dir/f'{key}-{variant}-audit.json').write_text(json.dumps(data,ensure_ascii=False),encoding='utf8')
 if variant=='main':refs[key]=(raw,presentation,data['money'])
 elif variant in ['reviewed','dark'] and key in refs:
  old,prior,money=refs[key];assert presentation==prior,(key,variant,'presentation differs');assert data['money']==money
  checks['parity'][key+'-'+variant]=compare_rasters(old,raw)
 failures=[r for r in data['rows'] if not r['pass']]
 if variant=='light' and name!='flag-off':
  checks['contrast'][key]={'samples':len(data['rows']),'failures':failures,'minimum_text':min((r['ratio'] for r in data['rows'] if r['threshold']==4.5),default=None),'minimum_essential':min((r['ratio'] for r in data['rows'] if r['threshold']==3),default=None)}
  if failures and not a.collect_contrast:raise AssertionError((key,failures[:12]))
 elif variant=='main':checks['legacy_dark'][key]=failures
 print(json.dumps({'viewport':viewport,'variant':variant,'state':name,'failures':len(failures)}),flush=True)
def financial(page,name):
 if name not in ['position-loading','loading']:
  page.wait_for_function('!document.body.innerText.includes("Carregando a posição patrimonial atual")');settle(page)
 s=snap(page);data=page.evaluate(AUDIT_JS)
 values={k:s[k] for k in ['fixture','source','financialProps','financialCents','events','currentView']};values['dom_money']=data['money']
 key=viewport+'-'+name
 (a.out_dir/f'{key}-{variant}-financial.json').write_text(json.dumps(s,ensure_ascii=False,indent=2),encoding='utf8')
 if variant=='main':finrefs[key]=values
 elif variant in ['reviewed','dark','light'] and key in finrefs:assert values==finrefs[key],(key,variant,'financial mismatch')
 checks['financial'][key+'-'+variant]={'sha256':digest(values),'same_four_variants':a.themes=='all'}
 if variant in ['dark','light']:
  before=snap(page);counts=page.evaluate('__dashboardPreview.profile()')
  page.evaluate('''async()=>{const e=document.querySelector('[data-finelo-theme]'),t=e.dataset.fineloTheme;e.dataset.fineloTheme=t==='light'?'dark':'light';await new Promise(r=>requestAnimationFrame(r));e.dataset.fineloTheme=t;await new Promise(r=>requestAnimationFrame(r));}''');settle(page)
  assert snap(page)==before and page.evaluate('__dashboardPreview.profile()')==counts,(key,'theme caused work')
  checks['theme_switch'][key+'-'+variant]={'react_commits':0,'account_calculations':0,'requests':0,'writes':0,'economic_events':0}
def states(page):
 for case in ['complete','empty','zero','negative','future','multiple','cards','investments','family','long','incomplete','load-error','loading','position-error','position-loading','partial','free','onboarding','onboarding-review','onboarding-view','invite','asset-review']:
  load(page,case)
  capture(page,case);financial(page,case)
  if case=='complete':
   for name,selector in [('budgets','#dashboard-budgets'),('annual','#dashboard-annual-evolution'),('networth','[data-net-worth-components]'),('monthly','#dashboard-charts-main'),('categories','#dashboard-charts-secondary')]:capture(page,name,selector)
  if case in ['negative','partial','position-error','position-loading']:capture(page,case+'-position','[data-net-worth-components]')
  if case=='loading':page.evaluate('__dashboardPreview.release("initial")');settle(page);capture(page,'loading-recovered');financial(page,'loading-recovered')
  if case=='load-error':page.get_by_role('button',name='Tentar novamente',exact=True).click();settle(page);capture(page,'load-error-retry');financial(page,'load-error-retry')
  if case=='position-loading':page.evaluate('__dashboardPreview.release("position")');page.wait_for_function('!document.body.innerText.includes("Carregando a posição patrimonial atual")');settle(page);financial(page,'position-recovered')
  if case=='position-error':
   page.evaluate('__dashboardPreview.release("position")');page.get_by_role('button',name='Tentar novamente',exact=True).click();settle(page);financial(page,'position-retry')
 load(page,networth='legacy',scope='off');capture(page,'legacy');financial(page,'legacy')
 page.get_by_role('button',name='Comparar',exact=True).click();settle(page);capture(page,'legacy-compare');financial(page,'legacy-compare')
 page.locator('select').first.select_option('yearly');settle(page);capture(page,'yearly-compare');financial(page,'yearly-compare');capture(page,'yearly-chart','#dashboard-charts-main')
 page.locator('select').first.select_option('custom');settle(page)
 dates=page.locator('input[type=date]');dates.nth(0).fill('2026-08-01');dates.nth(1).fill('2026-11-30');settle(page);capture(page,'custom-dates');financial(page,'custom-dates')
def interactions(page):
 load(page)
 page.get_by_role('button',name='Gerenciar orçamento',exact=True).click();settle(page);capture(page,'budget-modal',keep=True)
 print('MODAL '+json.dumps({'buttons':page.locator('.fixed.inset-0').last.locator('button').all_text_contents(),'inputs':page.locator('.fixed.inset-0').last.locator('input').evaluate_all('(es)=>es.map(e=>({type:e.type,value:e.value}))')},ensure_ascii=True),flush=True)
 page.get_by_role('button',name='Fechar',exact=True).click();settle(page);financial(page,'budget-cancel')
 page.locator('[data-net-worth-details] summary').click();settle(page);capture(page,'networth-details','[data-net-worth-details]');financial(page,'networth-details')
 page.locator('[data-net-worth-details] summary').click()
 chart=page.locator('#dashboard-annual-evolution rect[role=button]').nth(4)
 page.mouse.move(0,0);chart.focus();settle(page);capture(page,'annual-focus','#dashboard-annual-evolution',keep=True)
 if variant in ['main','reviewed']:
  chart.click();chart.click() # Same two legacy toggle actions; keyboard activation did not exist.
 else:
  page.keyboard.press('Enter');settle(page);assert page.locator('[data-finance~=dashboard-chart-tooltip]').count()==0
  page.keyboard.press('Space');settle(page);assert page.locator('[data-finance~=dashboard-chart-tooltip]').count()==1
 page.mouse.move(0,0);chart.evaluate('(e)=>e.blur()');page.keyboard.press('Tab');chart.focus();settle(page);capture(page,'annual-keyboard','#dashboard-annual-evolution',keep=True)
 if variant in ['dark','light']:
  page.keyboard.press('Escape');settle(page);assert page.locator('[data-finance~=dashboard-chart-tooltip]').count()==0;assert chart.evaluate('(e)=>document.activeElement===e')
 page.evaluate('document.activeElement.blur()');page.mouse.move(0,0);settle(page)
 month=page.locator('[data-finance~=dashboard-month]').first
 if month.count():
  month.focus();settle(page);capture(page,'monthly-keyboard',keep=True);page.keyboard.press('Escape');settle(page);assert month.locator('[data-finance~=dashboard-month-tooltip]').evaluate('(e)=>getComputedStyle(e).opacity==="0"');assert month.evaluate('(e)=>document.activeElement===e');page.evaluate('document.activeElement.blur()')
 page.locator('select').first.focus();capture(page,'select-focus','#dashboard-header',keep=True)
 if viewport=='mobile':
  page.get_by_role('button',name='Nova Transação',exact=True).click();settle(page);page.locator('.fixed.inset-0').last.locator('input').first.focus();capture(page,'transaction-modal',keep=True)
  page.locator('.fixed.inset-0').last.locator('button').first.click();settle(page);financial(page,'transaction-cancel')
 # Hover hints: current Dark must equal the original hover presentation.
 triggers=page.locator('.group\\/tooltip, .group\\/legend')
 for i in range(min(triggers.count(),7)):
  page.evaluate('document.activeElement.blur()');triggers.nth(i).hover();capture(page,'hint-'+str(i),keep=True,hover=True)
  if variant in ['light','dark'] and triggers.nth(i).get_attribute('tabindex')=='0':
   triggers.nth(i).focus();page.mouse.move(0,0);settle(page)
   assert triggers.nth(i).locator('[role=tooltip]').evaluate('(e)=>getComputedStyle(e).display!=="none"')
   if variant=='light':capture(page,'keyboard-hint-'+str(i),keep=True)
   popup=triggers.nth(i).locator('[role=tooltip]');assert popup.evaluate('(e)=>getComputedStyle(e).pointerEvents==="auto"')
   popup.hover();settle(page);assert popup.is_visible();page.keyboard.press('Escape');settle(page);assert not popup.is_visible();assert triggers.nth(i).evaluate('(e)=>document.activeElement===e')
   checks.setdefault('keyboard',{})[viewport+'-'+variant+'-hint-'+str(i)]={'dismissible':True,'hoverable':True,'persistent':True,'focus_preserved':True}
   page.evaluate('document.activeElement.blur()')
 page.get_by_role('button',name='Iniciar Tutorial',exact=True).click();expect(page.locator('.driver-popover')).to_be_visible();capture(page,'tour',keep=True);financial(page,'tour')
 page.keyboard.press('Escape');settle(page)
 for route,label in [('transactions','Transações QA'),('import','Importação QA')]:
  page.get_by_role('button',name=label,exact=True).click();settle(page)
  assert snap(page)['currentView']==route
  page.get_by_role('button',name='Dashboard QA',exact=True).click();settle(page);financial(page,'returned-'+route)
 load(page,'family');selectors=page.locator('select');print('FAMILY '+str(selectors.count()),flush=True)
 for i in range(selectors.count()):
  opts=selectors.nth(i).locator('option').evaluate_all('(es)=>es.map(e=>({value:e.value,text:e.text}))')
  if any('familiar' in x['text'].lower() or 'consolid' in x['text'].lower() for x in opts):
   for item in opts:
    selectors.nth(i).select_option(item['value']);settle(page);capture(page,'owner-'+re.sub('[^a-zA-Z0-9]','',item['value']));financial(page,'owner-'+item['value'])
   break
def extras(page):
 for fail in [False,True]:
  load(page,budgetError='true' if fail else 'false')
  page.get_by_role('button',name='Gerenciar orçamento',exact=True).click();settle(page)
  modal=page.locator('.fixed.inset-0').last;field=modal.locator('input').first
  field.fill('-1');modal.get_by_role('button',name='Salvar',exact=True).click();settle(page);capture(page,'budget-invalid-'+str(fail),keep=True);financial(page,'budget-invalid-'+str(fail))
  field.fill('125,50');modal.get_by_role('button',name='Salvar',exact=True).click();settle(page)
  if fail:expect(page.get_by_text('Não foi possível salvar o orçamento do mês. Tente novamente.',exact=True)).to_be_visible()
  else:expect(page.get_by_text('Orçamento salvo.',exact=True)).to_be_visible()
  capture(page,'budget-result-'+str(fail),keep=True);financial(page,'budget-result-'+str(fail))
 load(page,period='yearly',compare='true')
 page.get_by_role('button',name='Mesmo período, ano anterior',exact=True).click();settle(page);capture(page,'year-over-year');financial(page,'year-over-year')
 month=page.locator('[data-finance~=dashboard-month]').nth(7)
 if variant in ['dark','light']:
  month.focus();settle(page);assert month.get_attribute('aria-label').count('receitas')==2
  capture(page,'yearly-month-focus',keep=True);financial(page,'yearly-month-focus')
 page.locator('select').first.select_option('custom');settle(page)
 dates=page.locator('input[type=date]');dates.nth(0).fill('2024-01-01');dates.nth(1).fill('2026-12-31');settle(page);capture(page,'long-period');financial(page,'long-period')
 load(page)
 before=snap(page);counts=page.evaluate('__dashboardPreview.profile()')
 page.evaluate('''async()=>{const e=document.querySelector('[data-finelo-theme]');e.removeAttribute('data-finelo-theme');await new Promise(r=>requestAnimationFrame(r));}''')
 capture(page,'flag-off');assert snap(page)==before and page.evaluate('__dashboardPreview.profile()')==counts

def premium(page):
 load(page,'free');capture(page,'free');financial(page,'free')
 if variant in ['dark','light']:
  assert page.locator('[inert]').count()==3
  month=page.locator('[inert] [data-finance~=dashboard-month]').first;month.focus();assert not month.evaluate('(e)=>document.activeElement===e')
  checks['inactive_preview']={'inert_regions':3,'keyboard_blocked':True,'overlay_available':True}

def a11y(page):
 load(page)
 page.keyboard.press('Tab');page.locator('#dashboard-annual-evolution rect[role=button]').nth(4).focus();settle(page);capture(page,'svg-focus','#dashboard-annual-evolution',keep=True)
 page.evaluate('document.activeElement.blur()')
 load(page)
 page.locator('select').first.select_option('custom');settle(page);dates=page.locator('input[type=date]');dates.first.focus();settle(page);capture(page,'native-date-focus','#dashboard-header',keep=True)
 page.get_by_role('button',name='Comparar',exact=True).click();settle(page);page.get_by_role('button',name='Mesmo período, ano anterior',exact=True).hover();capture(page,'comparison-hover','#dashboard-header',keep=True,hover=True)

with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
 for viewport,width,height in [('desktop',1440,1000),('mobile',390,844)]:
  if a.viewport not in ['all',viewport]:continue
  finrefs={}
  for variant in (['light'] if a.themes=='light' else ['main','reviewed','dark','light']):
   context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1,timezone_id='America/Sao_Paulo',color_scheme='dark',service_workers='block');remote=[];errors=[]
   def route(r):
    if r.request.url.startswith(origin+'/'):r.continue_()
    else:remote.append(r.request.url);r.abort()
   context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.goto(origin+'/scripts/diagnostics/dashboard-preview.html');page.evaluate('()=>{const f=document.createElement("iframe");document.body.append(f);f.contentWindow.localStorage.clear();f.contentWindow.localStorage.setItem("dashboard-fence-sentinel","unchanged");f.remove();}');page.clock.set_fixed_time(datetime(2026,11,5,12,0,tzinfo=timezone.utc))
   {'states':states,'interactions':interactions,'extras':extras,'a11y':a11y,'premium':premium}[a.suite](page)
   assert not remote,remote;assert not errors,errors;context.close()
 browser.close()
checks['status']='COLLECTED' if any(x['failures'] for x in checks['contrast'].values()) else 'PASS'
(a.out_dir/'validation.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf8')
