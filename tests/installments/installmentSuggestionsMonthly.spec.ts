import { describe, expect, it, vi } from 'vitest';
import {
  aplicarEscolhasDeParcela,
  construirSugestoesDeParcela,
  descricoesSemelhantes,
  escolhasIniciaisDeParcela,
  evidenciasDoCandidato,
  podePreSugerir,
} from '../../src/domain/installments/installmentSuggestions';
import { NATIVE_BANK_CONFIGS, parseNativeBankCSV } from '../../src/services/parsers/nativeBankParsers';
import { processStatementFile } from '../../src/services/parserService';
import type { Transaction } from '../../src/types';

/**
 * Chamado reaberto (#f5786b2): a sugestão de parcela existia, mas quase nunca
 * aparecia no uso mensal.
 *
 * A causa: a fatura de cartão repete a data da COMPRA em toda parcela, e a
 * primeira versão exigia irmã com data ESTRITAMENTE anterior. Os testes
 * antigos usavam datas de um mês para o outro — um formato que a fatura real
 * não tem. Aqui as fixtures seguem o formato real: mesma data em todas as
 * parcelas. Comerciantes e valores são fictícios.
 */

const CARTAO = 'conta-cartao-xp';
const OUTRO_CARTAO = 'conta-cartao-outro';
const xp = NATIVE_BANK_CONFIGS.find((c) => c.id === 'cartao-xp')!;
const nubank = NATIVE_BANK_CONFIGS.find((c) => c.id === 'nubank-cartao')!;

type Importada = Omit<Transaction, 'ID_Transacao' | 'user_id'>;

const faturaXp = (linhas: string[]) => `Data;Estabelecimento;Portador;Valor;Parcela\n${linhas.join('\n')}\n`;
const faturaNubank = (linhas: string[]) => `date,title,amount\n${linhas.join('\n')}\n`;

/** O que a gravação faz com o lote: dá id e conta. Nada mais muda. */
let seq = 0;
const gravar = (lote: Importada[], conta: string | null, classificar: Record<string, [string, string]> = {}): Transaction[] =>
  lote.map((t) => {
    seq += 1;
    const manual = classificar[t.Descricao_Original];
    return {
      ...t,
      ID_Transacao: `tx-${seq}`,
      ID_Conta: conta ?? undefined,
      ...(manual ? { Nome_Fantasia: manual[0], Categoria: manual[1] } : {}),
    } as Transaction;
  });

/** Importa um arquivo aceitando o que o modal traz pré-marcado, sem escolher nada à mão. */
const importarAceitandoPreMarcadas = (lote: Importada[], conta: string | null, historico: Transaction[]) => {
  const sugestoes = construirSugestoesDeParcela(lote, conta, historico, { contaEhCartao: true });
  const escolhas = escolhasIniciaisDeParcela(sugestoes);
  return { sugestoes, gravadas: gravar(aplicarEscolhasDeParcela(lote, sugestoes, escolhas), conta) };
};

