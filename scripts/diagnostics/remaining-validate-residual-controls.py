"""Four-reference native/support states and current DOM-only accessibility probes."""
import runpy,json,sys
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('remaining-validate-globals.py')),run_name='remaining_global_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
EXTRA=r'''
 for(const el of document.querySelectorAll('[data-finance~="remaining-pin-dot"]')){const s=getComputedStyle(el);add('pin-essential',el.className,ratio(rgba(s.borderColor),bg(el.parentElement)),3)}
 for(const el of document.querySelectorAll('[data-finance~="remaining-avatar"]')){
  const original=el.style.backgroundColor;
  for(let h=0;h<360;h++){el.style.backgroundColor=`hsl(${h},50%,40%)`;const s=getComputedStyle(el),stops=s.backgroundImage.match(/rgba?\([^)]+\)/g);if(!stops||stops.length!==2||stops[0]!==stops[1])throw Error('Unexpected avatar gradient');add('avatar-hue',h,ratio(rgba(s.color),blend(rgba(stops[0]),rgba(s.backgroundColor))),4.5)}
  el.style.backgroundColor=original;
 }
 for(const el of root.querySelectorAll('input[type="checkbox"],input[type="radio"]'))if(shown(el))add('native-accent',el.type,ratio(rgba(getComputedStyle(el).accentColor),bg(el)),3);
 const field=root.querySelector('#support-description');if(field){const s=getComputedStyle(field,'::selection');add('selection','support description',ratio(rgba(s.color),rgba(s.backgroundColor)),4.5)}
'''

def run_residual():
 extras=[];keyboard=[]
 with sync_playwright()as pw:
  b=pw.chromium.launch(channel='msedge',headless=True,args=RENDER_ARGS)
  for w,h in[(1440,1000),(390,844)]:
   for v in VARIANTS:
    p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.route('**/*',routing);p.clock.set_fixed_time('2026-11-06T12:00:00Z')
    load(p,v,'help');action(p,'Novo Chamado').click();p.get_by_placeholder('Resumo do problema...').fill('Assunto sintético');p.get_by_placeholder('Descreva o que aconteceu, passos para reproduzir, etc...').fill('Descrição sintética');p.locator('input[type=file]').first.set_input_files({'name':'synthetic.txt','mimeType':'text/plain','buffer':b'synthetic closed fixture'})
    cap(p,v,w,'residual-file-consent-unchecked');p.get_by_role('checkbox').check();cap(p,v,w,'residual-file-consent-checked')
    if v=='light':
     audit=p.evaluate(AUDIT_JS.replace('return {rows,geometry,content,colors,svgPaint,money};',EXTRA+'return {rows,geometry,content,colors,svgPaint,money};'));extras.extend({'width':w,**r}for r in audit['rows']if r['kind']in['native-accent','selection','avatar-hue']);assert all(r['pass']for r in extras)
     load(p,v,'goals',lock='on');audit=p.evaluate(AUDIT_JS.replace('return {rows,geometry,content,colors,svgPaint,money};',EXTRA+'return {rows,geometry,content,colors,svgPaint,money};'));extras.extend({'width':w,**r}for r in audit['rows']if r['kind']=='pin-essential');assert all(r['pass']for r in extras)
    load(p,v,'admin',admin='true');p.evaluate("window.__remainingPreview.hold('rpc:get_admin_metrics')");action(p,'Métricas').click();p.get_by_text('Carregando métricas do CRM...',exact=True).wait_for();cap(p,v,w,'residual-admin-metrics-loading');p.evaluate("window.__remainingPreview.release('rpc:get_admin_metrics')");settle(p)
    if v in['dark','light']:
     load(p,v,'pricing',plan='active');trigger=action(p,"Fazer Upgrade Vitalício",False);trigger.click();dialog=p.get_by_role('dialog',name='Atenção ao Upgrade');dialog.wait_for();cancel=dialog.get_by_role('button',name='Cancelar');p.wait_for_function("document.activeElement?.textContent.trim()==='Cancelar'");p.keyboard.press('Shift+Tab');assert p.evaluate("document.activeElement.textContent.trim()")=='Entendi, quero continuar';p.keyboard.press('Tab');assert cancel.evaluate('e=>e===document.activeElement');cancel.hover();audit=p.evaluate(AUDIT_JS)
     image=f'residual-pricing-keyboard-{w}-{v}.png';p.screenshot(path=str(OUT/image))
     if v=='light':extras.extend({'width':w,**r}for r in audit['rows'])
     p.keyboard.press('Escape');assert dialog.count()==0 and trigger.evaluate('e=>e===document.activeElement');keyboard.append({'width':w,'variant':v,'image':image,'focusTrapEscapeRestore':True,'checkoutRequests':0})
    p.close()
  b.close()
 report=compare('4c3-residual');report['extraComputedAA']=extras;report['keyboard']=keyboard;report['issues'].extend({'kind':'extra-aa',**r}for r in extras if not r['pass']);(OUT/'4c3-residual-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');assert not report['issues'],report['issues']
 return report
if __name__=='__main__':run_residual()
