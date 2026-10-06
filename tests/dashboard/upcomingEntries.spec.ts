import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import UpcomingEntriesCard, {
  UPCOMING_CARD_NOTE,
  UPCOMING_DISCLAIMER,
} from '../../src/components/dashboard/UpcomingEntriesCard';
import type { Account, Category, Transaction } from '../../src/types';
import { addDaysToDateOnly } from '../../src/utils/dateOnly';
import {
  buildUpcomingTransactionFilters,
  computeUpcomingEntries,
  openUpcomingInTransactions,
  type UpcomingCardGroup,
  type UpcomingEntry,
} from '../../src/utils/upcomingEntries';
import {
  SMART_TRANSACTION_FILTERS_STORAGE_KEY,
  TRANSACTION_FILTERS_STORAGE_KEY,
} from '../../src/utils/transactionPeriodFilters';

const TODAY = '2026-10-06';

const categories: Category[] = [
  { id: '1', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '2', Nome_Categoria: 'Mercado', Tipo: 'Despesa' },
  { id: '3', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: '4', Nome_Categoria: 'Aportes', Tipo: 'Despesa', is_investment: true },
];

const acc = (id: string, name: string, tipo: Account['Tipo_Conta']): Account =>
  ({ id, user_id: 'u', Nome_Conta: name, Tipo_Conta: tipo, Saldo_Inicial: 0 }) as unknown as Account;
const accounts: Account[] = [
  acc('bank', 'Conta Itaú', 'Conta Corrente'),
  acc('cardA', 'Cartão A', 'Cartão de Crédito'),
  acc('cardB', 'Cartão B', 'Cartão de Crédito'),
];

let seq = 0;
const tx = (date: string, tipo: 'Renda' | 'Despesa', valor: number, extra: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: `t${String((seq += 1)).padStart(3, '0')}`,
    Data: date,
    Descricao_Original: 'x',
    Nome_Fantasia: `Item ${seq}`,
    Valor: tipo === 'Despesa' ? -Math.abs(valor) : valor,
    Tipo: tipo,
    Categoria: tipo === 'Renda' ? 'Salário' : 'Mercado',
    Origem: 'manual',
    Fonte: 'Manual',
    ID_Conta: 'bank',
    ...extra,
  }) as unknown as Transaction;

const compute = (transactions: Transaction[], horizonDays = 30, today = TODAY) =>
  computeUpcomingEntries({ transactions, categories, accounts, today, horizonDays });

const ids = (m: ReturnType<typeof compute>) => m.items.map((i) => (i.kind === 'entry' ? i.id : i.key));

