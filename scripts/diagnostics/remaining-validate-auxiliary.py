"""Support, help, admin and subscription presentation. All transport is synthetic."""
import runpy,json,sys
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('remaining-validate-themes.py')),run_name='remaining_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
def ack(p):
 settle(p)
 if action(p,'Entendi').count():action(p,'Entendi').click();settle(p)
def help_flow(p,v,w):
 load(p,v,'help');cap(p,v,w,'help-topics','main')
 p.locator('#help-search-input').fill('fatura');cap(p,v,w,'help-search','main');p.locator('#help-search-input').fill('inexistente QA');cap(p,v,w,'help-search-empty','main');p.locator('#help-search-input').fill('')
 topics=p.locator('[id^=help-topic-] > button');count=topics.count()
 for i in [0,min(2,count-1),min(6,count-1)]:
  topics.nth(i).click();topics.nth(i).scroll_into_view_if_needed();cap(p,v,w,f'help-article-{i}','main');topics.nth(i).click()
 guide=p.locator('#help-credit-card-guide > button');guide.click();guide.scroll_into_view_if_needed();cap(p,v,w,'help-guide','main')
 p.locator('#help-tab-new').click();cap(p,v,w,'help-new','main')
 p.get_by_placeholder('Resumo do problema...').fill('Chamado sintético novo');p.locator('textarea').fill('Descrição sintética sem informações pessoais.');cap(p,v,w,'help-draft','main')
 p.evaluate("window.__remainingPreview.hold('write:support_tickets')");action(p,'Abrir Chamado',True).click();cap(p,v,w,'help-sending','main');p.evaluate("window.__remainingPreview.release('write:support_tickets')");ack(p);cap(p,v,w,'help-created','main')
 p.locator('#help-tab-history').click();cap(p,v,w,'help-history','main')
 reply=p.get_by_placeholder('Responder...').first;reply.fill('Resposta sintética nova');cap(p,v,w,'help-reply-draft','main')
 # The original button is inside the ticket card; only this original submit is clicked.
 ticket=reply.locator('xpath=ancestor::div[contains(@class,"mt-4")][1]');ticket.get_by_role('button',name='Enviar',exact=True).click();settle(p);cap(p,v,w,'help-reply-sent','main')
 p.get_by_role('button',name='Abrir Novo Chamado',exact=True).first.click();cap(p,v,w,'help-reference-closed','main')
 load(p,v,'help','empty');p.locator('#help-tab-history').click();cap(p,v,w,'help-history-empty','main')
 load(p,v,'help','write-error');p.locator('#help-tab-new').click();p.get_by_placeholder('Resumo do problema...').fill('Falha sintética');p.locator('textarea').fill('Descrição sintética.');action(p,'Abrir Chamado',True).click();cap(p,v,w,'help-write-error');ack(p)
def admin_flow(p,v,w):
 load(p,v,'admin',admin='true');cap(p,v,w,'admin-list','main')
 p.get_by_text('Chamado_A_QA aberto',exact=True).click();cap(p,v,w,'admin-ticket','main')
 reply=p.get_by_placeholder('Digite sua resposta...');reply.fill('Resposta de suporte sintética');cap(p,v,w,'admin-reply-draft','main');action(p,'Enviar').click();settle(p);cap(p,v,w,'admin-reply-sent','main')
 p.locator('select').filter(visible=True).first.select_option('in_progress');settle(p);cap(p,v,w,'admin-status','main')
 p.get_by_placeholder('Buscar protocolo, termo...').fill('não encontrado QA');cap(p,v,w,'admin-search-empty','main');p.get_by_placeholder('Buscar protocolo, termo...').fill('')
 action(p,'Métricas').click();settle(p);cap(p,v,w,'admin-metrics','main')
 search=p.locator('input').filter(visible=True).first;search.fill('Contato_A');cap(p,v,w,'admin-crm-search','main');search.fill('sem resultado QA');cap(p,v,w,'admin-crm-empty','main')
 load(p,v,'admin','empty',admin='true');cap(p,v,w,'admin-empty','main')
def pricing_flow(p,v,w):
 load(p,v,'pricing',plan='free');cap(p,v,w,'pricing-free-annual','main');p.locator('button.h-8.w-16').click();cap(p,v,w,'pricing-free-monthly','main')
 load(p,v,'pricing',plan='free',promo='QA-SINTETICO');cap(p,v,w,'pricing-promo','main')
 load(p,v,'pricing',plan='active');cap(p,v,w,'pricing-active','main');action(p,'Fazer Upgrade Vitalício').click();cap(p,v,w,'pricing-warning');cancel(p);cap(p,v,w,'pricing-cancelled','main')
 load(p,v,'pricing','sold-out',plan='free');cap(p,v,w,'pricing-sold-out','main')
 load(p,v,'success',plan='active');cap(p,v,w,'payment-success','main')
def run_aux(probe=False):
 with sync_playwright()as pw:
  b=pw.chromium.launch(channel='msedge',headless=True,args=RENDER_ARGS)
  for w,h in [(1440,1000),(390,844)]:
   for v in ['light']if probe else VARIANTS:
    p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.clock.set_fixed_time('2026-11-06T12:00:00Z');errors=[];p.on('pageerror',lambda e:errors.append(str(e)));p.route('**/*',lambda r:r.continue_()if r.request.url.startswith('http://127.0.0.1:5207/')else r.abort())
    for fn in [help_flow,admin_flow,pricing_flow]:fn(p,v,w)
    assert not errors,errors;p.close()
  b.close()
 if not probe:return compare('4c2')
 failures=[{'state':r['state'],'width':r['width'],**row}for r in RESULTS for row in r['audit']['rows']if not row['pass']];(OUT/'4c2-probe.json').write_text(json.dumps({'captures':len(RESULTS),'failures':failures},indent=2),encoding='utf8');print(json.dumps({'probe':len(RESULTS),'failures':failures},ensure_ascii=True));return{'issues':failures}
if __name__=='__main__':
 r=run_aux('--probe'in sys.argv);sys.exit(bool(r['issues']))
