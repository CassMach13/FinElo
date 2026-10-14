import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, C, SNAP, SNAP2, SNAP3, as, closeDatabases, createDatabase, newHolding, newPortfolio, q } from '../helpers/investmentsPgFixture';

/**
 * Contrato da classificação (V2-B1B) contra o banco REAL da V2-B1A (migrations aplicadas no PGlite): exatamente o
 * UPDATE que `classifyInvestment`/`unclassifyInvestment` emitem — `SET portfolio_id, holding_id WHERE id AND user_id`
 * — executado como `authenticated`. Prova que a classificação não toca em dado financeiro, que a auditoria é do banco
 * e que a propriedade nunca muda.
 */
vi.setConfig({ testTimeout: 120_000 });
afterEach(closeDatabases);

const FINANCIAL = `id, user_id, institution, product_type, balance, reference_month, created_at, product_name, yield_rate, maturity_date,
  invested_principal, source_file, application_date, monthly_yield_rate, gross_return_amount, original_applied_amount`;

/** Mesmo SQL que o PostgREST gera para o UPDATE do serviço. */
const classify = (db: PGlite, id: string, owner: string, portfolio: string | null, holding: string | null) =>
  q<{ id: string; classified_by: string | null }>(
    db,
    'update public.investments set portfolio_id = $1, holding_id = $2 where id = $3 and user_id = $4 returning id, classified_by',
    [portfolio, holding, id, owner]
  );

const financialHash = async (db: PGlite) => {
  await as(db, 'postgres');
  return (await q<{ h: string }>(db, `select md5(string_agg(to_jsonb(t)::text, '|' order by t.id)) h from (select ${FINANCIAL} from public.investments) t`))[0].h;
};
const state = async (db: PGlite, id: string) => {
  await as(db, 'postgres');
  return (await q<{ user_id: string; portfolio_id: string | null; holding_id: string | null; classified_by: string | null; classified_at: string | null }>(
    db, 'select user_id, portfolio_id, holding_id, classified_by, classified_at::text from public.investments where id = $1', [id]))[0];
};

describe('classificar e desfazer pelo contrato do serviço', () => {
  it('dono classifica, familiar move, dono desfaz: dados financeiros intactos e auditoria do banco em cada passo', async () => {
    const db = await createDatabase();
    const before = await financialHash(db);
    await as(db, 'authenticated', A);
    const p1 = await newPortfolio(db, A, 'Longo prazo');
    const p2 = await newPortfolio(db, A, 'Reserva');
    const h1 = await newHolding(db, A, p1, 'CDB X');

    expect(await classify(db, SNAP2, A, p1, h1)).toHaveLength(1);
    expect(await state(db, SNAP2)).toMatchObject({ user_id: A, portfolio_id: p1, holding_id: h1, classified_by: A });

    await as(db, 'authenticated', B);
    expect(await classify(db, SNAP2, A, p2, null)).toHaveLength(1);
    expect(await state(db, SNAP2)).toMatchObject({ user_id: A, portfolio_id: p2, holding_id: null, classified_by: B });

    await as(db, 'authenticated', A);
    expect(await classify(db, SNAP2, A, null, null)).toHaveLength(1);
    const undone = await state(db, SNAP2);
    expect(undone).toMatchObject({ user_id: A, portfolio_id: null, holding_id: null, classified_by: A });
    expect(undone.classified_at).not.toBeNull(); // desfazer é auditado, não apaga a autoria

    expect(await financialHash(db)).toBe(before);
  });

  it('o filtro de proprietário torna no-op um pedido com o dono errado; sem vínculo, a RLS esconde o snapshot', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    expect(await classify(db, SNAP, B, p, null)).toHaveLength(0); // snapshot de A pedido como se fosse de B
    await as(db, 'authenticated', C);
    expect(await classify(db, SNAP, A, p, null)).toHaveLength(0); // C não tem vínculo
    expect(await state(db, SNAP)).toMatchObject({ portfolio_id: null, classified_by: null });
  });

  it('carteira de outro proprietário é recusada pelo banco (FK composta): nunca mistura donos', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const pB = await newPortfolio(db, B, 'Carteira de B');
    await expect(classify(db, SNAP, A, pB, null)).rejects.toThrow(/foreign key|violates/);
    expect(await state(db, SNAP)).toMatchObject({ user_id: A, portfolio_id: null });
  });

  it('uma holding por mês: a segunda posição do mesmo mês na mesma holding é recusada (23505)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    const h = await newHolding(db, A, p, 'CDB X');
    await classify(db, SNAP2, A, p, h);
    await expect(classify(db, SNAP3, A, p, h)).rejects.toMatchObject({ code: '23505' });
    expect(await classify(db, SNAP, A, p, h)).toHaveLength(1); // outro mês: permitido
  });

  it('reenviar a mesma classificação não altera a auditoria', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    await classify(db, SNAP, A, p, null);
    const first = await state(db, SNAP);
    await as(db, 'authenticated', B);
    await classify(db, SNAP, A, p, null);
    expect(await state(db, SNAP)).toEqual(first);
  });

  it('o banco aceita carteira arquivada como destino — por isso o serviço recusa antes de gravar', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'Antiga');
    await q(db, 'update public.investment_portfolios set archived_at = now() where id = $1', [p]);
    expect(await classify(db, SNAP, A, p, null)).toHaveLength(1);
  });
});
