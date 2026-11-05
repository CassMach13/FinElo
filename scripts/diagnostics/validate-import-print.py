"""Compare the existing browser print output; all data and I/O are synthetic."""
import argparse,hashlib,json,re
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode
import pymupdf
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=5202)
parser.add_argument('--out-dir',type=Path,required=True)
args=parser.parse_args()
args.out_dir.mkdir(parents=True,exist_ok=True)
repo=Path(__file__).resolve().parents[2]
fixtures=json.loads((repo/'tests/appearance/import-files.json').read_text(encoding='utf-8'))
origin=f'http://127.0.0.1:{args.port}'
expect.set_options(timeout=30000)
checks={'status':'RUNNING','states':{}}
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1000},color_scheme='dark',timezone_id='America/Sao_Paulo',service_workers='block')
    remote=[]
    def route(r):
        if r.request.url.startswith(origin+'/'):r.continue_()
        else:remote.append(r.request.url);r.abort()
    context.route('**/*',route)
    page=context.new_page()
    page.clock.set_fixed_time(datetime(2026,11,5,12,0,tzinfo=timezone.utc))
    for state in ['mapping','history','hidden-error']:
        reference=None
        for variant in ['main','reviewed','dark','light']:
            query={'theme':'light' if variant=='light' else 'dark'}
            if variant in ['main','reviewed']:query['baseline']=variant
            if state=='history':query['view']='history'
            page.goto(origin+'/scripts/diagnostics/import-preview.html?'+urlencode(query),wait_until='networkidle',timeout=120000)
            page.wait_for_function('window.__importPreview!==undefined')
            initial=page.evaluate('__importPreview.snapshot().rows')
            if state!='history':
                page.get_by_role('button',name=re.compile('Todos os Bancos',re.I)).click()
                page.get_by_text('Mapeamento',exact=True).click()
                page.locator('#source-select').select_option(label='CSV sintético')
                content=fixtures['manual'].encode() if state=='mapping' else b'PK\x03\x04arquivo-zip-truncado'
                page.locator('#file-upload').set_input_files({'name':'sintetico.csv' if state=='mapping' else 'invalido.xlsx','mimeType':'text/csv' if state=='mapping' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':content})
                if state=='mapping':expect(page.get_by_role('heading',name='Mapeamento de Colunas',exact=False)).to_be_visible()
                elif variant in ['dark','light']:expect(page.get_by_role('alert')).to_be_visible()
                else:page.wait_for_timeout(500) # Legacy notification has no rendered DOM target.
            else:
                expect(page.locator('#settings-logs')).to_be_visible()
                page.locator('#settings-logs select').select_option('-1')
            page.evaluate('document.activeElement?.blur()')
            pdf=page.pdf(format='A4',print_background=True,prefer_css_page_size=True)
            target=args.out_dir/f'import-{state}-{variant}.pdf'
            target.write_bytes(pdf)
            doc=pymupdf.open(target)
            text='\n'.join(p.get_text() for p in doc)
            if state=='mapping':assert ('5.200' in text or '5200' in text) and 'MERCADO' in text,'Missing financial preview'
            if state=='history':assert 'lote-sintetico.csv' in text and 'historico-sintetico-23.csv' in text,'Missing history or pagination tail'
            assert page.evaluate('__importPreview.snapshot().rows')==initial,'Print wrote financial data'
            rasters=[]
            for i,p in enumerate(doc):
                raster=p.get_pixmap();rasters.append({'size':[raster.width,raster.height,raster.n],'sha256':hashlib.sha256(raster.samples).hexdigest()})
                if variant in ['main','light']:raster.save(args.out_dir/f'import-{state}-{variant}-page-{i+1}.png')
            if reference is None:reference=rasters
            else:assert rasters==reference,(state,variant,'Print geometry/color/content/pagination regression')
            checks['states'][state+'-'+variant]={'pages':len(doc),'raster_identical':True,'page_rasters':rasters,'pdf_sha256':hashlib.sha256(pdf).hexdigest()}
        print(state+' PASS',flush=True)
    assert not remote,remote
    checks['remote_requests']=len(remote)
    browser.close()
checks['status']='PASS'
(args.out_dir/'validation.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
