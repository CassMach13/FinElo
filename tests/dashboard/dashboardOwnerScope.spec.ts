import { describe, expect, it } from 'vitest';
import {
  FAMILY_SCOPE,
  SELF_SCOPE,
  investmentOwnersFor,
  resolveDashboardScope,
  scopeDashboardData,
  type DashboardOwnerOption,
  type DashboardSourceData,
} from '../../src/domain/dashboard/dashboardOwnerScope';
import { computeAccountsTotalAsOf, computeAssetsTotals } from '../../src/utils/dashboardNetWorth';

const ME = 'user-me';
const ANA = 'user-ana';
const OUT = 'user-outsider';
const self: DashboardOwnerOption = { userId: ME, label: 'Você', isSelf: true };
const ana: DashboardOwnerOption = { userId: ANA, label: 'Ana', isSelf: false };

const tx = (id: string, user_id: string | undefined, ID_Conta: string, Valor: number, Data = '2026-09-10') =>
  ({ ID_Transacao: id, user_id, ID_Conta, Valor, Data, Data_Pagamento: Data, Descricao: id, Categoria: 'X', Origem: 'Manual' }) as any;
const acc = (id: string, user_id: string, Saldo_Inicial = 0) =>
  ({ id, user_id, Nome_Conta: id, Tipo_Conta: 'Conta Corrente', Saldo_Inicial, Data_Saldo_Inicial: '2026-01-01' }) as any;
const asset = (id: string, user_id: string, value: number, remaining_balance = 0) => ({ id, user_id, name: id, type: 'other', value, remaining_balance }) as any;

const data: DashboardSourceData = {
  accounts: [acc('c-me', ME, 1000), acc('c-ana', ANA, 500)],
  transactions: [
    tx('t1', ME, 'c-me', -100.1),
    tx('t2', ANA, 'c-ana', -50.2),
    // lançamento de Ana NA CONTA do titular (família pode lançar): pertence a Ana, mas mexe no saldo da conta de "me"
    tx('t3', ANA, 'c-me', -0.3),
    // sem user_id: dono vem da conta
    tx('t4', undefined, 'c-ana', 10),
    // sem dono identificável
    tx('t5', undefined, 'c-desconhecida', 7),
  ],
  assets: [asset('a-me', ME, 20000, 5000), asset('a-ana', ANA, 3000)],
  budgets: [
    { user_id: ME, Categoria: 'X', Valor_Limite_Mensal: 100, ano: 2026 },
    { user_id: ANA, Categoria: 'X', Valor_Limite_Mensal: 50, ano: 2026 },
    { Categoria: 'Legado', Valor_Limite_Mensal: 10, ano: 2026 },
  ],
  budgetMonths: [
    { id: 'm1', user_id: ME, Categoria: 'X', year: 2026, month: 9, amount: 100, created_at: '', updated_at: '' },
    { id: 'm2', user_id: ANA, Categoria: 'X', year: 2026, month: 9, amount: 50, created_at: '', updated_at: '' },
  ],
  economicEvents: [
    { id: 'e1', user_id: ME, kind: 'investment' as any, source: 'manual' as any, counterparty_account_id: null, created_by: ME, created_at: '' },
    { id: 'e2', user_id: ANA, kind: 'investment' as any, source: 'manual' as any, counterparty_account_id: null, created_by: ANA, created_at: '' },
  ],
};
const ownerOfTx = (t: any) => t.user_id || data.accounts.find((a) => a.id === t.ID_Conta)?.user_id;
const opts = { sessionUserId: ME, getTransactionOwnerId: ownerOfTx };
const cents = (n: number) => Math.round(n * 100);
const sumTx = (list: any[]) => list.reduce((s, t) => s + cents(t.Valor), 0);

describe('resolução do escopo', () => {
  it('padrão é "Você"; consolidado nunca é automático', () => {
    expect(resolveDashboardScope(ME, undefined, [self, ana])).toMatchObject({ kind: 'self', ownerIds: [ME], label: 'Você' });
    expect(resolveDashboardScope(ME, SELF_SCOPE, [self, ana]).kind).toBe('self');
    expect(resolveDashboardScope(ME, FAMILY_SCOPE, [self, ana])).toMatchObject({ kind: 'family', ownerIds: null, label: 'Família (consolidado)' });
  });

  it('usuário sem familiares: consolidado e familiar caem para "Você"', () => {
    expect(resolveDashboardScope(ME, FAMILY_SCOPE, [self]).kind).toBe('self');
    expect(resolveDashboardScope(ME, ANA, [self]).kind).toBe('self');
  });

  it('familiar autorizado é selecionável; não autorizado (fora das opções) ou vínculo revogado volta para "Você"', () => {
    expect(resolveDashboardScope(ME, ANA, [self, ana])).toMatchObject({ kind: 'owner', ownerIds: [ANA], label: 'Ana' });
    expect(resolveDashboardScope(ME, OUT, [self, ana]).kind).toBe('self');
    expect(resolveDashboardScope(ME, ANA, [self]).kind).toBe('self'); // revogado: sumiu das opções
  });

  it('a chave muda com sessão e proprietário (respostas antigas não servem)', () => {
    const keys = [
      resolveDashboardScope(ME, SELF_SCOPE, [self, ana]).key,
      resolveDashboardScope(ME, ANA, [self, ana]).key,
      resolveDashboardScope(ME, FAMILY_SCOPE, [self, ana]).key,
      resolveDashboardScope(ANA, SELF_SCOPE, [{ ...ana, isSelf: true }]).key,
    ];
    expect(new Set(keys).size).toBe(4);
    expect(resolveDashboardScope(null, ANA, [self, ana])).toMatchObject({ kind: 'self', ownerIds: [] });
  });
});

