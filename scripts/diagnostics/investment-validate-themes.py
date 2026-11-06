"""Offline, synthetic, four-reference Investments/Assets verification (Edge).

Run with the staging-only investment-preview fixture on loopback. No credentials.
The baseline snapshots are prepared from the SHAs recorded in the report.
"""
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright, expect
import argparse, json, re, sys, time
from investment_visual_checks import AUDIT_JS, compare_rasters

A='10000000-0000-4000-8000-000000000001'
B='10000000-0000-4000-8000-000000000002'
C='10000000-0000-4000-8000-000000000003'
VARIANTS={'main':{'baseline':'main'},'reviewed':{'baseline':'reviewed'},'dark':{},'light':{'theme':'light'}}
CASES=['complete','empty','single','zero','negative','incomplete','unclassified','long','previous-only','flows','denied','read-only','load-error','no-entitlement']
parser=argparse.ArgumentParser();parser.add_argument('--out',default='node_modules/.finelo-cycle4b-tools/visual');parser.add_argument('--phase',choices=['core','states','assets','security','all'],default='all');parser.add_argument('--variant',choices=list(VARIANTS));args=parser.parse_args()
OUT=Path(args.out);OUT.mkdir(parents=True,exist_ok=True);records=[];errors=[];blocked=[]

def snap(p):return p.evaluate('__investmentPreview.snapshot()')
def click(p,text):p.locator('button').filter(has_text=re.compile(r'^\s*'+re.escape(text)+r'\s*$')).filter(visible=True).last.click()
def row_action(p,text):
 target=p.get_by_title(text,exact=True).filter(visible=True)
 if target.count():target.first.click()
 else:p.locator('button').filter(has_text=re.compile('^'+text+'$')).filter(visible=True).first.click()

def load(p,variant,engine,case='complete',**extra):
 q={**VARIANTS[variant],'engine':engine,'case':case,**extra}
 p.goto('http://127.0.0.1:5206/scripts/diagnostics/investment-preview.html?'+urlencode(q),wait_until='networkidle',timeout=120000)
 p.wait_for_function('window.__investmentPreview!==undefined')
 if extra.get('view')=='assets':expect(p.locator('#settings-manage-assets')).to_be_visible();p.evaluate('()=>{let e=document.querySelector("#settings-manage-assets");while(e&&e.parentElement&&!e.parentElement.matches("[data-finelo-theme]")){for(const s of e.parentElement.children)if(s!==e)s.setAttribute("data-qa-outside-assets","");e=e.parentElement}}');p.add_style_tag(content='[data-qa-outside-assets]{display:none!important}')
 elif extra.get('view')=='dashboard':p.wait_for_function('__investmentPreview.snapshot().props.some(x=>x.component==="CurrentNetWorthCard")')
 elif case not in ['no-entitlement','load-error']:p.wait_for_function('__investmentPreview.snapshot().props.some(x=>x.component==="PortfolioSummary")')
 p.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}')
 p.mouse.move(0,0);p.evaluate('document.activeElement?.blur()');p.evaluate('window.scrollTo(0,0)')

def settle(p):
 p.evaluate('async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?0:i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const old=document.body.style.opacity;document.body.style.opacity="0";await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.body.style.opacity=old;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')
 p.wait_for_timeout(750)

def capture(p,variant,engine,width,state,scope=None):
 if not p.locator('.fixed.inset-0').count() and not state.startswith('a11y-'):p.evaluate('window.scrollTo(0,0)')
 settle(p);key=f'{engine}-{width}-{state}-{variant}';audit=AUDIT_JS
 if scope:audit=audit.replace('const root=tour||',f'const root=document.querySelector({json.dumps(scope)})||tour||')
 data=p.evaluate(audit);s=snap(p)
 profile=p.evaluate('__investmentPreview.profile()');p.evaluate('()=>{const e=document.querySelector("[data-finelo-theme]");e.dataset.fineloTheme=e.dataset.fineloTheme==="light"?"dark":"light";e.dataset.fineloTheme=e.dataset.fineloTheme==="light"?"dark":"light"}')
 after=p.evaluate('__investmentPreview.profile()');assert profile==after,(key,'theme caused financial work',profile,after)
 p.screenshot(path=str(OUT/(key+'.png')),full_page=True)
 record={'key':key,'variant':variant,'engine':engine,'width':width,'state':state,'audit':data,'financial':{k:s[k]for k in ['actor','db','events','props','cents','visible','source']},'requests':s['requests'],'themeRoundtrip':{'before':profile,'after':after},'overflow':p.evaluate('document.documentElement.scrollWidth-innerWidth')}
 (OUT/(key+'.json')).write_text(json.dumps(record,ensure_ascii=False),encoding='utf8');records.append({k:record[k]for k in ['key','variant','engine','width','state','overflow']})
 fails=[r for r in data['rows']if not r['pass']]
 print(json.dumps({'capture':key,'AA_fail':len(fails)if variant=='light'else None,'overflow':record['overflow']}),flush=True)
 return record

