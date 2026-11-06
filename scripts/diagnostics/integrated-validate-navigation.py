"""Bounded actual-App navigation matrix. SDK native; all HTTP replies synthetic."""
from pathlib import Path
import json,sys,time,copy
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend,A
from remaining_visual_checks import AUDIT_JS,compare_rasters

OUT=Path('node_modules/.finelo-cycle4d-tools/evidence');OUT.mkdir(exist_ok=True)
ARGS=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts','--disable-lcd-text','--disable-font-subpixel-positioning','--font-render-hinting=none','--run-all-compositor-stages-before-draw']
VIEWS=['dashboard','transactions','import','investments','goals','settings','help','dashboard']
FINANCIAL=['accounts','transactions','economicEvents','categories','assets','goals','budgets']
def settle(p):
 p.evaluate('async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}');p.wait_for_timeout(500)
def boot(p,baseline=None,view='dashboard',login='a',dismiss_tour=True,capture_styles=True):
 q={'view':view,'login':login}
 if baseline:q['baseline']=baseline
 p.goto('http://127.0.0.1:5209/scripts/diagnostics/integrated-preview.html?'+urlencode(q),wait_until='networkidle',timeout=120000);p.wait_for_function('window.__integratedQa!==undefined');p.wait_for_function("window.__integratedQa.snapshot().initialDataLoadStatus==='ready'")
 if dismiss_tour:
  # Real first-visit UI, not a forged localStorage flag. Separate risk probe covers
  # navigating before the legacy automatic-tour timer fires.
  p.wait_for_timeout(1700);close=p.locator('.driver-popover-close-btn').filter(visible=True)
  if close.count():
   p.once('dialog',lambda d:d.accept());close.first.click();p.locator('.driver-overlay').wait_for(state='detached')
 if capture_styles:p.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}')
 settle(p)
def navigate(p,view):
 target=p.locator('#nav-'+view).filter(visible=True)
 if not target.count():
  label={'dashboard':'Dashboard','transactions':'Transações','import':'Importar','investments':'Investimentos','goals':'Objetivos','settings':'Configurações','help':'Central de Ajuda'}[view]
  target=p.locator('#main-layout nav').first.get_by_role('button',name=label,exact=True).filter(visible=True)
 if target.count():target.first.click()
 elif view=='help':
  p.get_by_role('button',name='Menu da conta',exact=True).filter(visible=True).first.click();p.locator('[data-appearance-part=menu]').get_by_role('button',name='Central de Ajuda',exact=False).first.click()
 else:raise RuntimeError('No visible navigation for '+view)
 p.wait_for_function('(v)=>window.__integratedQa.snapshot().view===v',arg=view)
 if view=='goals':p.wait_for_function('window.__integratedQa.snapshot().goals.length>0')
 settle(p)
def capture(p,backend,engine,width,preference,view,step,baseline=None):
 p.mouse.move(0,0);p.evaluate('document.activeElement?.blur()');settle(p)
 audit=p.evaluate(AUDIT_JS);snap=p.evaluate('window.__integratedQa.snapshot()');name=f'{engine}-{width}-{preference}-{step}-{view}'+('-'+baseline if baseline else'')
 p.screenshot(path=str(OUT/(name+'.png')))
 row={'engine':engine,'width':width,'preference':preference,'view':view,'step':step,'baseline':baseline,'theme':p.locator('[data-qa-eligible]').get_attribute('data-finelo-theme'),'audit':audit,'snapshot':snap,'image':name+'.png','financialWrites':[w for w in backend.writes if w['kind']=='data'and w['table']not in['product_events']]}
 (OUT/(name+'.json')).write_text(json.dumps(row,ensure_ascii=False),encoding='utf8');print(json.dumps({'engine':engine,'width':width,'preference':preference,'view':view,'AAfail':sum(not r['pass']for r in audit['rows']),'financialWrites':len(row['financialWrites'])}),flush=True);return row
def launch(pw,name):
 if name in['edge','chrome']:return pw.chromium.launch(channel='msedge'if name=='edge'else'chrome',headless=True,args=ARGS)
 return getattr(pw,name).launch(headless=True,**({'args':ARGS}if name=='chromium'else{}))

