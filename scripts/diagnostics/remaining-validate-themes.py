"""Closed-transport, four-reference remaining-screen checks. Never uses real sessions."""
from pathlib import Path
import json,sys,re,time
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright
from remaining_visual_checks import AUDIT_JS,compare_rasters,digest

OUT=Path('node_modules/.finelo-cycle4c-tools/evidence');OUT.mkdir(exist_ok=True)
VARIANTS=['main','reviewed','dark','light']
RENDER_ARGS=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts','--disable-lcd-text','--disable-font-subpixel-positioning','--font-render-hinting=none','--run-all-compositor-stages-before-draw']
RESULTS=[]
def settle(p):
 p.evaluate("async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?null:new Promise(r=>{i.onload=r;i.onerror=r})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}")
 p.wait_for_timeout(750)
def load(p,v,view,case='complete',**extra):
 q={'theme':'light'if v=='light'else'dark','view':view,'case':case,**extra}
 if v in ['main','reviewed']:q['baseline']=v
 p.goto('http://127.0.0.1:5207/scripts/diagnostics/remaining-preview.html?'+urlencode(q),wait_until='networkidle',timeout=120000)
 p.wait_for_function('window.__remainingPreview!==undefined');p.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}')
 settle(p)
 p.wait_for_function("window.__remainingPreview.snapshot().actor==='10000000-0000-4000-8000-000000000001'")
 if view=='goals' and case not in ['empty','load-error']:
  p.wait_for_function('window.__remainingPreview.snapshot().sources.goals.length>0')
def action(p,name,exact=True):return p.get_by_role('button',name=name,exact=exact).filter(visible=True)
def cancel(p):
 x=action(p,'Cancelar');x.last.click();settle(p)
def cap(p,v,width,name,scope=None):
 settle(p);p.mouse.move(0,0)
 # Match focus across immutable versions; keyboard focus has separate explicit snapshots.
 if not name.endswith('-keyboard'):p.evaluate('document.activeElement?.blur()')
 p.evaluate("async(keepFocus)=>{const nodes=[...document.querySelectorAll('*')].filter(e=>e.scrollTop||e.scrollLeft).map(e=>[e,e.scrollTop,e.scrollLeft]),active=keepFocus?document.activeElement:null,old=document.body.style.display;document.body.style.display='none';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.body.style.display=old;nodes.forEach(([e,t,l])=>{e.scrollTop=t;e.scrollLeft=l});active?.focus({preventScroll:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}",name.endswith('-keyboard'))
 audit=AUDIT_JS
 if scope:audit=audit.replace("const root=tour||",f"const root=tour||").replace("document.querySelector('[data-finelo-theme]')",f"document.querySelector({json.dumps(scope)})||document.querySelector('[data-finelo-theme]')")
 data=p.evaluate(audit);snap=p.evaluate('window.__remainingPreview.snapshot()');profile=p.evaluate('window.__remainingPreview.profile()')
 file=f'{name}-{width}-{v}';p.screenshot(path=str(OUT/(file+'.png')))
 before=profile;p.evaluate("()=>{const e=document.querySelector('[data-finelo-theme]');e.dataset.fineloTheme=e.dataset.fineloTheme==='light'?'dark':'light';e.dataset.fineloTheme=e.dataset.fineloTheme==='light'?'dark':'light'}")
 after=p.evaluate('window.__remainingPreview.profile()');assert before==after,('Appearance caused work',name,before,after)
 entry={'state':name,'variant':v,'width':width,'audit':data,'snapshot':snap,'cssZeroWork':True,'image':file+'.png','renderer':RENDER_ARGS}
 (OUT/(file+'.json')).write_text(json.dumps(entry,ensure_ascii=False),encoding='utf8');RESULTS.append(entry)
 print(json.dumps({'state':name,'variant':v,'width':width,'AAfail':len([r for r in data['rows']if not r['pass']])}),flush=True)
