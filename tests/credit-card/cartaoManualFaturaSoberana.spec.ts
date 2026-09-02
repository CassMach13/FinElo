import { describe, expect, it } from 'vitest';
import {
  creditCardRebuildFromImportHistoryService,
} from '../../src/services/creditCardRebuildFromImportHistoryService';
import { projectCardTwoLedger } from '../../src/domain/credit-card/twoLedgerProjection';
import {
  referenceMonthFromTransaction,
  inferUserTargetCompetenceOnPaymentEdit,
} from '../../src/services/creditCardManualCompetence';
import { buildDirectedPurchaseDescription } from '../../src/services/creditCardDirectedPayment';
import type { Account, Transaction } from '../../src/types';

/**
 * O cartão manual, e a fatura que o usuário escolheu.
 *
 * Num lançamento manual a segunda data não é «quando eu paguei»: é EM QUE
 * FATURA a compra será cobrada. Como a competência N vence em N+1, dela sai a
 * competência por subtração — e nada deveria recalcular isso por estimativa.
 *
 * Duas heurísticas faziam exatamente isso, e as duas descartavam a escolha:
 * compra e vencimento no mesmo mês devolvia o mês da COMPRA, e compra muito
 * antes do vencimento devolvia o mês do VENCIMENTO. A primeira fundia numa
 * fatura só duas compras que o usuário separou de propósito.
 *
 * Em paralelo, um pagamento manual que apontasse para uma competência sem
 * fatura era ESCONDIDO pelo filtro de competência fantasma — o dinheiro sumia
 * de todas as telas, sem erro, e o saldo não andava.
 */

const ACC = 'card-1';
const conta: Account = {
  id: ACC,
  Nome_Conta: 'Cartão Manual',
  Tipo_Conta: 'Cartão de Crédito',
  dia_vencimento: 10,
  limite_credito: 10000,
} as Account;

const tx = (over: Record<string, unknown>): Transaction =>
  ({ ID_Conta: ACC, Origem: 'manual', ...over }) as unknown as Transaction;

/** Compra manual como o formulário passa a gravá-la: com a fatura junto. */
const compraCriadaPeloFormulario = (id: string, data: string, vencimento: string, valor: number) => {
  const ref = inferUserTargetCompetenceOnPaymentEdit(vencimento, data, conta)!;
  return tx({
    ID_Transacao: id, Tipo: 'Despesa', Data: data, Data_Pagamento: vencimento, Valor: valor,
    Nome_Fantasia: `Compra ${id}`, Categoria: 'Compras',
    Descricao_Original: buildDirectedPurchaseDescription(ref, `Compra ${id}`),
  });
};

/** A mesma compra sem marcador — como as linhas antigas do banco estão hoje. */
const compraSemMarcador = (id: string, data: string, vencimento: string, valor: number) =>
  tx({
    ID_Transacao: id, Tipo: 'Despesa', Data: data, Data_Pagamento: vencimento, Valor: valor,
    Nome_Fantasia: `Compra ${id}`, Categoria: 'Compras', Descricao_Original: `Compra ${id}`,
  });

const pagamentoDirigido = (id: string, data: string, ref: string, valor: number) =>
  tx({
    ID_Transacao: id, Tipo: 'Renda', Data: data, Data_Pagamento: data, Valor: valor,
    Nome_Fantasia: 'Pagamento de Fatura', Categoria: 'Pagamento de Fatura',
    Descricao_Original: `Pagamento de Fatura (${ref}) finelo_competence:${ref}`,
  });

function projetar(transactions: Transaction[]) {
  const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: ACC, account: conta, accounts: [conta], transactions, importLogs: [],
  });
  const p = projectCardTwoLedger(cards, { asOf: '2026-11-02' });
  return { cards, p, mes: (ref: string) => p.competences.find((c) => c.referenceMonth === ref) };
}

// ---------------------------------------------------------------------------

describe('a fatura informada define a competência', () => {
  it('compra 05/08 com fatura 10/08 vai para 2026-07', () => {
    expect(referenceMonthFromTransaction(compraSemMarcador('A', '2026-08-05', '2026-08-10', -500), conta))
      .toBe('2026-07');
  });

  it('compra 05/08 com fatura 10/09 vai para 2026-08', () => {
    expect(referenceMonthFromTransaction(compraSemMarcador('B', '2026-08-05', '2026-09-10', -700), conta))
      .toBe('2026-08');
  });

  /** O caso que motivou tudo: mesma data de compra, faturas diferentes. */
  it('duas compras no mesmo dia com faturas diferentes NÃO se fundem', () => {
    const { mes } = projetar([
      compraCriadaPeloFormulario('A', '2026-08-05', '2026-08-10', -500),
      compraCriadaPeloFormulario('B', '2026-08-05', '2026-09-10', -700),
    ]);

    expect(mes('2026-07')?.statementTotalCents).toBe(50000);
    expect(mes('2026-08')?.statementTotalCents).toBe(70000);
  });

  it('a competência sai do vencimento também na virada de ano', () => {
    const c = (data: string, venc: string) =>
      referenceMonthFromTransaction(compraSemMarcador('x', data, venc, -100), conta);

    expect(c('2026-12-05', '2027-01-10')).toBe('2026-12');
    expect(c('2025-12-20', '2026-01-10')).toBe('2025-12');
    expect(c('2026-01-05', '2026-01-10')).toBe('2025-12');
  });

  /**
   * Criação grava o marcador; leitura sem marcador deriva pela mesma regra.
   * Se as duas discordassem, a mesma compra mudaria de fatura conforme tivesse
   * sido digitada de uma vez ou ajustada depois.
   */
  it('criação e derivação produzem exatamente a mesma competência', () => {
    const casos: Array<[string, string]> = [
      ['2026-08-05', '2026-08-10'],
      ['2026-08-05', '2026-09-10'],
      ['2026-06-05', '2026-09-10'],
      ['2026-12-05', '2027-01-10'],
      ['2026-08-05', '2026-09-15'],
    ];

    for (const [data, venc] of casos) {
      const criada = referenceMonthFromTransaction(compraCriadaPeloFormulario('c', data, venc, -100), conta);
      const derivada = referenceMonthFromTransaction(compraSemMarcador('d', data, venc, -100), conta);
      expect(criada, `compra ${data} fatura ${venc}`).toBe(derivada);
    }
  });
});

