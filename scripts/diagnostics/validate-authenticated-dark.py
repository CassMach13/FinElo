"""Compare real authenticated main (5199) with this branch, flag off (5200). Staging QA only."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import pymupdf
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--credentials', type=Path, required=True)
parser.add_argument('--out-dir', type=Path, required=True)
args=parser.parse_args()
qa=json.loads(args.credentials.read_text())
assert qa['email']=='qa-e864-pr96-20261104@example.com'
args.out_dir.mkdir(parents=True,exist_ok=True)
stage='https://sxmmrnwbxntccscojmfh.supabase.co/'
shots={}
pdfs=[]
fixed=datetime.now(timezone.utc).replace(microsecond=0)

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    for version,port in [('main',5199),('branch',5200)]:
        origin=f'http://127.0.0.1:{port}'
        ctx=browser.new_context(service_workers='block',device_scale_factor=1,color_scheme='dark',timezone_id='America/Sao_Paulo')
        ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith((origin+'/',stage)) else r.abort())
        page=ctx.new_page()
        page.set_default_timeout(90000)
        page.clock.set_fixed_time(fixed)
        page.goto(origin+'/login',wait_until='networkidle',timeout=120000)
        page.get_by_label('Email',exact=True).fill(qa['email'])
        page.get_by_label('Senha',exact=True).fill(qa['password'])
        page.get_by_role('button',name='Entrar',exact=True).click()
        page.wait_for_url('**/app**',timeout=120000)
        shots[version]={}
        for label,width,height in [('desktop',1440,900),('mobile',390,844)]:
            page.set_viewport_size({'width':width,'height':height})
            for view in ['dashboard','settings']:
                page.goto(origin+'/app?view='+view,wait_until='networkidle',timeout=120000)
                page.wait_for_function("window.__finEloDebug?.getAppState().initialDataLoadStatus === 'ready'")
                page.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}')
                expect(page.locator('[data-finelo-theme]')).to_have_count(0)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.mouse.move(0,0)
                key=label+'-'+view
                shots[version][key]=page.screenshot(animations='disabled')
                (args.out_dir/f'autenticado-{version}-{key}.png').write_bytes(shots[version][key])
                if view=='dashboard' and label=='desktop':
                    pdf=page.pdf(format='A4',print_background=True,prefer_css_page_size=True)
                    pdfs.append([p.get_pixmap().samples for p in pymupdf.open(stream=pdf,filetype='pdf')])
                    (args.out_dir/f'dashboard-{version}.pdf').write_bytes(pdf)
                    page.emulate_media(media='screen')
        page.evaluate('async () => { await window.__finEloDebug.getAppState().signOut(); }')
        ctx.close()
    browser.close()

same={k:shots['main'][k]==shots['branch'][k] for k in shots['main']}
result={'baseline':'6fa1188','flag_off_authenticated':same,'dashboard_pdf_identical':pdfs[0]==pdfs[1],'dashboard_pdf_pages':len(pdfs[0]),'sha256':{k:hashlib.sha256(v).hexdigest() for k,v in shots['branch'].items()}}
(args.out_dir/'authenticated-dark.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
assert all(same.values()),'Authenticated dark regression'
assert result['dashboard_pdf_identical'],'Dashboard PDF regression'