def states(p,v,e,w):
 load(p,v,e);capture(p,v,e,w,'ready')
 # Existing buttons have hidden text at mobile widths. Select by DOM text, not coordinates.
 click(p,'Adicionar');dialog=p.locator('.fixed.inset-0').last;dialog.locator('input').first.focus();capture(p,v,e,w,'add-empty')
 fields=dialog.locator('input');fields.nth(0).fill('Instituição manual QA');fields.nth(1).fill('Renda Fixa');fields.nth(2).fill('Posição manual QA');fields.nth(3).fill('1234.56');fields.nth(4).fill('1000.01');fields.nth(5).fill('2026-10-15');fields.nth(6).fill('2027-01-20')
 fields.first.focus();capture(p,v,e,w,'add-filled');click(p,'Cancelar');assert not snap(p)['events'];capture(p,v,e,w,'add-cancel')
 row_action(p,'Editar');p.locator('.fixed.inset-0 input').first.focus();capture(p,v,e,w,'edit');click(p,'Cancelar')
 # Chart already has native keyboard interaction; compare identical focused month.
 chart=p.locator('[data-portfolio-chart]');
 if not chart.count():chart=p.locator('svg[role=img]').first.locator('..')
 points=p.locator('[data-portfolio-chart] [role=button]')
 if points.count():
  points.last.focus();p.keyboard.press('Home');capture(p,v,e,w,'chart-keyboard');p.keyboard.press('Escape');p.evaluate('document.activeElement?.blur()')
 click(p,'Importar Planilha');p.locator('.fixed.inset-0 select').first.focus();capture(p,v,e,w,'import-select');click(p,'Cancelar')
 # Destructive confirmation is cancelled, leaving the exact original database.
 p.once('dialog',lambda d:d.dismiss());row_action(p,'Excluir');capture(p,v,e,w,'delete-cancel');assert not snap(p)['events']
 if e=='v2':
  click(p,'Nova carteira');p.locator('#portfolio-name').focus();capture(p,v,e,w,'portfolio-disabled');p.locator('#portfolio-name').fill('Carteira teste QA');capture(p,v,e,w,'portfolio-filled');click(p,'Cancelar')
  p.get_by_role('button',name='Gerenciar carteira Reserva sintética QA',exact=True).click();capture(p,v,e,w,'manager');click(p,'Novo ativo');p.get_by_label('Nome do ativo',exact=True).focus();capture(p,v,e,w,'holding-empty');p.get_by_label('Nome do ativo',exact=True).fill('Ativo independente QA');capture(p,v,e,w,'holding-filled');click(p,'Cancelar');click(p,'Renomear');p.locator('#portfolio-name').focus();capture(p,v,e,w,'rename-disabled');click(p,'Cancelar');p.locator('.fixed.inset-0').last.get_by_role('button',name='Fechar',exact=True).click()
  p.locator('button[data-classification-badge]').filter(visible=True).first.click();p.locator('#classify-portfolio').focus();capture(p,v,e,w,'classification');p.locator('#classify-portfolio').select_option(label='Longo prazo QA');capture(p,v,e,w,'classification-move');click(p,'Cancelar')
  p.locator('#investment-owner').select_option(B);p.wait_for_function('(id)=>__investmentPreview.snapshot().visible.rows.length>0&&__investmentPreview.snapshot().visible.rows.every(r=>r.user_id===id)',arg=B);capture(p,v,e,w,'peer-authorized')
  assert not p.get_by_title('Editar',exact=True).filter(visible=True).count()

def assets(p,v,w):
 load(p,v,'assets',view='assets');section=p.locator('#settings-manage-assets');section.scroll_into_view_if_needed();capture(p,v,'assets',w,'table','#settings-manage-assets')
 for i,name in enumerate(['financing','consortium']):
  section.get_by_title('Ver detalhes do financiamento / consórcio').filter(visible=True).nth(i).click();capture(p,v,'assets',w,name);click(p,'Editar Ativo');capture(p,v,'assets',w,name+'-edit');click(p,'Cancelar')

