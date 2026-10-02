import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManualEntryPayload, type ManualEntryInput } from '../../src/domain/transactions/manualEntryPayload';
import {
  buildDirectedPurchaseDescription,
  buildDirectedRefundDescription,
  isDirectedManualRefund,
  isManualCardRefund,
  isManualInvoicePayment,
  parseDirectedCompetenceFromPayment,
} from '../../src/services/creditCardDirectedPayment';
import {
  inferUserTargetCompetenceOnPaymentEdit,
  prepareManualPurchaseCompetenceOnPaymentDateEdit,
  referenceMonthFromTransaction,
} from '../../src/services/creditCardManualCompetence';
import {
  classifyCompetenceLedgerRole,
  creditCardRebuildFromImportHistoryService,
} from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { Account, Transaction } from '../../src/types';

/**
 * A competência escolhida no formulário precisa chegar ao banco.
 *
 * O modal monta o marcador `finelo_competence:AAAA-MM` na descrição original do estorno
 * (e da compra no cartão). Ao gravar um lançamento NOVO, o mapeamento das telas
 * Transações e Dashboard reescrevia `Descricao_Original` com o nome digitado e o
 * marcador sumia. Sem ele, o estorno voltava a ser classificado pela DATA: um estorno
 * de 02/10 destinado à fatura 09/2026 caía em 10/2026.
 *
 * Cenário reproduzido no staging (conta QA): fatura 09/2026 de R$ 402,10, estorno de
 * R$ 79,90 com data 02/10/2026 e competência 09/2026 escolhida.
 */

const CARD = 'card-exemplo';
const cartao: Account = {
  id: CARD,
  Nome_Conta: 'Cartão Exemplo',
  Tipo_Conta: 'Cartão de Crédito',
  dia_vencimento: 10,
  dia_fechamento: 3,
  limite_credito: 5000,
} as Account;

const ARQUIVO = 'fatura-cartao-exemplo.csv';
const importLogs = [
  {
    id: 'log-fatura',
    file_name: ARQUIVO,
    imported_details: [{ ID_Conta: CARD, Card_Reference_Label: '2026-09', Card_Due_Date: '2026-10-10' }],
  },
] as never[];

const linha = (id: string, data: string, valor: number, nome: string): Transaction =>
  ({
    ID_Transacao: id,
    ID_Conta: CARD,
    Origem: ARQUIVO,
    Fonte: 'Cartão de Crédito Nubank',
    Tipo: 'Despesa',
    Data: data,
    Data_Pagamento: '2026-10-10',
    Valor: valor,
    Nome_Fantasia: nome,
    Descricao_Original: nome,
    Categoria: '-',
  }) as unknown as Transaction;

/** A fatura importada de 09/2026 (R$ 322,20), como no staging. */
const faturaImportada = [
  linha('i1', '2026-08-29', -182.4, 'Mercado Exemplo'),
  linha('i2', '2026-09-03', -24.9, 'Cafeteria Exemplo'),
  linha('i3', '2026-09-12', -39.9, 'Assinatura Exemplo'),
  linha('i4', '2026-09-20', -75, 'Livraria Exemplo'),
];

/**
 * O que `NewTransactionModal.handleSubmit` entrega no `onSave` para um lançamento no cartão.
 * Usa os mesmos construtores de marcador que o modal (ver o teste de ligação no fim).
 */
function saidaDoModalEstorno(p: { data: string; competencia: string; nome: string; valor: number }): ManualEntryInput {
  return {
    Data: p.data as unknown as Date,
    ID_Conta: CARD,
    // Estorno não mostra "Fatura desta compra": a data de pagamento é a própria data.
    Data_Pagamento: p.data as unknown as Date,
    Nome_Fantasia: p.nome,
    Categoria: 'Estornos',
    Tipo: 'Renda',
    Valor: Math.abs(p.valor),
    Parcela_Atual: null,
    Total_Parcelas: null,
    Fonte: 'Manual',
    Descricao_Original: buildDirectedRefundDescription(p.competencia, p.nome),
    linked_asset_id: undefined,
  } as unknown as ManualEntryInput;
}

