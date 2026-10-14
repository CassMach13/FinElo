import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  A, B, C, SNAP, SNAP2, SNAP3, MIGRATIONS, ROLLBACKS,
  as, closeDatabases, createDatabase, newHolding, newPortfolio, q,
} from '../helpers/investmentsPgFixture';

/**
 * Auditoria da classificação de snapshots (V2-B1A): `classified_by`/`classified_at` registram a ÚLTIMA mudança real de
 * `portfolio_id`/`holding_id`, atribuídos pelo banco a partir de `auth.uid()`. Toda operação de cliente roda como
 * `authenticated`; só a verificação do estado (e o caso sem JWT) usa o papel dono, e dizendo isso.
 */
vi.setConfig({ testTimeout: 120_000 });

afterEach(closeDatabases);

type Audit = { classified_by: string | null; classified_at: string | null; portfolio_id: string | null; holding_id: string | null };
const audit = async (db: Awaited<ReturnType<typeof createDatabase>>, id: string) =>
  (await q<Audit>(db, 'select classified_by, classified_at::text classified_at, portfolio_id, holding_id from public.investments where id = $1', [id]))[0];

describe('legado e INSERT', () => {
  it('1: snapshot legado mantém NULL/NULL', async () => {
    const db = await createDatabase();
    await as(db, 'postgres');
    const rows = await q(db, 'select classified_by, classified_at from public.investments');
    expect(rows).toHaveLength(4);
    expect(rows.every((r: any) => r.classified_by === null && r.classified_at === null)).toBe(true);
  });

  it('13: INSERT sem classificação mantém a auditoria NULL', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const id = (await q<{ id: string }>(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month) values ($1,'XP','Renda Fixa',1,'2026-10-01') returning id", [A]))[0].id;
    expect(await audit(db, id)).toMatchObject({ classified_by: null, classified_at: null });
  });

  it('12: INSERT com classificação registra o operador e o relógio do banco (familiar em nome do dono)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const p = await newPortfolio(db, A, 'P');
    const id = (await q<{ id: string }>(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month, portfolio_id) values ($1,'XP','Renda Fixa',1,'2026-10-01',$2) returning id", [A, p]))[0].id;
    const row = await audit(db, id);
    expect(row.classified_by).toBe(B);
    expect(row.classified_at).not.toBeNull();
    const owner = (await q<{ user_id: string }>(db, 'select user_id from public.investments where id = $1', [id]))[0];
    expect(owner.user_id).toBe(A);
  });

  it('7/8: o cliente não escolhe a auditoria no INSERT (valor enviado é rejeitado)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const p = await newPortfolio(db, A, 'P');
    await expect(q(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month, portfolio_id, classified_by, classified_at) values ($1,'XP','x',1,'2026-10-01',$2,$1,now())", [A, p])).rejects.toThrow(/definidos pelo banco/);
    await expect(q(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month, classified_at) values ($1,'XP','x',1,'2026-10-02', now())", [A])).rejects.toThrow(/definidos pelo banco/);
    await expect(q(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month, classified_by) values ($1,'XP','x',1,'2026-10-03', $2)", [A, B])).rejects.toThrow(/definidos pelo banco/);
  });

  it('classificar sem operador autenticado é recusado (sem bypass por ausência de JWT)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    await as(db, 'postgres'); // papel dono, SEM sessão
    await expect(q(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month, portfolio_id) values ($1,'XP','x',1,'2026-10-01',$2)", [A, p])).rejects.toThrow(/operador autenticado/);
    await expect(q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP])).rejects.toThrow(/operador autenticado/);
    // editar campos não relacionados sem JWT continua possível (não é classificação)
    await expect(q(db, 'update public.investments set balance = 2 where id = $1', [SNAP])).resolves.toBeDefined();
  });
});

