"""Small controls that distinguish approved-baseline behavior from 4D changes."""
import json
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend,fixture
from integrated_validate_helpers import launch,boot,OUT

def run():
 rows=[]
 with sync_playwright()as pw:
  for baseline in['reviewed',None]:
   b=launch(pw,'firefox');backend=Backend();context=b.new_context(viewport={'width':1440,'height':1000});context.route('**/*',backend.route);p=context.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)));boot(p,baseline=baseline);rows.append({'scenario':'firefox-native-sdk-lock','baseline':baseline or'current','status':'FAIL'if errors else'PASS','errors':errors,'actor':p.evaluate('window.__integratedQa.snapshot().actor')});context.close();b.close()
   for kind in['investment-read-error','inconsistent-financing-seed']:
    b=launch(pw,'edge');backend=Backend(seed=fixture())if kind=='inconsistent-financing-seed'else Backend()
    if kind=='investment-read-error':backend.fail.add('read:investments')
    context=b.new_context(viewport={'width':390,'height':844});context.route('**/*',backend.route);p=context.new_page();p.clock.set_fixed_time('2026-11-06T12:00:00Z');boot(p,baseline=baseline,view='investments'if kind=='investment-read-error'else'dashboard');financial=[w for w in backend.writes if w['kind']=='data'and w['table']!='product_events'];alerts=p.get_by_role('alert').filter(visible=True).count();rows.append({'scenario':kind,'baseline':baseline or'current','status':'FAIL'if kind=='investment-read-error'and not alerts else'PASS','visibleAlerts':alerts,'financialWriteAttemptsBeforeTheme':financial,'transportDeniedAllFinancialWrites':True});p.screenshot(path=str(OUT/f'risk-{kind}-{baseline or"current"}.png'));context.close();b.close()
 (OUT/'legacy-risk-controls.json').write_text(json.dumps({'cases':rows},ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(rows,ensure_ascii=True));return rows
if __name__=='__main__':run()