describe('pagamento de fatura', () => {
  const fatura = compraCriadaPeloFormulario('F', '2026-08-05', '2026-09-10', -1000);
  const REF = '2026-08';

  it('pagamentos parciais abatem a fatura em sequência', () => {
    const p1 = pagamentoDirigido('p1', '2026-09-05', REF, 300);
    const p2 = pagamentoDirigido('p2', '2026-09-07', REF, 400);
    const p3 = pagamentoDirigido('p3', '2026-09-09', REF, 300);

    expect(projetar([fatura]).mes(REF)?.economicOpenBalanceCents).toBe(100000);
    expect(projetar([fatura, p1]).mes(REF)?.economicOpenBalanceCents).toBe(70000);
    expect(projetar([fatura, p1, p2]).mes(REF)?.economicOpenBalanceCents).toBe(30000);
    expect(projetar([fatura, p1, p2, p3]).mes(REF)?.economicOpenBalanceCents).toBe(0);
  });

  it('o limite utilizado acompanha cada pagamento parcial', () => {
    const p1 = pagamentoDirigido('p1', '2026-09-05', REF, 300);
    const p2 = pagamentoDirigido('p2', '2026-09-07', REF, 400);

    expect(projetar([fatura]).p.economicUsedCents).toBe(100000);
    expect(projetar([fatura, p1]).p.economicUsedCents).toBe(70000);
    expect(projetar([fatura, p1, p2]).p.economicUsedCents).toBe(30000);
  });

  it('pagar a maior zera a fatura e deixa a sobra no livro 2, sem tocar no limite', () => {
    const { p, mes } = projetar([fatura, pagamentoDirigido('p1', '2026-09-09', REF, 1000.22)]);
    const c = mes(REF)!;

    expect(c.economicOpenBalanceCents).toBe(0);
    expect(c.unresolvedReconciliationDeltaCents).toBe(22);
    expect(c.reconciliationStatus).toBe('unreconciled');
    expect(p.economicUsedCents).toBe(0);
    expect(p.economicCarryCents).toBe(0);
  });

  /**
   * REGRESSÃO. Um pagamento apontado para uma competência sem fatura caía no
   * filtro de fantasma e desaparecia de todas as superfícies.
   */
  it('pagamento em competência sem fatura aparece — nunca some', () => {
    const { cards, mes } = projetar([
      fatura,
      pagamentoDirigido('solto', '2026-10-05', '2026-09', 300),
    ]);

    const orfa = mes('2026-09');
    expect(orfa, 'a competência do pagamento foi escondida').toBeDefined();
    expect(orfa!.recognizedPaymentsCents).toBe(30000);

    const card = cards.find((k) => k.referenceMonth === '2026-09')!;
    expect(card.directedManualPaymentTotal).toBeCloseTo(300, 2);
    // E não foi transformado em estorno: não reduziu total de fatura nenhuma.
    expect(card.totalRefunds).toBeCloseTo(0, 2);
    expect(mes('2026-08')?.statementTotalCents).toBe(100000);
  });

  it('pagamento não vira estorno silenciosamente', () => {
    const { cards } = projetar([fatura, pagamentoDirigido('p1', '2026-09-05', REF, 300)]);
    const card = cards.find((k) => k.referenceMonth === REF)!;

    expect(card.totalPayments).toBeCloseTo(300, 2);
    expect(card.totalRefunds).toBeCloseTo(0, 2);
    expect(card.statementTotal).toBeCloseTo(1000, 2);
  });
});

describe('estorno explícito continua reduzindo a fatura', () => {
  it('estorno dirigido abate o total, e não os pagamentos', () => {
    const { cards, mes } = projetar([
      compraCriadaPeloFormulario('F', '2026-08-05', '2026-09-10', -1000),
      tx({
        ID_Transacao: 'e1', Tipo: 'Renda', Data: '2026-08-20', Data_Pagamento: '2026-08-20',
        Valor: 150, Nome_Fantasia: 'Estorno loja', Categoria: 'Estornos/Reembolsos',
        Descricao_Original: 'Estorno loja (2026-08) finelo_competence:2026-08',
      }),
    ]);

    const card = cards.find((k) => k.referenceMonth === '2026-08')!;
    expect(card.totalRefunds).toBeCloseTo(150, 2);
    expect(card.totalPayments).toBeCloseTo(0, 2);
    expect(mes('2026-08')?.statementTotalCents).toBe(85000);
  });
});
