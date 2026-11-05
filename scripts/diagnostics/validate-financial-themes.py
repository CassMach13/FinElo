"""Synthetic financial presentation regression. No Auth, real storage, remote traffic or production writes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlencode
import pymupdf
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=5201)
parser.add_argument('--out-dir',type=Path,required=True)
parser.add_argument('--manifest',type=Path,required=True)
parser.add_argument('--phase',choices=['all','light','controls'],default='all')
args=parser.parse_args()
args.out_dir.mkdir(parents=True,exist_ok=True)
origin=f'http://127.0.0.1:{args.port}'
url=origin+'/scripts/diagnostics/financial-preview.html'
checks={'base':'6fa1188','viewports':{},'contrast':{},'financial':{}}
repo=Path(__file__).resolve().parents[2]
baseline_root=repo/'scripts/diagnostics/theme-financial-baseline'
baseline_manifest=json.loads((baseline_root/'baseline.json').read_text(encoding='utf-8'))
for source,digest in baseline_manifest['files'].items():assert hashlib.sha256((baseline_root/source).read_bytes()).hexdigest()==digest,'Baseline modified: '+source
checks['base']=baseline_manifest['base']

audit_js=r'''() => {
 const rgba=s=>(s.match(/[\d.]+/g)||[]).map(Number);
 const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
 const bg=el=>el?blend(rgba(getComputedStyle(el).backgroundColor),bg(el.parentElement)):[255,255,255];
 const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
 const shown=el=>{if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')return false;for(let e=el;e;e=e.parentElement)if(getComputedStyle(e).opacity==='0')return false;return true};
 const layers=el=>{let opacity=1;for(let e=el;e;e=e.parentElement)opacity*=Number(getComputedStyle(e).opacity);return opacity};
 const score=(el,color)=>{
   const back=bg(el),opacity=layers(el),front=blend(rgba(color),back).map((v,i)=>v*opacity+back[i]*(1-opacity));
   let score=ratio(front,back);
   for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e),gradient=s.backgroundImage.match(/rgba?\([^)]+\)/g);
     if(gradient){score=Math.min(...gradient.map(c=>ratio(front,blend(rgba(c),bg(e.parentElement)))));break}
     if((rgba(s.backgroundColor)[3]??1)>0)break;
   }
   return score;
 };
 const dialogs=[...document.querySelectorAll('[data-appearance-part="modal"],[data-appearance-part="dialog"]')].filter(shown);
 const root=dialogs.at(-1)||document.querySelector('[data-finelo-theme]');
 const rows=[];
 const add=(kind,text,value,threshold)=>rows.push({kind,text:String(text).slice(0,70),ratio:+value.toFixed(3),threshold,pass:value>=threshold});
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
   const node=walker.currentNode,el=node.parentElement,text=node.textContent.trim();
   if(!text||!shown(el)||['SCRIPT','STYLE','OPTION'].includes(el.tagName))continue;
   add('text',text,score(el,getComputedStyle(el).color),4.5);
 }
 for(const el of root.querySelectorAll('input,select,textarea')){
   if(!shown(el)||['checkbox','radio','hidden'].includes(el.type))continue;
   add('field',el.getAttribute('aria-label')||el.name||el.id,score(el,getComputedStyle(el).color),4.5);
   if(el.placeholder&&!el.value)add('placeholder',el.placeholder,score(el,getComputedStyle(el,'::placeholder').color),4.5);
   if(parseFloat(getComputedStyle(el).borderTopWidth)>0)add('control-border',el.name||el.id,ratio(blend(rgba(getComputedStyle(el).borderTopColor),bg(el)),bg(el)),3);
 }
 for(const el of root.querySelectorAll('button svg')){
   if(!shown(el)||layers(el)<.01)continue;
   add('action-icon',el.closest('button').getAttribute('title')||el.closest('button').textContent,score(el,getComputedStyle(el).color),3);
 }
 const active=document.activeElement;
 if(root.contains(active)&&active.matches(':focus-visible')){
   const style=getComputedStyle(active);
   if(style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0)add('focus',active.name||active.getAttribute('aria-label'),ratio(rgba(style.outlineColor),bg(active.parentElement)),3);
 }
 return rows;
}'''

def capture(page,name,images,theme,baseline,keep_hover=False):
    print(json.dumps({'viewport':viewport,'theme':'main' if baseline else theme,'state':name}),flush=True)
    if not keep_hover:page.mouse.move(0,0)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(viewport,name,'horizontal overflow')
    images[name]=page.screenshot(animations='disabled')
    (args.out_dir/f'{viewport}-{"main" if baseline else theme}-{name}.png').write_bytes(images[name])
    if theme=='light' and not baseline:
        rows=page.evaluate(audit_js)
        checks['contrast'][viewport+'-'+name]={'samples':len(rows),'minimum_text':min((r['ratio'] for r in rows if r['threshold']==4.5),default=None),'minimum_essential':min((r['ratio'] for r in rows if r['threshold']==3),default=None),'failures':[r for r in rows if not r['pass']]}
        if any(not r['pass'] for r in rows):(args.out_dir/'failed-audit.json').write_text(json.dumps(checks['contrast'][viewport+'-'+name],indent=2),encoding='utf-8')
        assert all(r['pass'] for r in rows),(viewport,name,[r for r in rows if not r['pass']][:12])

def load(page,theme,baseline=False,**params):
    query={'theme':theme,**params}
    if baseline:query['baseline']='main'
    page.goto(url+'?'+urlencode(query),wait_until='networkidle',timeout=120000)
    page.wait_for_function('window.__financialPreview !== undefined')
    page.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.evaluate('''() => { const f=document.createElement('iframe');document.body.append(f);const unchanged=f.contentWindow.localStorage.getItem('financial-fence-sentinel')==='unchanged'&&f.contentWindow.localStorage.length===1;f.remove();return unchanged; }''')

def snapshot(page):return page.evaluate('__financialPreview.snapshot()')

def expand(page):page.locator('button[aria-controls="transactions-filters-body"]').click()

def card_for(page,text):
    return page.locator('#transactions-cards').get_by_text(text,exact=True).locator('xpath=ancestor::div[contains(@class,"relative overflow-hidden w-full")][1]')

def swipe(card,direction):
    content=card.locator(':scope > div').nth(1)
    content.dispatch_event('touchstart',{'touches':[{'identifier':0,'clientX':200,'clientY':100}]})
    content.dispatch_event('touchmove',{'touches':[{'identifier':0,'clientX':330 if direction=='left' else 70,'clientY':100}]})
    content.dispatch_event('touchend',{'touches':[]})

def open_edit(page,text):
    if viewport=='desktop':page.locator('tbody tr').filter(has_text=text).get_by_title('Editar Transação',exact=True).click()
    else:
        card=card_for(page,text)
        card.scroll_into_view_if_needed()
        swipe(card,'left')
        card.get_by_role('button',name='Editar',exact=True).click()
    expect(page.get_by_role('heading',name='Editar Lançamento',exact=True)).to_be_visible()

def first_modal_field(page):
    page.locator('#new-transaction-form').locator('input:not(:disabled),select:not(:disabled)').first.focus()

def modal_root(page,title):return page.get_by_role('heading',name=title,exact=True).locator('..').locator('..')

def close_modal(page,title):modal_root(page,title).locator('button').first.click()

def exercise_suggestions(page,theme,baseline,images):
    result={}
    for case in ['unique','refusal','ambiguous','manual','cancel']:
        load(page,theme,baseline,view='suggestions',candidates='two' if case in ['ambiguous','manual'] else 'one')
        radios=page.locator('input[type="radio"]')
        if case in ['ambiguous','manual']:
            expect(radios.nth(0)).not_to_be_checked()
            expect(radios.nth(1)).not_to_be_checked()
            expect(radios.nth(2)).to_be_checked()
            if not baseline:expect(radios.nth(2)).to_be_focused()
        else:expect(radios.nth(0)).to_be_checked()
        if case=='refusal':radios.last.check()
        if case=='manual':radios.nth(1).check()
        radios.first.focus()
        capture(page,'parcelas-'+case,images,theme,baseline)
        if case=='cancel':page.get_by_role('button',name='Cancelar importação',exact=True).click()
        else:page.get_by_role('button',name=re.compile('^Importar (aplicando|sem aplicar)')).click()
        state=page.evaluate('__financialPreview.installments()')
        for before,after in zip(state['original'],state['projected']):
            for field in before:
                if field not in ['Nome_Fantasia','Categoria']:assert before[field]==after[field],(case,field)
        if case in ['refusal','ambiguous','cancel']:assert state['projected']==state['original']
        else:assert state['projected'][0]['Nome_Fantasia']==('Compra anterior B' if case=='manual' else 'Compra anterior A')
        assert state['events'][0]['action']==('cancel' if case=='cancel' else 'confirm')
        result[case]=state
    return result

def exercise(page,theme,baseline):
    images={}
    load(page,theme,baseline)
    original=snapshot(page)
    capture(page,'lista',images,theme,baseline)
    expand(page)
    capture(page,'filtros',images,theme,baseline)
    if viewport=='mobile':page.get_by_role('button',name=re.compile('Mais filtros')).click()
    page.locator('input[name="text"]').fill('Mercado')
    capture(page,'busca',images,theme,baseline)
    page.locator('input[name="text"]').fill('sem-correspondencia-qa')
    expect(page.get_by_text('Nenhuma transação encontrada.',exact=True).filter(visible=True)).to_be_visible()
    capture(page,'vazio-filtrado',images,theme,baseline)
    assert snapshot(page)==original

    load(page,theme,baseline)
    page.get_by_title('Clique para editar Conta principal',exact=True).click()
    modal_root(page,'Editar Conta').locator('input:not(:disabled)').first.focus()
    capture(page,'conta',images,theme,baseline)
    close_modal(page,'Editar Conta')
    assert snapshot(page)==original

    load(page,theme,baseline)
    page.get_by_role('button',name='Adicionar Lançamento',exact=True).click()
    page.get_by_role('button',name='+ Categoria',exact=True).click()
    modal_root(page,'Nova Categoria').locator('input:not(:disabled)').first.focus()
    capture(page,'categoria',images,theme,baseline)
    close_modal(page,'Nova Categoria')
    page.get_by_role('button',name='Cancelar',exact=True).click()
    assert snapshot(page)==original

    load(page,theme,baseline)
    page.get_by_role('button',name='Adicionar Lançamento',exact=True).click()
    page.get_by_title('Criar regra para preencher importações com texto parecido',exact=True).click()
    modal_root(page,'Nova Regra de Mapeamento').locator('input:not(:disabled)').first.focus()
    capture(page,'regra',images,theme,baseline)
    close_modal(page,'Nova Regra de Mapeamento')
    page.get_by_role('button',name='Cancelar',exact=True).click()
    assert snapshot(page)==original

    load(page,theme,baseline)
    page.get_by_role('button',name='Recorrências',exact=True).click()
    expect(page.get_by_text('Internet fibra',exact=True).first).to_be_visible()
    capture(page,'recorrencias',images,theme,baseline)

    load(page,theme,baseline)
    page.get_by_role('button',name='Adicionar Lançamento',exact=True).click()
    first_modal_field(page)
    capture(page,'inclusao',images,theme,baseline)
    page.get_by_role('button',name='Salvar',exact=True).click()
    expect(page.get_by_text('A conta é obrigatória.',exact=True)).to_be_visible()
    capture(page,'invalido',images,theme,baseline)
    page.get_by_role('button',name='Cancelar',exact=True).click()
    assert snapshot(page)==original

    load(page,theme,baseline)
    page.get_by_role('button',name='Adicionar Lançamento',exact=True).click()
    page.locator('select[name="ID_Conta"]').select_option('bank')
    page.locator('select[name="Tipo"]').select_option('Despesa')
    page.locator('input[name="Nome_Fantasia"]').fill('Compra QA parcelada')
    page.locator('select[name="Categoria"]').select_option('Casa')
    page.locator('input[name="Valor"]').fill('300')
    page.get_by_label('Repetir este lançamento?',exact=True).check()
    page.locator('input[name="recurrenceType"][value="installments"]').check()
    page.locator('input[type="number"]').last.fill('3')
    first_modal_field(page)
    capture(page,'parcelamento-manual',images,theme,baseline)
    page.get_by_role('button',name='Gerar 3 Lançamentos',exact=True).click()
    expect(page.get_by_role('heading',name='Adicionar Lançamento',exact=True)).not_to_be_visible()
    created=snapshot(page)
    assert len(created['rows'])==len(original['rows'])+3
    assert sum(t['Valor'] for t in created['rows'] if t['ID_Transacao'].startswith('new-'))==-300

    load(page,theme,baseline,state='save-error')
    page.get_by_role('button',name='Adicionar Lançamento',exact=True).click()
    page.locator('select[name="ID_Conta"]').select_option('bank')
    page.locator('select[name="Tipo"]').select_option('Despesa')
    page.locator('input[name="Nome_Fantasia"]').fill('Tentativa sintética')
    page.locator('select[name="Categoria"]').select_option('Casa')
    page.locator('input[name="Valor"]').fill('10')
    page.get_by_role('button',name='Salvar',exact=True).click()
    error_dialog=page.get_by_role('dialog',name='Erro ao salvar',exact=True)
    expect(error_dialog).to_be_visible()
    error_dialog.get_by_role('button').first.focus()
    capture(page,'erro-gravacao',images,theme,baseline)
    error_dialog.get_by_role('button').first.click()
    assert snapshot(page)==original

    if not baseline:
        load(page,theme,baseline)
        page.get_by_role('button',name='Adicionar Lançamento',exact=True).click()
        dialog=page.get_by_role('dialog',name='Adicionar Lançamento',exact=True)
        dialog.get_by_role('button').first.focus()
        page.keyboard.press('Shift+Tab')
        expect(dialog.get_by_role('button',name='Salvar',exact=True)).to_be_focused()
        page.keyboard.press('Tab')
        expect(dialog.get_by_role('button').first).to_be_focused()
        page.keyboard.press('Escape')
        expect(page.get_by_role('heading',name='Adicionar Lançamento',exact=True)).not_to_be_visible()
        expect(page.get_by_role('button',name='Adicionar Lançamento',exact=True)).to_be_focused()
        assert snapshot(page)==original

        load(page,theme,baseline)
        if viewport=='desktop':
            cell=page.locator('tbody tr').filter(has_text='Restaurante importado').locator('td').nth(3)
            cell.focus()
            page.keyboard.press('Enter')
            editor=page.locator('input[aria-label="Editar Nome_Fantasia"]')
            expect(editor).to_be_visible()
            editor.fill('Edição cancelada no teclado')
            page.keyboard.press('Escape')
            assert snapshot(page)==original
            rule=page.locator('tbody tr').filter(has_text='Restaurante importado').get_by_title('Criar regra de mapeamento',exact=True)
            rule.focus()
            page.keyboard.press('Enter')
            expect(page.get_by_role('heading',name='Nova Regra de Mapeamento',exact=True)).to_be_visible()
            close_modal(page,'Nova Regra de Mapeamento')
            assert snapshot(page)==original
        else:
            card=card_for(page,'Salário de novembro')
            action=card.get_by_role('button',name='Editar',exact=True)
            action.focus()
            expect(action).to_have_css('opacity','1')
            action.click()
            expect(page.get_by_role('heading',name='Editar Lançamento',exact=True)).to_be_visible()
            page.get_by_role('button',name='Cancelar',exact=True).click()
            assert snapshot(page)==original

    load(page,theme,baseline)
    open_edit(page,'Salário de novembro')
    first_modal_field(page)
    capture(page,'edicao',images,theme,baseline)
    page.locator('input[name="Nome_Fantasia"]').fill('Salário revisado QA')
    page.get_by_role('button',name='Salvar',exact=True).click()
    edited=snapshot(page)
    assert edited['balances']==original['balances']

    retained=None
    if viewport=='desktop':
        load(page,theme,baseline)
        expand(page)
        picker=page.locator('#transactions-filters').get_by_text('Categoria',exact=True).locator('..').get_by_role('button')
        picker.click()
        page.get_by_role('checkbox',name='Casa',exact=True).check()
        picker.click()
        cell=page.locator('tbody tr').filter(has_text='Aluguel').locator('td').nth(5)
        cell.click()
        cell.locator('select').select_option('Alimentação')
        page.get_by_role('heading',name='Transações',exact=True).click()
        expect(page.get_by_text('1 categorizada fora do filtro',exact=False)).to_be_visible()
        capture(page,'categoria-retida',images,theme,baseline)
        retained=snapshot(page)
        assert retained['balances']==original['balances']

    load(page,theme,baseline)
    if viewport=='mobile':
        open_edit(page,'Restaurante importado')
        expect(page.locator('input[name="Valor"]')).to_be_disabled()
        expect(page.locator('input[name="Data"]')).to_be_disabled()
        first_modal_field(page)
        capture(page,'importada-bloqueada',images,theme,baseline)
        page.get_by_role('button',name='Cancelar',exact=True).click()
    else:
        row=page.locator('tbody tr').filter(has_text='Restaurante importado')
        row.locator('td').nth(7).click()
        expect(row.locator('input')).to_have_count(0)
        capture(page,'importada-bloqueada',images,theme,baseline)
    assert snapshot(page)==original

    load(page,theme,baseline)
    page.get_by_role('button',name='Exclusão por seleção',exact=True).click()
    selectable=page.locator('input[type="checkbox"][aria-label^="Selecionar "]:visible').last
    selectable.check()
    capture(page,'selecao',images,theme,baseline)
    page.get_by_role('button',name='Excluir selecionados',exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.get_by_role('dialog').get_by_role('button').first.focus()
    capture(page,'exclusao-confirmacao',images,theme,baseline)
    page.keyboard.press('Escape')
    assert snapshot(page)==original

    load(page,theme,baseline,state='loading')
    capture(page,'carregando',images,theme,baseline)
    load(page,theme,baseline,filters='smart',family='true')
    capture(page,'filtros-smart-familia',images,theme,baseline)
    suggestions=exercise_suggestions(page,theme,baseline,images)
    return images,{'original':original,'created':created,'edited':edited,'retained':retained,'suggestions':suggestions}

def compare_rasters(reference,actual):
    if reference==actual:return {'exact':True,'different_pixels':0,'maximum_channel_delta':0}
    a,b=pymupdf.Pixmap(reference),pymupdf.Pixmap(actual)
    assert (a.width,a.height,a.n)==(b.width,b.height,b.n),'Raster geometry differs'
    first,second=a.samples,b.samples
    maximum=max(abs(x-y) for x,y in zip(first,second))
    pixels=sum(any(first[i+c]!=second[i+c] for c in range(a.n)) for i in range(0,len(first),a.n))
    limit=max(20,int(a.width*a.height*.0001))
    assert maximum<=2 and pixels<=limit,('Visual regression',pixels,maximum,limit)
    return {'exact':False,'different_pixels':pixels,'maximum_channel_delta':maximum,'pixel_limit':limit,'classification':'bounded rasterization noise; retained for review'}

def exercise_controls(page,theme,baseline):
    images={}
    load(page,theme,baseline)
    original=snapshot(page)
    add=page.get_by_role('button',name='Adicionar Lançamento',exact=True)
    add.hover()
    capture(page,'hover-acao',images,theme,baseline,keep_hover=True)
    add.focus()
    page.keyboard.press('Tab')
    page.keyboard.press('Shift+Tab')
    capture(page,'foco-acao',images,theme,baseline)
    if viewport=='desktop':
        page.locator('tbody tr').filter(has_text='Salário de novembro').hover()
        capture(page,'hover-linha',images,theme,baseline,keep_hover=True)
    add.click()
    date=page.locator('input[name="Data"]')
    date.focus()
    assert date.evaluate("el=>getComputedStyle(el).colorScheme") in ['light','dark']
    capture(page,'data-nativa-foco',images,theme,baseline)
    page.get_by_role('button',name='Cancelar',exact=True).click()
    assert snapshot(page)==original
    # No theme attribute represents the default/flag-off presentation. The real
    # flag and eligibility implementation are unchanged; no account is enrolled.
    load(page,'dark',baseline)
    page.evaluate("document.querySelector('[data-finelo-theme]').removeAttribute('data-finelo-theme')")
    capture(page,'sem-tema',images,'dark',baseline)
    return images,{'original':original}

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    ctx=browser.new_context(color_scheme='dark',device_scale_factor=1,timezone_id='America/Sao_Paulo',service_workers='block',has_touch=True)
    ctx.add_init_script("localStorage.setItem('financial-fence-sentinel','unchanged')")
    remote=[]
    def route(r):
        if r.request.url.startswith(origin+'/'):r.continue_()
        else:remote.append(r.request.url);r.abort()
    ctx.route('**/*',route)
    page=ctx.new_page()
    page.set_default_timeout(15000)
    page.clock.set_fixed_time(datetime(2026,11,5,12,0,tzinfo=timezone.utc))
    for viewport,width,height in [('desktop',1440,1000),('mobile',390,844)]:
        page.set_viewport_size({'width':width,'height':height})
        if args.phase=='light':
            exercise(page,'light',False)
            continue
        run=exercise_controls if args.phase=='controls' else exercise
        baseline_images,baseline_finance=run(page,'dark',True)
        for theme in ['dark','light']:
            images,finance=run(page,theme,False)
            for state,png in images.items():(args.out_dir/f'{viewport}-{theme}-{state}.png').write_bytes(png)
            assert finance==baseline_finance,(viewport,theme,'financial payload or balance regression')
            if theme=='dark':
                assert images.keys()==baseline_images.keys()
                raster_parity={state:compare_rasters(baseline_images[state],images[state]) for state in images}
        checks['viewports'][viewport]={'parity':True,'states':list(images),'raster_parity':raster_parity,'dark_sha256':{k:hashlib.sha256(v).hexdigest() for k,v in baseline_images.items()}}
        checks['financial'][viewport]={'identical_to_main':True,'initial_rows':len(baseline_finance['original']['rows']),'created_rows':0 if args.phase=='controls' else 3,'payload_sha256':hashlib.sha256(json.dumps(baseline_finance,sort_keys=True,default=datetime.isoformat).encode()).hexdigest()}
    if args.phase=='light':
        print('Light diagnostic phase passed',flush=True)
        browser.close()
        raise SystemExit(0)
    page.set_viewport_size({'width':1440,'height':1000})
    pdfs=[]
    for theme,baseline in ([] if args.phase=='controls' else [('dark',True),('dark',False),('light',False)]):
        load(page,theme,baseline)
        pdf=page.pdf(format='A4',print_background=True,prefer_css_page_size=True)
        doc=pymupdf.open(stream=pdf,filetype='pdf')
        pdfs.append([p.get_pixmap().samples for p in doc])
        (args.out_dir/f'transacoes-{theme}-{baseline}.pdf').write_bytes(pdf)
        assert any('5.200' in p.get_text() or '5200' in p.get_text() for p in doc),'PDF omits financial fixture'
    if pdfs:
        assert pdfs[0]==pdfs[1]==pdfs[2],'Print or pagination regression'
        checks['pdf']={'identical_rasters':True,'pages':len(pdfs[0]),'page_sha256':[hashlib.sha256(p).hexdigest() for p in pdfs[0]]}
    checks['remote_requests']=len(remote)
    assert not remote,'Remote traffic attempted'
    browser.close()
args.manifest.parent.mkdir(parents=True,exist_ok=True)
contracts=json.loads((repo/'tests/appearance/financial-presentation-baseline.json').read_text())
sources=[*contracts['files'],'src/components/ui/Input.tsx','src/components/ui/Select.tsx','src/components/ui/Modal.tsx','src/components/appearance/financial.css','scripts/diagnostics/financial-preview-runtime.tsx','scripts/diagnostics/financial-preview.tsx']
checks['source_sha256']={source:hashlib.sha256((repo/source).read_bytes()).hexdigest() for source in sources}
args.manifest.write_text(json.dumps(checks,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({k:v for k,v in checks.items() if k!='contrast'},indent=2))
