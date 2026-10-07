import { describe, expect, it } from 'vitest';
import {
  buildBudgetIndex,
  buildManagerRows,
  canNavigateToMonth,
  clampManagerMonth,
  computeBudgetLines,
  computeBudgetLineTotals,
  describeRemaining,
  editRightsFor,
  isEligibleBudgetCategory,
  monthsInRange,
  nextMonth,
  planCopyFromPreviousMonth,
  planManagerSave,
  previousMonth,
  resolveEffectiveLimit,
} from '../../src/domain/budgets/monthlyBudget';
import { parseMoneyInput } from '../../src/domain/goals/goalProgress';
import type { Budget, BudgetMonth, Category, Transaction } from '../../src/types';

const A = 'user-a';
const B = 'user-b';

const range = (y: number, m1: number, m2 = m1, y2 = y) => ({
  start: new Date(y, m1 - 1, 1, 0, 0, 0, 0),
  end: new Date(y2, m2, 0, 23, 59, 59, 999),
});

let seq = 0;
const annual = (owner: string, Categoria: string, valor: number, ano = 2026): Budget => ({
  id: `a${(seq += 1)}`,
  user_id: owner,
  Categoria,
  Valor_Limite_Mensal: valor,
  ano,
});
const monthly = (owner: string, Categoria: string, year: number, month: number, amount: number): BudgetMonth => ({
  id: `m${(seq += 1)}`,
  user_id: owner,
  Categoria,
  year,
  month,
  amount,
  created_at: '',
  updated_at: '',
});
const tx = (owner: string | undefined, Categoria: string, date: string, valor: number, extra: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: `t${(seq += 1)}`,
    user_id: owner,
    Data: date,
    Categoria,
    Tipo: 'Despesa',
    Valor: -Math.abs(valor),
    Nome_Fantasia: 'x',
    Descricao_Original: 'x',
    Origem: 'manual',
    Fonte: 'Manual',
    ...extra,
  }) as unknown as Transaction;

const ownerOf = (t: Transaction) => t.user_id;
const lines = (
  budgets: Budget[],
  budgetMonths: BudgetMonth[],
  transactions: Transaction[],
  r = range(2026, 10),
  currentUserId = A
) => computeBudgetLines({ budgets, budgetMonths, transactions, range: r, currentUserId, getTransactionOwnerId: ownerOf, referenceDate: new Date(2026, 9, 15) });

const cats: Category[] = [
  { id: '1', Nome_Categoria: 'Alimentação', Tipo: 'Despesa' },
  { id: '2', Nome_Categoria: 'Transporte', Tipo: 'Despesa' },
  { id: '3', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '4', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: '5', Nome_Categoria: 'Aportes', Tipo: 'Despesa', is_investment: true },
];

describe('Limite efetivo', () => {
  it('mensal ganha do anual do mesmo dono', () => {
    const idx = buildBudgetIndex([annual(A, 'Alimentação', 1400)], [monthly(A, 'Alimentação', 2026, 10, 1500)], A);
    expect(resolveEffectiveLimit(idx, A, 'Alimentação', 2026, 10)).toMatchObject({ amount: 1500, source: 'monthly' });
  });

  it('sem mensal, usa o anual do mesmo dono e ano', () => {
    const idx = buildBudgetIndex([annual(A, 'Alimentação', 1400)], [], A);
    const r = resolveEffectiveLimit(idx, A, 'Alimentação', 2026, 3);
    expect(r).toMatchObject({ amount: 1400, source: 'annual' });
    expect(r?.legacyBudgetId).toBeDefined();
    expect(resolveEffectiveLimit(idx, A, 'Alimentação', 2025, 3)).toBeNull(); // outro ano
  });

  it('o anual de A nunca serve para B; o mensal de A nunca serve para B', () => {
    const idx = buildBudgetIndex([annual(A, 'Alimentação', 1400)], [monthly(A, 'Transporte', 2026, 10, 300)], A);
    expect(resolveEffectiveLimit(idx, B, 'Alimentação', 2026, 10)).toBeNull();
    expect(resolveEffectiveLimit(idx, B, 'Transporte', 2026, 10)).toBeNull();
  });

  it('nenhum → sem orçamento', () => {
    expect(resolveEffectiveLimit(buildBudgetIndex([], [], A), A, 'X', 2026, 1)).toBeNull();
  });

  it('o mensal de um mês não vale em outro (novembro não muda outubro)', () => {
    const idx = buildBudgetIndex([], [monthly(A, 'Alimentação', 2026, 11, 1650)], A);
    expect(resolveEffectiveLimit(idx, A, 'Alimentação', 2026, 10)).toBeNull();
    expect(resolveEffectiveLimit(idx, A, 'Alimentação', 2026, 11)?.amount).toBe(1650);
  });

  it('registro legado sem user_id cai no usuário atual (fixture antiga), nunca em outro dono', () => {
    const legacy = { id: 'x', Categoria: 'Alimentação', Valor_Limite_Mensal: 500, ano: 2026 } as Budget;
    const idx = buildBudgetIndex([legacy], [], A);
    expect(resolveEffectiveLimit(idx, A, 'Alimentação', 2026, 1)?.amount).toBe(500);
    expect(resolveEffectiveLimit(idx, B, 'Alimentação', 2026, 1)).toBeNull();
  });
});