def goals(p,v,w):
 load(p,v,'goals');cap(p,v,w,'goals-normal','#goals-view')
 action(p,'Arquivados',False).click();cap(p,v,w,'goals-archived','#goals-view')
 action(p,'+ Novo objetivo').click();cap(p,v,w,'goals-create')
 action(p,'Salvar').click();cap(p,v,w,'goals-validation')
 p.get_by_label('Nome',exact=True).fill('Objetivo sintético novo');p.get_by_label('Valor desejado (R$)',exact=True).fill('1234,56');p.get_by_label('Quanto já tenho (R$)',exact=True).fill('123,45');p.locator('#goal-month').fill('2027-12')
 p.locator('#goal-name').focus();p.keyboard.press('Tab');cap(p,v,w,'goals-create-keyboard')
 p.evaluate("window.__remainingPreview.hold('write:financial_goals')");action(p,'Salvar').click();cap(p,v,w,'goals-saving')
 p.evaluate("window.__remainingPreview.release('write:financial_goals')");p.wait_for_selector('#goal-form',state='detached');cap(p,v,w,'goals-created','#goals-view')
 assert not any(e.get('table')in ['transactions','economic_events','contas']for e in p.evaluate('window.__remainingPreview.snapshot().events'))
 card=p.get_by_role('article',name='Objetivo Objetivo sintético novo',exact=True);card.get_by_role('button',name='Atualizar valor').click();cap(p,v,w,'goals-value')
 p.locator('#goal-current-value').fill('222,22') if p.locator('#goal-current-value').count() else p.get_by_label('Quanto você tem hoje',exact=False).fill('222,22')
 action(p,'Salvar').click();settle(p);cap(p,v,w,'goals-value-saved','#goals-view')
 card.get_by_role('button',name='Mais opções',exact=False).click();cap(p,v,w,'goals-menu','#goals-view');p.get_by_role('menuitem',name='Editar',exact=True).click();cap(p,v,w,'goals-edit');cancel(p)
 card.get_by_role('button',name='Mais opções',exact=False).click();p.get_by_role('menuitem',name='Arquivar',exact=True).click();settle(p);cap(p,v,w,'goals-archive-saved','#goals-view')
 card=p.get_by_role('article',name='Objetivo Objetivo sintético novo',exact=True);card.get_by_role('button',name='Mais opções',exact=False).click();p.get_by_role('menuitem',name='Restaurar',exact=True).click();settle(p)
 card.get_by_role('button',name='Mais opções',exact=False).click();p.get_by_role('menuitem',name='Excluir',exact=True).click();cap(p,v,w,'goals-delete-confirm');cancel(p)
 card.get_by_role('button',name='Mais opções',exact=False).click();p.get_by_role('menuitem',name='Excluir',exact=True).click();action(p,'Excluir').last.click();settle(p);cap(p,v,w,'goals-deleted','#goals-view')
 for case in ['empty','load-error','long']:
  load(p,v,'goals',case);cap(p,v,w,'goals-'+case,'#goals-view')
 load(p,v,'goals','write-error');action(p,'+ Novo objetivo').click();p.get_by_label('Nome',exact=True).fill('Falha sintética');p.locator('#goal-target').fill('100');action(p,'Salvar').click();cap(p,v,w,'goals-save-error')
def settings(p,v,w):
 load(p,v,'settings')
 for section in ['configs','manage-accounts','logs','categories','budgets','manage-assets','rules','family']:
  root=p.locator('#settings-'+section);root.scroll_into_view_if_needed();p.evaluate("()=>{const e=document.querySelector('main');if(e)e.scrollLeft=0}");cap(p,v,w,'settings-'+section,'#settings-'+section)
  if section in ['configs','manage-accounts','categories','budgets','rules']:
   root.get_by_role('button',name='Adicionar Novo',exact=True).click();cap(p,v,w,'settings-'+section+'-create');cancel(p)
   edit=root.get_by_role('button',name='Editar',exact=True).filter(visible=True)
   if edit.count():edit.first.click();cap(p,v,w,'settings-'+section+'-edit');cancel(p)
  if section=='family':
   plus=root.get_by_role('button',name=re.compile('Adicionar|Convidar')).filter(visible=True)
   if plus.count():plus.first.click();cap(p,v,w,'settings-family-invite');cancel(p)
 # Read-only categories, list search, pagination and empty results use original handlers.
 root=p.locator('#settings-categories');root.scroll_into_view_if_needed();search=root.locator('input');search.fill('Nenhum resultado sintético');cap(p,v,w,'settings-search-empty','#settings-categories');search.fill('')
 # Security is deliberately exercised without recording a PIN or a real credential.
 for title in ['Segurança','Proteção']:
  heading=p.get_by_role('heading',name=re.compile(title)).filter(visible=True)
  if heading.count():heading.first.scroll_into_view_if_needed();cap(p,v,w,'settings-security');break
 load(p,v,'settings',admin='true');cap(p,v,w,'settings-admin')
 for text in ['Cartão V2','Reprocessamento','Backup']:
  h=p.get_by_role('heading',name=re.compile(text)).filter(visible=True)
  if h.count():h.first.scroll_into_view_if_needed();cap(p,v,w,'settings-admin-'+text.split()[0].lower())
