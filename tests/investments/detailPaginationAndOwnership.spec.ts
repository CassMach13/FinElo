import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  calls: [] as Array<{ eq: Array<[string, unknown]>; order: string[]; range: [number, number] | null }>,
  failOnCall: null as number | null,
}));

vi.mock('../../src/supabaseClient', () => {
  const API_CAP = 1000; // o PostgREST devolve no máximo 1000 linhas por resposta
  const from = () => {
    const call = { eq: [] as Array<[string, unknown]>, order: [] as string[], range: null as [number, number] | null };
    const gte: Array<[string, string]> = [];
    const lte: Array<[string, string]> = [];
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => { call.eq.push([c, v]); return chain; },
      gte: (c: string, v: string) => { gte.push([c, v]); return chain; },
      lte: (c: string, v: string) => { lte.push([c, v]); return chain; },
      order: (c: string) => { call.order.push(c); return chain; },
      range: (a: number, b: number) => { call.range = [a, b]; return chain; },
      limit: () => chain,
      then: (resolveFn: (v: unknown) => unknown) => {
        db.calls.push(call);
        if (db.failOnCall !== null && db.calls.length === db.failOnCall) {
          return Promise.resolve({ data: null, error: new Error('falha de rede') }).then(resolveFn);
        }
        let out = db.rows.filter((r) => call.eq.every(([c, v]) => r[c] === v)
          && gte.every(([c, v]) => r[c] >= v) && lte.every(([c, v]) => r[c] <= v));
        out = out.slice().sort((x, y) => {
          for (const key of call.order) {
            if (x[key] < y[key]) return -1;
            if (x[key] > y[key]) return 1;
          }
          return 0; // empate: ordem de inserção (instável sem chave secundária)
        });
        const [a, b] = call.range ?? [0, API_CAP - 1];
        out = out.slice(a, Math.min(b, a + API_CAP - 1) + 1);
        return Promise.resolve({ data: out, error: null }).then(resolveFn);
      },
    };
    return chain;
  };
  return { supabase: { from } };
});

import { investmentService } from '../../src/services/investmentService';
import { isSnapshotReady, loadPortfolio } from '../../src/services/investmentPortfolioLoader';
import { buildMonthlySeries, summarizePortfolio } from '../../src/domain/investments/portfolioOverview';

const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));

const MARCH = new Date(2026, 2, 1);
const make = (n: number, user = 'u1', month = '2026-03-01'): Row[] => {
  // ids embaralhados de propósito e só 3 instituições: o desempate por id precisa ser explícito
  const ids = Array.from({ length: n }, (_, i) => i).sort((a, b) => ((a * 7919) % 1009) - ((b * 7919) % 1009));
  return ids.map((i) => ({
    id: `id-${String(i).padStart(5, '0')}`,
    user_id: user,
    institution: ['Inter', 'Nubank', 'XP'][i % 3],
    product_type: 'CDB',
    balance: 10.01,
    reference_month: month,
  }));
};

beforeEach(() => {
  db.rows = [];
  db.calls = [];
  db.failOnCall = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('A. detalhamento mensal paginado', () => {
  it('1001 posições no mesmo mês: detalhamento, histórico e resumo concordam', async () => {
    db.rows = make(1001);
    const detail = await investmentService.getInvestments(MARCH, 'u1');
    const history = await investmentService.getInvestmentHistory('u1', '2025-04-01', '2026-03-01');
    expect(detail).toHaveLength(1001);
    expect(history).toHaveLength(1001);
    const summary = summarizePortfolio(history, '2026-03-01');
    expect(summary.positionCount).toBe(1001);
    const expectedCents = detail.reduce((sum, r) => sum + Math.round(Number(r.balance) * 100), 0);
    expect(summary.balance).toBe(expectedCents / 100);
    expect(buildMonthlySeries(history, '2026-03-01').at(-1)?.balance).toBe(expectedCents / 100);
    expect(new Set(detail.map((r) => r.id)).size).toBe(1001); // sem duplicatas entre páginas
  });

  it('loadPortfolio entrega detalhamento e histórico do mesmo tamanho', async () => {
    db.rows = make(1001);
    const data = await loadPortfolio(
      {
        getDetail: (k) => investmentService.getInvestments(new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1), 'u1'),
        getHistory: (s, e) => investmentService.getInvestmentHistory('u1', s, e),
        getLatestMonthKey: async () => null,
      },
      '2026-03-01'
    );
    expect(data.detail).toHaveLength(data.history.length);
  });

  it('exatamente 1000: uma página cheia e uma segunda vazia, sem perder nem repetir', async () => {
    db.rows = make(1000);
    const detail = await investmentService.getInvestments(MARCH, 'u1');
    expect(detail).toHaveLength(1000);
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1].range).toEqual([1000, 1999]);
  });

  it('menos de uma página: uma única chamada', async () => {
    db.rows = make(5);
    expect(await investmentService.getInvestments(MARCH, 'u1')).toHaveLength(5);
    expect(db.calls).toHaveLength(1);
    db.calls = [];
    db.rows = [];
    expect(await investmentService.getInvestments(MARCH, 'u1')).toEqual([]);
  });

  it('ordenação estável: instituição, depois id, idêntica em toda chamada', async () => {
    db.rows = make(1001);
    const detail = await investmentService.getInvestments(MARCH, 'u1');
    const expected = db.rows.slice().sort((a, b) => (a.institution < b.institution ? -1 : a.institution > b.institution ? 1 : a.id < b.id ? -1 : 1));
    expect(detail.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    for (const call of db.calls) expect(call.order).toEqual(['institution', 'id']);
  });

  it('erro na segunda página: a chamada falha, sem devolver as 1000 parciais', async () => {
    db.rows = make(1001);
    db.failOnCall = 2;
    await expect(investmentService.getInvestments(MARCH, 'u1')).rejects.toThrow('falha de rede');
  });

  it('userId informado filtra o dono; sem userId o comportamento dos demais callers não muda', async () => {
    db.rows = [...make(3, 'u1'), ...make(4, 'u2')];
    expect(await investmentService.getInvestments(MARCH, 'u1')).toHaveLength(3);
    expect(db.calls[0].eq).toContainEqual(['user_id', 'u1']);
    expect(db.calls[0].eq).toContainEqual(['reference_month', '2026-03-01']);
    db.calls = [];
    expect(await investmentService.getInvestments(MARCH)).toHaveLength(7); // RLS faz o escopo no banco
    expect(db.calls[0].eq.some(([c]) => c === 'user_id')).toBe(false);
  });

  it('só o mês pedido, em YYYY-MM-01', async () => {
    db.rows = [...make(2, 'u1', '2026-03-01'), ...make(3, 'u1', '2026-04-01')];
    expect(await investmentService.getInvestments(MARCH, 'u1')).toHaveLength(2);
  });
});