describe('Período e limite somado', () => {
  it('monthsInRange: 1, 3, 6, 12 meses, virada de ano e custom parcial', () => {
    expect(monthsInRange(range(2026, 10))).toEqual([{ year: 2026, month: 10 }]);
    expect(monthsInRange(range(2026, 1, 3))).toHaveLength(3);
    expect(monthsInRange(range(2026, 1, 6))).toHaveLength(6);
    expect(monthsInRange(range(2026, 1, 12))).toHaveLength(12);
    expect(monthsInRange(range(2026, 11, 2, 2027)).map((m) => `${m.year}-${m.month}`)).toEqual(['2026-11', '2026-12', '2027-1', '2027-2']);
    const partial = { start: new Date(2026, 9, 20), end: new Date(2026, 10, 5, 23, 59, 59) };
    expect(monthsInRange(partial)).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 11 }]);
  });

  it('soma os limites EFETIVOS mês a mês (valores mudam por mês)', () => {
    const l = lines(
      [annual(A, 'Alimentação', 1000)],
      [monthly(A, 'Alimentação', 2026, 2, 1200), monthly(A, 'Alimentação', 2026, 3, 1500)],
      [],
      range(2026, 1, 3)
    );
    expect(l).toHaveLength(1);
    expect(l[0].limit).toBe(1000 + 1200 + 1500);
    expect(l[0].sources).toEqual(['annual', 'monthly']);
  });

  it('virada do ano: anual de 2026 não vale em janeiro/2027, mas o mensal sim', () => {
    const l = lines([annual(A, 'Alimentação', 1000, 2026)], [monthly(A, 'Alimentação', 2027, 1, 1100)], [], range(2026, 12, 1, 2027));
    expect(l[0].limit).toBe(1000 + 1100);
  });

  it('custom que intercepta parte de um mês conta o limite mensal INTEIRO, sem prorrata', () => {
    const partial = { start: new Date(2026, 9, 28), end: new Date(2026, 9, 31, 23, 59, 59) };
    const l = lines([annual(A, 'Alimentação', 900)], [], [tx(A, 'Alimentação', '2026-10-29', 100), tx(A, 'Alimentação', '2026-10-05', 999)], partial);
    expect(l[0].limit).toBe(900);
    expect(l[0].spent).toBe(100); // só o que está dentro das datas do período
    const two = { start: new Date(2026, 9, 28), end: new Date(2026, 10, 3, 23, 59, 59) };
    expect(lines([annual(A, 'Alimentação', 900)], [], [], two)[0].limit).toBe(1800);
  });

  it('mês SEM orçamento no período: nem limite nem gasto daquele mês entram', () => {
    const l = lines(
      [],
      [monthly(A, 'Alimentação', 2026, 10, 1000)],
      [tx(A, 'Alimentação', '2026-10-10', 300), tx(A, 'Alimentação', '2026-11-10', 700)],
      range(2026, 10, 11)
    );
    expect(l[0].limit).toBe(1000);
    expect(l[0].spent).toBe(300);
  });

  it('linha só existe se algum mês do período tem limite', () => {
    expect(lines([annual(A, 'Alimentação', 1000, 2025)], [], [tx(A, 'Alimentação', '2026-10-10', 10)])).toEqual([]);
  });
});

