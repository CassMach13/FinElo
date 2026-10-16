"""Local synthetic UI checks. All non-localhost requests are blocked."""
import argparse
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--out-dir', type=Path, default=Path(os.environ['TEMP']) / 'finelo-net-worth-ui')
args = parser.parse_args()
out = args.out_dir
out.mkdir(parents=True, exist_ok=True)
checks, layouts, requests_outside_localhost = [], [], []
base = 'http://127.0.0.1:4181/'

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def local_only(route):
        if route.request.url.startswith(base):
            route.continue_()
        else:
            requests_outside_localhost.append(route.request.url.split('?')[0])
            route.abort()

    page.route('**/*', local_only)
    page.goto(base + 'scripts/diagnostics/net-worth-preview.html', wait_until='domcontentloaded', timeout=90000)
    page.locator('[data-net-worth-total]').wait_for(state='visible', timeout=60000)
    page.wait_for_load_state('networkidle')
    scenario = page.get_by_role('combobox', name='Cenário')
    card = page.locator('[data-net-worth-v2]').locator('..')
    disclosure = page.locator('[data-net-worth-details]')
    expected_components = [
        ('Saldo bancário', 'R$ 201,43'),
        ('Benefícios de uso restrito', 'R$ 674,85'),
        ('Investimentos', 'R$ 78.810,73'),
        ('Bens patrimoniais líquidos', 'R$ 75.500,00'),
        ('Obrigações de cartões', '-R$ 7.437,11'),
    ]

    for label, width, height in [('desktop', 1280, 1100), ('mobile', 390, 844), ('narrow', 320, 812)]:
        page.set_viewport_size({'width': width, 'height': height})
        scenario.select_option('pilot')
        assert '147.749,90' in page.locator('[data-net-worth-total]').inner_text()
        assert '7.235,68' in page.locator('[data-available-after-overdue]').inner_text()
        rows = page.locator('[data-net-worth-components] > div')
        actual = [(r.locator('dt').inner_text(), r.locator('dd').first.inner_text().replace('\u00a0', ' ')) for r in rows.all()]
        assert actual == expected_components, actual
        assert not disclosure.evaluate('(el) => el.open')
        assert not page.get_by_text('Saldo efetivo das contas, inclusive quando negativo.', exact=True).is_visible()
        assert page.get_by_text('Vencidas: R$ 7.437,11 · A vencer: R$ 0,00.').is_visible()
        assert page.get_by_text('Saldo negativo após vencidas', exact=True).is_visible()
        before = page.locator('[data-net-worth-total]').inner_text()
        page.get_by_label('Comparação operacional', exact=True).check()
        assert page.locator('[data-net-worth-total]').inner_text() == before
        page.get_by_label('Comparação operacional', exact=True).uncheck()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        card.screenshot(path=str(out / ('after-' + label + '.png')))
        layouts.append({'layout': label, 'height': round(card.bounding_box()['height']), 'width': width})

        # Native disclosure supports keyboard and leaves financial values intact.
        disclosure.locator('summary').focus()
        page.keyboard.press('Enter')
        assert disclosure.evaluate('(el) => el.open')
        assert page.get_by_text('Cartão sintético:', exact=True).is_visible()
        assert page.get_by_text('Saldo efetivo das contas, inclusive quando negativo.', exact=True).is_visible()
        assert page.locator('[data-net-worth-total]').inner_text() == before
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        if label != 'narrow':
            card.screenshot(path=str(out / ('expanded-' + label + '.png')))
        disclosure.locator('summary').focus()
        page.keyboard.press('Space')
        assert not disclosure.evaluate('(el) => el.open')
        checks.append(label + ':keyboard-disclosure')

        for name in ['negative', 'future', 'paid', 'partial', 'reconciliation', 'loading', 'error']:
            scenario.select_option(name)
            if name in ['partial', 'loading', 'error']:
                assert page.locator('[data-net-worth-total]').inner_text() == '—'
            if name == 'negative':
                assert '-R$' in rows.first.locator('dd').inner_text()
            if name == 'future':
                assert '201,43' in page.locator('[data-available-after-overdue]').inner_text()
                assert not page.get_by_text('Saldo negativo após vencidas', exact=True).count()
            if name == 'paid':
                assert '155.187,01' in page.locator('[data-net-worth-total]').inner_text()
            if name == 'reconciliation':
                assert page.get_by_text('Conciliação pendente', exact=True).is_visible()
            if name == 'error':
                page.get_by_role('button', name='Tentar novamente').focus()
                page.keyboard.press('Enter')
                assert '147.749,90' in page.locator('[data-net-worth-total]').inner_text()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), (label, name)
            checks.append(label + ':' + name)

        scenario.select_option('pilot')
        page.get_by_label('Flag V2 desligada', exact=True).check()
        assert page.get_by_text('Patrimônio total', exact=True).is_visible()
        assert page.locator('[data-net-worth-v2]').count() == 0
        page.get_by_label('Flag V2 desligada', exact=True).uncheck()
        checks.append(label + ':legacy-off')

    page.set_viewport_size({'width': 1280, 'height': 1100})
    page.evaluate("document.body.style.zoom='2'")
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    card.screenshot(path=str(out / 'after-zoom-200.png'))
    assert not errors, errors
    assert not requests_outside_localhost, requests_outside_localhost
    browser.close()

result = {'checks': checks, 'layouts': layouts, 'zoom': '200%', 'pageErrors': errors, 'network': 'localhost only'}
(out / 'browser-results.json').write_text(json.dumps(result, indent=2), encoding='utf8')
print(json.dumps(result))