describe('UPDATE: atribuir, trocar, desclassificar', () => {
  it('2: o proprietário atribui a carteira — autoria = proprietário', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP]);
    const row = await audit(db, SNAP);
    expect(row).toMatchObject({ classified_by: A, portfolio_id: p });
    expect(row.classified_at).not.toBeNull();
  });

  it('3: o familiar atribui a carteira — autoria = familiar; a propriedade permanece com o dono', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const p = await newPortfolio(db, A, 'P');
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP]);
    expect(await audit(db, SNAP)).toMatchObject({ classified_by: B, portfolio_id: p });
    expect((await q<{ user_id: string }>(db, 'select user_id from public.investments where id = $1', [SNAP]))[0].user_id).toBe(A);
  });

  it('4/5: familiar vincula a holding; o proprietário desfaz — a desclassificação é auditada e não apaga a autoria', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const p = await newPortfolio(db, A, 'P');
    const h = await newHolding(db, A, p);
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP]);
    await q(db, 'update public.investments set holding_id = $1 where id = $2', [h, SNAP]);
    expect(await audit(db, SNAP)).toMatchObject({ classified_by: B, holding_id: h });
    await as(db, 'authenticated', A);
    const before = await audit(db, SNAP);
    await q(db, 'update public.investments set holding_id = null, portfolio_id = null where id = $1', [SNAP]);
    const after = await audit(db, SNAP);
    expect(after).toMatchObject({ portfolio_id: null, holding_id: null, classified_by: A });
    expect(after.classified_at).not.toBeNull();
    expect(after.classified_at).not.toBe(before.classified_at); // novo momento; a linha NÃO volta a NULL/NULL
  });

  it('6: sem mudança de classificação a auditoria permanece (balance, produto, reenvio dos mesmos valores)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const p = await newPortfolio(db, A, 'P');
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP]);
    const base = await audit(db, SNAP);
    await as(db, 'authenticated', A); // outro operador faz edições não relacionadas
    await q(db, "update public.investments set balance = 999, product_name = 'Renomeado' where id = $1", [SNAP]);
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP]); // mesmo valor
    await q(db, 'update public.investments set portfolio_id = $1, holding_id = null where id = $2', [p, SNAP]); // mesmos valores
    expect(await audit(db, SNAP)).toEqual(base);
  });

  it('7/8: tentar alterar classified_by/classified_at isoladamente falha, mesmo com o mesmo operador', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const p = await newPortfolio(db, A, 'P');
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP]);
    const base = await audit(db, SNAP);
    await expect(q(db, 'update public.investments set classified_by = $1 where id = $2', [A, SNAP])).rejects.toThrow(/definidos pelo banco/);
    await expect(q(db, "update public.investments set classified_at = '2000-01-01' where id = $1", [SNAP])).rejects.toThrow(/definidos pelo banco/);
    await expect(q(db, 'update public.investments set classified_by = null, classified_at = null where id = $1', [SNAP])).rejects.toThrow(/definidos pelo banco/);
    // forjar junto com uma mudança real de classificação também é rejeitado (não há substituição silenciosa)
    const p2 = await newPortfolio(db, A, 'P2');
    await expect(q(db, 'update public.investments set portfolio_id = $1, classified_by = $2 where id = $3', [p2, A, SNAP])).rejects.toThrow(/definidos pelo banco/);
    expect(await audit(db, SNAP)).toEqual(base);
  });

  it('o par de auditoria é consistente (CHECK): nunca só um dos dois campos', async () => {
    const db = await createDatabase();
    await as(db, 'postgres');
    await expect(q(db, 'update public.investments set classified_by = $1 where id = $2', [A, SNAP])).rejects.toThrow(/definidos pelo banco|investments_classification_audit_pair_check/);
  });
});

describe('segurança familiar e propriedade', () => {
  it('9: o user_id continua imutável', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    await expect(q(db, 'update public.investments set user_id = $1 where id = $2', [B, SNAP])).rejects.toThrow(/imutável/);
  });

  it('10: vínculo cross-owner continua bloqueado (sem registrar auditoria)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const pB = await newPortfolio(db, B, 'Minha');
    await expect(q(db, 'update public.investments set portfolio_id = $1 where id = $2', [pB, SNAP])).rejects.toThrow(/investments_portfolio_owner_fkey/);
    expect(await audit(db, SNAP)).toMatchObject({ classified_by: null, portfolio_id: null });
  });

  it('11/J: o familiar revogado não classifica; a classificação anterior permanece e o dono mantém o acesso', async () => {
    for (const revoke of ["delete from public.family_members where member_email = 'b@example.test'", "update public.family_members set status = 'declined' where member_email = 'b@example.test'"]) {
      const db = await createDatabase();
      await as(db, 'authenticated', B);
      const p = await newPortfolio(db, A, 'P');
      await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP]);
      const before = await audit(db, SNAP);
      await as(db, 'postgres');
      await db.exec(revoke);
      await as(db, 'authenticated', B);
      expect(await q(db, 'update public.investments set portfolio_id = null where id = $1 returning id', [SNAP])).toHaveLength(0);
      await expect(q(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month, portfolio_id) values ($1,'XP','x',1,'2026-10-01',$2)", [A, p])).rejects.toThrow(/row-level security|violates/i);
      await as(db, 'authenticated', A);
      expect(await audit(db, SNAP)).toEqual(before); // classificação válida e autoria preservadas
      await q(db, 'update public.investments set portfolio_id = null where id = $1', [SNAP]);
      expect((await audit(db, SNAP)).classified_by).toBe(A);
    }
  });

  it('terceiro, convite pendente e recusado não classificam', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    for (const who of [C, '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555']) {
      await as(db, 'authenticated', who);
      expect(await q(db, 'update public.investments set portfolio_id = $1 where id = $2 returning id', [p, SNAP])).toHaveLength(0);
    }
    await as(db, 'authenticated', A);
    expect(await audit(db, SNAP)).toMatchObject({ classified_by: null });
  });
});