def run(probe=False):
 rows=[];availability=[];issues=[]
 with sync_playwright()as pw:
  for engine in(['edge']if probe else['edge','chrome','firefox','webkit']):
   try:b=launch(pw,engine);availability.append({'browser':engine,'version':b.version,'status':'PASS'})
   except Exception as e:availability.append({'browser':engine,'status':'BLOCKED','reason':str(e)});continue
   for width,height in([(1440,1000)]if probe else[(1440,1000),(390,844)]):
    for preference in(['light']if probe else['dark','light','system']):
     backend=Backend();context=b.new_context(viewport={'width':width,'height':height},timezone_id='America/Sao_Paulo',color_scheme='light'if preference=='system'else'dark');context.route('**/*',backend.route);p=context.new_page();p.clock.set_fixed_time('2026-11-06T12:00:00Z');errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
     boot(p);p.evaluate('(t)=>window.__integratedQa.theme(t)',preference);p.wait_for_function('(t)=>window.__integratedQa.snapshot().user.user_metadata.appearance_theme===t',arg=preference)
     for step,view in enumerate(VIEWS):
      if step:navigate(p,view)
      rows.append(capture(p,backend,engine,width,preference,view,step))
     if preference=='system':
      p.emulate_media(color_scheme='dark');p.wait_for_function("document.querySelector('[data-qa-eligible]').dataset.fineloTheme==='dark'");p.emulate_media(color_scheme='light');p.wait_for_function("document.querySelector('[data-qa-eligible]').dataset.fineloTheme==='light'")
     if errors:issues.append({'kind':'javascript','engine':engine,'width':width,'preference':preference,'errors':errors})
     context.close()
    if engine=='edge'and not probe:
     backend=Backend(preference='dark');context=b.new_context(viewport={'width':width,'height':height},timezone_id='America/Sao_Paulo',color_scheme='dark');context.route('**/*',backend.route);p=context.new_page();p.clock.set_fixed_time('2026-11-06T12:00:00Z');boot(p,baseline='reviewed')
     for step,view in enumerate(VIEWS):
      if step:navigate(p,view)
      rows.append(capture(p,backend,engine,width,'dark',view,step,baseline='reviewed'))
     context.close()
   b.close()
 financial=[];parity=[];AA=[]
 for row in rows:
  if row['financialWrites']:issues.append({'kind':'financial-write','image':row['image'],'writes':row['financialWrites']})
  if not row['baseline']:
   AA.extend({'engine':row['engine'],'width':row['width'],'preference':row['preference'],'view':row['view'],**r}for r in row['audit']['rows'])
   if row['preference']!='dark':
    ref=next((r for r in rows if r['engine']==row['engine']and r['width']==row['width']and r['step']==row['step']and r['preference']=='dark'and not r['baseline']),None)
    if ref:
     same=all(row['snapshot'][k]==ref['snapshot'][k]for k in FINANCIAL)and row['audit']['money']==ref['audit']['money'];financial.append({'image':row['image'],'pass':same})
     if not same:issues.append({'kind':'financial-equivalence','image':row['image']})
  else:
   actual=next(r for r in rows if r['engine']=='edge'and r['width']==row['width']and r['step']==row['step']and r['preference']=='dark'and not r['baseline']);same=all(row['audit'][k]==actual['audit'][k]for k in['content','geometry','colors','svgPaint','money']);result={'image':actual['image'],'baseline':row['image'],'pass':same}
   if same:
    try:result.update(compare_rasters((OUT/row['image']).read_bytes(),(OUT/actual['image']).read_bytes()))
    except AssertionError as e:result.update(pass_=False,rasterError=str(e));result['pass']=False
   else:result['differentKeys']=[k for k in['content','geometry','colors','svgPaint','money']if row['audit'][k]!=actual['audit'][k]]
   parity.append(result)
   if not result['pass']:issues.append({'kind':'dark-parity',**result})
 report={'availability':availability,'captures':len(rows),'financial':financial,'parity':parity,'computedAA':AA,'issues':issues,'lightFailures':[r for r in AA if r['preference']!='dark'and not r['pass']],'darkFailures':[r for r in AA if r['preference']=='dark'and not r['pass']]}
 (OUT/('navigation-probe.json'if probe else'navigation-validation.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'captures':len(rows),'issues':issues,'lightFailures':len(report['lightFailures']),'darkFailures':len(report['darkFailures'])}),flush=True)
 return report
if __name__=='__main__':run('--probe'in sys.argv)