describe('Gasto por dono (modelo pessoal)', () => {
  const budgets = [annual(A, 'Alimentação', 1500), annual(B, 'Alimentação', 1000)];
  const txs = [
    tx(A, 'Alimentação', '2026-10-03', 900),
    tx(B, 'Alimentação', '2026-10-04', 700),
    tx(B, 'Transporte', '2026-10-04', 50), // sem orçamento
  ];

  it('A e B com a mesma categoria viram linhas separadas, cada uma com o gasto do próprio dono', () => {
    const l = lines(budgets, [], txs);
    expect(l).toHaveLength(2);
    const a = l.find((x) => x.ownerUserId === A)!;
    const b = l.find((x) => x.ownerUserId === B)!;
    expect([a.limit, a.spent]).toEqual([1500, 900]);
    expect([b.limit, b.spent]).toEqual([1000, 700]);
  });

  it('total sem dupla contagem: 2.500 / 1.600 (não 2 × o gasto familiar)', () => {
    const t = computeBudgetLineTotals(lines(budgets, [], txs));
    expect(t.limit).toBe(2500);
    expect(t.spent).toBe(1600);
    expect(t.remaining).toBe(900);
    expect(t.exceeded).toBe(false);
  });

  it('o dono da transação segue o resolvedor do contexto (fallback pelo dono da conta)', () => {
    const noOwner = tx(undefined, 'Alimentação', '2026-10-05', 40, { ID_Conta: 'conta-b' });
    const l = computeBudgetLines({
      budgets,
      budgetMonths: [],
      transactions: [noOwner],
      range: range(2026, 10),
      currentUserId: A,
      getTransactionOwnerId: (t) => t.user_id ?? (t.ID_Conta === 'conta-b' ? B : undefined),
      referenceDate: new Date(2026, 9, 15),
    });
    expect(l.find((x) => x.ownerUserId === B)!.spent).toBe(40);
    expect(l.find((x) => x.ownerUserId === A)!.spent).toBe(0);
  });

  it('usuário solo: o mesmo resultado do cálculo antigo (todas as transações são dele)', () => {
    const l = lines([annual(A, 'Alimentação', 1000)], [], [tx(A, 'Alimentação', '2026-10-02', 250.5), tx(A, 'Alimentação', '2026-10-09', 100)]);
    expect([l[0].limit, l[0].spent, l[0].remaining]).toEqual([1000, 350.5, 649.5]);
  });

  it('só Despesa da mesma categoria conta (Renda e outras categorias não)', () => {
    const l = lines([annual(A, 'Alimentação', 1000)], [], [
      tx(A, 'Alimentação', '2026-10-02', 100),
      tx(A, 'Alimentação', '2026-10-03', 500, { Tipo: 'Renda', Valor: 500 }),
      tx(A, 'Transporte', '2026-10-03', 400),
    ]);
    expect(l[0].spent).toBe(100);
  });

  it('demo nunca consome orçamento (linha e total)', () => {
    const l = lines([annual(A, 'Alimentação', 1000)], [], [
      tx(A, 'Alimentação', '2026-10-02', 100),
      tx(A, 'Alimentação', '2026-10-03', 900, { Origem: 'demo.csv' }),
      tx(A, 'Alimentação', '2026-10-04', 800, { Fonte: 'Demo' }),
    ]);
    expect(l[0].spent).toBe(100);
    expect(computeBudgetLineTotals(l).spent).toBe(100);
  });

  it('cartão: Data_Pagamento prevalece sobre Data (contrato atual preservado)', () => {
    const l = lines([annual(A, 'Alimentação', 1000)], [], [
      tx(A, 'Alimentação', '2026-09-28', 200, { Data_Pagamento: '2026-10-10' as unknown as Date }),
      tx(A, 'Alimentação', '2026-10-02', 300, { Data_Pagamento: '2026-11-10' as unknown as Date }),
    ]);
    expect(l[0].spent).toBe(200);
  });

  it('parcelas: cada uma consome o seu mês efetivo, nunca o total da compra', () => {
    const parcelas = [10, 11, 12].map((m, i) =>
      tx(A, 'Alimentação', `2026-${m}-05`, 100, { Parcela_Atual: i + 1, Total_Parcelas: 3 })
    );
    expect(lines([annual(A, 'Alimentação', 1000)], [], parcelas, range(2026, 10))[0].spent).toBe(100);
    expect(lines([annual(A, 'Alimentação', 1000)], [], parcelas, range(2026, 10, 12))[0].spent).toBe(300);
  });

  it('reembolso (Renda) NÃO reduz o gasto — limitação preservada', () => {
    const l = lines([annual(A, 'Alimentação', 1000)], [], [
      tx(A, 'Alimentação', '2026-10-02', 300),
      tx(A, 'Alimentação', '2026-10-03', 100, { Tipo: 'Renda', Valor: 100, Nome_Fantasia: 'Reembolso' }),
    ]);
    expect(l[0].spent).toBe(300);
  });

  it('legado em categoria hoje inelegível (Ambos/investimento) continua resolvendo e aparecendo', () => {
    const l = lines([annual(A, 'Movimentação', 300), annual(A, 'Aportes', 200)], [], [tx(A, 'Aportes', '2026-10-02', 50)]);
    expect(l.map((x) => x.Categoria).sort()).toEqual(['Aportes', 'Movimentação']);
    expect(l.find((x) => x.Categoria === 'Aportes')!.spent).toBe(50);
  });
});