function saidaDoModalCompra(p: { data: string; fatura: string; nome: string; valor: number; conta?: Account }): ManualEntryInput {
  const ref = inferUserTargetCompetenceOnPaymentEdit(p.fatura, p.data, p.conta ?? cartao)!;
  return {
    Data: p.data as unknown as Date,
    ID_Conta: CARD,
    Data_Pagamento: p.fatura as unknown as Date,
    Nome_Fantasia: p.nome,
    Categoria: 'Compras',
    Tipo: 'Despesa',
    Valor: -Math.abs(p.valor),
    Parcela_Atual: null,
    Total_Parcelas: null,
    Fonte: 'Manual',
    Descricao_Original: buildDirectedPurchaseDescription(ref, p.nome),
    linked_asset_id: undefined,
  } as unknown as ManualEntryInput;
}

/** O que o banco devolve depois do insert: o payload gravado, com id e origem manual. */
function gravar(input: ManualEntryInput, id: string): Transaction {
  const payload = buildManualEntryPayload(input);
  return { ...payload, ID_Transacao: id, user_id: 'qa' } as unknown as Transaction;
}

function faturas(transactions: Transaction[], account: Account = cartao) {
  const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: CARD,
    account,
    accounts: [account],
    transactions,
    importLogs,
  });
  return (ref: string) => cards.find((c) => c.referenceMonth === ref);
}

const estornoDeOutubroParaSetembro = () =>
  gravar(
    saidaDoModalEstorno({ data: '2026-10-02', competencia: '2026-09', nome: 'Estorno Loja Exemplo', valor: 79.9 }),
    'estorno'
  );

const compraLoja = () =>
  gravar(saidaDoModalCompra({ data: '2026-09-25', fatura: '2026-10-10', nome: 'Loja Exemplo', valor: 79.9 }), 'compra-loja');

describe('estorno manual: a competência escolhida chega ao banco', () => {
  it('o payload gravado mantém o marcador da competência escolhida', () => {
    const gravado = estornoDeOutubroParaSetembro();
    expect(gravado.Descricao_Original).toContain('finelo_competence:2026-09');
    expect(parseDirectedCompetenceFromPayment(gravado)).toBe('2026-09');
  });

  it('continua sendo um estorno: Renda, valor positivo, nada de pagamento de fatura', () => {
    const gravado = estornoDeOutubroParaSetembro();
    expect(gravado.Tipo).toBe('Renda');
    expect(Number(gravado.Valor)).toBeCloseTo(79.9, 2);
    expect(gravado.Origem).toBe('manual');
    expect(isManualCardRefund(gravado)).toBe(true);
    expect(isDirectedManualRefund(gravado)).toBe(true);
    expect(isManualInvoicePayment(gravado)).toBe(false);
    expect(classifyCompetenceLedgerRole(gravado)).toBe('estorno');
  });

  it('a data de outubro não vence a escolha: o estorno abate a fatura 09/2026', () => {
    const antes = faturas([...faturaImportada, compraLoja()]);
    expect(antes('2026-09')!.statementTotal).toBeCloseTo(402.1, 2);

    const depois = faturas([...faturaImportada, compraLoja(), estornoDeOutubroParaSetembro()]);
    expect(depois('2026-09')!.statementTotal).toBeCloseTo(322.2, 2);
    expect(depois('2026-09')!.totalRefunds).toBeCloseTo(79.9, 2);
    expect(referenceMonthFromTransaction(estornoDeOutubroParaSetembro(), cartao)).toBe('2026-09');
  });

  it('nenhuma fatura 10/2026 recebe o estorno por causa da data', () => {
    const f = faturas([...faturaImportada, compraLoja(), estornoDeOutubroParaSetembro()]);
    const outubro = f('2026-10');
    expect(outubro?.totalRefunds ?? 0).toBeCloseTo(0, 2);
    expect(outubro?.directedManualRefundTotal ?? 0).toBeCloseTo(0, 2);
  });
});