describe('addDaysToDateOnly', () => {
  it('soma dias no calendário civil', () => {
    expect(addDaysToDateOnly('2026-10-06', 1)).toBe('2026-10-07');
    expect(addDaysToDateOnly('2026-10-06', 30)).toBe('2026-11-05');
    expect(addDaysToDateOnly('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateOnly('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDaysToDateOnly('2028-02-27', 2)).toBe('2028-02-29');
    expect(addDaysToDateOnly('2028-02-28', 2)).toBe('2028-03-01');
    expect(addDaysToDateOnly('lixo', 1)).toBe('');
  });
});

describe('Próximos lançamentos — contrato temporal', () => {
  it('janela: início = amanhã, fim = hoje + horizonte', () => {
    const m = compute([]);
    expect(m.startDate).toBe('2026-10-07');
    expect(m.endDate).toBe('2026-11-05');
  });

  it('A/B/C/D. amanhã entra; hoje não; último dia entra; dia seguinte não', () => {
    const data = [
      tx('2026-10-06', 'Despesa', 10, { ID_Transacao: 'hoje' }),
      tx('2026-10-07', 'Despesa', 10, { ID_Transacao: 'amanha' }),
      tx('2026-11-05', 'Despesa', 10, { ID_Transacao: 'ultimo' }),
      tx('2026-11-06', 'Despesa', 10, { ID_Transacao: 'depois' }),
      tx('2026-10-05', 'Despesa', 10, { ID_Transacao: 'ontem' }),
    ];
    expect(ids(compute(data))).toEqual(['amanha', 'ultimo']);
  });

  it('E/F. Data_Pagamento tem prioridade; sem ela vale Data', () => {
    const data = [
      // compra passada, vencimento futuro: entra
      tx('2026-09-20', 'Despesa', 50, { ID_Transacao: 'venc', Data_Pagamento: '2026-10-10' as unknown as Date }),
      // compra futura, pagamento passado: não entra
      tx('2026-10-20', 'Despesa', 50, { ID_Transacao: 'pago', Data_Pagamento: '2026-10-01' as unknown as Date }),
      tx('2026-10-15', 'Despesa', 50, { ID_Transacao: 'fallback' }),
    ];
    expect(ids(compute(data))).toEqual(['venc', 'fallback']);
  });

  it('30/60/90 incluem a janela certa', () => {
    const data = [
      tx('2026-11-05', 'Despesa', 1, { ID_Transacao: 'd30' }),
      tx('2026-11-06', 'Despesa', 1, { ID_Transacao: 'd31' }),
      tx('2026-12-05', 'Despesa', 1, { ID_Transacao: 'd60' }),
      tx('2026-12-06', 'Despesa', 1, { ID_Transacao: 'd61' }),
      tx('2027-01-04', 'Despesa', 1, { ID_Transacao: 'd90' }),
      tx('2027-01-05', 'Despesa', 1, { ID_Transacao: 'd91' }),
    ];
    expect(ids(compute(data, 30))).toEqual(['d30']);
    expect(ids(compute(data, 60))).toEqual(['d30', 'd31', 'd60']);
    expect(ids(compute(data, 90))).toEqual(['d30', 'd31', 'd60', 'd61', 'd90']);
    expect(compute(data, 90).endDate).toBe('2027-01-04');
  });

  it('virada de ano: 31/12 → janeiro', () => {
    const data = [
      tx('2026-12-31', 'Despesa', 1, { ID_Transacao: 'hoje' }),
      tx('2027-01-01', 'Despesa', 1, { ID_Transacao: 'ano-novo' }),
      tx('2027-01-30', 'Despesa', 1, { ID_Transacao: 'fim' }),
      tx('2027-01-31', 'Despesa', 1, { ID_Transacao: 'fora' }),
    ];
    const m = compute(data, 30, '2026-12-31');
    expect(m.startDate).toBe('2027-01-01');
    expect(m.endDate).toBe('2027-01-30');
    expect(ids(m)).toEqual(['ano-novo', 'fim']);
  });

  it('fevereiro e ano bissexto', () => {
    expect(compute([], 30, '2027-01-30').endDate).toBe('2027-03-01'); // fev/2027 tem 28 dias
    expect(compute([], 30, '2028-01-30').endDate).toBe('2028-02-29'); // fev/2028 bissexto
    const data = [tx('2028-02-29', 'Despesa', 1, { ID_Transacao: 'bissexto' })];
    expect(ids(compute(data, 30, '2028-02-27'))).toEqual(['bissexto']);
    expect(compute([], 30, '2028-02-28').startDate).toBe('2028-02-29');
  });

  it('strings ISO com horário e Date em meia-noite UTC não deslocam o dia', () => {
    const data = [
      tx('2026-10-07T00:00:00+00:00', 'Despesa', 1, { ID_Transacao: 'iso' }),
      tx(new Date('2026-10-08T00:00:00.000Z') as unknown as string, 'Despesa', 1, { ID_Transacao: 'utc' }),
    ];
    expect(ids(compute(data))).toEqual(['iso', 'utc']);
    expect(compute(data).items.map((i) => i.effectiveDate)).toEqual(['2026-10-07', '2026-10-08']);
  });

  it('data inválida fica de fora, sem cair para Data', () => {
    const data = [tx('2026-10-10', 'Despesa', 1, { Data_Pagamento: 'xx' as unknown as Date })];
    // Data_Pagamento inválida → toDateOnlyIso('') faz o helper canônico devolver inválida
    expect(compute(data).items).toHaveLength(0);
  });
});

describe('Próximos lançamentos — inclusões e exclusões', () => {
  it('G/H. renda soma em Entradas, despesa em Saídas, sem saldo', () => {
    const m = compute([tx('2026-10-10', 'Renda', 1000), tx('2026-10-11', 'Despesa', 250.5), tx('2026-10-12', 'Despesa', 100)]);
    expect(m.incomeTotal).toBe(1000);
    expect(m.expenseTotal).toBe(350.5);
    expect(Object.keys(m)).not.toContain('balance');
  });

  it('I/J. zero, NaN e Infinity excluídos', () => {
    const bad = (v: number) => ({ ...tx('2026-10-10', 'Despesa', 1), Valor: v }) as Transaction;
    const m = compute([bad(0), bad(Number.NaN), bad(Number.POSITIVE_INFINITY), bad(Number.NEGATIVE_INFINITY)]);
    expect(m.items).toHaveLength(0);
    expect(m.expenseTotal).toBe(0);
  });

  it('K/L. demo por Origem e por Fonte excluído', () => {
    const m = compute([
      tx('2026-10-10', 'Despesa', 10, { Origem: 'demo.csv' }),
      tx('2026-10-10', 'Despesa', 10, { Fonte: 'Demo' }),
      tx('2026-10-10', 'Despesa', 10, { ID_Transacao: 'real' }),
    ]);
    expect(ids(m)).toEqual(['real']);
  });

  it('M/N. categoria Ambos e investimento excluídas', () => {
    const m = compute([
      tx('2026-10-10', 'Despesa', 10, { Categoria: 'Movimentação' }),
      tx('2026-10-10', 'Renda', 10, { Categoria: 'Movimentação' }),
      tx('2026-10-10', 'Despesa', 10, { Categoria: 'Aportes' }),
      tx('2026-10-10', 'Despesa', 10, { ID_Transacao: 'ok' }),
    ]);
    expect(ids(m)).toEqual(['ok']);
  });

  it('tipo desconhecido é ignorado', () => {
    const odd = { ...tx('2026-10-10', 'Despesa', 10), Tipo: 'Outro' } as unknown as Transaction;
    expect(compute([odd]).items).toHaveLength(0);
  });
});

describe('Próximos lançamentos — pagamento e cartão', () => {
  const pagar = (pernas: 'card' | 'bank') =>
    tx('2026-10-15', pernas === 'card' ? 'Renda' : 'Despesa', 300, {
      ID_Conta: pernas === 'card' ? 'cardA' : 'bank',
      Descricao_Original: 'Pagamento Fatura (2026-09) finelo_competence:2026-09 finelo_funding_account:11111111-1111-1111-1111-111111111111',
    });

  it('A. perna bancária do Pagar excluída', () => {
    expect(compute([pagar('bank')]).items).toHaveLength(0);
  });

  it('B. perna do cartão do Pagar excluída (mesmo se a conta não fosse cartão)', () => {
    expect(compute([pagar('card')]).items).toHaveLength(0);
    expect(compute([{ ...pagar('card'), ID_Conta: 'bank' } as Transaction]).items).toHaveLength(0);
    expect(compute([{ ...pagar('bank'), Descricao_Original: 'x', Observacoes: 'finelo_funding_account:abc' } as Transaction]).items).toHaveLength(0);
  });

  it('C/D. Renda em cartão (pagamento, estorno, crédito) não vira entrada', () => {
    const m = compute([
      tx('2026-10-15', 'Renda', 80, { ID_Conta: 'cardA', Nome_Fantasia: 'Estorno loja' }),
      tx('2026-10-15', 'Renda', 900, { ID_Conta: 'cardA', Nome_Fantasia: 'Pagamento de Fatura', Origem: 'fatura.csv' }),
      tx('2026-10-15', 'Renda', 20, { ID_Conta: 'cardB' }),
    ]);
    expect(m.items).toHaveLength(0);
    expect(m.incomeTotal).toBe(0);
  });

  it('E/F. despesa de cartão entra usando o vencimento', () => {
    const m = compute([tx('2026-09-28', 'Despesa', 120, { ID_Conta: 'cardA', Data_Pagamento: '2026-10-10' as unknown as Date })]);
    expect(m.items).toHaveLength(1);
    expect(m.items[0].effectiveDate).toBe('2026-10-10');
    expect(m.expenseTotal).toBe(120);
  });

  const cards = [
    tx('2026-09-01', 'Despesa', 100.1, { ID_Conta: 'cardA', Data_Pagamento: '2026-10-10' as unknown as Date, Nome_Fantasia: 'Zeta' }),
    tx('2026-09-02', 'Despesa', 200.2, { ID_Conta: 'cardA', Data_Pagamento: '2026-10-10' as unknown as Date, Nome_Fantasia: 'Alfa' }),
    tx('2026-09-03', 'Despesa', 50, { ID_Conta: 'cardB', Data_Pagamento: '2026-10-10' as unknown as Date }),
    tx('2026-09-04', 'Despesa', 70, { ID_Conta: 'cardA', Data_Pagamento: '2026-11-10' as unknown as Date }),
  ];

  it('G/H/I/J. agrupa por conta + vencimento, com total correto', () => {
    const m = compute(cards, 60);
    const groups = m.items.filter((i): i is UpcomingCardGroup => i.kind === 'credit_card_group');
    expect(groups).toHaveLength(3);
    const a10 = groups.find((g) => g.accountId === 'cardA' && g.effectiveDate === '2026-10-10')!;
    expect(a10.count).toBe(2);
    expect(a10.amount).toBeCloseTo(300.3, 2);
    expect(a10.entries.map((e) => e.description)).toEqual(['Alfa', 'Zeta']);
    expect(groups.find((g) => g.accountId === 'cardB')!.count).toBe(1);
    expect(groups.find((g) => g.effectiveDate === '2026-11-10')!.amount).toBe(70);
    expect(m.totalItemCount).toBe(3);
    expect(m.entryCount).toBe(4);
    expect(m.expenseTotal).toBeCloseTo(420.3, 2);
  });

  it('K. nada do grupo é rotulado como fatura', () => {
    const html = renderToStaticMarkup(
      React.createElement(UpcomingEntriesCard, {
        transactions: cards,
        categories,
        accounts,
        today: TODAY,
        onViewInTransactions: () => {},
        initialHorizon: 60,
        initialExpandedKeys: ['cardA|2026-10-10'],
      })
    );
    expect(html).toContain('Cartão A');
    expect(html).toContain('2 lançamentos registrados');
    expect(html).toContain(UPCOMING_CARD_NOTE);
    // "fatura" só aparece na nota de ressalva, nunca como rótulo do total
    const withoutNote = html.replace(UPCOMING_CARD_NOTE, '');
    expect(withoutNote).not.toMatch(/fatura/i);
  });
});

describe('Próximos lançamentos — parcelas e recorrência', () => {
  it('parcela futura preserva X/Y', () => {
    const m = compute([tx('2026-10-20', 'Despesa', 100, { Parcela_Atual: 6, Total_Parcelas: 10 })]);
    expect((m.items[0] as UpcomingEntry).installment).toEqual({ current: 6, total: 10 });
  });

  it('0/0 (demo antiga) e ausência não geram selo', () => {
    const m = compute([
      tx('2026-10-20', 'Despesa', 1, { Parcela_Atual: 0, Total_Parcelas: 0 }),
      tx('2026-10-21', 'Despesa', 1),
    ]);
    expect(m.items.map((i) => (i as UpcomingEntry).installment)).toEqual([null, null]);
  });

  it('recorrência fixa (clones sem série) aparece como lançamentos normais e sem inferência', () => {
    const data = [
      tx('2026-10-10', 'Despesa', 59.9, { Nome_Fantasia: 'Academia' }),
      tx('2026-11-10', 'Despesa', 59.9, { Nome_Fantasia: 'Academia' }),
      tx('2026-12-10', 'Despesa', 59.9, { Nome_Fantasia: 'Academia' }),
    ];
    const m = compute(data, 60);
    expect(m.items.map((i) => i.effectiveDate)).toEqual(['2026-10-10', '2026-11-10']);
    expect(m.items.every((i) => i.kind === 'entry' && i.installment === null)).toBe(true);
    expect(compute(data, 90).items).toHaveLength(3);
  });
});

describe('Próximos lançamentos — ordenação', () => {
  it('data crescente, independente da ordem do array; desempate estável', () => {
    const a = tx('2026-10-12', 'Despesa', 1, { ID_Transacao: 'a', Nome_Fantasia: 'B' });
    const b = tx('2026-10-12', 'Renda', 1, { ID_Transacao: 'b', Nome_Fantasia: 'A' });
    const c = tx('2026-10-08', 'Despesa', 1, { ID_Transacao: 'c', Nome_Fantasia: 'Z' });
    const d = tx('2026-10-12', 'Despesa', 1, { ID_Transacao: 'd', Nome_Fantasia: 'B' });
    const g = tx('2026-10-12', 'Despesa', 5, { ID_Transacao: 'g', ID_Conta: 'cardA' });
    const one = ids(compute([a, b, c, d, g]));
    const two = ids(compute([g, d, c, b, a]));
    expect(one).toEqual(two);
    expect(one).toEqual(['c', 'b', 'a', 'd', 'cardA|2026-10-12']);
  });
});

describe('CTA — Ver em Transações', () => {
  const store = new Map<string, string>();
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  });

  const range = { startDate: '2026-10-07', endDate: '2026-11-05' };

  it('monta filtros que reproduzem o horizonte, sem resíduos', () => {
    const f = buildUpcomingTransactionFilters(range);
    expect(f).toMatchObject({
      viewScope: 'operation',
      periodPreset: 'custom',
      dateField: 'Pagamento',
      startDate: '2026-10-07',
      endDate: '2026-11-05',
      text: '',
      category: [],
      type: '',
      accountId: [],
      ownerUserId: '',
      sourceScope: 'all',
    });
  });

  it('filtros inteligentes ligados → chave v2, depois navega', () => {
    const order: string[] = [];
    openUpcomingInTransactions({
      range,
      smartFiltersEnabled: true,
      navigate: (v) => order.push(`nav:${v}:${store.has(SMART_TRANSACTION_FILTERS_STORAGE_KEY)}`),
    });
    expect(SMART_TRANSACTION_FILTERS_STORAGE_KEY).toBe('finelo_transaction_filters_v2');
    expect(order).toEqual(['nav:transactions:true']); // gravou ANTES de navegar
    expect(store.has(TRANSACTION_FILTERS_STORAGE_KEY)).toBe(false);
    expect(JSON.parse(store.get(SMART_TRANSACTION_FILTERS_STORAGE_KEY)!)).toMatchObject({
      viewScope: 'operation',
      periodPreset: 'custom',
      dateField: 'Pagamento',
      startDate: range.startDate,
      endDate: range.endDate,
    });
  });

  it('filtros inteligentes desligados → chave v1', () => {
    let navigated = '';
    openUpcomingInTransactions({ range, smartFiltersEnabled: false, navigate: (v) => (navigated = v) });
    expect(TRANSACTION_FILTERS_STORAGE_KEY).toBe('finelo_transaction_filters_v1');
    expect(navigated).toBe('transactions');
    expect(store.has(SMART_TRANSACTION_FILTERS_STORAGE_KEY)).toBe(false);
    expect(JSON.parse(store.get(TRANSACTION_FILTERS_STORAGE_KEY)!)).toMatchObject({
      dateField: 'Pagamento',
      startDate: range.startDate,
      endDate: range.endDate,
      text: '',
      sourceScope: 'all',
    });
  });

  it('o intervalo da Agenda é o mesmo aberto em Transações', () => {
    const m = compute([], 60);
    const f = buildUpcomingTransactionFilters({ startDate: m.startDate, endDate: m.endDate });
    expect([f.startDate, f.endDate]).toEqual(['2026-10-07', '2026-12-05']);
  });
});