describe('Restante, excedido e dinheiro', () => {
  it('Restam / acima, sem -0, NaN ou Infinity', () => {
    expect(describeRemaining(980, 1500)).toEqual({ kind: 'remaining', amount: 520 });
    expect(describeRemaining(620, 600)).toEqual({ kind: 'over', amount: 20 });
    expect(describeRemaining(600, 600)).toEqual({ kind: 'remaining', amount: 0 });
    expect(Object.is(describeRemaining(600, 600).amount, -0)).toBe(false);
    expect(describeRemaining(600.01, 600)).toEqual({ kind: 'over', amount: 0.01 });
    expect(describeRemaining(0, 0)).toEqual({ kind: 'remaining', amount: 0 });
    expect(JSON.stringify([describeRemaining(Number.NaN, 10), describeRemaining(10, Number.POSITIVE_INFINITY)])).not.toMatch(/NaN|Infinity|null/);
  });

  it('centavos sem deriva de ponto flutuante na soma', () => {
    const l = lines([annual(A, 'Alimentação', 0.3)], [], [tx(A, 'Alimentação', '2026-10-02', 0.1), tx(A, 'Alimentação', '2026-10-03', 0.2)]);
    expect(l[0].spent).toBe(0.3);
    expect(l[0].remaining).toBe(0);
    expect(l[0].exceeded).toBe(false);
    expect(lines([annual(A, 'Alimentação', 0.3)], [], [tx(A, 'Alimentação', '2026-10-02', 0.31)])[0].exceeded).toBe(true);
  });

  it('gasto zero e orçamento 1 centavo', () => {
    const l = lines([annual(A, 'Alimentação', 0.01)], [], []);
    expect([l[0].spent, l[0].remaining]).toEqual([0, 0.01]);
  });

  it('ordem determinística: mais consumido primeiro, depois categoria e dono', () => {
    const l = lines(
      [annual(A, 'Transporte', 100), annual(A, 'Alimentação', 100), annual(B, 'Alimentação', 100)],
      [],
      [tx(A, 'Transporte', '2026-10-02', 90), tx(A, 'Alimentação', '2026-10-02', 10), tx(B, 'Alimentação', '2026-10-02', 10)]
    );
    expect(l.map((x) => `${x.ownerUserId}:${x.Categoria}`)).toEqual([`${A}:Transporte`, `${A}:Alimentação`, `${B}:Alimentação`]);
  });
});

