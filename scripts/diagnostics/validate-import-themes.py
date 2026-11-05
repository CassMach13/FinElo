"""End-to-end synthetic import presentation/financial parity. All remote I/O is fenced."""
import argparse
import base64
import csv
from datetime import datetime,timezone
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlencode
import pymupdf
from playwright.sync_api import sync_playwright,expect
from import_visual_checks import AUDIT_JS,digest,compare_rasters
expect.set_options(timeout=30000)

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=5202)
parser.add_argument('--out-dir',type=Path,required=True)
parser.add_argument('--manifest',type=Path,required=True)
parser.add_argument('--suite',choices=['files','integration','history','extras','controls','all'],default='all')
parser.add_argument('--themes',choices=['light','all'],default='all')
parser.add_argument('--viewport',choices=['desktop','mobile','all'],default='all')
args=parser.parse_args()
repo=Path(__file__).resolve().parents[2]
args.out_dir.mkdir(parents=True,exist_ok=True)
fixtures=json.loads((repo/'tests/appearance/import-files.json').read_text(encoding='utf-8'))
origin=f'http://127.0.0.1:{args.port}'
url=origin+'/scripts/diagnostics/import-preview.html'
checks={'bases':{},'viewports':{},'contrast':{},'financial':{},'accessibility':{},'approved_feedback_exceptions':{},'status':'RUNNING'}
for baseline in ['main','reviewed']:
    root=repo/f'scripts/diagnostics/theme-import-{baseline}-baseline'
    manifest=json.loads((root/'baseline.json').read_text(encoding='utf-8'))
    for source,value in manifest['files'].items():assert hashlib.sha256((root/source).read_bytes()).hexdigest()==value,'Modified baseline: '+source
    checks['bases'][baseline]=manifest['base']
images={};presentations={};native_dialogs=[]

def load(page,variant='light',**params):
    query={'theme':'light' if variant=='light' else 'dark',**params}
    if variant in ['main','reviewed']:query['baseline']=variant
    page.goto(url+'?'+urlencode(query),wait_until='networkidle',timeout=120000)
    page.wait_for_function('window.__importPreview!==undefined')
    page.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}')
    assert page.evaluate('''() => {const f=document.createElement('iframe');document.body.append(f);const ok=f.contentWindow.localStorage.getItem('import-fence-sentinel')==='unchanged'&&f.contentWindow.localStorage.length===1;f.remove();return ok;}'''),'Real storage changed'

def snapshot(page):return page.evaluate('__importPreview.snapshot()')
def rows(page):return snapshot(page)['rows']
def release(page,key):page.evaluate('(key)=>__importPreview.release(key)',key)

