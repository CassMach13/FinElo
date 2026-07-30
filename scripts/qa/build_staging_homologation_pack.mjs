import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const outputRoot = path.resolve('docs/homologacao/staging-2026-07-30');
const filesDir = path.join(outputRoot, 'arquivos');
const previewDir = path.resolve(process.env.TEMP, 'finelo-homologation-previews-20260730');

await fs.mkdir(filesDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

function csvEscape(value, delimiter) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes('\n') || text.includes('\r') || text.includes(delimiter)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsv(rows, delimiter = ',') {
  return rows.map((row) => row.map((value) => csvEscape(value, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}

const baseRows = [
  ['Data', 'Valor', 'Identificador', 'Descrição'],
  ['2026-07-01', '5200.00', 'STG-BASE-001', 'STG-QA SALARIO EMPRESA DEMO'],
  ['2026-07-02', '-120.00', 'STG-BASE-002', 'STG-QA SUPERMERCADO CENTRAL'],
  ['2026-07-03', '-49.90', 'STG-BASE-003', 'STG-QA INTERNET FIBRA'],
  ['2026-07-04', '-35.00', 'STG-BASE-004', 'STG-QA POSTO AVENIDA'],
  ['2026-07-05', '-89.90', 'STG-BASE-005', 'STG-QA FARMACIA SAUDE'],
  ['2026-07-10', '-120.00', 'STG-BASE-006', 'STG-QA SUPERMERCADO CENTRAL'],
  ['2026-07-12', '-49.90', 'STG-BASE-007', 'STG-QA STREAMING VIDEO'],
  ['2026-07-15', '250.00', 'STG-BASE-008', 'STG-QA PIX RECEBIDO CLIENTE A'],
  ['2026-07-20', '-1500.00', 'STG-BASE-009', 'STG-QA ALUGUEL RESIDENCIAL'],
  ['2026-07-24', '-79.90', 'STG-BASE-010', 'STG-QA RESTAURANTE PRACA'],
];

const sameValueRows = [
  ['Data', 'Valor', 'Identificador', 'Descrição'],
  ['2026-08-02', '-120.00', 'STG-SAME-001', 'STG-QA SUPERMERCADO CENTRAL'],
  ['2026-08-03', '-120.00', 'STG-SAME-002', 'STG-QA MERCADO BAIRRO'],
  ['2026-08-04', '-49.90', 'STG-SAME-003', 'STG-QA INTERNET FIBRA'],
  ['2026-08-05', '-49.90', 'STG-SAME-004', 'STG-QA STREAMING VIDEO'],
  ['2026-08-06', '250.00', 'STG-SAME-005', 'STG-QA PIX RECEBIDO CLIENTE B'],
];

const xpJulyRows = [
  ['Data', 'Estabelecimento', 'Portador', 'Valor', 'Parcela'],
  ['02/07/2026', 'STG-QA CURSO ONLINE', 'CONTA DEMO', '300,00', '1/3'],
  ['05/07/2026', 'STG-QA SUPERMERCADO', 'CONTA DEMO', '120,00', ''],
  ['10/07/2026', 'STG-QA ASSINATURA DIGITAL', 'CONTA DEMO', '29,90', ''],
  ['15/07/2026', 'STG-QA ESTORNO CURSO', 'CONTA DEMO', '-50,00', ''],
  ['25/07/2026', 'Pagamentos Validos', 'CONTA DEMO', '-400,00', ''],
];

const xpAugustRows = [
  ['Data', 'Estabelecimento', 'Portador', 'Valor', 'Parcela'],
  ['02/08/2026', 'STG-QA CURSO ONLINE', 'CONTA DEMO', '300,00', '2/3'],
  ['05/08/2026', 'STG-QA SUPERMERCADO', 'CONTA DEMO', '120,00', ''],
  ['10/08/2026', 'STG-QA ASSINATURA DIGITAL', 'CONTA DEMO', '29,90', ''],
  ['20/08/2026', 'Pagamentos Validos', 'CONTA DEMO', '-399,90', ''],
];

const malformedRows = [
  ['Data', 'Valor', 'Identificador', 'Descrição'],
  ['2026-07-01', '-10.00', 'STG-ERR-001', 'STG-QA COMPRA VALIDA'],
  ['data-invalida', '-20.00', 'STG-ERR-002', 'STG-QA DATA INVALIDA'],
  ['2026-07-03', 'valor-invalido', 'STG-ERR-003', 'STG-QA VALOR INVALIDO'],
  ['', '', 'STG-ERR-004', 'STG-QA LINHA VAZIA'],
  ['2026-07-05', '15.00', 'STG-ERR-005', 'STG-QA ESTORNO VALIDO'],
];

const stressRows = [['Data', 'Valor', 'Identificador', 'Descrição']];
for (let index = 1; index <= 1000; index += 1) {
  const day = String(((index - 1) % 28) + 1).padStart(2, '0');
  const isIncome = index % 10 === 0;
  stressRows.push([
    `2026-07-${day}`,
    isIncome ? '1000.00' : '-10.00',
    `STG-STRESS-${String(index).padStart(4, '0')}`,
    isIncome ? 'STG-QA PIX RECEBIDO RECORRENTE' : 'STG-QA COMPRA REPETIDA MESMO VALOR',
  ]);
}

const csvFiles = [
  { name: '01_nubank_conta_base_julho_2026.csv', rows: baseRows, delimiter: ',' },
  { name: '02_nubank_conta_mesmos_valores_agosto_2026.csv', rows: sameValueRows, delimiter: ',' },
  { name: '03_nubank_conta_base_julho_2026_RENOMEADO.csv', rows: baseRows, delimiter: ',' },
  { name: '10_xp_cartao_fatura_julho_2026.csv', rows: xpJulyRows, delimiter: ';' },
  { name: '11_xp_cartao_fatura_agosto_2026.csv', rows: xpAugustRows, delimiter: ';' },
  { name: '90_nubank_conta_stress_1000_linhas.csv', rows: stressRows, delimiter: ',' },
  { name: '91_nubank_conta_linhas_invalidas.csv', rows: malformedRows, delimiter: ',' },
];

for (const file of csvFiles) {
  const csvText = toCsv(file.rows, file.delimiter);
  const validationText = file.delimiter === ';'
    ? toCsv(file.rows, ',')
    : csvText;
  const validationWorkbook = await Workbook.fromCSV(validationText, { sheetName: 'Validacao' });
  const expectedRows = file.rows.length;
  const inspected = await validationWorkbook.inspect({
    kind: 'table',
    range: `Validacao!A1:E${expectedRows}`,
    include: 'values',
    tableMaxRows: Math.min(expectedRows, 12),
    tableMaxCols: 5,
    maxChars: 12000,
  });
  if (!inspected.ndjson || !inspected.ndjson.includes(file.rows[0][0])) {
    throw new Error(`Falha ao validar estruturalmente ${file.name}`);
  }
  await fs.writeFile(path.join(filesDir, file.name), csvText, 'utf8');
}

const workbook = Workbook.create();
const startSheet = workbook.worksheets.add('Comece aqui');
const roadmapSheet = workbook.worksheets.add('Roteiro');
const expectedSheet = workbook.worksheets.add('Dados esperados');
const riskSheet = workbook.worksheets.add('Riscos e rollback');

const navy = '#0F172A';
const slate = '#1E293B';
const cyan = '#06B6D4';
startSheet.showGridLines = false;
startSheet.getRange('A1:H2').merge();
startSheet.getRange('A1').values = [['FinElo — Homologação segura no staging']];
startSheet.getRange('A1:H2').format = {
  fill: navy,
  font: { bold: true, color: '#FFFFFF', size: 20 },
  verticalAlignment: 'center',
  horizontalAlignment: 'left',
};
startSheet.getRange('A4:B11').values = [
  ['Ambiente autorizado', 'Somente staging — sxmmrnwbxntccscojmfh'],
  ['Aplicação', 'https://finelo-br-git-codex-sprint-0-s-24220f-cassios-projects-a7e9d592.vercel.app'],
  ['Prefixo obrigatório', 'STG-QA'],
  ['Dados de produção', 'PROIBIDO copiar ou importar'],
  ['Ordem de execução', 'Seguir a coluna Ordem da aba Roteiro'],
  ['Evidências', 'Capturar tela antes/depois e registrar na coluna Evidência'],
  ['Falha grave', 'Parar imediatamente; não repetir nem tentar corrigir em produção'],
  ['Limpeza', 'Somente após contagem prévia e aprovação explícita'],
];
startSheet.getRange('A4:A11').format = { fill: slate, font: { bold: true, color: '#FFFFFF' } };
startSheet.getRange('B4:B11').format = { fill: '#F1F5F9', font: { color: navy } };
startSheet.getRange('A13:H13').merge();
startSheet.getRange('A13').values = [['REGRA DE OURO: se aparecer qualquer referência ao projeto de produção xotxxxohcmivyzswyjtm, interrompa o teste.']];
startSheet.getRange('A13:H13').format = { fill: '#FEE2E2', font: { bold: true, color: '#991B1B' }, wrapText: true };
startSheet.getRange('A15:B18').values = [
  ['Indicador', 'Resultado'],
  ['Casos aprovados', "=COUNTIF('Roteiro'!$H$6:$H$35,\"Aprovado\")"],
  ['Casos executáveis', "=COUNTA('Roteiro'!$A$6:$A$35)"],
  ['Percentual aprovado', '=IF(B17=0,0,B16/B17)'],
];
startSheet.getRange('A15:B15').format = { fill: cyan, font: { bold: true, color: '#FFFFFF' } };
startSheet.getRange('B18').format.numberFormat = '0.0%';
startSheet.getRange('A1:H18').format.wrapText = true;
startSheet.getRange('A:A').format.columnWidth = 27;
startSheet.getRange('B:B').format.columnWidth = 78;
startSheet.freezePanes.freezeRows(2);

const roadmapRows = [
  ['ENV-01', 1, 'Ambiente', 'Crítica', 'Confirmar que a URL contém o alias de staging e que o Supabase é sxmmrnwbxntccscojmfh.', 'Sem arquivo', 'Nenhuma referência à produção; teste continua.', 'Aprovado', 'Isolamento validado na Sprint 0.'],
  ['AUTH-01', 2, 'Autenticação', 'Crítica', 'Entrar com a conta demo criada no staging.', 'Conta demo', 'Login concluído e painel carregado.', 'Aprovado', 'Validado pelo proprietário em 30/07/2026.'],
  ['AUTH-02', 3, 'Autenticação', 'Alta', 'Confirmar que as duas tentativas de cadastro permanecem separadas. Não excluir usuários.', 'Sem arquivo', 'Dois registros preservados; nenhuma limpeza sem escolha explícita.', 'Aprovado', 'Duas tentativas confirmadas pelo proprietário em 30/07/2026.'],
  ['SETUP-01', 4, 'Preparação', 'Alta', 'Criar categorias STG-QA Alimentação, STG-QA Moradia, STG-QA Transporte e STG-QA Receita.', 'Cadastro manual', 'Quatro categorias visíveis somente na conta demo.', 'Pendente', ''],
  ['SETUP-02', 5, 'Preparação', 'Crítica', 'Criar conta corrente STG-QA Conta Nubank com saldo inicial R$ 1.000,00 em 30/06/2026.', 'Cadastro manual', 'Conta criada com banco NuBank e saldo inicial correto.', 'Pendente', ''],
  ['SETUP-03', 6, 'Preparação', 'Crítica', 'Criar cartão STG-QA Cartão XP; limite R$ 5.000, fechamento dia 20 e vencimento dia 28.', 'Cadastro manual', 'Cartão criado sem alterar outras contas.', 'Pendente', ''],
  ['BASIC-01', 7, 'Plano Basic', 'Alta', 'Importar o arquivo base na conta corrente usando o importador nativo NuBank.', '01_nubank_conta_base_julho_2026.csv', '10 transações; receitas R$ 5.450,00; despesas R$ 2.044,60; líquido R$ 3.405,40.', 'Pendente', ''],
  ['BASIC-02', 8, 'Plano Basic', 'Alta', 'Tentar uma segunda importação no mesmo mês antes de qualquer liberação de teste.', '02_nubank_conta_mesmos_valores_agosto_2026.csv', 'Plano gratuito bloqueia de forma clara e nenhuma linha adicional é gravada.', 'Pendente', ''],
  ['GATE-01', 9, 'Portão', 'Crítica', 'Parar e solicitar ao desenvolvedor a liberação temporária do plano somente para a conta demo no staging.', 'Sem arquivo', 'Liberação registrada com user_id exato, contagens antes/depois e rollback preparado.', 'Pendente', 'Não avançar sem aprovação explícita.'],
  ['MAN-01', 10, 'Transação manual', 'Alta', 'Criar duas despesas de R$ 35,00 com mesma descrição STG-QA Café, mas em datas diferentes.', 'Cadastro manual', 'As duas transações permanecem; nenhuma é tratada como duplicada.', 'Pendente', ''],
  ['MAN-02', 11, 'Transação manual', 'Média', 'Editar uma das despesas para R$ 36,00 e depois restaurar R$ 35,00.', 'Cadastro manual', 'Somente a transação escolhida muda; saldo acompanha a edição e o retorno.', 'Pendente', ''],
  ['IMP-01', 12, 'Importação bancária', 'Crítica', 'Após GATE-01, importar o arquivo de mesmos valores.', '02_nubank_conta_mesmos_valores_agosto_2026.csv', 'Todas as 5 linhas são importadas; valores iguais não causam falso bloqueio.', 'Pendente', ''],
  ['MAP-01', 13, 'Mapeamento', 'Alta', 'Mapear SUPERMERCADO e MERCADO para STG-QA Alimentação e reaplicar regras.', 'Dados já importados', 'Descrições distintas podem compartilhar categoria sem perder transações.', 'Pendente', ''],
  ['DUP-01', 14, 'Duplicidade', 'Crítica', 'Reimportar exatamente o arquivo 02 com o mesmo nome.', '02_nubank_conta_mesmos_valores_agosto_2026.csv', 'Arquivo bloqueado; contagem de transações permanece inalterada.', 'Pendente', ''],
  ['CARD-01', 15, 'Cartão', 'Crítica', 'Importar a fatura XP de julho no cartão STG-QA.', '10_xp_cartao_fatura_julho_2026.csv', '5 linhas; compras R$ 449,90; estorno R$ 50,00; total da competência R$ 399,90.', 'Pendente', ''],
  ['CARD-02', 16, 'Cartão', 'Crítica', 'Importar a fatura XP de agosto no mesmo cartão.', '11_xp_cartao_fatura_agosto_2026.csv', '4 linhas; compras R$ 449,90; pagamento R$ 399,90 direcionado à competência anterior.', 'Pendente', ''],
  ['CARD-03', 17, 'Cartão', 'Crítica', 'Abrir histórico por competência e conferir julho/agosto.', 'Dados CARD-01/02', 'Julho quitado por R$ 399,90; agosto aberto em R$ 449,90; parcela 1/3 e 2/3 não se confundem.', 'Pendente', ''],
  ['CARD-04', 18, 'Cartão', 'Alta', 'Editar uma compra manual do cartão e recarregar a página.', 'Cadastro manual', 'Fatura recalcula uma única vez e persiste após novo login.', 'Pendente', ''],
  ['ERR-01', 19, 'Resiliência', 'Alta', 'Importar o arquivo com linhas inválidas e revisar a prévia antes de confirmar.', '91_nubank_conta_linhas_invalidas.csv', 'Somente 2 linhas válidas; 3 inválidas são explicadas. Se a prévia divergir, cancelar e registrar falha.', 'Falhou', 'Baseline local: 3 linhas emitidas; valor-invalido virou NaN e somente 2 foram ignoradas.'],
  ['DASH-01', 20, 'Dashboard', 'Alta', 'Selecionar julho/2026 e confrontar cartões e gráficos com Dados esperados.', 'Dados importados', 'Totais conciliam sem misturar pagamento de fatura com despesa operacional.', 'Pendente', ''],
  ['BUD-01', 21, 'Orçamento', 'Média', 'Criar orçamento STG-QA Alimentação de R$ 250,00 para 2026.', 'Cadastro manual', 'Indicador reflete apenas despesas categorizadas do período selecionado.', 'Pendente', ''],
  ['EXPORT-01', 22, 'Exportação', 'Média', 'Exportar transações filtradas em CSV e Excel.', 'Dados importados', 'Arquivos abrem, contagens e valores conferem, sem dados de outro usuário.', 'Pendente', ''],
  ['SESSION-01', 23, 'Sessão', 'Alta', 'Sair, entrar novamente e recarregar a página.', 'Conta demo', 'Dados persistem e nenhuma informação de outra tentativa de cadastro aparece.', 'Pendente', ''],
  ['RLS-01', 24, 'Isolamento por usuário', 'Crítica', 'Entrar com a outra tentativa de cadastro e verificar dashboard/contas.', 'Segundo usuário de staging', 'Nenhuma conta, transação, categoria ou fatura do usuário principal aparece.', 'Pendente', ''],
  ['MOBILE-01', 25, 'Responsividade', 'Média', 'Repetir Dashboard, Transações e Importar em largura móvel.', 'Sem arquivo', 'Navegação utilizável; botões, valores e modais sem corte horizontal crítico.', 'Pendente', ''],
  ['PWA-01', 26, 'PWA', 'Média', 'Após carregamento online, simular offline e abrir apenas telas já armazenadas.', 'Sem arquivo', 'App abre sem tela branca; operações de escrita não afirmam sucesso sem rede.', 'Pendente', ''],
  ['PERF-01', 27, 'Estresse', 'Alta', 'Importar o lote de 1.000 linhas somente após backup do estado da conta demo.', '90_nubank_conta_stress_1000_linhas.csv', '1.000 linhas preservadas, inclusive repetições legítimas; sem travamento ou duplicação silenciosa.', 'Pendente', 'Executar perto do fim.'],
  ['DUP-02', 28, 'Duplicidade adversarial', 'Crítica', 'Importar a cópia renomeada do arquivo base somente no final.', '03_nubank_conta_base_julho_2026_RENOMEADO.csv', 'Baseline atual pode duplicar: registrar comportamento e não levar os dados adiante. Melhoria futura deve bloquear por identidade segura.', 'Pendente', 'Teste conhecido como destrutivo apenas no staging.'],
  ['STRIPE-01', 29, 'Pagamentos', 'Crítica', 'Abrir planos no staging sem informar cartão nem concluir checkout.', 'Sem arquivo', 'Nenhuma cobrança real; ausência de segredo Stripe em Preview permanece protegendo o ambiente.', 'Pendente', ''],
  ['ROLLBACK-01', 30, 'Retorno', 'Crítica', 'Executar limpeza apenas da conta demo, após relatório de contagens e aprovação.', 'Prefixo STG-QA', 'Dados sintéticos removidos ou conta preservada conforme decisão; produção inalterada.', 'Pendente', 'Não excluir usuário Auth automaticamente.'],
];

roadmapSheet.showGridLines = false;
roadmapSheet.getRange('A1:I2').merge();
roadmapSheet.getRange('A1').values = [['Roteiro de homologação funcional e adversarial']];
roadmapSheet.getRange('A1:I2').format = { fill: navy, font: { bold: true, color: '#FFFFFF', size: 18 }, verticalAlignment: 'center' };
roadmapSheet.getRange('A3:I3').merge();
roadmapSheet.getRange('A3').values = [['Preencha Status e Evidência. Pare imediatamente em qualquer falha Crítica.']];
roadmapSheet.getRange('A3:I3').format = { fill: '#FEF3C7', font: { bold: true, color: '#92400E' } };
roadmapSheet.getRange('A5:I5').values = [['ID', 'Ordem', 'Área', 'Criticidade', 'Procedimento', 'Arquivo/Dado', 'Resultado esperado', 'Status', 'Evidência/observação']];
roadmapSheet.getRange(`A6:I${5 + roadmapRows.length}`).values = roadmapRows;
roadmapSheet.getRange('A5:I5').format = { fill: cyan, font: { bold: true, color: '#FFFFFF' }, wrapText: true };
roadmapSheet.tables.add(`A5:I${5 + roadmapRows.length}`, true, 'RoteiroTable').style = 'TableStyleMedium2';
roadmapSheet.getRange(`H6:H${5 + roadmapRows.length}`).dataValidation = { rule: { type: 'list', values: ['Pendente', 'Aprovado', 'Falhou', 'Bloqueado'] } };
roadmapSheet.getRange(`H6:H${5 + roadmapRows.length}`).conditionalFormats.add('containsText', { text: 'Aprovado', format: { fill: '#DCFCE7', font: { color: '#166534', bold: true } } });
roadmapSheet.getRange(`H6:H${5 + roadmapRows.length}`).conditionalFormats.add('containsText', { text: 'Falhou', format: { fill: '#FEE2E2', font: { color: '#991B1B', bold: true } } });
roadmapSheet.getRange(`H6:H${5 + roadmapRows.length}`).conditionalFormats.add('containsText', { text: 'Bloqueado', format: { fill: '#FEF3C7', font: { color: '#92400E', bold: true } } });
roadmapSheet.getRange(`A5:I${5 + roadmapRows.length}`).format.wrapText = true;
roadmapSheet.getRange('A:A').format.columnWidth = 14;
roadmapSheet.getRange('B:B').format.columnWidth = 9;
roadmapSheet.getRange('C:C').format.columnWidth = 22;
roadmapSheet.getRange('D:D').format.columnWidth = 13;
roadmapSheet.getRange('E:E').format.columnWidth = 52;
roadmapSheet.getRange('F:F').format.columnWidth = 42;
roadmapSheet.getRange('G:G').format.columnWidth = 58;
roadmapSheet.getRange('H:H').format.columnWidth = 15;
roadmapSheet.getRange('I:I').format.columnWidth = 42;
roadmapSheet.freezePanes.freezeRows(5);

expectedSheet.showGridLines = false;
expectedSheet.getRange('A1:J2').merge();
expectedSheet.getRange('A1').values = [['Dados esperados e reconciliações']];
expectedSheet.getRange('A1:J2').format = { fill: navy, font: { bold: true, color: '#FFFFFF', size: 18 }, verticalAlignment: 'center' };
expectedSheet.getRange('A4:J4').values = [['Arquivo', 'Linhas válidas', 'Receitas/créditos', 'Despesas/compras', 'Estornos', 'Pagamentos', 'Líquido caixa', 'Total fatura', 'Uso', 'Observação']];
const expectedRows = [
  ['01_nubank_conta_base_julho_2026.csv', 10, 5450, 2044.6, 0, 0, '=C5-D5+E5', 0, 'Conta corrente', 'Dois supermercados iguais em datas distintas são legítimos.'],
  ['02_nubank_conta_mesmos_valores_agosto_2026.csv', 5, 250, 339.8, 0, 0, '=C6-D6+E6', 0, 'Falso positivo', 'Valores iguais e descrições mapeáveis não significam duplicidade.'],
  ['03_nubank_conta_base_julho_2026_RENOMEADO.csv', 10, 5450, 2044.6, 0, 0, '=C7-D7+E7', 0, 'Ataque por renomeação', 'Mesmo conteúdo do arquivo 01; executar apenas no fim.'],
  ['10_xp_cartao_fatura_julho_2026.csv', 5, 0, 449.9, 50, 400, '=C8-D8+E8+F8', '=D8-E8', 'Cartão N', 'Pagamento no arquivo pode liquidar competência anterior.'],
  ['11_xp_cartao_fatura_agosto_2026.csv', 4, 0, 449.9, 0, 399.9, '=C9-D9+E9+F9', '=D9-E9', 'Cartão N+1', 'Pagamento de R$ 399,90 deve quitar julho.'],
  ['90_nubank_conta_stress_1000_linhas.csv', 1000, 100000, 9000, 0, 0, '=C10-D10+E10', 0, 'Estresse', '900 despesas repetidas são legítimas; identificadores são únicos.'],
  ['91_nubank_conta_linhas_invalidas.csv', 2, 15, 10, 0, 0, '=C11-D11+E11', 0, 'Erro controlado', 'Desejado: 2 aceitas. Baseline: 3 emitidas; valor-invalido vira NaN (defeito conhecido).'],
];
expectedSheet.getRange('A5:J11').values = expectedRows;
expectedSheet.getRange('A4:J4').format = { fill: cyan, font: { bold: true, color: '#FFFFFF' }, wrapText: true };
expectedSheet.tables.add('A4:J11', true, 'ExpectedDataTable').style = 'TableStyleMedium2';
expectedSheet.getRange('C5:H11').setNumberFormat('"R$" #,##0.00;[Red]("R$" #,##0.00);-');
expectedSheet.getRange('A4:J11').format.wrapText = true;
expectedSheet.getRange('A:A').format.columnWidth = 52;
expectedSheet.getRange('B:B').format.columnWidth = 15;
expectedSheet.getRange('C:H').format.columnWidth = 18;
expectedSheet.getRange('I:I').format.columnWidth = 22;
expectedSheet.getRange('J:J').format.columnWidth = 52;
expectedSheet.freezePanes.freezeRows(4);

riskSheet.showGridLines = false;
riskSheet.getRange('A1:F2').merge();
riskSheet.getRange('A1').values = [['Riscos, portões e retorno ao estado anterior']];
riskSheet.getRange('A1:F2').format = { fill: navy, font: { bold: true, color: '#FFFFFF', size: 18 }, verticalAlignment: 'center' };
riskSheet.getRange('A4:F4').values = [['Risco', 'Severidade', 'Sinal de parada', 'Proteção', 'Rollback', 'Aprovação necessária']];
riskSheet.getRange('A5:F11').values = [
  ['Contaminação da produção', 'Crítica', 'URL/ref de produção em qualquer tela ou bundle', 'Alias de staging + Supabase sxmm... + prefixo STG-QA', 'Parar sem salvar; nenhuma ação na produção', 'Sempre'],
  ['Exclusão do usuário errado', 'Crítica', 'user_id não conciliado com a sessão testada', 'Contagem por tabela e confirmação do e-mail apenas no painel', 'Não excluir Auth; limpar somente dados com user_id exato', 'Sempre'],
  ['Falso positivo de duplicidade', 'Alta', 'Linha legítima marcada como duplicada', 'Arquivos 01/02 e identificadores únicos', 'Cancelar importação e preservar evidência', 'Antes de correção'],
  ['Duplicação por arquivo renomeado', 'Alta', 'Arquivo 03 adiciona novamente as 10 linhas', 'Executar por último, somente no staging', 'Excluir lote pela Origem/log após contagem', 'Antes de executar'],
  ['Regressão de cartão', 'Crítica', 'Julho/agosto, parcelas ou pagamentos não conciliam', 'Importar N e N+1 em ordem e comparar totais', 'Remover lotes de cartão da conta demo; não reprocessar produção', 'Sempre'],
  ['Teste de carga degrada a sessão', 'Alta', 'Travamento, timeout ou contagem parcial', 'Backup lógico da conta demo e arquivo de 1.000 linhas', 'Remover lote de estresse pelo log/origem', 'Antes de executar'],
  ['Valor textual vira NaN', 'Alta', 'Prévia mostra linha STG-QA VALOR INVALIDO', 'Cancelar sem confirmar e preservar a evidência', 'Nenhuma linha do arquivo inválido deve ser salva', 'Antes de corrigir'],
];
riskSheet.getRange('A4:F4').format = { fill: cyan, font: { bold: true, color: '#FFFFFF' }, wrapText: true };
riskSheet.tables.add('A4:F11', true, 'RiskTable').style = 'TableStyleMedium2';
riskSheet.getRange('A12:F12').merge();
riskSheet.getRange('A12').values = [['Sequência segura de rollback da conta demo (não executar automaticamente)']];
riskSheet.getRange('A12:F12').format = { fill: slate, font: { bold: true, color: '#FFFFFF' } };
riskSheet.getRange('A13:B20').values = [
  [1, 'Interromper novos testes e registrar o último caso executado.'],
  [2, 'Confirmar projeto sxmmrnwbxntccscojmfh e usuário autenticado.'],
  [3, 'Levantar contagens por tabela para o user_id da conta demo.'],
  [4, 'Exportar evidências e, se necessário, um backup lógico somente da conta demo.'],
  [5, 'Apresentar exatamente quais linhas/lotes serão removidos e pedir aprovação.'],
  [6, 'Excluir dados em transação e na ordem das dependências; não excluir Auth automaticamente.'],
  [7, 'Recontar tabelas e validar login, dashboard e RLS.'],
  [8, 'Se a liberação de plano foi criada, restaurar o estado Basic da conta demo.'],
];
riskSheet.getRange('B13:F13').merge();
riskSheet.getRange('B14:F14').merge();
riskSheet.getRange('B15:F15').merge();
riskSheet.getRange('B16:F16').merge();
riskSheet.getRange('B17:F17').merge();
riskSheet.getRange('B18:F18').merge();
riskSheet.getRange('B19:F19').merge();
riskSheet.getRange('B20:F20').merge();
riskSheet.getRange('A13:A20').format = { fill: '#E2E8F0', font: { bold: true, color: navy }, horizontalAlignment: 'center' };
riskSheet.getRange('A13:F20').format.rowHeight = 34;
riskSheet.getRange('A4:F20').format.wrapText = true;
riskSheet.getRange('A:A').format.columnWidth = 32;
riskSheet.getRange('B:B').format.columnWidth = 18;
riskSheet.getRange('C:C').format.columnWidth = 44;
riskSheet.getRange('D:D').format.columnWidth = 48;
riskSheet.getRange('E:E').format.columnWidth = 50;
riskSheet.getRange('F:F').format.columnWidth = 22;
riskSheet.freezePanes.freezeRows(4);

const workbookInspect = await workbook.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 12000,
  tableMaxRows: 8,
  tableMaxCols: 10,
});
if (
  !workbookInspect.ndjson ||
  roadmapSheet.tables.items.length !== 1 ||
  expectedSheet.tables.items.length !== 1 ||
  riskSheet.tables.items.length !== 1
) {
  throw new Error('A inspeção final não encontrou as tabelas obrigatórias.');
}

const formulaErrors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 300 },
  summary: 'final formula error scan',
});
if (formulaErrors.ndjson && /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/.test(formulaErrors.ndjson)) {
  throw new Error(`Erros de fórmula encontrados: ${formulaErrors.ndjson}`);
}

for (const sheetName of ['Comece aqui', 'Roteiro', 'Dados esperados', 'Riscos e rollback']) {
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(path.join(previewDir, `${sheetName.replaceAll(' ', '_')}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
const workbookPath = path.join(outputRoot, 'FinElo_Roadmap_Homologacao_Staging_2026-07-30.xlsx');
await xlsx.save(workbookPath);
await fs.rm(`${workbookPath}.inspect.ndjson`, { force: true });

const manifestLines = ['SHA256  ARQUIVO'];
for (const file of [...csvFiles.map((item) => item.name), 'FinElo_Roadmap_Homologacao_Staging_2026-07-30.xlsx']) {
  const filePath = file.endsWith('.xlsx') ? path.join(outputRoot, file) : path.join(filesDir, file);
  const bytes = await fs.readFile(filePath);
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  manifestLines.push(`${hash}  ${file}`);
}
await fs.writeFile(path.join(outputRoot, 'MANIFESTO-SHA256.txt'), manifestLines.join('\r\n') + '\r\n', 'utf8');

console.log(JSON.stringify({ outputRoot, files: csvFiles.length + 2, previews: previewDir }, null, 2));
