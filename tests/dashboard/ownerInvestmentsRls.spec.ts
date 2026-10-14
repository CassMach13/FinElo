import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, C, D, E, EMAIL, as, closeDatabases, createDatabase, q } from '../helpers/investmentsPgFixture';
import { summarizeOwnerInvestments, type OwnerLatestPosition } from '../../src/domain/investments/ownerInvestmentTotals';

/**
 * As consultas que `getLatestPositionsByOwner` faz (último mês do dono até o corte + posições daquele mês, sempre com
 * `user_id = dono`), executadas como `authenticated` contra a RLS real de `investments` (has_family_access).
 * Fixture: A tem ago/2026 (1000,10) e set/2026 (1100,20 + 50); B tem set/2026 (77); A convidou B (accepted).
 */
vi.setConfig({ testTimeout: 120_000 });
afterEach(closeDatabases);

const latestFor = async (db: PGlite, session: string, owner: string, endKey: string): Promise<OwnerLatestPosition> => {
  await as(db, 'authenticated', session);
  const m = await q<{ reference_month: string }>(
    db,
    'select reference_month::text from public.investments where user_id = $1 and reference_month <= $2 order by reference_month desc limit 1',
    [owner, endKey]
  );
  if (!m[0]) return { ownerUserId: owner, monthKey: null, balances: [] };
  const rows = await q<{ balance: string }>(db, 'select balance::text from public.investments where user_id = $1 and reference_month = $2 order by id', [owner, m[0].reference_month]);
  return { ownerUserId: owner, monthKey: m[0].reference_month, balances: rows.map((r) => r.balance) };
};

describe('investimentos por dono sob a RLS real', () => {
  it('familiar autorizado vê a última posição do titular; consolidado soma por dono em centavos', async () => {
    const db = await createDatabase();
    const a = await latestFor(db, B, A, '2026-10-15');
    const b = await latestFor(db, B, B, '2026-10-15');
    expect(a).toEqual({ ownerUserId: A, monthKey: '2026-09-01', balances: ['1100.20', '50'] });
    expect(b.monthKey).toBe('2026-09-01');
    const family = summarizeOwnerInvestments([a, b]);
    expect(family.totalCents).toBe(115020 + 7700);
    // corte em agosto: A volta para ago/2026 e B não tem posição — meses NÃO são misturados
    const aug = summarizeOwnerInvestments([await latestFor(db, B, A, '2026-08-31'), await latestFor(db, B, B, '2026-08-31')]);
    expect(aug.byOwner).toEqual([
      { ownerUserId: A, monthKey: '2026-08-01', totalCents: 100010, positions: 1 },
      { ownerUserId: B, monthKey: null, totalCents: 0, positions: 0 },
    ]);
  });

  it('não autorizado, pendente e recusado: nenhuma posição do titular', async () => {
    const db = await createDatabase();
    for (const outsider of [C, D, E]) {
      expect(await latestFor(db, outsider, A, '2026-10-15')).toEqual({ ownerUserId: A, monthKey: null, balances: [] });
    }
  });

  it('revogação do vínculo: a mesma consulta deixa de devolver as posições do titular', async () => {
    const db = await createDatabase();
    expect((await latestFor(db, B, A, '2026-10-15')).monthKey).toBe('2026-09-01');
    await as(db, 'postgres');
    await q(db, 'delete from public.family_members where owner_id = $1 and member_email = $2', [A, EMAIL[B]]);
    expect(await latestFor(db, B, A, '2026-10-15')).toEqual({ ownerUserId: A, monthKey: null, balances: [] });
  });
});