describe('compra manual no cartão: a fatura escolhida chega ao banco', () => {
  it('o payload gravado mantém o marcador da fatura escolhida', () => {
    const gravado = compraLoja();
    expect(gravado.Descricao_Original).toContain('finelo_competence:2026-09');
    expect(gravado.Tipo).toBe('Despesa');
    expect(Number(gravado.Valor)).toBeCloseTo(-79.9, 2);
  });

  /**
   * Na criação, derivar a competência pela "Fatura desta compra" dá o mesmo resultado que o
   * marcador (é a mesma regra; ver cartaoManualFaturaSoberana). Sem o marcador, porém, a
   * escolha depende do dia de vencimento do cartão NA HORA DA LEITURA: se o vencimento do
   * cartão muda depois, a compra troca de fatura sozinha.
   */
  it('a compra não muda de fatura se o dia de vencimento do cartão mudar depois', () => {
    const gravado = compraLoja();
    const cartaoComOutroVencimento = { ...cartao, dia_vencimento: 15 } as Account;
    expect(referenceMonthFromTransaction(gravado, cartao)).toBe('2026-09');
    expect(referenceMonthFromTransaction(gravado, cartaoComOutroVencimento)).toBe('2026-09');
  });
});

describe('o que não pode mudar', () => {
  it('lançamento manual fora de cartão grava a descrição como antes', () => {
    const input = {
      Data: '2026-10-02',
      ID_Conta: 'conta-exemplo',
      Data_Pagamento: '2026-10-02',
      Nome_Fantasia: 'Cafeteria Exemplo — QA Ajuda',
      Categoria: 'Restaurantes',
      Tipo: 'Despesa',
      Valor: -18.9,
      Parcela_Atual: null,
      Total_Parcelas: null,
      Fonte: 'Manual',
      Descricao_Original: 'Cafeteria Exemplo — QA Ajuda',
    } as unknown as ManualEntryInput;
    const payload = buildManualEntryPayload(input);
    expect(payload.Descricao_Original).toBe('Cafeteria Exemplo — QA Ajuda');
    expect(payload).toEqual({
      Data: '2026-10-02',
      ID_Conta: 'conta-exemplo',
      Data_Pagamento: '2026-10-02',
      Nome_Fantasia: 'Cafeteria Exemplo — QA Ajuda',
      Categoria: 'Restaurantes',
      Tipo: 'Despesa',
      Valor: -18.9,
      Parcela_Atual: null,
      Total_Parcelas: null,
      Fonte: 'Manual',
      Origem: 'manual',
      Descricao_Original: 'Cafeteria Exemplo — QA Ajuda',
    });
  });

  it('sem marcador, a descrição gravada continua sendo o nome (inclusive o rascunho "Lançamento Manual")', () => {
    const base = saidaDoModalEstorno({ data: '2026-10-02', competencia: '2026-09', nome: 'Estorno X', valor: 10 });
    expect(buildManualEntryPayload({ ...base, Descricao_Original: 'Lançamento Manual' }).Descricao_Original).toBe('Estorno X');
    expect(buildManualEntryPayload({ ...base, Descricao_Original: '' }).Descricao_Original).toBe('Estorno X');
  });

  it('marcador inválido não é preservado', () => {
    const base = saidaDoModalEstorno({ data: '2026-10-02', competencia: '2026-09', nome: 'Estorno X', valor: 10 });
    const invalido = { ...base, Descricao_Original: 'Estorno X (2026-13) finelo_competence:2026-13' };
    expect(buildManualEntryPayload(invalido).Descricao_Original).toBe('Estorno X');
  });

  it('sem marcador, a heurística continua valendo: estorno de 02/10 fica em 10/2026', () => {
    const base = saidaDoModalEstorno({ data: '2026-10-02', competencia: '2026-09', nome: 'Estorno sem escolha', valor: 79.9 });
    const legado = gravar({ ...base, Descricao_Original: 'Estorno sem escolha' }, 'legado');
    expect(parseDirectedCompetenceFromPayment(legado)).toBeNull();
    expect(referenceMonthFromTransaction(legado, cartao)).toBe('2026-10');
  });

  it('pagamento pelo botão Pagar não passa por este caminho e continua classificado como pagamento', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/components/views/TransactionsView.tsx'), 'utf8');
    const pagar = src.slice(src.indexOf('const submitPayCreditCardInvoice'), src.indexOf('const submitPayCreditCardInvoice') + 2500);
    expect(pagar).toContain('buildDirectedPaymentDescription(referenceMonth, sourceAccountId)');
    expect(pagar).not.toContain('buildManualEntryPayload');

    const pagamento = {
      ID_Transacao: 'pg',
      ID_Conta: CARD,
      Origem: 'manual',
      Tipo: 'Renda',
      Data: '2026-10-02',
      Data_Pagamento: '2026-10-02',
      Valor: 322.2,
      Nome_Fantasia: 'Pagamento de Fatura',
      Categoria: 'Pagamento de Fatura',
      Descricao_Original: 'Pagamento de Fatura (2026-09) finelo_competence:2026-09',
    } as unknown as Transaction;
    expect(classifyCompetenceLedgerRole(pagamento)).toBe('pagamento');
    expect(isManualCardRefund(pagamento)).toBe(false);
  });
});