def capture(page,name,hover=False,normalize_focus=True,audit_light=True):
    if normalize_focus and not page.locator('.driver-popover').count() and page.locator('.fixed.inset-0').filter(has=page.locator('button')).count():focus_modal(page)
    elif normalize_focus and not page.locator('.driver-popover').count():page.evaluate('document.activeElement?.blur()')
    if not hover:page.mouse.move(0,0)
    page.evaluate('''async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}''')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(viewport,variant,name,'horizontal overflow')
    data=page.evaluate(AUDIT_JS)
    png=page.screenshot(animations='disabled')
    images[name]=png
    presentations[name]={key:data[key] for key in ['geometry','content','colors']}
    (args.out_dir/f'{viewport}-{variant}-{name}.png').write_bytes(png)
    if variant=='light' and audit_light:
        samples=data['rows'];failures=[row for row in samples if not row['pass']]
        record={'samples':len(samples),'minimum_text':min((r['ratio'] for r in samples if r['threshold']==4.5),default=None),'minimum_essential':min((r['ratio'] for r in samples if r['threshold']==3),default=None),'failures':failures}
        checks['contrast'][viewport+'-'+name]=record
        if failures:(args.out_dir/'failed-audit.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
        assert not failures,(viewport,name,failures[:10])
    print(json.dumps({'viewport':viewport,'variant':variant,'state':name}),flush=True)

def focus_modal(page):
    overlay=page.locator('.fixed.inset-0').filter(has=page.locator('button')).last
    fields=overlay.locator('input:not(:disabled):not([type="file"]),select:not(:disabled),textarea:not(:disabled)').filter(visible=True)
    if fields.count():fields.first.focus()
    else:overlay.locator('button').first.focus()

def dialog_button(page,text):return page.locator('.fixed.inset-0').filter(has=page.locator('button')).last.get_by_role('button',name=text,exact=True).last
def confirm(page):dialog_button(page,'Confirmar e Importar').click()
def upload(page,selector,content,name='sintetico.csv'):
    mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' if name.endswith('.xlsx') else 'application/vnd.ms-excel' if name.endswith('.xls') else 'application/x-ofx' if name.endswith('.ofx') else 'text/csv'
    page.locator(selector).set_input_files({'name':name,'mimeType':mime,'buffer':content.encode() if isinstance(content,str) else content})

def open_manual(page,config='CSV sintético'):
    page.get_by_role('button',name=re.compile('Todos os Bancos',re.I)).click()
    page.get_by_text('Mapeamento',exact=True).click()
    if config:page.locator('#source-select').select_option(label=config)

def open_native(page,bank='NuBank',card=False,manual=False):
    page.get_by_text(bank,exact=True).click()
    modal=page.locator('.fixed.inset-0').last
    modal.locator('select').select_option('credit' if card else 'bank')
    if card:modal.locator('input[type="date"]').fill('2026-11-20')
    if manual:
        modal.get_by_text('Definir manualmente',exact=True).click()
        modal.locator('input[type="month"]').fill('2026-10')
    focus_modal(page)

def file_scenarios(page):
    result={}
    load(page,variant)
    original=snapshot(page)
    capture(page,'bancos')
    page.get_by_role('button',name=re.compile('Todos os Bancos',re.I)).click()
    capture(page,'todos-bancos')
    page.get_by_text('NuBank',exact=True).hover()
    capture(page,'banco-hover',hover=True)
    page.get_by_text('Mapeamento',exact=True).click()
    capture(page,'manual-upload')
    upload(page,'#file-upload',fixtures['manual'])
    expect(page.get_by_role('heading',name='Mapeamento de Colunas',exact=False)).to_be_visible()
    capture(page,'mapeamento-sem-colunas')
    page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
    expect(page.get_by_text('Por favor, indique quais colunas correspondem a Data e Valor.',exact=True)).to_be_visible()
    capture(page,'colunas-ausentes')
    selects=page.locator('thead select')
    selects.nth(0).select_option('date');selects.nth(1).select_option('desc');selects.nth(2).select_option('amount');selects.nth(3).select_option('installments')
    page.get_by_title('Ignorar esta linha',exact=True).last.check()
    capture(page,'mapeamento-selecao-ignorada')
    page.get_by_text('Inverter Valores (Positivo ↔ Negativo)',exact=True).click()
    capture(page,'mapeamento-invertido')
    page.get_by_role('button',name='Voltar',exact=True).click()
    assert snapshot(page)==original
    result['mapping_cancel']=snapshot(page)

    load(page,variant)
    open_manual(page)
    upload(page,'#file-upload',fixtures['manual'])
    page.get_by_title('Ignorar esta linha',exact=True).last.check()
    capture(page,'manual-previa-configurada')
    page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
    expect(page.get_by_role('heading',name='Salvar Mapeamento',exact=True)).to_be_visible()
    focus_modal(page);capture(page,'salvar-mapeamento-novo')
    page.get_by_role('button',name='Salvar Configuração',exact=True).click()
    expect(page.get_by_role('heading',name='Salvar Mapeamento',exact=True)).to_be_visible()
    page.get_by_placeholder('Ex: Nubank, Boleto XP...',exact=True).fill('Mapeamento QA novo')
    page.get_by_role('button',name='Salvar Configuração',exact=True).click()
    expect(page.get_by_text('Configuração criada com sucesso!',exact=True)).to_be_visible()
    focus_modal(page);capture(page,'mapeamento-salvo')
    dialog_button(page,'Entendi').click()
    capture(page,'sucesso-manual')
    after=snapshot(page)
    assert len(after['rows'])==len(original['rows'])+4
    inserted=[t for t in after['rows'] if t['ID_Transacao'].startswith('imported-')]
    assert sum(t['Valor'] for t in inserted)==5153.5
    assert any(t['Valor']==0 for t in inserted)
    assert any(t['Nome_Fantasia']=='Mercado QA classificado' and t['Categoria']=='Alimentação' for t in inserted)
    assert any(t['Nome_Fantasia']=='DUPLICADA SINTETICA' for t in inserted),'Do not invent row deduplication'
    result['manual_success']=after
    page.get_by_role('button',name='Conferir transações',exact=True).click()
    expect(page.get_by_role('status')).to_have_text('Destino de navegação: transactions')
    result['return_navigation']=snapshot(page)

    load(page,variant)
    open_native(page)
    capture(page,'nativa-conta')
    upload(page,'#native-file-upload',fixtures['native'])
    expect(page.get_by_role('heading',name='Confirmar Importação',exact=True)).to_be_visible()
    focus_modal(page);capture(page,'nativa-confirmacao')
    dialog_button(page,'Cancelar').click()
    assert rows(page)==original['rows']
    capture(page,'nativa-cancelada')
    upload(page,'#native-file-upload',fixtures['native'])
    confirm(page)
    expect(page.get_by_role('heading',name='Importação concluída',exact=False)).to_be_visible()
    capture(page,'nativa-sucesso')
    first=snapshot(page)
    upload(page,'#native-file-upload',fixtures['native'],name='renomeado.csv')
    confirm(page)
    expect(page.get_by_text(re.compile('Arquivo já importado anteriormente:'))).to_be_visible()
    capture(page,'arquivo-duplicado')
    assert rows(page)==first['rows']
    result['native_and_duplicate']=snapshot(page)
    page.locator('.fixed.inset-0').last.locator('select').select_option('wallet')
    upload(page,'#native-file-upload',fixtures['native'],name='mesmo-conteudo-outra-conta.csv')
    confirm(page)
    expect(page.get_by_role('heading',name='Importação concluída',exact=False)).to_be_visible()
    capture(page,'mesmo-arquivo-outra-conta')
    assert len(rows(page))==len(first['rows'])*2-len(original['rows'])
    result['same_file_other_account']=snapshot(page)

    for case,content,name in [('empty',fixtures['empty'],'vazio.csv'),('header',fixtures['headerOnly'],'cabecalho.csv'),('invalid',fixtures['invalid'],'invalido.csv'),('invalid-excel',b'PK\x03\x04arquivo-zip-truncado','invalido.xlsx')]:
        load(page,variant)
        open_manual(page)
        upload(page,'#file-upload',content,name)
        if case=='invalid-excel':
            if variant in ['main','reviewed']:
                expect(page.get_by_text('Erro ao ler arquivo para pré-visualização.',exact=True)).to_have_count(0)
            else:expect(page.get_by_text('Erro ao ler arquivo para pré-visualização.',exact=True)).to_be_visible()
        else:expect(page.get_by_role('heading',name='Mapeamento de Colunas',exact=False)).to_be_visible()
        capture(page,'arquivo-'+case)
        assert rows(page)==original['rows']
        result['file_'+case]=snapshot(page)

    for case in ['persist-error','interrupted','persist-loading']:
        load(page,variant,case=case)
        open_native(page)
        upload(page,'#native-file-upload',fixtures['native'])
        confirm(page)
        if case!='persist-error':
            expect(page.get_by_text('Importando automaticamente...',exact=True)).to_be_visible()
            capture(page,case+'-carregando')
            assert rows(page)==original['rows']
            release(page,'persist')
        if case!='persist-loading':
            expect(page.get_by_text(re.compile('Falha na importação:'))).to_be_visible()
            assert rows(page)==original['rows']
            capture(page,case+'-erro')
            upload(page,'#native-file-upload',fixtures['native'])
            confirm(page)
        expect(page.get_by_role('heading',name='Importação concluída',exact=False)).to_be_visible()
        capture(page,case+'-recuperado')
        result[case]=snapshot(page)

    load(page,variant,case='file-read-loading')
    open_manual(page)
    upload(page,'#file-upload',fixtures['manual'])
    capture(page,'arquivo-em-leitura')
    release(page,'file-read')
    expect(page.get_by_role('heading',name='Mapeamento de Colunas',exact=False)).to_be_visible()
    capture(page,'leitura-concluida')
    assert rows(page)==original['rows']
    result['file_loading']=snapshot(page)
    return result

def card_scenarios(page):
    result={}
    for case in ['unique','refusal','ambiguous','manual','cancel']:
        load(page,variant,case='e864-ambiguous' if case in ['ambiguous','manual'] else 'e864-unique')
        original=rows(page)
        open_native(page,'Cartão de Crédito XP',card=True,manual=True)
        if case=='unique':capture(page,'cartao-metadados')
        upload(page,'#native-file-upload',fixtures['card'],name='xp-sintetico-2026-10.csv')
        confirm(page)
        expect(page.get_by_role('heading',name='Parcelas de compras que você já classificou',exact=True)).to_be_visible()
        radios=page.locator('input[type="radio"][name^="sugestao-"]')
        if case in ['ambiguous','manual']:
            expect(radios).to_have_count(3)
            expect(radios.nth(0)).not_to_be_checked();expect(radios.nth(1)).not_to_be_checked();expect(radios.nth(2)).to_be_checked()
        else:expect(radios.nth(0)).to_be_checked()
        if case=='refusal':radios.last.check()
        if case=='manual':radios.nth(1).check()
        radios.first.focus();capture(page,'e864-'+case)
        if case=='cancel':
            page.get_by_role('button',name='Cancelar importação',exact=True).click()
            expect(page.get_by_text('Importação cancelada. Nenhum lançamento foi gravado.',exact=True)).to_be_visible()
            assert rows(page)==original
            assert not snapshot(page)['events']
            capture(page,'e864-cancelada-sem-gravacao')
        else:
            page.get_by_role('button',name=re.compile('^Importar (aplicando|sem aplicar)')).click()
            expect(page.get_by_role('heading',name='Importação concluída',exact=False)).to_be_visible()
            after=snapshot(page)
            added=[t for t in after['rows'] if t['ID_Transacao'].startswith('imported-')]
            assert len(added)==1 and added[0]['Valor']==-120.5
            assert added[0]['Parcela_Atual']==2 and added[0]['Total_Parcelas']==4
            assert added[0]['Data'].startswith('2026-09-14') and added[0]['Data_Pagamento'].startswith('2026-11-20')
            expected='Sofá QA B' if case=='manual' else 'Sofá QA A' if case=='unique' else 'LOJA QA'
            assert added[0]['Nome_Fantasia']==expected
            context=next(e['payload']['p_detail_context'] for e in after['events'] if e['action']=='rpc-import')
            assert context['Card_Reference_Label']=='2026-10' and context['Card_Due_Date']=='2026-11-20'
        result['e864_'+case]=snapshot(page)

    load(page,variant)
    open_manual(page,'Cartão sintético')
    manual_card='Data;Descricao;Valor;Parcela\n14/09/2026;LOJA QA;120,50;2/4\n'
    upload(page,'#file-upload',manual_card,name='cartao-manual.csv')
    page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
    expect(page.get_by_text(re.compile('Para importação de cartão de crédito, a Data de Vencimento é obrigatória'))).to_be_visible()
    focus_modal(page);capture(page,'cartao-vencimento-obrigatorio');dialog_button(page,'Entendi').click()
    page.locator('input[type="date"]').fill('2026-11-20')
    page.locator('input[name="tempReferenceMode"]').last.check()
    page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
    expect(page.get_by_text('Para modo manual, informe a competência da fatura (AAAA-MM).',exact=True)).to_be_visible()
    focus_modal(page);capture(page,'cartao-competencia-obrigatoria');dialog_button(page,'Entendi').click()
    page.locator('input[type="month"]').fill('2026-10')
    capture(page,'cartao-manual-configurado')
    page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
    expect(page.get_by_role('heading',name='Parcelas de compras que você já classificou',exact=True)).to_be_visible()
    page.get_by_role('button',name=re.compile('^Importar aplicando')).click()
    expect(page.get_by_role('heading',name='Salvar Mapeamento',exact=True)).to_be_visible()
    page.get_by_role('button',name='Não Salvar',exact=True).click()
    result['manual_card']=snapshot(page)

    for proceed in [False,True]:
        load(page,variant)
        open_native(page,'Cartão de Crédito XP',card=True)
        upload(page,'#native-file-upload',fixtures['cardMultipleMonths'],name='xp-meses-sinteticos.csv')
        expect(page.get_by_role('heading',name='Confirmar Competência Automática',exact=True)).to_be_visible()
        focus_modal(page);capture(page,'competencia-auto-'+str(proceed))
        if not proceed:
            dialog_button(page,'Cancelar').click()
            expect(page.get_by_text(re.compile('Importação pausada. Defina a competência manualmente'))).to_be_visible()
            assert not snapshot(page)['events']
        else:
            dialog_button(page,'Continuar automático').click()
            confirm(page)
            expect(page.get_by_role('heading',name='Parcelas de compras que você já classificou',exact=True)).to_be_visible()
            page.get_by_role('button',name=re.compile('^Importar aplicando')).click()
            expect(page.get_by_role('heading',name='Importação concluída',exact=False)).to_be_visible()
        result['automatic_'+str(proceed)]=snapshot(page)
    return result

def integration_scenarios(page):
    result={}
    load(page,variant,integration='on',case='connections-loading')
    original=rows(page)
    expect(page.get_by_text('Carregando conexões...',exact=True)).to_be_visible()
    capture(page,'conexoes-carregando');release(page,'connections')
    expect(page.get_by_text('Banco Sintético',exact=True)).to_be_visible()
    capture(page,'conexoes-carregadas');assert rows(page)==original
    result['connection_loading']=snapshot(page)
    load(page,variant,integration='on',connections='none',case='integration-loading')
    page.get_by_role('button',name='+ Conectar Novo Banco',exact=True).click()
    page.locator('input[placeholder="Ex: João da Silva"]').fill('Pessoa Sintética QA')
    page.locator('input[placeholder="00000000000"]').fill('00000000000')
    page.get_by_role('button',name='Importar via Open Finance',exact=False).click()
    expect(page.get_by_role('button',name='Importar via Open Finance',exact=False)).to_be_disabled()
    capture(page,'consentimento-carregando');release(page,'consent')
    expect(page.get_by_role('button',name='Importar via Open Finance',exact=False)).to_be_enabled()
    result['consent_loading']=snapshot(page)
    for plan,case in [('free','basic'),('premium','extra')]:
        load(page,variant,integration='on',plan=plan)
        initial=rows(page)
        page.get_by_role('button',name='+ Conectar Novo Banco',exact=True).click()
        focus_modal(page);capture(page,'integracao-limite-'+case)
        dialog_button(page,'Continuar no Plano Grátis' if case=='basic' else 'Cancelar').click()
        assert rows(page)==initial
        result['paywall_'+case]=snapshot(page)

    load(page,variant,integration='on',connections='none')
    initial=rows(page)
    page.get_by_role('button',name='+ Conectar Novo Banco',exact=True).click()
    focus_modal(page);capture(page,'consentimento-vazio-desabilitado')
    page.locator('input[placeholder="Ex: João da Silva"]').fill('Pessoa Sintética QA')
    page.locator('input[placeholder="00000000000"]').fill('1')
    page.get_by_role('button',name='Importar via Open Finance',exact=False).click()
    if variant not in ['main','reviewed']:expect(page.get_by_role('alert')).to_have_text('CPF inválido. Digite os 11 dígitos.')
    capture(page,'consentimento-cpf-invalido')
    result['consent_invalid']=snapshot(page)
    assert rows(page)==initial
    load(page,variant,integration='on',connections='none')
    page.get_by_role('button',name='+ Conectar Novo Banco',exact=True).click()
    page.locator('input[placeholder="Ex: João da Silva"]').fill('Pessoa Sintética QA')
    page.locator('input[placeholder="00000000000"]').fill('00000000000')
    capture(page,'consentimento-preenchido')
    page.get_by_role('button',name='Importar via Open Finance',exact=False).click()
    expect(page.get_by_role('button',name='Importar via Open Finance',exact=False)).to_be_enabled()
    if variant not in ['main','reviewed']:expect(page.get_by_role('alert')).to_have_text('Falha sintética ao iniciar conexão')
    capture(page,'consentimento-erro')
    dialog_button(page,'Cancelar').click()
    expect(page.get_by_text('Falha sintética ao iniciar conexão',exact=True).first).to_be_visible()
    capture(page,'integracao-erro-e-suporte')
    expect(page.get_by_role('button',name='Copiar Request ID',exact=True)).to_be_visible()
    assert rows(page)==initial
    result['consent_error']=snapshot(page)

    load(page,variant,integration='on',connections='none',case='integration-success')
    page.get_by_role('button',name='+ Conectar Novo Banco',exact=True).click()
    page.locator('input[placeholder="Ex: João da Silva"]').fill('Pessoa Sintética QA')
    page.locator('input[placeholder="00000000000"]').fill('00000000000')
    page.get_by_role('button',name='Importar via Open Finance',exact=False).click()
    expect(page.get_by_role('heading',name='Conectar via Open Finance',exact=True)).not_to_be_visible()
    capture(page,'integracao-janela-simulada')
    assert any(e['action']=='open-integration-window' for e in snapshot(page)['events'])
    result['consent_success']=snapshot(page)

    load(page,variant,integration='on')
    page.get_by_role('button',name=re.compile('Sincronizar$')).click()
    focus_modal(page);capture(page,'integracao-periodo')
    page.get_by_role('button',name=re.compile('Período personalizado')).click()
    dates=page.locator('.fixed.inset-0').last.locator('input[type="date"]')
    dates.nth(0).fill('2026-11-01');dates.nth(1).fill('2026-11-05')
    dates.nth(0).focus();capture(page,'integracao-periodo-personalizado')
    page.get_by_role('button',name='Buscar Transações →',exact=True).click()
    expect(page.get_by_text('3 transações encontradas',exact=True)).to_be_visible()
    capture(page,'integracao-revisao')
    selects=page.locator('tbody select')
    selects.nth(1).select_option('Casa')
    page.locator('tbody input[type="checkbox"]').last.uncheck()
    capture(page,'integracao-revisao-ajustada')
    page.get_by_role('button',name=re.compile('Confirmar 2 transações')).click()
    expect(page.get_by_role('heading',name='Selecione o Banco ou Cartão',exact=True)).to_be_visible()
    capture(page,'integracao-retorno')
    committed=snapshot(page)
    assert len(committed['rows'])==len(initial)+1
    assert any(e['action']=='add' and e['payload']['Valor']==-31.5 and e['payload']['Categoria']=='Casa' for e in committed['events'])
    assert any(e['action']=='update' and e['payload']['ID_Transacao']=='manual-income' for e in committed['events'])
    result['review_parent_success']=committed

    for case in ['fetch-error','legacy-connection','integration-empty','fetch-loading','integration-persist-error','integration-persist-loading','default']:
        load(page,variant,view='review',case=case,many='true' if case=='default' else 'false')
        original=snapshot(page)
        page.locator('.fixed.inset-0').last.locator('select').select_option('credit')
        if case=='default':
            inputs=page.locator('.fixed.inset-0').last.locator('input[type="number"]')
            inputs.nth(0).fill('5000');inputs.nth(1).fill('5');inputs.nth(2).fill('20')
            focus_modal(page);capture(page,'integracao-detalhes-cartao')
        page.get_by_role('button',name='Buscar Transações →',exact=True).click()
        if case=='fetch-loading':
            expect(page.get_by_role('button',name=re.compile('Buscando'))).to_be_disabled()
            capture(page,'integracao-buscando');release(page,'fetch')
        if case in ['fetch-error','legacy-connection']:
            expect(page.get_by_text(re.compile('Falha sintética na leitura|Esta conexão foi criada'))).to_be_visible()
            focus_modal(page);capture(page,'integracao-'+case)
            assert rows(page)==original['rows']
        elif case=='integration-empty':
            expect(page.get_by_text('Nenhuma transação nova encontrada neste período.',exact=True)).to_be_visible()
            capture(page,'integracao-sem-novos')
            assert rows(page)==original['rows']
        else:
            expect(page.get_by_role('button',name=re.compile('Confirmar .*transa'))).to_be_visible()
            if case=='default':
                capture(page,'integracao-muitas-linhas')
                page.get_by_role('button',name='Limpar',exact=True).click()
                expect(page.get_by_role('button',name=re.compile('Confirmar 0'))).to_be_disabled()
                capture(page,'integracao-selecao-vazia')
                page.get_by_role('button',name='Selecionar todas',exact=True).click()
            if case=='fetch-loading':
                page.get_by_role('button',name='Cancelar',exact=True).last.click()
                assert rows(page)==original['rows']
            else:
                page.get_by_role('button',name=re.compile('Confirmar .*transa')).click()
                if case=='integration-persist-loading':
                    expect(page.get_by_role('button',name='Salvando...',exact=True)).to_be_disabled()
                    capture(page,'integracao-salvando');release(page,'review-persist')
                if case=='integration-persist-error':
                    expect(page.get_by_text('Falha sintética ao salvar revisão',exact=True)).to_be_visible()
                    capture(page,'integracao-erro-gravacao')
                    assert rows(page)==original['rows']
                else:
                    expect(page.get_by_role('heading',name='Sincronização concluída!',exact=True)).to_be_visible()
                    capture(page,'integracao-concluida-'+case)
                    assert any(t['Valor']==0 and t['ID_Transacao'].startswith('of-new-') for t in rows(page))
        result[case]=snapshot(page)
    return result

def history_scenarios(page):
    result={}
    load(page,variant,view='history')
    initial=snapshot(page)
    capture(page,'historico')
    search=page.locator('#settings-logs input[type="text"]')
    search.fill('sem-correspondencia')
    capture(page,'historico-vazio')
    search.fill('lote-sintetico.csv')
    capture(page,'historico-busca')
    page.get_by_role('button',name='Exibir',exact=True).click()
    expect(page.get_by_role('heading',name='Detalhes da Importação - lote-sintetico.csv',exact=True)).to_be_visible()
    focus_modal(page);capture(page,'detalhes-importadas')
    expect(page.get_by_text('Ativas no ledger: 1',exact=True)).to_be_visible()
    expect(page.get_by_text('Excluídas depois da importação: 1',exact=True)).to_be_visible()
    page.get_by_role('button',name='Ignoradas (2)',exact=True).click()
    capture(page,'detalhes-ignoradas')
    dialog_button(page,'Fechar').click()
    assert snapshot(page)==initial
    page.get_by_role('button',name='Excluir',exact=True).click()
    focus_modal(page);capture(page,'historico-exclusao-confirmacao')
    dialog_button(page,'Cancelar').click()
    assert snapshot(page)==initial
    page.get_by_role('button',name='Corrigir Conta',exact=True).click()
    focus_modal(page);capture(page,'corrigir-conta')
    dialog_button(page,'Aplicar').click()
    expect(page.get_by_text('Selecione uma conta para continuar.',exact=True)).to_be_visible()
    focus_modal(page);capture(page,'corrigir-conta-validacao');dialog_button(page,'Entendi').click()
    page.locator('.fixed.inset-0').filter(has=page.locator('button')).last.locator('select').select_option('wallet')
    dialog_button(page,'Aplicar').click()
    expect(page.get_by_role('button',name='Aplicar Correção',exact=True)).to_be_visible()
    focus_modal(page);capture(page,'corrigir-conta-confirmacao')
    dialog_button(page,'Cancelar').click()
    assert snapshot(page)==initial
    dialog_button(page,'Aplicar').click();dialog_button(page,'Aplicar Correção').click()
    expect(page.get_by_text('Conta corrigida com sucesso em 1 transações.',exact=True)).to_be_visible()
    dialog_button(page,'Entendi').click()
    after=snapshot(page)
    assert sum(t['Valor'] for t in after['rows'])==sum(t['Valor'] for t in initial['rows'])
    assert next(t for t in after['rows'] if t['ID_Transacao']=='old-duplicate')['ID_Conta']=='wallet'
    result['history_reassign']=after

    load(page,variant,view='history')
    page.get_by_role('button',name='Reidratar histórico de importações',exact=True).click()
    focus_modal(page);capture(page,'historico-reidratar-confirmacao')
    dialog_button(page,'Reidratar').click()
    expect(page.get_by_text('Histórico sintético conferido sem alterações',exact=True)).to_be_visible()
    focus_modal(page);capture(page,'historico-reidratar-resultado');dialog_button(page,'Entendi').click()
    page.get_by_role('button',name='Sincronizar Histórico Antigo',exact=True).click()
    focus_modal(page);capture(page,'historico-sincronizar-confirmacao');dialog_button(page,'Cancelar').click()
    assert rows(page)==initial['rows']
    result['history_metadata']=snapshot(page)
    page.locator('#settings-logs select').select_option('-1')
    capture(page,'historico-muitas-linhas')
    page.get_by_role('button',name='Sincronizar Histórico Antigo',exact=True).scroll_into_view_if_needed()
    capture(page,'historico-rodape')

    load(page,variant,view='history',section='configs')
    before=snapshot(page)
    capture(page,'configuracoes')
    page.get_by_role('button',name='Adicionar Novo',exact=True).click()
    focus_modal(page);capture(page,'configuracao-nova')
    page.locator('input[name="Nome_Fonte"]').fill('Configuração QA nova')
    page.locator('select[name="ID_Conta_Associada"]').select_option('wallet')
    page.get_by_role('button',name='Salvar Alterações',exact=True).click()
    expect(page.get_by_text('Configuração "Configuração QA nova" criada com sucesso!',exact=True)).to_be_visible()
    dialog_button(page,'Entendi').click()
    assert rows(page)==before['rows']
    result['config_create']=snapshot(page)
    page.get_by_role('button',name='Editar',exact=True).last.click()
    focus_modal(page);capture(page,'configuracao-editar')
    page.locator('input[name="Nome_Fonte"]').fill('Configuração QA revisada')
    page.get_by_role('button',name='Salvar Alterações',exact=True).click()
    expect(page.get_by_text('Configuração "Configuração QA revisada" atualizada com sucesso!',exact=True)).to_be_visible()
    dialog_button(page,'Entendi').click()
    page.get_by_role('button',name='Excluir',exact=True).last.click()
    focus_modal(page);capture(page,'configuracao-excluir-confirmacao');dialog_button(page,'Cancelar').click()
    assert rows(page)==before['rows']
    result['config_edit']=snapshot(page)

    load(page,variant,view='history',section='rules')
    before=snapshot(page)
    capture(page,'regras')
    page.get_by_role('button',name='Adicionar Novo',exact=True).click()
    focus_modal(page);capture(page,'regra-nova')
    page.locator('#rule-text').fill('LOJA QA TESTE')
    page.locator('#rule-name').fill('Compra sintética classificada')
    page.locator('#rule-category').select_option('Casa')
    page.get_by_role('button',name='Salvar',exact=True).click()
    expect(page.get_by_text('Regra de mapeamento criada com sucesso!',exact=True)).to_be_visible()
    dialog_button(page,'Entendi').click()
    assert rows(page)==before['rows']
    result['rule_create']=snapshot(page)
    page.get_by_role('button',name='Editar',exact=True).last.click()
    page.locator('#rule-category').select_option('Transporte')
    focus_modal(page);capture(page,'regra-editar')
    page.get_by_role('button',name='Salvar',exact=True).click()
    expect(page.get_by_text('Regra de mapeamento atualizada com sucesso!',exact=True)).to_be_visible()
    dialog_button(page,'Entendi').click()
    page.get_by_role('button',name='Excluir',exact=True).last.click()
    focus_modal(page);capture(page,'regra-excluir-confirmacao');dialog_button(page,'Cancelar').click()
    page.get_by_role('button',name='Re-aplicar Todas as Regras',exact=True).click()
    focus_modal(page);capture(page,'reaplicar-regras-confirmacao');dialog_button(page,'Cancelar').click()
    assert rows(page)==before['rows']
    result['rule_edit_cancel']=snapshot(page)
    return result

workbooks={}
def workbook(kind):
    if kind not in workbooks:
        code="import XLSX from 'xlsx';import fs from 'node:fs';const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(JSON.parse(fs.readFileSync(0,'utf8'))),'Extrato');book.Props={CreatedDate:new Date('2026-11-05T12:00:00Z')};process.stdout.write(XLSX.write(book,{type:'base64',bookType:process.argv[1],compression:true}));"
        output=subprocess.check_output(['node','--input-type=module','-e',code,kind],input=json.dumps(list(csv.reader(io.StringIO(fixtures['native'])))).encode(),cwd=repo)
        workbooks[kind]=base64.b64decode(output)
    return workbooks[kind]

def extra_scenarios(page):
    result={}
    load(page,variant)
    original=snapshot(page)
    page.evaluate("document.querySelector('[data-finelo-theme]').removeAttribute('data-finelo-theme')")
    capture(page,'flag-desligada',audit_light=False)
    load(page,variant)
    page.get_by_text('NuBank',exact=True).click()
    focus_modal(page);capture(page,'nativa-sem-conta')
    page.get_by_role('button',name='+ Nova Conta',exact=True).click()
    focus_modal(page);capture(page,'nativa-criar-conta')
    page.get_by_role('button',name='Cancelar',exact=True).last.click()
    assert snapshot(page)==original
    page.get_by_role('button',name='+ Nova Conta',exact=True).click()
    page.locator('input[name="Nome_Conta"]').fill('Nova conta de importação QA')
    page.locator('select[name="bank_id"]').select_option('nubank-conta')
    page.get_by_role('button',name='Salvar',exact=True).click()
    expect(page.get_by_role('heading',name='Nova Conta',exact=True)).not_to_be_visible()
    assert len(snapshot(page)['accounts'])==len(original['accounts'])+1
    expect(page.locator('.fixed.inset-0').last.locator('select')).to_have_value('created-account-1')
    focus_modal(page);capture(page,'nativa-conta-criada')
    result['account_creation']=snapshot(page)

    load(page,variant)
    open_manual(page)
    page.get_by_role('button',name='Iniciar Tutorial',exact=True).click()
    expect(page.locator('.driver-popover-title')).to_have_text('Importação de Extratos')
    page.wait_for_timeout(400) # Driver's JavaScript positioning animation, identical in every reference.
    page.locator('.driver-popover-next-btn').focus();capture(page,'tutorial-importacao')
    page.locator('.driver-popover-next-btn').click()
    expect(page.locator('.driver-popover-title')).to_have_text('Upload de Arquivo')
    page.wait_for_timeout(400)
    page.locator('.driver-popover-next-btn').focus();capture(page,'tutorial-upload')
    page.locator('.driver-popover-next-btn').click()
    expect(page.locator('.driver-popover')).to_have_count(0)
    assert snapshot(page)==original
    result['tour']=snapshot(page)

    load(page,variant)
    open_manual(page)
    many=fixtures['manual']+''.join(f'{i%27+1:02d}/10/2026;Descrição muito longa para testar leitura e rolagem da prévia financeira {i};{i%2*-2+1},00;\n' for i in range(60))
    upload(page,'#file-upload',many,name='muitas-linhas.csv')
    page.get_by_role('heading',name='Mapeamento de Colunas',exact=False).scroll_into_view_if_needed()
    capture(page,'previa-muitas-linhas')
    page.get_by_role('button',name='Confirmar e Importar',exact=True).scroll_into_view_if_needed()
    capture(page,'previa-muitas-linhas-rodape')
    page.get_by_role('button',name='Voltar',exact=True).click()
    assert rows(page)==original['rows']
    result['many_preview_cancel']=snapshot(page)

    load(page,variant)
    open_manual(page)
    upload(page,'#file-upload',fixtures['manual'])
    selects=page.locator('thead select')
    selects.nth(1).select_option('date')
    page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
    expect(page.get_by_text('Nenhuma transação encontrada no arquivo. Verifique o mapeamento das colunas.',exact=True)).to_be_visible()
    capture(page,'mapeamento-incorreto-sem-gravacao')
    assert rows(page)==original['rows']
    result['incorrect_mapping']=snapshot(page)

    for extension,content in [('xlsx',workbook('xlsx')),('xls',workbook('biff8'))]:
        load(page,variant,atomic='on' if extension=='xlsx' else 'off')
        open_native(page)
        upload(page,'#native-file-upload',content,name='planilha-sintetica.'+extension)
        expect(page.get_by_role('heading',name='Confirmar Importação',exact=True)).to_be_visible()
        focus_modal(page);capture(page,'excel-confirmacao-'+extension)
        confirm(page)
        expect(page.get_by_role('heading',name='Importação concluída',exact=False)).to_be_visible()
        capture(page,'excel-sucesso-'+extension)
        assert len(rows(page))>len(original['rows'])
        result['excel_'+extension]=snapshot(page)

    load(page,variant)
    open_manual(page)
    upload(page,'#file-upload',fixtures['ofx'],name='extrato-sintetico.ofx')
    capture(page,'ofx-previa')
    page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
    expect(page.get_by_text('Nenhuma transação encontrada no arquivo. Verifique o mapeamento das colunas.',exact=True)).to_be_visible()
    capture(page,'ofx-resultado-legado-sem-gravacao')
    assert rows(page)==original['rows']
    result['ofx']=snapshot(page)

    for case in ['default','config-error']:
        load(page,variant,case=case)
        open_manual(page)
        upload(page,'#file-upload',fixtures['manual'])
        page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
        expect(page.get_by_role('heading',name='Salvar Mapeamento',exact=True)).to_be_visible()
        imported=rows(page)
        if case=='default':
            page.get_by_text('Atualizar Existente',exact=True).click()
            page.locator('.fixed.inset-0').last.locator('select').select_option('cfg-manual')
            focus_modal(page);capture(page,'salvar-mapeamento-existente')
        else:page.get_by_placeholder('Ex: Nubank, Boleto XP...',exact=True).fill('Configuração com falha QA')
        page.get_by_role('button',name='Salvar Configuração',exact=True).click()
        expected='Configuração atualizada com sucesso!' if case=='default' else 'Erro ao criar: Falha sintética ao salvar configuração'
        expect(page.get_by_text(expected,exact=True)).to_be_visible()
        focus_modal(page);capture(page,'mapeamento-resultado-'+case)
        assert rows(page)==imported
        result['mapping_save_'+case]=snapshot(page)

    for exhausted in [False,True]:
        load(page,variant,plan='free',case='quota' if exhausted else 'default')
        capture(page,'cota-'+str(exhausted))
        if not exhausted:
            open_manual(page)
            upload(page,'#file-upload',fixtures['manual'])
            page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
            page.get_by_role('button',name='Não Salvar',exact=True).click()
            expect(page.get_by_text('Você utilizou sua importação gratuita deste mês.',exact=True)).to_be_visible()
            expect(page.get_by_role('button',name='Importar outro arquivo',exact=True)).to_have_count(0)
            capture(page,'cota-sucesso-limite')
        result['quota_'+str(exhausted)]=snapshot(page)
    return result

def control_scenarios(page):
    result={}
    load(page,variant,view='review',many='true')
    original=rows(page)
    page.get_by_role('button',name='Buscar Transações →',exact=True).click()
    expect(page.get_by_role('button',name=re.compile('Confirmar.*transações'))).to_be_visible()
    page.locator('div.overflow-auto').evaluate('el=>el.scrollLeft=el.scrollWidth')
    capture(page,'revisao-colunas-finais',normalize_focus=False)
    assert rows(page)==original
    result['review_horizontal_scroll']=snapshot(page)
    load(page,variant,view='history')
    original=rows(page)
    page.locator('#settings-logs input[type="text"]').fill('lote-sintetico.csv')
    page.get_by_role('button',name='Exibir',exact=True).click()
    page.locator('div.overflow-auto').evaluate('el=>el.scrollLeft=el.scrollWidth')
    capture(page,'detalhes-colunas-finais',normalize_focus=False)
    assert rows(page)==original
    result['history_horizontal_scroll']=snapshot(page)
    load(page,variant)
    initial=rows(page)
    favorite=page.get_by_title('Remover dos favoritos',exact=True).first
    favorite.focus();page.keyboard.press('Tab');page.keyboard.press('Shift+Tab')
    capture(page,'favorito-foco',normalize_focus=False)
    open_native(page,bank='Cartão de Crédito XP',card=True)
    date=page.locator('input[type="date"]')
    date.focus();page.keyboard.press('Tab');page.keyboard.press('Shift+Tab')
    capture(page,'data-nativa-foco',normalize_focus=False)
    upload(page,'#native-file-upload',fixtures['native'])
    if page.get_by_role('button',name='Entendi',exact=True).count():dialog_button(page,'Entendi').click()
    if page.get_by_role('heading',name='Confirmar Importação',exact=True).count():dialog_button(page,'Cancelar').click()
    expect(page.get_by_text(re.compile('O arquivo parece ser do'))).to_be_visible()
    capture(page,'banco-divergente')
    assert rows(page)==initial
    result['native_warning_no_write']=snapshot(page)
    load(page,variant,integration='on')
    initial=rows(page)
    remove=page.get_by_title('Remover conexão',exact=True)
    remove.focus();page.keyboard.press('Tab');page.keyboard.press('Shift+Tab')
    capture(page,'conexao-remover-foco',normalize_focus=False)
    remove.click();capture(page,'conexao-remover-confirmacao')
    dialog_button(page,'Cancelar').click()
    assert len(snapshot(page)['connections'])==1 and rows(page)==initial
    remove.click();dialog_button(page,'Remover').click()
    expect(page.get_by_text('Nenhum banco conectado ainda. Clique em "+ Conectar Novo Banco" para começar.',exact=True)).to_be_visible()
    capture(page,'conexao-removida')
    assert not snapshot(page)['connections'] and rows(page)==initial
    result['disconnect']=snapshot(page)
    for destination in ['another','dashboard']:
        load(page,variant)
        open_manual(page)
        upload(page,'#file-upload',fixtures['manual'])
        page.get_by_role('button',name='Confirmar e Importar',exact=True).click()
        page.get_by_role('button',name='Não Salvar',exact=True).click()
        expect(page.get_by_role('heading',name='Importação concluída',exact=False)).to_be_visible()
        before=rows(page)
        page.get_by_role('button',name='Importar outro arquivo' if destination=='another' else 'Ver minha Dashboard',exact=True).click()
        if destination=='dashboard':expect(page.get_by_role('status')).to_have_text('Destino de navegação: dashboard')
        else:expect(page.get_by_role('heading',name='Importação concluída',exact=False)).to_have_count(0)
        capture(page,'retorno-'+destination)
        assert rows(page)==before
        result['navigation_'+destination]=snapshot(page)
    return result

def accessibility_scenarios(page):
    load(page,variant)
    original=rows(page)
    page.get_by_title('Remover dos favoritos',exact=True).first.focus()
    page.keyboard.press('Enter')
    expect(page.get_by_role('heading',name='Importação Automática',exact=True)).to_have_count(0)
    assert rows(page)==original
    assert any(e['action']=='preferences' for e in snapshot(page)['events'])
    load(page,variant)
    page.get_by_text('Cartão de Crédito XP',exact=True).click()
    chooser=[]
    def on_chooser(value):chooser.append(value)
    page.on('filechooser',on_chooser)
    upload_control=page.get_by_role('button',name='Selecionar arquivo para importação nativa',exact=True)
    expect(upload_control).to_have_attribute('aria-disabled','true')
    upload_control.focus();page.keyboard.press('Enter')
    assert not chooser,'Disabled file input activated'
    page.locator('.fixed.inset-0').last.locator('select').select_option('credit')
    page.locator('input[type="date"]').fill('2026-11-20')
    expect(upload_control).to_have_attribute('aria-disabled','false')
    with page.expect_file_chooser() as chosen:
        upload_control.focus();page.keyboard.press('Enter')
    chosen.value.set_files([])
    page.remove_listener('filechooser',on_chooser)
    close=page.locator('.fixed.inset-0').last.locator('button').first
    close.focus();page.keyboard.press('Shift+Tab')
    expect(upload_control).to_be_focused()
    page.keyboard.press('Tab');expect(close).to_be_focused()
    page.keyboard.press('Escape')
    expect(page.get_by_role('heading',name='Importação Automática',exact=True)).to_have_count(0)
    assert rows(page)==original
    load(page,variant,integration='on',connections='none')
    original=rows(page)
    connect=page.get_by_role('button',name='+ Conectar Novo Banco',exact=True)
    connect.click()
    dialog=page.get_by_role('dialog',name='Conectar via Open Finance',exact=True)
    first=dialog.locator('select')
    first.focus();page.keyboard.press('Shift+Tab')
    expect(dialog.get_by_role('button',name='Cancelar',exact=True)).to_be_focused()
    page.keyboard.press('Tab');expect(first).to_be_focused()
    page.keyboard.press('Escape');expect(connect).to_be_focused()
    assert rows(page)==original
    load(page,variant)
    original=rows(page);open_manual(page)
    manual=page.get_by_role('button',name='Selecionar arquivo para mapeamento',exact=True)
    with page.expect_file_chooser() as chosen:
        manual.focus();page.keyboard.press('Space')
    chosen.value.set_files([])
    assert rows(page)==original
    checks['accessibility'][viewport+'-'+variant]={'favorite_keyboard':True,'disabled_file_control':True,'enabled_file_chooser_keyboard':True,'manual_file_chooser_keyboard':True,'modal_focus_loop_escape_restore':True,'consent_focus_loop_escape_restore':True,'financial_rows_unchanged':True}

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True,args=['--disable-gpu','--force-color-profile=srgb','--disable-skia-runtime-opts','--disable-partial-raster','--run-all-compositor-stages-before-draw'])
    context=browser.new_context(device_scale_factor=1,timezone_id='America/Sao_Paulo',color_scheme='dark',service_workers='block')
    context.add_init_script("localStorage.setItem('import-fence-sentinel','unchanged')")
    remote=[]
    def route(r):
        if r.request.url.startswith(origin+'/'):r.continue_()
        else:remote.append(r.request.url);r.abort()
    context.route('**/*',route)
    page=context.new_page();page.set_default_timeout(20000)
    page_errors=[];page.on('pageerror',lambda error:page_errors.append(str(error)))
    page.clock.set_fixed_time(datetime(2026,11,5,12,0,tzinfo=timezone.utc))
    def native_dialog(dialog):
        native_dialogs.append({'type':dialog.type,'message':dialog.message});dialog.accept()
    page.on('dialog',native_dialog)
    for viewport,width,height in [('desktop',1440,1000),('mobile',390,844)]:
        if args.viewport!='all' and args.viewport!=viewport:continue
        page.set_viewport_size({'width':width,'height':height})
        reference=None;current_dark=None
        for variant in (['light'] if args.themes=='light' else ['reviewed','main','dark','light']):
            images={};presentations={};native_dialogs=[]
            finance={}
            if variant in ['dark','light']:accessibility_scenarios(page)
            if args.suite in ['files','all']:
                finance['files']=file_scenarios(page)
                finance['cards']=card_scenarios(page)
            if args.suite in ['integration','all']:finance['integration']=integration_scenarios(page)
            if args.suite in ['history','all']:finance['history']=history_scenarios(page)
            if args.suite in ['extras','all']:finance['extras']=extra_scenarios(page)
            if args.suite in ['controls','all']:finance['controls']=control_scenarios(page)
            result={'financial':finance,'native_dialogs':native_dialogs}
            (args.out_dir/f'financial-{viewport}-{variant}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
            if reference is None and args.themes=='all':reference={'result':result,'images':images.copy(),'presentation':presentations.copy()}
            elif args.themes=='all':
                assert result==reference['result'],(viewport,variant,'Financial or native-dialog regression')
                assert images.keys()==reference['images'].keys()
                if variant in ['main','dark']:
                    parity={}
                    for state,png in images.items():
                        if variant=='dark' and state in ['arquivo-invalid-excel','consentimento-cpf-invalido','consentimento-erro','integracao-erro-e-suporte','integracao-janela-simulada','integracao-retorno','conexao-removida']:
                            checks['approved_feedback_exceptions'][viewport+'-'+state]={'authorization':'User explicitly approved showing existing hidden notifications in both themes','reference_sha256':hashlib.sha256(reference['images'][state]).hexdigest(),'dark_sha256':hashlib.sha256(png).hexdigest(),'reference_presentation':{key:digest(value) for key,value in reference['presentation'][state].items()},'dark_presentation':{key:digest(value) for key,value in presentations[state].items()},'financial_equivalence':True}
                            continue
                        for key in ['geometry','content','colors']:
                            if presentations[state][key]!=reference['presentation'][state][key]:
                                (args.out_dir/f'failed-parity-{viewport}-{variant}-{state}.json').write_text(json.dumps({'reference':reference['presentation'][state],'actual':presentations[state]},ensure_ascii=False,indent=2),encoding='utf-8')
                            assert presentations[state][key]==reference['presentation'][state][key],(viewport,variant,state,key,'Functional presentation differs')
                        try:parity[state]=compare_rasters(reference['images'][state],png)
                        except AssertionError as error:raise AssertionError((viewport,variant,state,*error.args)) from error
                        if not parity[state]['exact']:
                            proof={'reference':reference['presentation'][state],'actual':presentations[state]}
                            proof_name=f'raster-proof-{viewport}-{variant}-{state}.json'
                            (args.out_dir/proof_name).write_text(json.dumps(proof,ensure_ascii=False,indent=2),encoding='utf-8')
                            parity[state]['presentation_proof']=proof_name
                            parity[state]['presentation_proof_sha256']=hashlib.sha256((args.out_dir/proof_name).read_bytes()).hexdigest()
                    checks['viewports'][viewport+'-'+variant]={'parity':True,'states':parity}
                if variant=='light':
                    assert current_dark is not None
                    for state in presentations:
                        for key in ['geometry','content']:assert presentations[state][key]==current_dark[state][key],(viewport,state,key,'Light/dark layout or content regression')
            if variant=='dark':current_dark=presentations.copy()
            checks['financial'][viewport+'-'+variant]={'equivalent':True,'sha256':digest(result),'states':list(images),'presentation':{state:{key:digest(value) for key,value in values.items()} for state,values in presentations.items()}}
    assert not remote,('Remote requests attempted',remote)
    assert not page_errors,('Unhandled browser error',page_errors)
    checks['javascript_errors']=page_errors
    checks['remote_requests']=len(remote)
    browser.close()
checks['status']='PASS'
contracts=json.loads((repo/'tests/appearance/import-presentation-baseline.json').read_text())
sources=[*contracts['files'],'src/components/imports/ImportFeedback.tsx','src/components/appearance/financial.css','scripts/diagnostics/import-preview-runtime.tsx','scripts/diagnostics/import-preview.tsx','scripts/diagnostics/validate-import-themes.py','scripts/diagnostics/import_visual_checks.py']
checks['source_sha256']={path:hashlib.sha256((repo/path).read_bytes()).hexdigest() for path in sources}
args.manifest.parent.mkdir(parents=True,exist_ok=True)
args.manifest.write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':checks['status'],'captures':sum(len(v['states']) for v in checks['financial'].values()),'contrast_samples':sum(v['samples'] for v in checks['contrast'].values())}),flush=True)
