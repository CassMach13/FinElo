import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(os.environ['TEMP'])/'finelo-net-worth-ui'
out.mkdir(exist_ok=True)
checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.route('**/*',lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:4181/') else route.abort())
    page.goto('http://127.0.0.1:4181/scripts/diagnostics/net-worth-preview.html',wait_until='domcontentloaded',timeout=90000)
    page.wait_for_load_state('networkidle')
    scenario=page.get_by_role('combobox',name='Cenário')
    for label,width,height in [('desktop',1280,1100),('mobile',390,844)]:
        page.set_viewport_size({'width':width,'height':height})
        scenario.select_option('pilot')
        assert '147.749,90' in page.locator('[data-net-worth-total]').inner_text()
        assert '7.235,68' in page.locator('[data-available-after-overdue]').inner_text()
        before=page.locator('[data-net-worth-total]').inner_text()
        page.get_by_label('Comparação operacional',exact=True).check()
        assert page.locator('[data-net-worth-total]').inner_text()==before
        page.get_by_label('Comparação operacional',exact=True).uncheck()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.screenshot(path=str(out/('current-'+label+'.png')),full_page=True)
        for name in ['negative','future','paid','partial','reconciliation','loading','error']:
            scenario.select_option(name)
            if name in ['partial','loading','error']:
                assert page.locator('[data-net-worth-total]').inner_text()=='—'
            if name=='future':
                assert '201,43' in page.locator('[data-available-after-overdue]').inner_text()
            if name=='paid':
                assert '155.187,01' in page.locator('[data-net-worth-total]').inner_text()
            if name=='reconciliation':
                assert page.get_by_text('Conciliação pendente:',exact=False).is_visible()
            if name=='error':
                page.get_by_role('button',name='Tentar novamente').focus()
                page.keyboard.press('Enter')
                assert '147.749,90' in page.locator('[data-net-worth-total]').inner_text()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            checks.append(label+':'+name)
        scenario.select_option('pilot')
        page.get_by_text('Ver cartões e origem dos valores',exact=True).click()
        assert page.get_by_text('Cartão sintético:',exact=False).is_visible()
        page.get_by_label('Flag V2 desligada',exact=True).check()
        assert page.get_by_text('Patrimônio total',exact=True).is_visible()
        assert page.locator('[data-net-worth-v2]').count()==0
        page.get_by_label('Flag V2 desligada',exact=True).uncheck()
    page.set_viewport_size({'width':1280,'height':1100})
    page.evaluate("document.body.style.zoom='2'")
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path=str(out/'current-zoom-200.png'),full_page=True)
    assert not errors,errors
    browser.close()
result={'checks':checks,'layouts':['desktop','mobile','200% zoom'],'pageErrors':errors,'network':'localhost only'}
(out/'browser-results.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result))