def accounts(p,v,w):
 load(p,v,'accounts');cap(p,v,w,'accounts-normal');action(p,'Adicionar Conta').click();cap(p,v,w,'accounts-create')
 p.locator('[name=Tipo_Conta]').select_option(label='Cartão de Crédito');cap(p,v,w,'accounts-credit');cancel(p)
 for case in ['empty','long']:load(p,v,'accounts',case);cap(p,v,w,'accounts-'+case)
def compare(stage):
 issues=[];parities=[];financial=[];aa=[]
 def data_props(value):
  # Paint annotations inside React-element props carry no payload or domain state.
  if isinstance(value,list):return [data_props(x)for x in value]
  if isinstance(value,dict):return {k:data_props(v)for k,v in value.items()if not k.startswith('data-finance')}
  return value
 grouped={}
 for r in RESULTS:grouped.setdefault((r['state'],r['width']),{})[r['variant']]=r
 for (name,w),group in grouped.items():
  for v,r in group.items():
   if v=='light':aa.extend({'state':name,'width':w,**row}for row in r['audit']['rows'])
   if v=='main':continue
   ref=group['main'];a,b=ref['audit'],r['audit']
   # The approved session exception changes only invalid cross-account lifetimes, not normal scenario payloads.
   equal=all(ref['snapshot'][k]==r['snapshot'][k]for k in ['db','events','sources'])and data_props(ref['snapshot']['props'])==data_props(r['snapshot']['props'])
   financial.append({'state':name,'width':w,'variant':v,'pass':equal})
   if not equal:issues.append({'kind':'financial','state':name,'variant':v,'keys':[k for k in ['db','events','sources']if ref['snapshot'][k]!=r['snapshot'][k]]+(['props']if data_props(ref['snapshot']['props'])!=data_props(r['snapshot']['props'])else[])})
   if v!='light':
    same=all(a[k]==b[k]for k in ['content','geometry','colors','svgPaint','money']);result={'state':name,'width':w,'variant':v,'pass':same}
    if same:
     try:result.update(compare_rasters((OUT/ref['image']).read_bytes(),(OUT/r['image']).read_bytes()))
     except AssertionError as e:result.update({'pass':False,'rasterError':str(e)})
    else:result['differentKeys']=[k for k in ['content','geometry','colors','svgPaint','money']if a[k]!=b[k]]
    parities.append(result)
    if not result['pass']:issues.append({'kind':'dark-parity',**result})
 failures=[r for r in aa if not r['pass']];issues.extend({'kind':'contrast',**r}for r in failures)
 report={'stage':stage,'captures':len(RESULTS),'financial':financial,'parity':parities,'AA':aa,'issues':issues,'cssZeroWork':len(RESULTS)}
 (OUT/(stage+'-validation.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps({'stage':stage,'captures':len(RESULTS),'financial':len(financial),'parities':len(parities),'AA':len(aa),'issues':issues[:30]},ensure_ascii=True),flush=True)
 return report
def run(stage):
 with sync_playwright()as pw:
  b=pw.chromium.launch(channel='msedge',headless=True,args=RENDER_ARGS)
  for w,h in [(1440,1000),(390,844)]:
   for v in VARIANTS:
    p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-06T12:00:00Z');errors=[];p.on('pageerror',lambda e:errors.append(str(e)));p.route('**/*',lambda r:r.continue_()if r.request.url.startswith('http://127.0.0.1:5207/')else r.abort())
    for fn in [goals,settings,accounts]:fn(p,v,w)
    assert not errors,errors;p.close()
  b.close()
 return compare(stage)
if __name__=='__main__':
 result=run(sys.argv[1]if len(sys.argv)>1 else'4c1');sys.exit(bool(result['issues']))