describe('efeitos de FK sobre a auditoria', () => {
  it('14: mover a holding de carteira (com JWT) move os snapshots e registra o operador da operação', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p1 = await newPortfolio(db, A, 'P1');
    const p2 = await newPortfolio(db, A, 'P2');
    const h = await newHolding(db, A, p1);
    await q(db, 'update public.investments set portfolio_id = $1, holding_id = $2 where id = $3', [p1, h, SNAP]);
    await q(db, 'update public.investments set portfolio_id = $1, holding_id = $2 where id = $3', [p1, h, SNAP2]);
    await as(db, 'authenticated', B);
    await q(db, 'update public.investment_holdings set portfolio_id = $1 where id = $2', [p2, h]);
    for (const id of [SNAP, SNAP2]) expect(await audit(db, id)).toMatchObject({ portfolio_id: p2, holding_id: h, classified_by: B });
    expect(await audit(db, SNAP3)).toMatchObject({ classified_by: null }); // snapshot sem holding não é afetado
  });

  it('14: mover a holding SEM JWT mantém a auditoria anterior (não há operador a atribuir) e a integridade', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p1 = await newPortfolio(db, A, 'P1');
    const p2 = await newPortfolio(db, A, 'P2');
    const h = await newHolding(db, A, p1);
    await q(db, 'update public.investments set portfolio_id = $1, holding_id = $2 where id = $3', [p1, h, SNAP]);
    const before = await audit(db, SNAP);
    await as(db, 'postgres'); // manutenção sem sessão
    await q(db, 'update public.investment_holdings set portfolio_id = $1 where id = $2', [p2, h]);
    const after = await audit(db, SNAP);
    expect(after).toMatchObject({ portfolio_id: p2, holding_id: h, classified_by: before.classified_by });
    expect(after.classified_at).toBe(before.classified_at);
  });

  it('15: apagar a holding desvincula, mantém a carteira e audita o operador (ou preserva a anterior sem JWT)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    const h = await newHolding(db, A, p);
    await q(db, 'update public.investments set portfolio_id = $1, holding_id = $2 where id = $3', [p, h, SNAP]);
    await as(db, 'authenticated', B);
    await q(db, 'delete from public.investment_holdings where id = $1', [h]);
    expect(await audit(db, SNAP)).toMatchObject({ holding_id: null, portfolio_id: p, classified_by: B });

  });

  it('15 (sem JWT): apagar a holding sem sessão preserva a auditoria e a carteira', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    const h = await newHolding(db, A, p);
    await q(db, 'update public.investments set portfolio_id = $1, holding_id = $2 where id = $3', [p, h, SNAP]);
    const before = await audit(db, SNAP);
    await as(db, 'postgres');
    await q(db, 'delete from public.investment_holdings where id = $1', [h]);
    const after = await audit(db, SNAP);
    expect(after).toMatchObject({ holding_id: null, portfolio_id: p, classified_by: before.classified_by });
    expect(after.classified_at).toBe(before.classified_at);
  });
});

describe('rollback da auditoria', () => {
  it('16: remove os objetos novos, preserva os valores financeiros e a policy familiar', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const p = await newPortfolio(db, A, 'P');
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP]);
    await as(db, 'postgres');
    const before = await q(db, 'select id, balance, reference_month::text, product_name, user_id from public.investments order by id');
    await db.exec(ROLLBACKS.b1a);
    expect(await q(db, 'select id, balance, reference_month::text, product_name, user_id from public.investments order by id')).toEqual(before);
    expect(await q(db, "select 1 from information_schema.columns where table_name='investments' and column_name in ('classified_by','classified_at','portfolio_id','holding_id')")).toHaveLength(0);
    expect(await q(db, "select 1 from pg_trigger where tgname = 'trg_investments_classification_audit'")).toHaveLength(0);
    expect(await q(db, "select 1 from pg_proc where proname = 'investments_classification_audit'")).toHaveLength(0);
    expect(await q(db, "select 1 from pg_policies where tablename='investments' and policyname='Family Access Investments'")).toHaveLength(1);
    // reaplicar a migration depois do rollback volta a NULL/NULL (a auditoria anterior se perdeu, como documentado)
    await db.exec(MIGRATIONS.b1a);
    expect((await audit(db, SNAP)).classified_by).toBeNull();
  });
});
