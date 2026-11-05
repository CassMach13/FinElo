"""Compare the five shared components with a Git baseline on the same Vite server."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlencode

from playwright.sync_api import expect, sync_playwright

here = Path(__file__).resolve().parent
repo = here.parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=5198)
parser.add_argument('--base', default='6fa1188')
parser.add_argument('--out-dir', type=Path, required=True)
args = parser.parse_args()
args.out_dir.mkdir(parents=True, exist_ok=True)
origin = f'http://127.0.0.1:{args.port}'
page_url = origin + '/scripts/diagnostics/theme-preview.html'
checks = {}
components = ('Button', 'Card', 'Input', 'Modal', 'Select')


def make_baseline(directory):
    for name in components:
        source = subprocess.check_output(
            ['git', 'show', f'{args.base}:src/components/ui/{name}.tsx'], cwd=repo
        )
        (directory / f'{name}.tsx').write_bytes(source)
    source = (repo / 'src/components/appearance/AppearanceReference.tsx').read_text(encoding='utf-8')
    source = source.replace('../../domain/', '../../../src/domain/')
    source = source.replace('../ui/', './').replace('./appearance.css', '../../../src/components/appearance/appearance.css')
    (directory / 'AppearanceReference.tsx').write_text(source, encoding='utf-8')


def capture(page, theme, baseline=None):
    params = {'theme': theme}
    if baseline:
        params['baseline'] = baseline
    page.goto(page_url + '?' + urlencode(params), wait_until='networkidle', timeout=90000)
    expect(page.locator('[data-finelo-theme]')).to_have_attribute('data-finelo-theme', theme)
    expect(page.get_by_label('Descrição')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    form = page.screenshot(animations='disabled')
    page.get_by_role('button', name='Abrir modal').click()
    expect(page.get_by_role('heading', name='Exemplo de modal')).to_be_visible()
    expect(page.get_by_role('button', name='Fechar')).to_be_focused()
    modal = page.screenshot(animations='disabled')
    page.keyboard.press('Tab')
    expect(page.get_by_role('button', name='Fechar')).to_be_focused()
    page.keyboard.press('Escape')
    expect(page.get_by_role('button', name='Abrir modal')).to_be_focused()
    return form, modal


with tempfile.TemporaryDirectory(dir=here, prefix='theme-baseline-') as work, sync_playwright() as pw:
    directory = Path(work)
    make_baseline(directory)
    browser = pw.chromium.launch(channel='msedge', headless=True)
    ctx = browser.new_context(color_scheme='dark', device_scale_factor=1, service_workers='block')
    ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
    page = ctx.new_page()
    for label, width, height in [('desktop', 1440, 900), ('mobile', 390, 844)]:
        page.set_viewport_size({'width': width, 'height': height})
        before = capture(page, 'dark', directory.name)
        dark = capture(page, 'dark')
        light = capture(page, 'light')
        assert dark == before, (label, 'Escuro difere do baseline')
        for theme, images in [('escuro', dark), ('claro', light)]:
            for state, png in zip(('formulario', 'modal'), images):
                (args.out_dir / f'{label}-{theme}-{state}.png').write_bytes(png)
        checks[label] = {'identical_dark': True, 'sha256': [hashlib.sha256(png).hexdigest() for png in dark]}

    page.goto(page_url + '?theme=system', wait_until='networkidle')
    expect(page.locator('[data-finelo-theme]')).to_have_attribute('data-finelo-theme', 'dark')
    page.emulate_media(color_scheme='light')
    expect(page.locator('[data-finelo-theme]')).to_have_attribute('data-finelo-theme', 'light')
    expect(page.get_by_label('Data')).to_have_css('color-scheme', 'light')
    page.goto(page_url + '?theme=dark', wait_until='networkidle')
    expect(page.locator('[data-finelo-theme]')).to_have_attribute('data-finelo-theme', 'dark')
    expect(page.get_by_label('Data')).to_have_css('color-scheme', 'dark')
    checks['system_change'] = True
    browser.close()

print(json.dumps(checks, indent=2))