describe('edição de estorno com competência escolhida', () => {
  const estornoGravado = {
    ID_Transacao: 'estorno',
    ID_Conta: CARD,
    Origem: 'manual',
    Fonte: 'Manual',
    Tipo: 'Renda',
    Data: '2026-10-02',
    Data_Pagamento: '2026-10-02',
    Valor: 79.9,
    Nome_Fantasia: 'Estorno Loja Exemplo',
    Categoria: 'Estornos',
    Descricao_Original: buildDirectedRefundDescription('2026-09', 'Estorno Loja Exemplo'),
  } as unknown as Transaction;

  it('trocar a data no formulário não substitui a competência escolhida', () => {
    // O modal manda a competência escolhida (09) junto com a data nova.
    const doModal = {
      ...estornoGravado,
      Data: '2026-10-03',
      Data_Pagamento: '2026-10-03',
      Descricao_Original: buildDirectedRefundDescription('2026-09', 'Estorno Loja Exemplo'),
    };
    const persistido = prepareManualPurchaseCompetenceOnPaymentDateEdit(estornoGravado, doModal as unknown as Partial<Transaction>, cartao);
    expect(parseDirectedCompetenceFromPayment(persistido as Transaction)).toBe('2026-09');
  });

  it('editar só a data de pagamento na tabela não move um estorno dirigido', () => {
    const naTabela = { ...estornoGravado, Data_Pagamento: '2026-10-05' };
    const persistido = prepareManualPurchaseCompetenceOnPaymentDateEdit(estornoGravado, naTabela as unknown as Partial<Transaction>, cartao);
    expect(parseDirectedCompetenceFromPayment(persistido as Transaction)).toBe('2026-09');
  });

  it('estorno SEM competência escolhida segue a regra de antes ao editar a data', () => {
    const semEscolha = { ...estornoGravado, Descricao_Original: 'Estorno Loja Exemplo' };
    const persistido = prepareManualPurchaseCompetenceOnPaymentDateEdit(
      semEscolha,
      { Data_Pagamento: '2026-10-05' } as unknown as Partial<Transaction>,
      cartao
    );
    expect(parseDirectedCompetenceFromPayment(persistido as Transaction)).toBe('2026-10');
  });

  it('compra continua tendo a fatura definida pela data de vencimento ao editar', () => {
    const compra = {
      ...compraLoja(),
      ID_Transacao: 'compra-loja',
      Data: '2026-09-25',
      Data_Pagamento: '2026-10-10',
    } as unknown as Transaction;
    const persistido = prepareManualPurchaseCompetenceOnPaymentDateEdit(
      compra,
      { ...compra, Data_Pagamento: '2026-11-10' } as unknown as Partial<Transaction>,
      cartao
    );
    expect(parseDirectedCompetenceFromPayment(persistido as Transaction)).toBe('2026-10');
  });
});

describe('ligação: modal monta o marcador e as duas telas usam o mesmo payload', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf8');

  it('o modal usa os construtores de marcador existentes', () => {
    const modal = read('src/components/modals/NewTransactionModal.tsx');
    expect(modal).toContain('buildDirectedRefundDescription(refundReferenceMonth, description)');
    expect(modal).toContain('buildDirectedPurchaseDescription(ref, description)');
    expect(modal).toContain('Descricao_Original: descricaoOriginal');
  });

  it('Transações e Dashboard gravam lançamento novo pelo mesmo payload', () => {
    ['src/components/views/TransactionsView.tsx', 'src/components/views/DashboardView.tsx'].forEach((f) => {
      const src = read(f);
      expect(src, f).toContain('newTransactions.map(buildManualEntryPayload)');
      expect(src, f).not.toContain('Descricao_Original: t.Nome_Fantasia');
    });
  });
});