def security(p,v,e,w):
 load(p,v,e);row_action(p,'Editar');p.evaluate('(id)=>__investmentPreview.auth(id)',C);p.wait_for_function('(id)=>__investmentPreview.snapshot().visible.rows.some(r=>r.user_id===id)',arg=C)
 p.mouse.move(0,0);p.evaluate('document.activeElement?.blur()');data=capture(p,v,e,w,'direct-session-edit');data['trace']=p.evaluate('__investmentPreview.trace()');(OUT/(data['key']+'-trace.json')).write_text(json.dumps(data['trace']),encoding='utf8')
 load(p,v,e);row_action(p,'Editar');p.evaluate('__investmentPreview.auth(null)');expect(p.get_by_text('Referência sem sessão autenticada.',exact=True)).to_be_visible();p.evaluate('(id)=>__investmentPreview.auth(id)',C);p.wait_for_function('(id)=>__investmentPreview.snapshot().visible.rows.some(r=>r.user_id===id)',arg=C);assert not any(x.startswith('Produto A QA')for x in snap(p)['visible']['fields']);p.mouse.move(0,0);p.evaluate('document.activeElement?.blur()');capture(p,v,e,w,'logout-login')
 if e=='v2':
  load(p,v,e);p.evaluate('(id)=>__investmentPreview.hold("detail:"+id)',B);p.locator('#investment-owner').select_option(B);p.wait_for_timeout(150);assert not snap(p)['visible']['rows'];capture(p,v,e,w,'owner-loading');p.evaluate('(id)=>__investmentPreview.release("detail:"+id)',B);p.wait_for_function('(id)=>__investmentPreview.snapshot().visible.rows.some(r=>r.user_id===id)',arg=B)
  p.evaluate('(id)=>__investmentPreview.hold("detail:"+id)',A);p.locator('#investment-owner').select_option(A);p.wait_for_timeout(150);p.locator('#investment-owner').select_option(B);p.wait_for_function('(id)=>__investmentPreview.snapshot().visible.rows.some(r=>r.user_id===id)',arg=B);p.evaluate('(id)=>__investmentPreview.release("detail:"+id)',arg=A);p.wait_for_timeout(300)
  trace=p.evaluate('__investmentPreview.trace()');assert not[f for f in trace if any(r['user_id']!=f['owner']for r in f['rows'])];capture(p,v,e,w,'owner-stale-response');(OUT/f'{e}-{w}-{v}-owner-trace.json').write_text(json.dumps(trace),encoding='utf8')

def main():
 with sync_playwright()as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts'])
  for v in ([args.variant]if args.variant else VARIANTS):
   for w,h in [(1440,1000),(390,844)]:
    p=browser.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-05T12:00:00Z');p.on('pageerror',lambda err:errors.append(str(err)))
    def fence(route):
     if route.request.url.startswith('http://127.0.0.1:5206/'):route.continue_()
     else:blocked.append(route.request.url);route.abort()
    p.route('**/*',fence)
    for e in ['legacy','v2']:
     if args.phase in ['core','all']:
      for case in CASES:
       load(p,v,e,case);r=capture(p,v,e,w,case)
       if e=='legacy':assert not any('/investment_portfolios' in x['path']or'/investment_holdings'in x['path']for x in r['requests'])
       if case=='load-error':
        p.evaluate('__investmentPreview.release("error")')
        retry=p.locator('button').filter(has_text=re.compile('^Tentar novamente$'))
        if retry.count():retry.first.click()
        else:p.locator('div.w-36').locator('..').locator('button').first.click()
        p.wait_for_function('__investmentPreview.snapshot().visible.rows.length>0');capture(p,v,e,w,'load-recovery')
     if args.phase in ['states','all']:states(p,v,e,w)
     if args.phase in ['security','all']:security(p,v,e,w)
    if args.phase in ['assets','all']:assets(p,v,w)
    p.close()
  browser.close()
 (OUT/f'run-{args.phase}-{args.variant or "all"}.json').write_text(json.dumps({'records':records,'pageErrors':errors,'blockedNetwork':blocked},ensure_ascii=False,indent=2),encoding='utf8')
 assert not errors,errors
 assert not blocked,blocked
 print(json.dumps({'captures':len(records),'pageErrors':errors,'blockedNetwork':blocked}),flush=True)

if __name__=="__main__":main()