describe('B. snapshot pertence ao dono', () => {
  const snapA = { monthKey: '2026-03-01', userId: 'user-a' };

  it('A → B no mesmo mês: antes de qualquer limpeza, a view NÃO está pronta', () => {
    expect(isSnapshotReady(snapA, '2026-03-01', 'user-a')).toBe(true);
    expect(isSnapshotReady(snapA, '2026-03-01', 'user-b')).toBe(false);
  });

  it('A → B em meses diferentes', () => {
    expect(isSnapshotReady(snapA, '2026-04-01', 'user-b')).toBe(false);
    expect(isSnapshotReady(snapA, '2026-04-01', 'user-a')).toBe(false);
  });

  it('logout e nova sessão sem snapshot', () => {
    expect(isSnapshotReady(snapA, '2026-03-01', null)).toBe(false);
    expect(isSnapshotReady(snapA, '2026-03-01', undefined)).toBe(false);
    expect(isSnapshotReady({ monthKey: null, userId: null }, '2026-03-01', 'user-a')).toBe(false);
    expect(isSnapshotReady({ monthKey: '2026-03-01', userId: null }, '2026-03-01', null)).toBe(false);
  });

  it('mesmo usuário com fetch novo válido volta a ficar pronto; depois do fetch de B só B', () => {
    expect(isSnapshotReady({ monthKey: '2026-04-01', userId: 'user-a' }, '2026-04-01', 'user-a')).toBe(true);
    const snapB = { monthKey: '2026-03-01', userId: 'user-b' };
    expect(isSnapshotReady(snapB, '2026-03-01', 'user-b')).toBe(true);
    expect(isSnapshotReady(snapB, '2026-03-01', 'user-a')).toBe(false);
  });

  describe('uso efetivo na view', () => {
    const view = read('src/components/views/InvestmentsView.tsx');
    const loader = read('src/services/investmentPortfolioLoader.ts');

    it('viewReady vem do predicado com o dono e o usuário vivo, avaliado a cada render', () => {
      expect(view).toContain('isSnapshotReady({ monthKey: loadedKey, userId: loadedUserId }, currentKey, user?.id)');
      expect(view).not.toMatch(/const viewReady = loadedKey === currentKey/);
    });

    it('o dono é gravado ao aceitar a busca e limpo ao trocar a sessão', () => {
      expect(view).toContain('setLoadedUserId(data.userId)');
      expect(view).toContain('setLoadedUserId(null)');
      expect(loader).toContain('handlers.onData({ ...data, userId })');
    });

    it('tabela, cards, resumo, gráfico e saldo usam SÓ o snapshot validado', () => {
      expect(view).toContain('const investments = viewReady ? rawInvestments : [];');
      expect(view).toContain('viewReady ? history : []');
      expect(view).toContain('{viewReady && <PortfolioSummary');
      expect(view).toContain('{viewReady && <PortfolioHistoryChart');
      const body = view.slice(view.indexOf('const InvestmentsView'));
      expect(body.match(/\bhistory\b/g)!.every(Boolean)).toBe(true);
      const render = body.slice(body.indexOf('return (\n        <div className="max-w-7xl'));
      expect(render).not.toMatch(/rawInvestments|[^a-zA-Z]history[^a-zA-Z]/);
    });

    it('a guarda de busca e o createRequestGuard seguem como estavam', () => {
      expect(view).toContain('createPortfolioFetcher(guardRef.current');
      expect(view).toContain('guardRef.current.invalidate()');
      expect(read('src/domain/investments/portfolioOverview.ts')).toContain('createRequestGuard');
    });

    it('o detalhamento da V2-A1 usa o mesmo escopo owner-only do histórico', () => {
      expect(view).toContain('investmentService.getInvestments(dateFromMonthKey(key), userId)');
      expect(view).toContain('investmentService.getInvestmentHistory(userId, start, end)');
    });
  });
});