describe('UpcomingEntriesCard — UI', () => {
  const many = Array.from({ length: 7 }, (_, i) =>
    tx(`2026-10-${String(10 + i).padStart(2, '0')}`, i === 0 ? 'Renda' : 'Despesa', 100 + i, { Nome_Fantasia: `Conta ${i}` })
  );
  const render = (extra: Partial<React.ComponentProps<typeof UpcomingEntriesCard>> = {}, data = many) =>
    renderToStaticMarkup(
      React.createElement(UpcomingEntriesCard, {
        transactions: data,
        categories,
        accounts,
        today: TODAY,
        onViewInTransactions: () => {},
        ...extra,
      })
    );

  it('título, subtítulo, horizontes com aria-pressed, resumo e disclaimer', () => {
    const html = render();
    expect(html).toContain('Próximos lançamentos');
    expect(html).toContain('Veja entradas e saídas que já estão registradas para os próximos dias.');
    expect(html).toContain('30 dias');
    expect(html).toContain('60 dias');
    expect(html).toContain('90 dias');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>30 dias/);
    expect(html).toContain('Entradas registradas');
    expect(html).toContain('Saídas registradas');
    expect(html).toContain(UPCOMING_DISCLAIMER);
    expect(html).toContain('Ver em Transações');
  });

  it('não mostra saldo, resultado ou previsão como métrica', () => {
    const html = render();
    expect(html).not.toMatch(/saldo (futuro|previsto|dos compromissos)|resultado (futuro|previsto)|caixa projetado|sobra prevista/i);
    expect(html).not.toMatch(/Previsão de saldo|Fluxo de caixa previsto|Compromissos financeiros|Faturas futuras/);
  });

  it('5 itens, Mostrar mais / Mostrar menos', () => {
    const collapsed = render();
    expect(collapsed.match(/<time /g)).toHaveLength(5);
    expect(collapsed).toContain('Mostrar mais (2)');
    expect(collapsed).toContain('aria-expanded="false"');
    const all = render({ initialShowAll: true });
    expect(all.match(/<time /g)).toHaveLength(7);
    expect(all).toContain('Mostrar menos');
    expect(render({}, many.slice(0, 5))).not.toContain('Mostrar mais');
  });

  it('Entrada/Saída não depende só de cor, e valores têm rótulo acessível', () => {
    const html = render();
    expect(html).toContain('>Entrada<');
    expect(html).toContain('>Saída<');
    expect(html).toMatch(/aria-label="Entrada de R\$/);
    expect(html).toMatch(/aria-label="Saída de R\$/);
  });

  it('parcela aparece como "Parcela X/Y"', () => {
    const html = render({}, [tx('2026-10-10', 'Despesa', 100, { Parcela_Atual: 3, Total_Parcelas: 10 })]);
    expect(html).toContain('Parcela 3/10');
  });

  it('estado vazio compacto, com o número do horizonte', () => {
    const html = render({ initialHorizon: 60 }, []);
    expect(html).toContain('Nenhum lançamento registrado para os próximos 60 dias.');
    expect(html).toContain('Parcelas, receitas e lançamentos recorrentes que você registrar para datas futuras aparecerão aqui.');
    expect(html).not.toContain('Ver em Transações');
    expect(html).toContain(UPCOMING_DISCLAIMER);
  });

  it('grupo de cartão: recolhido por padrão com aria-expanded, expandido mostra os lançamentos', () => {
    const data = [
      tx('2026-10-10', 'Despesa', 10, { ID_Conta: 'cardA', Nome_Fantasia: 'Padaria' }),
      tx('2026-10-10', 'Despesa', 20, { ID_Conta: 'cardA', Nome_Fantasia: 'Cinema' }),
    ];
    const closed = render({}, data);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('Padaria');
    const open = render({ initialExpandedKeys: ['cardA|2026-10-10'] }, data);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('Padaria');
    expect(open).toContain('Cinema');
    expect(open).toContain('Venc. 10/10');
  });
});

describe('Integração na Dashboard e layout móvel (contrato de código)', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');
  const dashboard = read('src/components/views/DashboardView.tsx');
  const card = read('src/components/dashboard/UpcomingEntriesCard.tsx');

  it('fica depois dos KPIs e antes do orçamento', () => {
    const kpis = dashboard.indexOf('id="dashboard-kpis"');
    const upcoming = dashboard.indexOf('<UpcomingEntriesCard');
    const budgets = dashboard.indexOf('id="dashboard-budgets"');
    const lastKpiCard = dashboard.indexOf('title="Investimentos (Mês)"');
    expect(kpis).toBeGreaterThan(0);
    expect(upcoming).toBeGreaterThan(lastKpiCard);
    expect(budgets).toBeGreaterThan(upcoming);
  });

  it('usa dados já carregados e o CTA persiste e navega', () => {
    expect(dashboard).toMatch(/transactions=\{transactions\}/);
    expect(dashboard).toContain('openUpcomingInTransactions');
    expect(dashboard).toContain('isSmartTransactionFiltersEnabled(user)');
    expect(dashboard).toContain('navigate: setCurrentView');
    expect(dashboard).not.toMatch(/isPremium[^\n]*UpcomingEntriesCard|UpcomingEntriesCard[^\n]*isPremium/);
  });

  it('layout: resumos empilham, textos quebram, sem largura fixa', () => {
    expect(card).toContain('grid-cols-1');
    expect(card).toContain('sm:grid-cols-2');
    expect(card).toContain('break-words');
    expect(card).toContain('min-w-0');
    expect(card).toContain('flex-wrap');
    expect(card).not.toMatch(/min-w-\[\d+px\]|overflow-x-(auto|scroll)/);
  });

  it('sem rede, banco, analytics ou ajuda no recurso', () => {
    for (const p of ['src/components/dashboard/UpcomingEntriesCard.tsx', 'src/utils/upcomingEntries.ts']) {
      expect(read(p)).not.toMatch(/supabase|fetch\(|trackProductEvent|helpIntent/);
    }
  });
});