describe('Elegibilidade, navegação e direitos', () => {
  it('o Gerenciador nunca abre além do próximo mês; passado e atual ficam como estão', () => {
    const now = { year: 2026, month: 10 };
    const clamp = (year: number, month: number) => clampManagerMonth({ year, month }, now);
    expect(clamp(2025, 9)).toEqual({ year: 2025, month: 9 });
    expect(clamp(2026, 10)).toEqual({ year: 2026, month: 10 });
    expect(clamp(2026, 11)).toEqual({ year: 2026, month: 11 });
    expect(clamp(2026, 12)).toEqual({ year: 2026, month: 11 });
    expect(clamp(2027, 1)).toEqual({ year: 2026, month: 11 });
    expect(clamp(2027, 3)).toEqual({ year: 2026, month: 11 });
    expect(clampManagerMonth({ year: 2027, month: 3 }, { year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
  });

  it('só Despesa não investimento pode receber novo orçamento mensal', () => {
    expect(cats.filter(isEligibleBudgetCategory).map((c) => c.Nome_Categoria)).toEqual(['Alimentação', 'Transporte']);
  });

  it('meses anterior/seguinte, dezembro↔janeiro e limite de navegação (próximo mês)', () => {
    expect(previousMonth({ year: 2027, month: 1 })).toEqual({ year: 2026, month: 12 });
    expect(nextMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
    const now = { year: 2026, month: 10 };
    expect(canNavigateToMonth({ year: 2026, month: 11 }, now)).toBe(true);
    expect(canNavigateToMonth({ year: 2026, month: 12 }, now)).toBe(false);
    expect(canNavigateToMonth({ year: 2020, month: 1 }, now)).toBe(true);
    expect(canNavigateToMonth({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toBe(true);
  });

  it('direitos: só o responsável cria e copia; qualquer membro edita valor e exclui o que existe', () => {
    expect(editRightsFor(A, A)).toMatchObject({ canCreate: true, canCopy: true, canEditExisting: true, canDeleteExisting: true });
    expect(editRightsFor(B, A)).toMatchObject({ canCreate: false, canCopy: false, canEditExisting: true, canDeleteExisting: true });
    expect(editRightsFor(A, undefined).canCreate).toBe(false);
  });
});

describe('Linhas do Gerenciador', () => {
  const rowsFor = (budgets: Budget[], months: BudgetMonth[], owner = A, period = { year: 2026, month: 10 }) =>
    buildManagerRows({ ownerId: owner, period, categories: cats, budgets, budgetMonths: months, currentUserId: A });

  it('categorias elegíveis com origem: deste mês, padrão do ano ou sem orçamento', () => {
    const rows = rowsFor([annual(A, 'Transporte', 600)], [monthly(A, 'Alimentação', 2026, 10, 1500)]);
    const by = Object.fromEntries(rows.map((r) => [r.Categoria, r]));
    expect(by['Alimentação'].monthly?.amount).toBe(1500);
    expect(by['Alimentação'].effective?.source).toBe('monthly');
    expect(by['Transporte'].monthly).toBeNull();
    expect(by['Transporte'].effective).toMatchObject({ source: 'annual', amount: 600 });
    expect(rows.map((r) => r.Categoria)).toEqual(['Alimentação', 'Transporte']);
  });

  it('fallback anual NÃO é tratado como linha mensal persistida', () => {
    const r = rowsFor([annual(A, 'Transporte', 600)], []).find((x) => x.Categoria === 'Transporte')!;
    expect(r.monthly).toBeNull();
  });

  it('legado inelegível aparece, marcado como fora das regras de criação', () => {
    const rows = rowsFor([annual(A, 'Movimentação', 300)], []);
    const legacy = rows.find((r) => r.Categoria === 'Movimentação')!;
    expect(legacy.eligible).toBe(false);
    expect(legacy.effective?.amount).toBe(300);
  });

  it('linhas de outro responsável usam só os valores dele', () => {
    const rows = rowsFor([annual(A, 'Transporte', 600)], [monthly(B, 'Alimentação', 2026, 10, 800)], B);
    const by = Object.fromEntries(rows.map((r) => [r.Categoria, r]));
    expect(by['Alimentação'].effective?.amount).toBe(800);
    expect(by['Transporte'].effective).toBeNull();
  });
});

describe('Copiar do mês anterior', () => {
  const plan = (budgets: Budget[], months: BudgetMonth[], target = { year: 2026, month: 10 }, owner = A) =>
    planCopyFromPreviousMonth({ ownerId: owner, target, categories: cats, budgets, budgetMonths: months, currentUserId: A });

  it('copia o limite EFETIVO da origem (mensal ou anual) para um destino vazio', () => {
    const p = plan([annual(A, 'Transporte', 600)], [monthly(A, 'Alimentação', 2026, 9, 1500)]);
    expect(p.source).toEqual({ year: 2026, month: 9 });
    expect(p.toCreate).toEqual([
      { Categoria: 'Alimentação', amount: 1500 },
      { Categoria: 'Transporte', amount: 600 },
    ]);
    expect(p.totalAmount).toBe(2100);
    expect(p.skippedExisting).toBe(0);
  });

  it('destino que só tem fallback anual PODE receber a cópia (anual não é linha mensal)', () => {
    const p = plan([annual(A, 'Transporte', 600)], [monthly(A, 'Transporte', 2026, 9, 650)]);
    expect(p.toCreate).toEqual([{ Categoria: 'Transporte', amount: 650 }]);
  });

  it('nunca sobrescreve linha mensal já existente no destino', () => {
    const p = plan([], [monthly(A, 'Alimentação', 2026, 9, 1500), monthly(A, 'Alimentação', 2026, 10, 1800), monthly(A, 'Transporte', 2026, 9, 600)]);
    expect(p.toCreate).toEqual([{ Categoria: 'Transporte', amount: 600 }]);
    expect(p.skippedExisting).toBe(1);
  });

  it('categoria sem valor na origem ou inelegível não é copiada', () => {
    const p = plan([annual(A, 'Movimentação', 300), annual(A, 'Aportes', 200)], [monthly(A, 'Alimentação', 2026, 9, 100)]);
    expect(p.toCreate.map((r) => r.Categoria)).toEqual(['Alimentação']);
    expect(plan([], []).toCreate).toEqual([]);
  });

  it('dezembro → janeiro; sem anual de 2027 o valor efetivo de dezembro vira mensal de janeiro', () => {
    const p = plan([annual(A, 'Alimentação', 1000, 2026)], [], { year: 2027, month: 1 });
    expect(p.source).toEqual({ year: 2026, month: 12 });
    expect(p.toCreate).toEqual([{ Categoria: 'Alimentação', amount: 1000 }]);
  });

  it('só o dono usa a cópia: o plano é calculado para o dono pedido, e os direitos bloqueiam os demais', () => {
    expect(editRightsFor(B, A).canCopy).toBe(false);
    const p = plan([annual(B, 'Alimentação', 900)], [], { year: 2026, month: 10 }, B);
    expect(p.toCreate).toEqual([{ Categoria: 'Alimentação', amount: 900 }]); // o plano existe; a UI desabilita a ação
  });
});

describe('Salvar em lote', () => {
  const period = { year: 2026, month: 10 };
  const rowsFor = (budgets: Budget[], months: BudgetMonth[]) =>
    buildManagerRows({ ownerId: A, period, categories: cats, budgets, budgetMonths: months, currentUserId: A });
  const save = (drafts: Record<string, string>, budgets: Budget[], months: BudgetMonth[], rights = editRightsFor(A, A)) =>
    planManagerSave({ rows: rowsFor(budgets, months), drafts, period, rights, parse: parseMoneyInput });

  it('valor novo = INSERT; monthly alterado = UPDATE de amount; igual = nada', () => {
    const existing = monthly(A, 'Alimentação', 2026, 10, 1500);
    const p = save({ Alimentação: '1.600,50', Transporte: '600' }, [], [existing]);
    expect(p.updates).toEqual([{ id: existing.id, amount: 1600.5 }]);
    expect(p.creates).toEqual([{ Categoria: 'Transporte', year: 2026, month: 10, amount: 600 }]);
    expect(save({ Alimentação: '1500' }, [], [existing])).toMatchObject({ creates: [], updates: [] });
  });

  it('abrir e salvar sem mexer não materializa o fallback anual', () => {
    expect(save({}, [annual(A, 'Transporte', 600)], [])).toEqual({ creates: [], updates: [], errors: {} });
  });

  it('campo vazio não apaga e nunca grava zero ou negativo', () => {
    const existing = monthly(A, 'Alimentação', 2026, 10, 1500);
    expect(save({ Alimentação: '' }, [], [existing])).toMatchObject({ creates: [], updates: [], errors: {} });
    for (const bad of ['0', '-5', 'abc']) {
      const p = save({ Transporte: bad }, [], []);
      expect(p.errors.Transporte, bad).toBeTruthy();
      expect(p.creates).toEqual([]);
    }
  });

  it('outro responsável: não cria, mas edita o valor de linha existente', () => {
    const existing = monthly(B, 'Alimentação', 2026, 10, 800);
    const rows = buildManagerRows({ ownerId: B, period, categories: cats, budgets: [], budgetMonths: [existing], currentUserId: A });
    const p = planManagerSave({
      rows,
      drafts: { Alimentação: '900', Transporte: '300' },
      period,
      rights: editRightsFor(B, A),
      parse: parseMoneyInput,
    });
    expect(p.updates).toEqual([{ id: existing.id, amount: 900 }]);
    expect(p.creates).toEqual([]);
  });

  it('categoria inelegível não recebe valor novo', () => {
    const p = save({ Movimentação: '100' }, [annual(A, 'Movimentação', 300)], []);
    expect(p.creates).toEqual([]);
  });
});
