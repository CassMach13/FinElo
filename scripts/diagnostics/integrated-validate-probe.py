"""Small actual-App probe before the bounded integrated matrix."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
from integrated_fixture_backend import Backend

OUT=Path('node_modules/.finelo-cycle4d-tools/evidence');OUT.mkdir(exist_ok=True)
with sync_playwright()as pw:
 backend=Backend();b=pw.chromium.launch(channel='msedge',headless=True);context=b.new_context(viewport={'width':1440,'height':1000});context.route('**/*',backend.route);p=context.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 p.goto('http://127.0.0.1:5209/scripts/diagnostics/integrated-preview.html?login=a',wait_until='networkidle',timeout=120000);p.wait_for_function('window.__integratedQa!==undefined');p.wait_for_timeout(1000);p.screenshot(path=str(OUT/'probe.png'))
 print(json.dumps({'text':p.locator('body').inner_text()[:3500],'snapshot':p.evaluate('window.__integratedQa.snapshot()'),'errors':errors,'unknown':[c for c in backend.calls if c['path'].startswith('/rest/v1/')and'/rpc/'not in c['path']and c['path'].split('/')[-1]not in backend.db]},ensure_ascii=True),flush=True)
 p.evaluate("async()=>{await window.__integratedQa.theme('light')}");p.wait_for_timeout(750);p.screenshot(path=str(OUT/'probe-light.png'));print(json.dumps({'theme':p.locator('[data-qa-eligible]').get_attribute('data-finelo-theme'),'errors':errors,'writes':backend.writes},ensure_ascii=True),flush=True);b.close()