describe('filtragem antes dos cálculos', () => {
  const mine = scopeDashboardData(resolveDashboardScope(ME, SELF_SCOPE, [self, ana]), data, opts);
  const anas = scopeDashboardData(resolveDashboardScope(ME, ANA, [self, ana]), data, opts);
  const family = scopeDashboardData(resolveDashboardScope(ME, FAMILY_SCOPE, [self, ana]), data, opts);

  it('"Você": só dados do titular; transação sem dono identificável fica só na própria visão', () => {
    expect(mine.transactions.map((t: any) => t.ID_Transacao)).toEqual(['t1', 't5']);
    expect(mine.accounts.map((a: any) => a.id)).toEqual(['c-me']);
    expect(mine.assets.map((a: any) => a.id)).toEqual(['a-me']);
    expect(mine.budgets.map((b) => b.Categoria)).toEqual(['X', 'Legado']); // sem user_id = da sessão (regra do orçamento)
    expect(mine.budgetMonths.map((m) => m.id)).toEqual(['m1']);
    expect(mine.economicEvents.map((e) => e.id)).toEqual(['e1']);
  });

  it('familiar: só os dados daquele proprietário (transação sem user_id usa o dono da conta)', () => {
    expect(anas.transactions.map((t: any) => t.ID_Transacao)).toEqual(['t2', 't3', 't4']);
    expect(anas.accounts.map((a: any) => a.id)).toEqual(['c-ana']);
    expect(anas.assets.map((a: any) => a.id)).toEqual(['a-ana']);
    expect(anas.budgets.map((b) => b.Valor_Limite_Mensal)).toEqual([50]);
  });

  it('consolidado devolve as MESMAS referências (igual ao comportamento anterior)', () => {
    for (const k of Object.keys(data) as Array<keyof DashboardSourceData>) expect(family[k]).toBe(data[k]);
  });

  it('sem duplicidade: as visões individuais particionam o consolidado (cada linha em um único dono)', () => {
    const ids = [...mine.transactions, ...anas.transactions].map((t: any) => t.ID_Transacao).sort();
    expect(ids).toEqual(data.transactions.map((t: any) => t.ID_Transacao).sort());
    expect(sumTx(mine.transactions) + sumTx(anas.transactions)).toBe(sumTx(family.transactions)); // em centavos
    const assets = (d: DashboardSourceData) => cents(computeAssetsTotals(d.assets).net);
    expect(assets(mine) + assets(anas)).toBe(assets(family));
  });

  it('saldo de conta usa TODAS as transações da conta: o lançamento da Ana na conta do titular continua no saldo dele', () => {
    const end = new Date('2026-12-31T12:00:00');
    const balance = (accounts: any[]) => cents(computeAccountsTotalAsOf(accounts, data.transactions, end));
    expect(balance(mine.accounts)).toBe(cents(1000 - 100.1 - 0.3));
    expect(balance(anas.accounts)).toBe(cents(500 - 50.2 + 10));
    expect(balance(mine.accounts) + balance(anas.accounts)).toBe(balance(family.accounts));
    // e o erro que isso evita: filtrar as transações por dono tiraria o lançamento de Ana do saldo da conta do titular
    expect(cents(computeAccountsTotalAsOf(mine.accounts, mine.transactions, end))).not.toBe(balance(mine.accounts));
  });

  it('investimentos: proprietários do escopo; no consolidado, todos os conhecidos sem repetir', () => {
    expect(investmentOwnersFor(resolveDashboardScope(ME, SELF_SCOPE, [self, ana]), [ME, ANA])).toEqual([ME]);
    expect(investmentOwnersFor(resolveDashboardScope(ME, ANA, [self, ana]), [ME, ANA])).toEqual([ANA]);
    expect(investmentOwnersFor(resolveDashboardScope(ME, FAMILY_SCOPE, [self, ana]), [ANA, ME, ANA, ''])).toEqual([ANA, ME].sort());
  });
});