describe('uso mensal — importação nativa (XP: coluna de parcela, data da compra repetida)', () => {
  it('a 1/6 classificada em janeiro é sugerida na 2/6 de fevereiro, mesmo com a MESMA data', () => {
    const janeiro = parseNativeBankCSV(faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;1 de 6']), xp, [], [], undefined, 'jan.csv');
    const historico = gravar(janeiro.newTransactions, CARTAO, { 'LOJA ALFA SP': ['Sofá da sala', 'Casa'] });

    const fevereiro = parseNativeBankCSV(faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;2 de 6']), xp, historico, [], undefined, 'fev.csv');
    const [sugestao] = construirSugestoesDeParcela(fevereiro.newTransactions, CARTAO, historico, { contaEhCartao: true });

    expect(sugestao).toMatchObject({ nivel: 'reconhecida', parcelaAtual: 2, totalParcelas: 6 });
    expect(sugestao.candidatos).toHaveLength(1);
    expect(sugestao.candidatos[0]).toMatchObject({
      nomeFantasia: 'Sofá da sala', categoria: 'Casa', parcelaAtual: 1, mesmaDataDeCompra: true, confianca: 'exata',
    });
    expect(podePreSugerir(sugestao)).toBe(true);
    expect(evidenciasDoCandidato(sugestao.candidatos[0])).toEqual(['parcela 1/6', 'mesma data de compra', 'mesmo estabelecimento']);
  });

  it('a continuidade segue da 2/6 até a 6/6, sempre com UMA opção pré-marcada', () => {
    let historico = gravar(
      parseNativeBankCSV(faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;1 de 6']), xp, [], [], undefined, 'm1.csv').newTransactions,
      CARTAO,
      { 'LOJA ALFA SP': ['Sofá da sala', 'Casa'] }
    );

    for (let parcela = 2; parcela <= 6; parcela++) {
      const lote = parseNativeBankCSV(
        faturaXp([`05/01/2026;LOJA ALFA SP;TITULAR;100,00;${parcela} de 6`]), xp, historico, [], undefined, `m${parcela}.csv`
      ).newTransactions;
      const { sugestoes, gravadas } = importarAceitandoPreMarcadas(lote, CARTAO, historico);

      // Cinco parcelas anteriores do mesmo plano são UMA sugestão, não cinco opções.
      expect(sugestoes).toHaveLength(1);
      expect(sugestoes[0].candidatos).toHaveLength(1);
      expect(sugestoes[0].candidatos[0].parcelaAtual).toBe(parcela - 1);
      expect(podePreSugerir(sugestoes[0])).toBe(true);
      expect(gravadas[0]).toMatchObject({ Nome_Fantasia: 'Sofá da sala', Categoria: 'Casa', Parcela_Atual: parcela, Total_Parcelas: 6 });
      historico = [...historico, ...gravadas];
    }
    expect(historico).toHaveLength(6);
  });

  it('se o usuário pulou um mês, a parcela seguinte ainda acha a última classificada', () => {
    const historico = [
      ...gravar(parseNativeBankCSV(faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;1 de 6']), xp, [], [], undefined, 'm1.csv').newTransactions, CARTAO, { 'LOJA ALFA SP': ['Sofá da sala', 'Casa'] }),
      // 2/6 entrou sem classificação («importar como veio»).
      ...gravar(parseNativeBankCSV(faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;2 de 6']), xp, [], [], undefined, 'm2.csv').newTransactions, CARTAO),
    ];
    const lote = parseNativeBankCSV(faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;3 de 6']), xp, historico, [], undefined, 'm3.csv').newTransactions;
    const [sugestao] = construirSugestoesDeParcela(lote, CARTAO, historico, { contaEhCartao: true });

    expect(sugestao.candidatos).toHaveLength(1);
    expect(sugestao.candidatos[0]).toMatchObject({ nomeFantasia: 'Sofá da sala', categoria: 'Casa', parcelaAtual: 1 });
    expect(podePreSugerir(sugestao)).toBe(true);
  });

  it('descrição diferente para a mesma compra não impede o reconhecimento', () => {
    const historico = gravar(
      parseNativeBankCSV(faturaXp(['12/03/2026;MERCADOLIVRE*VENDEDORX;TITULAR;83,33;1 de 3']), xp, [], [], undefined, 'm1.csv').newTransactions,
      CARTAO,
      { 'MERCADOLIVRE*VENDEDORX': ['Cadeira de escritório', 'Trabalho'] }
    );
    const lote = parseNativeBankCSV(faturaXp(['12/03/2026;MP *CADEIRAS LTDA;TITULAR;83,33;2 de 3']), xp, historico, [], undefined, 'm2.csv').newTransactions;
    const [sugestao] = construirSugestoesDeParcela(lote, CARTAO, historico, { contaEhCartao: true });

    expect(sugestao.nivel).toBe('reconhecida');
    expect(sugestao.candidatos[0]).toMatchObject({ nomeFantasia: 'Cadeira de escritório', mesmaDataDeCompra: true, descricaoSemelhante: false });
    expect(podePreSugerir(sugestao)).toBe(true);
  });

  it('arredondamento do plano (33,34 + 33,33) continua reconhecido, marcado como diferença de centavo', () => {
    const historico = gravar(
      parseNativeBankCSV(faturaXp(['02/02/2026;LOJA BETA;TITULAR;33,34;1 de 3']), xp, [], [], undefined, 'm1.csv').newTransactions,
      CARTAO, { 'LOJA BETA': ['Presente', 'Presentes'] }
    );
    const lote = parseNativeBankCSV(faturaXp(['02/02/2026;LOJA BETA;TITULAR;33,33;2 de 3']), xp, historico, [], undefined, 'm2.csv').newTransactions;
    const [sugestao] = construirSugestoesDeParcela(lote, CARTAO, historico, { contaEhCartao: true });
    expect(sugestao.candidatos[0].confianca).toBe('centavo');
    expect(evidenciasDoCandidato(sugestao.candidatos[0])).toContain('difere em R$ 0,01');
  });
});

describe('duas compras diferentes com o mesmo valor', () => {
  // Dois planos de 4x de R$ 50,00 no mesmo cartão, comprados em dias diferentes.
  const historico = gravar(
    parseNativeBankCSV(
      faturaXp(['05/01/2026;FARMACIA GAMA;TITULAR;50,00;1 de 4', '20/01/2026;LIVRARIA DELTA;TITULAR;50,00;1 de 4']),
      xp, [], [], undefined, 'm1.csv'
    ).newTransactions,
    CARTAO,
    { 'FARMACIA GAMA': ['Remédios', 'Saúde'], 'LIVRARIA DELTA': ['Livros do curso', 'Educação'] }
  );

  it('cada 2/4 reconhece a SUA compra pela data, sem ambiguidade', () => {
    const lote = parseNativeBankCSV(
      faturaXp(['05/01/2026;FARMACIA GAMA;TITULAR;50,00;2 de 4', '20/01/2026;LIVRARIA DELTA;TITULAR;50,00;2 de 4']),
      xp, historico, [], undefined, 'm2.csv'
    ).newTransactions;
    const sugestoes = construirSugestoesDeParcela(lote, CARTAO, historico, { contaEhCartao: true });

    expect(sugestoes.map((s) => s.candidatos.map((c) => c.categoria))).toEqual([['Saúde'], ['Educação']]);
    expect(sugestoes.every(podePreSugerir)).toBe(true);
  });

  it('uma terceira compra de mesmo valor e prazo NÃO herda a categoria das outras duas', () => {
    // 2/4 de uma compra cujo 1/4 nunca foi importado, em outro dia e outra loja.
    const historicoComDoisMeses = [
      ...historico,
      ...gravar(
        parseNativeBankCSV(faturaXp(['05/01/2026;FARMACIA GAMA;TITULAR;50,00;2 de 4']), xp, [], [], undefined, 'm2.csv').newTransactions,
        CARTAO, { 'FARMACIA GAMA': ['Remédios', 'Saúde'] }
      ),
    ];
    const lote = parseNativeBankCSV(faturaXp(['11/01/2026;PETSHOP OMEGA;TITULAR;50,00;2 de 4']), xp, historicoComDoisMeses, [], undefined, 'm3.csv').newTransactions;

    // O valor e o prazo coincidem, mas nada diz que é a mesma compra: nada a perguntar.
    expect(construirSugestoesDeParcela(lote, CARTAO, historicoComDoisMeses, { contaEhCartao: true })).toEqual([]);
  });

  it('duas compras idênticas no MESMO dia ficam para o usuário escolher — nunca pré-marcadas', () => {
    const gemeas = gravar(
      parseNativeBankCSV(
        faturaXp(['09/02/2026;LOJA SIGMA;TITULAR;70,00;1 de 2', '09/02/2026;LOJA SIGMA;TITULAR;70,00;1 de 2']),
        xp, [], [], undefined, 'm1.csv'
      ).newTransactions,
      CARTAO
    );
    gemeas[0] = { ...gemeas[0], Nome_Fantasia: 'Tênis do Pedro', Categoria: 'Vestuário' };
    gemeas[1] = { ...gemeas[1], Nome_Fantasia: 'Presente da Ana', Categoria: 'Presentes' };

    const lote = parseNativeBankCSV(faturaXp(['09/02/2026;LOJA SIGMA;TITULAR;70,00;2 de 2']), xp, gemeas, [], undefined, 'm2.csv').newTransactions;
    const [sugestao] = construirSugestoesDeParcela(lote, CARTAO, gemeas, { contaEhCartao: true });

    expect(sugestao.candidatos.map((c) => c.categoria).sort()).toEqual(['Presentes', 'Vestuário']);
    expect(podePreSugerir(sugestao)).toBe(false);
    expect(escolhasIniciaisDeParcela([sugestao]).get(sugestao.indice)).toBeNull();
  });

  it('outro cartão nunca candidata, mesmo com tudo igual', () => {
    const lote = parseNativeBankCSV(faturaXp(['05/01/2026;FARMACIA GAMA;TITULAR;50,00;2 de 4']), xp, historico, [], undefined, 'm2.csv').newTransactions;
    expect(construirSugestoesDeParcela(lote, OUTRO_CARTAO, historico, { contaEhCartao: true })).toEqual([]);
  });
});

describe('histórico sem a numeração da parcela', () => {
  it('recuperável: lançamento antigo perdeu os campos, mas o texto do banco diz "Parcela 1/6"', () => {
    // Estado real de lançamentos editados antes da proteção de metadados:
    // Parcela_Atual/Total_Parcelas nulos, texto original preservado.
    const janeiro = parseNativeBankCSV(faturaNubank(['2026-01-08,Loja Kappa - Parcela 1/6,"120,00"']), nubank, [], [], undefined, 'nu-jan.csv');
    const historico = gravar(janeiro.newTransactions, CARTAO, { 'Loja Kappa - Parcela 1/6': ['Geladeira', 'Casa'] })
      .map((t) => ({ ...t, Parcela_Atual: undefined, Total_Parcelas: undefined, Fonte: 'Manual' }));

    const fevereiro = parseNativeBankCSV(faturaNubank(['2026-01-08,Loja Kappa - Parcela 2/6,"120,00"']), nubank, historico, [], undefined, 'nu-fev.csv');
    expect(fevereiro.newTransactions[0]).toMatchObject({ Parcela_Atual: 2, Total_Parcelas: 6 });

    const [sugestao] = construirSugestoesDeParcela(fevereiro.newTransactions, CARTAO, historico, { contaEhCartao: true });
    expect(sugestao.nivel).toBe('reconhecida');
    expect(sugestao.candidatos[0]).toMatchObject({ nomeFantasia: 'Geladeira', parcelaAtual: 1, totalParcelas: 6, parcelaLidaDoTexto: true });
    expect(podePreSugerir(sugestao)).toBe(true);
  });

  it('fora de cartão o texto não é lido como parcela (lá "X/Y" costuma ser data)', () => {
    const historico: Transaction[] = [{
      ID_Transacao: 'cc-1', ID_Conta: 'conta-corrente', Data: new Date(2026, 0, 8), Descricao_Original: 'PIX FULANO 1/6',
      Nome_Fantasia: 'Fulano', Categoria: 'Outros', Valor: -120, Tipo: 'Despesa', Origem: 'extrato.csv', Fonte: 'Banco',
    }];
    const nova = { Descricao_Original: 'PIX FULANO 2/6', Nome_Fantasia: 'PIX FULANO 2/6', Valor: -120, Parcela_Atual: 2, Total_Parcelas: 6, Data: new Date(2026, 0, 9) };
    const [sugestao] = construirSugestoesDeParcela([nova], 'conta-corrente', historico, { contaEhCartao: false });
    // Sem a leitura do texto não é «reconhecida»; sobra só o candidato pelo histórico, nunca pré-marcado.
    expect(sugestao.nivel).toBe('historico');
    expect(podePreSugerir(sugestao)).toBe(false);
  });

  it('não recuperável: mesmo dia, mesmo valor e mesma conta viram candidato PELO HISTÓRICO, sem pré-seleção', () => {
    const historico: Transaction[] = [{
      ID_Transacao: 'h-1', ID_Conta: CARTAO, Data: new Date(2026, 3, 14), Descricao_Original: 'Curso de inglês',
      Nome_Fantasia: 'Curso de inglês', Categoria: 'Educação', Valor: -250, Tipo: 'Despesa', Origem: 'abr.csv', Fonte: 'Manual',
    }];
    const lote = parseNativeBankCSV(faturaXp(['14/04/2026;ESCOLA IDIOMAS ZETA;TITULAR;250,00;2 de 10']), xp, historico, [], undefined, 'mai.csv').newTransactions;
    const [sugestao] = construirSugestoesDeParcela(lote, CARTAO, historico, { contaEhCartao: true });

    expect(sugestao.nivel).toBe('historico');
    expect(sugestao.candidatos[0]).toMatchObject({ categoria: 'Educação', parcelaAtual: null, totalParcelas: null, mesmaDataDeCompra: true });
    expect(podePreSugerir(sugestao)).toBe(false);
    expect(escolhasIniciaisDeParcela([sugestao]).get(sugestao.indice)).toBeNull();
  });

  it('candidato pelo histórico por estabelecimento: mesma loja e mesmo valor, sem irmã confirmada', () => {
    const historico: Transaction[] = [{
      ID_Transacao: 'h-2', ID_Conta: CARTAO, Data: new Date(2026, 1, 3), Descricao_Original: 'OTICA LAMBDA CENTRO',
      Nome_Fantasia: 'Óculos novos', Categoria: 'Saúde', Valor: -180, Tipo: 'Despesa', Origem: 'fev.csv', Fonte: 'Cartão de Crédito XP',
    }];
    const lote = parseNativeBankCSV(faturaXp(['03/03/2026;OTICA LAMBDA CENTRO;TITULAR;180,00;2 de 5']), xp, historico, [], undefined, 'mar.csv').newTransactions;
    const [sugestao] = construirSugestoesDeParcela(lote, CARTAO, historico, { contaEhCartao: true });
    expect(sugestao.nivel).toBe('historico');
    expect(sugestao.candidatos[0]).toMatchObject({ nomeFantasia: 'Óculos novos', descricaoSemelhante: true });
    expect(evidenciasDoCandidato(sugestao.candidatos[0])).toEqual(['mesmo estabelecimento']);
  });

  it('só o valor igual NUNCA é candidato — nem pelo histórico', () => {
    const historico: Transaction[] = [{
      ID_Transacao: 'h-3', ID_Conta: CARTAO, Data: new Date(2026, 1, 3), Descricao_Original: 'RESTAURANTE THETA',
      Nome_Fantasia: 'Jantar', Categoria: 'Alimentação', Valor: -180, Tipo: 'Despesa', Origem: 'fev.csv', Fonte: 'Cartão de Crédito XP',
    }];
    const lote = parseNativeBankCSV(faturaXp(['03/03/2026;OTICA LAMBDA CENTRO;TITULAR;180,00;2 de 5']), xp, historico, [], undefined, 'mar.csv').newTransactions;
    expect(construirSugestoesDeParcela(lote, CARTAO, historico, { contaEhCartao: true })).toEqual([]);
  });

  it('compra anterior ainda sem categoria não é oferecida', () => {
    const historico = gravar(
      parseNativeBankCSV(faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;1 de 6']), xp, [], [], undefined, 'm1.csv').newTransactions, CARTAO
    );
    expect(historico[0].Categoria).toBe('-');
    // Renomeada, mas ainda sem categoria: não há classificação a reaproveitar.
    const renomeada = historico.map((t) => ({ ...t, Nome_Fantasia: 'Loja Alfa (a classificar)' }));
    const lote = parseNativeBankCSV(faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;2 de 6']), xp, renomeada, [], undefined, 'm2.csv').newTransactions;
    expect(construirSugestoesDeParcela(lote, CARTAO, renomeada, { contaEhCartao: true })).toEqual([]);
    expect(construirSugestoesDeParcela(lote, CARTAO, renomeada.map((t) => ({ ...t, Categoria: '' })), { contaEhCartao: true })).toEqual([]);
  });
});

describe('importação manual (mapeamento de colunas)', () => {
  const manual = async (conteudo: string, nome: string, comColunaDeParcela: boolean) => {
    const silencio = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      return await processStatementFile(new File([conteudo], nome), null, [], [], undefined, {
        hasHeader: true,
        dateColumnIndex: 0,
        descriptionColumnIndicies: [1],
        amountColumnIndex: 2,
        installmentsColumnIndex: comColunaDeParcela ? 3 : -1,
        skipLines: 0,
        fileContent: conteudo,
        sourceType: 'Cartao',
        invertValues: true,
      });
    } finally {
      silencio.mockRestore();
    }
  };

  it('com configuração salva e conta associada: 1/6 → 2/6 pela coluna de parcela', async () => {
    const jan = await manual('Data;Descricao;Valor;Parcela\n10/01/2026;MOVEIS IOTA;200,00;1/6\n', 'jan.csv', true);
    expect(jan.newTransactions[0]).toMatchObject({ Parcela_Atual: 1, Total_Parcelas: 6, Valor: -200 });
    const historico = gravar(jan.newTransactions, CARTAO, { 'MOVEIS IOTA': ['Guarda-roupa', 'Casa'] });

    const fev = await manual('Data;Descricao;Valor;Parcela\n10/01/2026;MOVEIS IOTA;200,00;2/6\n', 'fev.csv', true);
    const [sugestao] = construirSugestoesDeParcela(fev.newTransactions, CARTAO, historico, { contaEhCartao: true });
    expect(sugestao.nivel).toBe('reconhecida');
    expect(sugestao.candidatos[0]).toMatchObject({ nomeFantasia: 'Guarda-roupa', categoria: 'Casa' });
    expect(podePreSugerir(sugestao)).toBe(true);
  });

  it('parcela escrita no texto ("LOJA 2/6") também é reconhecida na importação manual', async () => {
    const jan = await manual('Data;Descricao;Valor\n10/01/2026;MOVEIS IOTA 1/6;200,00\n', 'jan.csv', false);
    const historico = gravar(jan.newTransactions, CARTAO, { 'MOVEIS IOTA 1/6': ['Guarda-roupa', 'Casa'] });
    const fev = await manual('Data;Descricao;Valor\n10/01/2026;MOVEIS IOTA 2/6;200,00\n', 'fev.csv', false);

    expect(fev.newTransactions[0]).toMatchObject({ Parcela_Atual: 2, Total_Parcelas: 6 });
    const [sugestao] = construirSugestoesDeParcela(fev.newTransactions, CARTAO, historico, { contaEhCartao: true });
    expect(sugestao.candidatos[0]).toMatchObject({ nomeFantasia: 'Guarda-roupa', mesmaDataDeCompra: true, descricaoSemelhante: true });
  });

  it('data no fim do texto não vira parcela na importação manual', async () => {
    const r = await manual('Data;Descricao;Valor\n10/01/2026;ASSINATURA STREAM 15/07;39,90\n', 'jan.csv', false);
    expect(r.newTransactions[0].Parcela_Atual).toBeUndefined();
    expect(r.newTransactions[0].Total_Parcelas).toBeUndefined();
  });

  it('sem configuração salva (sem conta): compara só com lançamentos também sem conta e nunca pré-marca', async () => {
    const jan = await manual('Data;Descricao;Valor;Parcela\n10/01/2026;MOVEIS IOTA;200,00;1/6\n', 'jan.csv', true);
    const semConta = gravar(jan.newTransactions, null, { 'MOVEIS IOTA': ['Guarda-roupa', 'Casa'] });
    const deOutroCartao = gravar(jan.newTransactions, OUTRO_CARTAO, { 'MOVEIS IOTA': ['Outra coisa', 'Lazer'] });

    const fev = await manual('Data;Descricao;Valor;Parcela\n10/01/2026;MOVEIS IOTA;200,00;2/6\n', 'fev.csv', true);
    const [sugestao] = construirSugestoesDeParcela(fev.newTransactions, null, [...deOutroCartao, ...semConta], { contaEhCartao: true });

    expect(sugestao.contaIndefinida).toBe(true);
    expect(sugestao.candidatos.map((c) => c.categoria)).toEqual(['Casa']);
    expect(podePreSugerir(sugestao)).toBe(false);
  });
});

describe('integridade: a sugestão muda só Nome_Fantasia e Categoria', () => {
  const historico = gravar(
    parseNativeBankCSV(faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;1 de 6']), xp, [], [], undefined, 'm1.csv').newTransactions,
    CARTAO, { 'LOJA ALFA SP': ['Sofá da sala', 'Casa'] }
  );
  const lote = () => parseNativeBankCSV(
    faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;2 de 6', '18/02/2026;PADARIA MU;TITULAR;12,50;-']),
    xp, historico, [], new Date(2026, 2, 10), 'm2.csv'
  ).newTransactions;

  it('valor, datas, descrição original, parcela, portador, fonte e origem não mudam; nada é duplicado', () => {
    const original = lote();
    const sugestoes = construirSugestoesDeParcela(original, CARTAO, historico, { contaEhCartao: true });
    const aplicado = aplicarEscolhasDeParcela(original, sugestoes, escolhasIniciaisDeParcela(sugestoes));

    expect(aplicado).toHaveLength(original.length);
    const soma = (ts: Importada[]) => ts.reduce((total, t) => total + Math.round(t.Valor * 100), 0);
    expect(soma(aplicado)).toBe(soma(original));

    const { Nome_Fantasia: nomeDepois, Categoria: categoriaDepois, ...restoDepois } = aplicado[0];
    const { Nome_Fantasia: nomeAntes, Categoria: categoriaAntes, ...restoAntes } = original[0];
    expect(restoDepois).toEqual(restoAntes);
    expect([nomeAntes, categoriaAntes]).toEqual(['LOJA ALFA SP', '-']);
    expect([nomeDepois, categoriaDepois]).toEqual(['Sofá da sala', 'Casa']);
    // A linha sem sugestão é o MESMO objeto: não foi tocada.
    expect(aplicado[1]).toBe(original[1]);
  });

  it('a consulta não altera o histórico nem o lote', () => {
    const original = lote();
    const antesLote = JSON.stringify(original);
    const antesHistorico = JSON.stringify(historico);
    construirSugestoesDeParcela(original, CARTAO, historico, { contaEhCartao: true });
    expect(JSON.stringify(original)).toBe(antesLote);
    expect(JSON.stringify(historico)).toBe(antesHistorico);
  });

  it('«importar sem aplicar»: desmarcando tudo, o lote sai idêntico ao arquivo', () => {
    const original = lote();
    const sugestoes = construirSugestoesDeParcela(original, CARTAO, historico, { contaEhCartao: true });
    const nenhuma = new Map(sugestoes.map((s) => [s.indice, null] as [number, null]));
    const aplicado = aplicarEscolhasDeParcela(original, sugestoes, nenhuma);
    expect(aplicado).toEqual(original);
    aplicado.forEach((t, i) => expect(t).toBe(original[i]));
  });

  it('parcela que já chega com a mesma descrição e categoria da irmã não gera pergunta', () => {
    const regra = [{ Texto_Contido_Descricao: 'LOJA ALFA', Nome_Fantasia_Sugerido: 'Sofá da sala', Categoria_Sugerida: 'Casa' }];
    const jaClassificado = parseNativeBankCSV(
      faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;2 de 6']), xp, historico, regra as never, undefined, 'm2.csv'
    ).newTransactions;
    expect(jaClassificado[0]).toMatchObject({ Nome_Fantasia: 'Sofá da sala', Categoria: 'Casa' });
    expect(construirSugestoesDeParcela(jaClassificado, CARTAO, historico, { contaEhCartao: true })).toEqual([]);
  });

  it('1/X e compra à vista nunca entram no mecanismo', () => {
    const outros = parseNativeBankCSV(
      faturaXp(['05/01/2026;LOJA ALFA SP;TITULAR;100,00;1 de 6', '05/01/2026;LOJA ALFA SP;TITULAR;100,00;-']),
      xp, historico, [], undefined, 'x.csv'
    ).newTransactions;
    expect(construirSugestoesDeParcela(outros, CARTAO, historico, { contaEhCartao: true })).toEqual([]);
  });
});

describe('estabelecimento semelhante', () => {
  it('ignora o marcador de parcela, acento e pontuação', () => {
    expect(descricoesSemelhantes('Loja Kappa - Parcela 1/6', 'LOJA KAPPA - PARCELA 2/6')).toBe(true);
    expect(descricoesSemelhantes('ÓTICA LAMBDA*CENTRO', 'otica lambda centro')).toBe(true);
  });

  it('aceita o texto truncado pelo banco', () => {
    expect(descricoesSemelhantes('AMAZON MARKETPLACE BR', 'AMAZON MARKETPLACE')).toBe(true);
  });

  it('uma palavra genérica em comum não basta', () => {
    expect(descricoesSemelhantes('LOJA ALFA', 'LOJA BETA')).toBe(false);
    expect(descricoesSemelhantes('AMAZON *LIVRO', 'AMAZON *FONE DE OUVIDO')).toBe(false);
    expect(descricoesSemelhantes('', 'LOJA ALFA')).toBe(false);
  });
});
