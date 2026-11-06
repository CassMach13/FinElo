"""Pixel parity against main primitives, computed contrast and print/PDF, with no external requests."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlencode
import pymupdf
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
checks = {'base': args.base, 'viewports': {}, 'contrast': {}}
components = ('Button', 'Card', 'Input', 'Modal', 'Select', 'SummaryCard', 'MultiSelect', 'Skeleton', 'ProgressBar', 'NavItem', 'GlobalDialog', 'icons')


def git_source(path):
    return subprocess.check_output(['git', 'show', f'{args.base}:{path}'], cwd=repo).decode('utf-8')


def make_baseline(directory):
    for name in components:
        source = git_source(f'src/components/ui/{name}.tsx')
        if name == 'GlobalDialog':
            # Dependency injection only, so the original main component uses the isolated fixture store.
            source = source.replace("../../hooks/useDialogStore", "../../../src/hooks/useDialogStore")
            source = source.replace('React.FC = () =>', 'React.FC<{ dialogStore?: typeof useDialogStore }> = ({ dialogStore = useDialogStore }) =>')
            source = source.replace('= useDialogStore();', '= dialogStore();')
        (directory / f'{name}.tsx').write_text(source, encoding='utf-8')
    source = git_source('src/components/views/UserAccountWidget.tsx')
    source = source.replace('../../hooks/', '../../../src/hooks/').replace('../../Avatar', '../../../src/Avatar').replace('../ui/icons', './icons')
    (directory / 'UserAccountWidget.tsx').write_text(source, encoding='utf-8')
    # Extract actual main shell classes, rather than inventing a baseline for the new presentation component.
    source = git_source('src/layouts/MainLayout.tsx')
    tags = [r'<div id="main-layout" className="([^"]+)"', r'<header className="([^"]+)"',
            r'<div className="(flex-1 flex flex-col landscape:[^"]+)"', r'<nav className="([^"]+)"',
            r'<main id="main-content" className="([^"]+)"']
    root, header, layout, nav, content = [re.search(p, source).group(1) for p in tags]
    shell = f'''export default function AuthenticatedShell({{header,navigation,children,overlays,idPrefix=""}}) {{ return (
      <div id={{idPrefix+"main-layout"}} className="{root}"><header className="{header}">{{header}}</header>
      <div className="{layout}"><nav className="{nav}">{{navigation}}</nav>
      <main id={{idPrefix+"main-content"}} className="{content}">{{children}}</main></div>{{overlays}}</div>); }}'''
    (directory / 'AuthenticatedShell.tsx').write_text(shell, encoding='utf-8')
    source = (repo / 'src/components/appearance/AppearanceReference.tsx').read_text(encoding='utf-8')
    source = source.replace('../../domain/', '../../../src/domain/').replace('../../hooks/', '../../../src/hooks/')
    source = source.replace('../../layouts/AuthenticatedShell', './AuthenticatedShell').replace('../views/UserAccountWidget', './UserAccountWidget')
    source = source.replace('../ui/', './').replace('./appearance.css', '../../../src/components/appearance/appearance.css')
    (directory / 'AppearanceReference.tsx').write_text(source, encoding='utf-8')


def load(page, theme, baseline=None, freeze=True):
    params = {'theme': theme}
    if baseline:
        params['baseline'] = baseline
    page.goto(page_url + '?' + urlencode(params), wait_until='networkidle', timeout=90000)
    expect(page.get_by_label('Descrição')).to_be_visible()
    if freeze:
        page.add_style_tag(content='*,*::before,*::after { animation:none!important; transition:none!important; caret-color:transparent!important; }')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def shot(page):
    page.mouse.move(0, 0)
    return page.screenshot(animations='disabled')


def capture(page, theme, baseline=None):
    load(page, theme, baseline)
    result = {'formulario': shot(page)}
    page.get_by_label('Descrição', exact=True).focus()
    result['foco'] = shot(page)
    page.get_by_label('Descrição', exact=True).blur()
    page.get_by_role('button', name='Secundário', exact=True).hover()
    result['hover'] = page.screenshot(animations='disabled')
    page.mouse.move(0,0)
    # The baseline MultiSelect has no accessible label association yet.
    page.get_by_text('1 selecionada(s)', exact=True).click()
    expect(page.get_by_text('Selecionar Todas', exact=True)).to_be_visible()
    result['multiselect'] = shot(page)
    page.get_by_text('1 selecionada(s)', exact=True).click()
    page.get_by_text('Saldo da amostra', exact=True).evaluate("el => el.scrollIntoView({block:'start'})")
    result['resumos'] = shot(page)
    page.get_by_role('heading', name='Estados de carregamento e progresso').evaluate("el => el.scrollIntoView({block:'start'})")
    result['carregamento'] = shot(page)
    page.get_by_role('button', name='Abrir modal', exact=True).click()
    expect(page.get_by_role('heading', name='Exemplo de modal')).to_be_visible()
    expect(page.get_by_role('button', name='Fechar', exact=True)).to_be_focused()
    result['modal'] = shot(page)
    page.keyboard.press('Tab')
    expect(page.get_by_role('button', name='Fechar', exact=True)).to_be_focused()
    page.keyboard.press('Escape')
    expect(page.get_by_role('button', name='Abrir modal', exact=True)).to_be_focused()
    page.get_by_role('button', name='Abrir diálogo', exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    # Compare identical focus states; main did not move focus into GlobalDialog automatically.
    page.get_by_role('dialog').get_by_role('button').first.focus()
    result['dialogo'] = shot(page)
    if not baseline:
        page.keyboard.press('Shift+Tab')
        expect(page.get_by_role('button', name='Confirmar', exact=True)).to_be_focused()
        page.keyboard.press('Tab')
        expect(page.get_by_role('dialog').get_by_role('button').first).to_be_focused()
    page.keyboard.press('Escape')
    page.locator('button:has(div.rounded-full):visible').click()
    expect(page.get_by_role('button', name='Gerenciar Conta', exact=True)).to_be_visible()
    result['menu-conta'] = shot(page)
    return result


contrast_js = r'''() => {
  const channels = s => (s.match(/[\d.]+/g)||[]).map(Number);
  const blend = (a,b) => a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
  const bg = el => { const c=channels(getComputedStyle(el).backgroundColor); return blend(c,el.parentElement?bg(el.parentElement):[255,255,255]); };
  const lum = c => c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const ratio = (a,b) => { const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  const parts=['title','muted','summary-label','summary-value','delta','error','button','control','nav-item','badge','tooltip'];
  const rows=[];
  for(const el of document.querySelectorAll('[data-appearance-part]')) {
    const part=el.dataset.appearancePart, s=getComputedStyle(el);
    if(!parts.includes(part)||!el.getClientRects().length||s.visibility==='hidden'||!el.textContent.trim()&&!el.matches('input,select'))continue;
    let back=bg(el),front=blend(channels(s.color),back);
    let r=ratio(front,back);
    const gradients=s.backgroundImage.match(/rgba?\([^)]+\)/g);
    if(gradients)r=Math.min(...gradients.map(c=>ratio(front,blend(channels(c),back))));
    const opacity=Number(s.opacity); if(opacity<1)r=ratio(front.map((v,i)=>v*opacity+back[i]*(1-opacity)),back);
    rows.push({part,text:(el.value||el.textContent.trim()).slice(0,45),ratio:+r.toFixed(3),threshold:4.5,pass:r>=4.5});
  }
  for(const el of document.querySelectorAll('[data-appearance-part="control"], [data-appearance-part="progress-fill"]')) {
    const s=getComputedStyle(el), fill=el.dataset.appearancePart==='progress-fill';
    const r=fill?ratio(bg(el),bg(el.parentElement)):ratio(blend(channels(s.borderTopColor),bg(el)),bg(el));
    rows.push({part:fill?'progress-boundary':'control-boundary',text:el.id,ratio:+r.toFixed(3),threshold:3,pass:r>=3});
  }
  const active=document.activeElement;
  if(active && active.matches(':focus-visible') && getComputedStyle(active).outlineStyle!=='none') {
    const r=ratio(channels(getComputedStyle(active).outlineColor),bg(active.parentElement));
    rows.push({part:'focus-indicator',text:active.id,ratio:+r.toFixed(3),threshold:3,pass:r>=3});
  }
  return rows;
}'''


with tempfile.TemporaryDirectory(dir=here, prefix='theme-baseline-') as work, sync_playwright() as pw:
    directory = Path(work)
    make_baseline(directory)
    browser = pw.chromium.launch(channel='msedge', headless=True)
    ctx = browser.new_context(color_scheme='dark', device_scale_factor=1, service_workers='block')
    ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    for label, width, height in [('desktop', 1440, 900), ('mobile', 390, 844)]:
        page.set_viewport_size({'width': width, 'height': height})
        before = capture(page, 'dark', directory.name)
        dark = capture(page, 'dark')
        light = capture(page, 'light')
        assert dark == before, (label, 'Escuro difere do baseline', [k for k in dark if dark[k] != before[k]])
        for theme, images in [('escuro', dark), ('claro', light)]:
            for state, png in images.items():
                (args.out_dir / f'{label}-{theme}-{state}.png').write_bytes(png)
        checks['viewports'][label] = {'identical_dark': True, 'states': list(dark), 'sha256': {k:hashlib.sha256(v).hexdigest() for k,v in dark.items()}}
        for theme in ['dark', 'light']:
            load(page, theme)
            rows=page.evaluate(contrast_js)
            checks['contrast'][label+'-'+theme]=rows
            if theme=='light':
                assert all(r['pass'] for r in rows), [r for r in rows if not r['pass']]
                def measured(state):
                    sample=page.evaluate(contrast_js)
                    checks['contrast'][label+'-'+state]=sample
                    assert all(r['pass'] for r in sample), (state,[r for r in sample if not r['pass']])
                for name in ['Abrir modal','Secundário','Contorno','Discreto']:
                    page.get_by_role('button', name=name, exact=True).hover()
                    measured('hover-'+name)
                page.mouse.move(0,0)
                for name in ['Descrição','Campo inválido','Data']:
                    page.get_by_label(name, exact=True).focus()
                    expect(page.get_by_label(name, exact=True)).to_have_css('outline-width','2px')
                    measured('focus-'+name)
                page.get_by_text('Saldo da amostra',exact=True).hover()
                measured('card-hover')
                page.get_by_label('Data', exact=True).focus()
                expect(page.get_by_label('Data', exact=True)).to_have_css('color-scheme','light')
                original=page.get_by_label('Data',exact=True).input_value()
                page.keyboard.press('ArrowUp')
                page.keyboard.press('ArrowDown')
                expect(page.get_by_label('Data',exact=True)).to_have_value(original)
                page.get_by_label('Categoria',exact=True).select_option('trabalho')
                expect(page.get_by_label('Categoria',exact=True)).to_have_value('trabalho')
                page.get_by_role('button',name='Contas da amostra',exact=True).click()
                expect(page.get_by_role('checkbox',name='Casa',exact=True)).to_be_checked()
                measured('multi-select')
                page.get_by_role('checkbox',name='Trabalho',exact=True).focus()
                page.keyboard.press('Escape')
                expect(page.get_by_role('button',name='Contas da amostra',exact=True)).to_be_focused()
                for variant in ['info','warning','danger','success']:
                    page.get_by_label('Tipo de diálogo',exact=True).select_option(variant)
                    page.get_by_role('button',name='Abrir diálogo',exact=True).click()
                    measured('dialog-'+variant)
                    expect(page.get_by_role('button',name='Abrir diálogo',exact=True)).not_to_be_focused()
                    page.get_by_role('button',name='Confirmar',exact=True).hover()
                    measured('dialog-hover-'+variant)
                    page.keyboard.press('Escape')
                    expect(page.get_by_role('button',name='Abrir diálogo',exact=True)).to_be_focused()
                page.locator('button:has(div.rounded-full):visible').click()
                measured('account-menu')
        # Removing the opt-in scope must restore precisely the original dark output.
        load(page,'dark',directory.name)
        base_off=shot(page)
        load(page,'light')
        page.locator('[data-finelo-theme]').evaluate("el => el.removeAttribute('data-finelo-theme')")
        assert shot(page)==base_off
        checks['viewports'][label]['scope_off_identical']=True

    page.set_viewport_size({'width':1440,'height':900})
    pdf_rasters=[]
    for theme, base in [('dark',directory.name),('dark',None),('light',None)]:
        load(page,theme,base)
        pdf=page.pdf(format='A4',print_background=True,prefer_css_page_size=True)
        document=pymupdf.open(stream=pdf,filetype='pdf')
        pdf_rasters.append([p.get_pixmap().samples for p in document])
        if not base: (args.out_dir/f'referencia-{theme}.pdf').write_bytes(pdf)
    assert pdf_rasters[0]==pdf_rasters[1]==pdf_rasters[2], 'PDF/paginação difere da main'
    checks['pdf']={'identical_rasters_and_pagination':True,'pages':len(pdf_rasters[0])}
    page.emulate_media(media='screen')
    load(page,'system')
    expect(page.locator('[data-finelo-theme]')).to_have_attribute('data-finelo-theme','dark')
    page.emulate_media(color_scheme='light')
    expect(page.locator('[data-finelo-theme]')).to_have_attribute('data-finelo-theme','light')
    checks['system_live_change']=True
    load(page,'light',freeze=False)
    for part in ['error','badge']:
        assert page.locator(f'[data-appearance-part="{part}"]').first.evaluate('(el)=>getComputedStyle(el).animationName')=='none'
    checks['informational_text_does_not_fade']=True
    assert not errors, errors
    checks['javascript_errors']=errors
    browser.close()

# Keep every measurement, one record per line, so the evidence remains reviewable.
serialized=json.dumps(checks,indent=2)
serialized=re.sub(r'\{\n\s+"part":.*?\n\s+\}', lambda m:json.dumps(json.loads(m.group(0)),ensure_ascii=False),serialized,flags=re.S)
(args.out_dir/'visual.json').write_text(serialized,encoding='utf-8')
print(json.dumps({k:v for k,v in checks.items() if k!='contrast'},indent=2))
