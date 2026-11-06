"""Synthetic residual keyboard, native-control and consent lifetime evidence."""
import runpy,json,sys
from pathlib import Path
ctx=runpy.run_path(str(Path(__file__).with_name('remaining-validate-globals.py')),run_name='remaining_global_tools');globals().update({k:v for k,v in ctx.items()if not k.startswith('__')})
checks=[]
A='10000000-0000-4000-8000-000000000001';B='10000000-0000-4000-8000-000000000002'

def record(name,v,w,**details):
 checks.append({'scenario':name,'variant':v,'width':w,'pass':True,**details});print(json.dumps(checks[-1]),flush=True)

def bottom(p):
 region=p.get_by_role('region',name='Texto dos Termos e Condições');region.focus();p.keyboard.press('Control+End');p.wait_for_timeout(150)
 # Native keyboard scrolling is exercised; event also settles deterministic scroll state.
 region.evaluate("e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll',{bubbles:true}))}")

def no_finance(p,before):
 after=p.evaluate('window.__remainingPreview.snapshot()');assert before['db']==after['db'] and before['events']==after['events']

def run_interactions():
 with sync_playwright()as pw:
  b=pw.chromium.launch(channel='msedge',headless=True,args=RENDER_ARGS)
  for w,h in[(1440,1000),(390,844)]:
   for v in['dark','light']:
    p=b.new_page(viewport={'width':w,'height':h},timezone_id='America/Sao_Paulo');p.route('**/*',routing);p.clock.set_fixed_time('2026-11-06T12:00:00Z')
    load(p,v,'goals');before=p.evaluate('window.__remainingPreview.snapshot()')
    menu=action(p,'Menu da conta').filter(visible=True).first;menu.focus();p.keyboard.press('Enter');assert menu.get_attribute('aria-expanded')=='true';p.keyboard.press('Tab');p.keyboard.press('Escape');assert menu.get_attribute('aria-expanded')=='false' and menu.evaluate('e=>e===document.activeElement');record('account-menu-keyboard-escape-focus',v,w);no_finance(p,before)
    load(p,v,'goals',terms='readonly');bottom(p);cap(p,v,w,'residual-terms-keyboard');action(p,'Fechar',exact=True).last.click();assert p.get_by_role('region',name='Texto dos Termos e Condições').count()==0;record('terms-keyboard-readonly-close',v,w)
    for outcome in ['success','error','switch','logout']:
     load(p,v,'goals',terms='required');accept=action(p,'Li e Concordo com os Termos');assert accept.is_disabled();before=p.evaluate('window.__remainingPreview.snapshot()');bottom(p);assert accept.is_enabled()
     key='profile:'+A
     if outcome=='error':p.evaluate('(k)=>window.__remainingPreview.fail(k)',key)
     else:p.evaluate('(k)=>window.__remainingPreview.hold(k)',key)
     dialogs=[]
     def on_dialog(d):dialogs.append(d.message);d.dismiss()
     p.on('dialog',on_dialog);accept.click();settle(p)
     if outcome=='error':assert dialogs and p.get_by_role('region',name='Texto dos Termos e Condições').count()==1 and accept.is_enabled()
     else:
      assert action(p,'Processando...').is_disabled()
      if outcome in ['switch','logout']:
       p.evaluate('(id)=>window.__remainingPreview.auth(id)',B if outcome=='switch'else None);settle(p)
      p.evaluate('(k)=>window.__remainingPreview.release(k)',key);settle(p)
      snap=p.evaluate('window.__remainingPreview.snapshot()')
      if outcome=='switch':assert snap['actor']==B and not snap['sources']['user']['user_metadata'].get('terms_accepted_version') and action(p,'Li e Concordo com os Termos').is_disabled()
      elif outcome=='logout':assert snap['actor']is None and p.get_by_role('region',name='Texto dos Termos e Condições').count()==0
      else:assert snap['sources']['user']['user_metadata']['terms_accepted_version']=='v_2026_03_17_consumer_rights' and p.get_by_role('region',name='Texto dos Termos e Condições').count()==0
     no_finance(p,before);p.remove_listener('dialog',on_dialog);record('terms-confirmation-'+outcome,v,w)
    load(p,v,'help');action(p,'Novo Chamado',True).click();p.locator('#support-subject').fill('Assunto sintético');p.locator('#support-description').fill('Descrição sintética');p.locator('#support-attachment').set_input_files({'name':'synthetic.txt','mimeType':'text/plain','buffer':b'synthetic closed fixture'})
    assert action(p,'Abrir Chamado',exact=True).is_disabled();cap(p,v,w,'residual-attachment-consent-unchecked');p.get_by_role('checkbox').check();assert action(p,'Abrir Chamado',exact=True).is_enabled();p.locator('#support-description').focus();p.keyboard.press('Tab');cap(p,v,w,'residual-attachment-consent-keyboard');record('attachment-consent-selection-disabled-native-focus',v,w)
    if v=='light':
     values=p.locator('#support-attachment').evaluate("e=>{const s=getComputedStyle(e,'::file-selector-button');return{color:s.color,background:s.backgroundColor}}")
     assert values['color']!='rgb(34, 211, 238)' and values['background']!='rgba(6, 182, 212, 0.1)';record('file-selector-semantic-pseudo',v,w,computed=values)
    load(p,v,'goals',lock='on');cap(p,v,w,'residual-pin-keyboard');action(p,'5').focus();p.keyboard.press('Enter');assert p.locator('[data-finance~=remaining-pin-dot][class~=bg-highlight]').count()==1
    action(p,'Apagar último dígito',False).click();record('pin-native-button-keyboard-backspace',v,w)
    load(p,v,'goals',pwa='update');before=p.evaluate('window.__remainingPreview.snapshot()');action(p,'Atualizar Agora',False).click();assert p.evaluate('window.__syntheticUpdateRequests')==1;no_finance(p,before);record('pwa-update-intent-only-no-os-install',v,w)
    p.close()
  b.close()
 failures=[{'state':r['state'],'width':r['width'],**row}for r in RESULTS if r['variant']=='light'for row in r['audit']['rows']if not row['pass']]
 report={'checks':checks,'captures':len(RESULTS),'AA':[{'state':r['state'],'width':r['width'],**row}for r in RESULTS if r['variant']=='light'for row in r['audit']['rows']],'failures':failures};(OUT/'4c3-interactions.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');assert not failures,failures
 return report

if __name__=='__main__':run_interactions()
