import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, C, D, E, MIGRATIONS, ROLLBACKS, SNAP, as, closeDatabases, createDatabase, policySnapshot, q } from '../helpers/investmentsPgFixture';

/**
 * Reconciliação da policy "Family Access Investments" (20261008115900): cria se ausente, aceita se equivalente,
 * FALHA se diferente ou se `has_family_access` não existir. Usa catálogo (`pg_policy`) e papéis reais do PostgreSQL.
 */
vi.setConfig({ testTimeout: 120_000 });
afterEach(closeDatabases);

const POLICY = 'Family Access Investments';
const reconcile = MIGRATIONS.reconcile;

const bare = () => createDatabase({ reconcile: false, b1a: false });
const createPolicy = (db: PGlite, ddl: string) => db.exec(`create policy "${POLICY}" on public.investments ${ddl};`);
const exists = async (db: PGlite) => (await q(db, "select 1 from pg_policies where tablename='investments' and policyname=$1", [POLICY])).length === 1;

/** Matriz de comportamento com papéis reais: quem lê e quem atualiza a linha de A. */
const behavior = async (db: PGlite) => {
  const out: Record<string, { read: number; update: number }> = {};
  for (const [name, role, uid] of [['A', 'authenticated', A], ['B', 'authenticated', B], ['C', 'authenticated', C], ['D', 'authenticated', D], ['E', 'authenticated', E], ['anon', 'anon', '']] as const) {
    await as(db, role, uid);
    let read = 0;
    let update = 0;
    try {
      read = (await q(db, 'select id from public.investments where id = $1', [SNAP])).length;
      update = (await q(db, 'update public.investments set balance = balance where id = $1 returning id', [SNAP])).length;
    } catch {
      /* privilégio negado conta como 0 */
    }
    out[name] = { read, update };
  }
  await as(db, 'postgres');
  return out;
};

const rejection = async (db: PGlite) => {
  const before = await policySnapshot(db);
  let error: Error | null = null;
  try {
    await db.exec(reconcile);
  } catch (e) {
    error = e as Error;
  }
  expect(error, 'a reconciliação deveria falhar').not.toBeNull();
  expect(await policySnapshot(db)).toBe(before); // nada foi substituído, ampliado nem removido
  expect(await q(db, "select 1 from pg_policies where policyname = 'finelo_family_policy_probe_tmp'")).toHaveLength(0);
  return error!.message;
};

describe('A: policy ausente → cria o contrato canônico', () => {
  it('cria FOR ALL, TO public, permissiva, com USING e WITH CHECK has_family_access', async () => {
    const db = await bare();
    expect(await exists(db)).toBe(false);
    await db.exec(reconcile);
    const row = (await q<{ cmd: string; permissive: string; roles: string; qual: string; with_check: string }>(db, "select cmd, permissive, roles::text, qual, with_check from pg_policies where tablename='investments' and policyname=$1", [POLICY]))[0];
    expect(row.cmd).toBe('ALL');
    expect(row.permissive).toBe('PERMISSIVE');
    expect(row.roles).toBe('{public}');
    expect(row.qual).toMatch(/has_family_access\(user_id\)/);
    expect(row.with_check).toMatch(/has_family_access\(user_id\)/);
    expect(await q(db, "select 1 from pg_policy where polname like 'finelo_family_policy_probe%'")).toHaveLength(0);
  });

  it('comportamento real: dono e familiar aceito acessam; terceiro, pendente, recusado e anon não', async () => {
    const db = await bare();
    await db.exec(reconcile);
    const m = await behavior(db);
    expect(m.A).toEqual({ read: 1, update: 1 });
    expect(m.B).toEqual({ read: 1, update: 1 });
    for (const who of ['C', 'D', 'E', 'anon']) expect(m[who]).toEqual({ read: 0, update: 0 });
  });

  it('J: não altera nenhuma outra policy de investments nem a função familiar, nem family_members', async () => {
    const db = await bare();
    await as(db, 'postgres');
    const others = async () => (await q<{ p: string }>(db, `select string_agg(polname||'|'||polcmd::text||'|'||coalesce(pg_get_expr(polqual,polrelid),'')||'|'||coalesce(pg_get_expr(polwithcheck,polrelid),''), ';' order by polname) p from pg_policy where polrelid='public.investments'::regclass and polname <> $1`, [POLICY]))[0].p;
    const fn = async () => (await q<{ h: string }>(db, "select md5(pg_get_functiondef('public.has_family_access(uuid)'::regprocedure)) h"))[0].h;
    const fm = async () => (await q<{ h: string }>(db, "select md5(string_agg(member_email||status, ',' order by member_email)) h from public.family_members"))[0].h;
    const t0 = [await others(), await fn(), await fm()];
    await db.exec(reconcile);
    expect([await others(), await fn(), await fm()]).toEqual(t0);
  });
});

describe('B/C: policy equivalente → nada muda; reaplicação idempotente', () => {
  it('B: equivalente (formatação e qualificação de schema diferentes) não é alterada', async () => {
    const db = await bare();
    await createPolicy(db, 'AS PERMISSIVE FOR ALL TO public USING ( ( has_family_access( user_id ) ) ) WITH CHECK ((public.has_family_access(user_id)))');
    const before = await policySnapshot(db);
    await expect(db.exec(reconcile)).resolves.not.toThrow();
    expect(await policySnapshot(db)).toBe(before);
    const oid = (await q<{ oid: string }>(db, "select oid::text from pg_policy where polname=$1", [POLICY]))[0].oid;
    await db.exec(reconcile);
    expect((await q<{ oid: string }>(db, 'select oid::text from pg_policy where polname=$1', [POLICY]))[0].oid).toBe(oid); // mesma policy, não recriada
  });

  it('C: reaplicar depois de criar é idempotente', async () => {
    const db = await bare();
    await db.exec(reconcile);
    const first = await policySnapshot(db);
    await db.exec(reconcile);
    await db.exec(reconcile);
    expect(await policySnapshot(db)).toBe(first);
  });
});

describe('divergências → falha fail-closed sem alterar nada', () => {
  it('D: SELECT em vez de ALL', async () => {
    const db = await bare();
    await createPolicy(db, 'FOR SELECT TO public USING (public.has_family_access(user_id))');
    expect(await rejection(db)).toMatch(/comando/);
  });

  it('E: autorização alterada (OR true, ou só o dono)', async () => {
    for (const using of ['public.has_family_access(user_id) OR true', 'auth.uid() = user_id', 'true']) {
      const db = await bare();
      await createPolicy(db, `FOR ALL TO public USING (${using}) WITH CHECK (public.has_family_access(user_id))`);
      expect(await rejection(db)).toMatch(/USING/);
    }
  });

  it('F: papéis diferentes', async () => {
    const db = await bare();
    await createPolicy(db, 'FOR ALL TO authenticated USING (public.has_family_access(user_id)) WITH CHECK (public.has_family_access(user_id))');
    expect(await rejection(db)).toMatch(/papéis/);
  });

  it('G: restritiva em vez de permissiva', async () => {
    const db = await bare();
    await createPolicy(db, 'AS RESTRICTIVE FOR ALL TO public USING (public.has_family_access(user_id)) WITH CHECK (public.has_family_access(user_id))');
    expect(await rejection(db)).toMatch(/permissiva/);
  });

  it('H: WITH CHECK ausente ou diferente', async () => {
    for (const ddl of [
      'FOR ALL TO public USING (public.has_family_access(user_id))',
      'FOR ALL TO public USING (public.has_family_access(user_id)) WITH CHECK (true)',
      'FOR ALL TO public USING (public.has_family_access(user_id)) WITH CHECK (auth.uid() = user_id)',
    ]) {
      const db = await bare();
      await createPolicy(db, ddl);
      expect(await rejection(db)).toMatch(/WITH CHECK/);
    }
  });

  it('a mensagem informa exatamente qual contrato não corresponde', async () => {
    const db = await bare();
    await createPolicy(db, 'AS RESTRICTIVE FOR SELECT TO authenticated USING (true)');
    const msg = await rejection(db);
    for (const part of ['comando', 'permissiva', 'papéis', 'USING', 'WITH CHECK']) expect(msg).toContain(part);
  });

  it('I: sem public.has_family_access a migration falha e não cria nada nem função substituta', async () => {
    const db = await bare();
    await db.exec('drop function public.has_family_access(uuid);');
    await expect(db.exec(reconcile)).rejects.toThrow(/has_family_access/);
    expect(await exists(db)).toBe(false);
    expect(await q(db, "select 1 from pg_proc where proname = 'has_family_access'")).toHaveLength(0);
  });
});

describe('policy-sonda preexistente: precheck fail-closed', () => {
  const PROBE = 'finelo_family_policy_probe_tmp';
  const probeRow = async (db: PGlite) =>
    q<{ polname: string; polcmd: string; polroles: string; qual: string | null; chk: string | null }>(
      db,
      "select polname, polcmd::text, polroles::text, pg_get_expr(polqual, polrelid) qual, pg_get_expr(polwithcheck, polrelid) chk from pg_policy where polrelid = 'public.investments'::regclass and polname = $1",
      [PROBE]
    );

  it('com a policy familiar presente (caminho de comparação), uma policy com o nome da sonda NÃO é removida e a migration falha', async () => {
    for (const familyDdl of [
      'FOR ALL TO public USING (public.has_family_access(user_id)) WITH CHECK (public.has_family_access(user_id))', // equivalente
      'FOR SELECT TO public USING (public.has_family_access(user_id))', // divergente
    ]) {
      const db = await bare();
      await createPolicy(db, familyDdl);
      await db.exec(`create policy "${PROBE}" on public.investments for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);`);
      const probeBefore = await probeRow(db);
      const before = await policySnapshot(db);
      await expect(db.exec(reconcile)).rejects.toThrow(/finelo_family_policy_probe_tmp.*Nenhuma policy foi alterada ou removida/s);
      expect(await probeRow(db)).toEqual(probeBefore); // intacta: mesmo comando, papéis e expressões
      expect(await policySnapshot(db)).toBe(before); // nenhuma outra policy mudou
      expect(await exists(db)).toBe(true);
    }
  });

  it('o precheck dispara antes de qualquer DROP ou CREATE: nada é criado nem removido', async () => {
    const db = await bare();
    await createPolicy(db, 'FOR ALL TO public USING (public.has_family_access(user_id)) WITH CHECK (public.has_family_access(user_id))');
    await db.exec(`create policy "${PROBE}" on public.investments for select to public using (true);`);
    const before = await policySnapshot(db);
    const oids = async () => (await q<{ o: string }>(db, "select string_agg(polname || ':' || oid::text, ',' order by polname) o from pg_policy where polrelid = 'public.investments'::regclass"))[0].o;
    const oidsBefore = await oids();
    await expect(db.exec(reconcile)).rejects.toThrow(/nome reservado à sonda/);
    expect(await oids()).toBe(oidsBefore); // mesmos objetos: nenhuma policy foi recriada
    expect(await policySnapshot(db)).toBe(before);
  });

  it('com a policy familiar ausente (caminho de criação) a sonda não é usada e a preexistente é preservada', async () => {
    const db = await bare();
    await db.exec(`create policy "${PROBE}" on public.investments for select to public using (true);`);
    const probeBefore = await probeRow(db);
    await db.exec(reconcile);
    expect(await exists(db)).toBe(true);
    expect(await probeRow(db)).toEqual(probeBefore);
  });

  it('sem policy-sonda preexistente o fluxo normal continua e nenhuma sonda sobra', async () => {
    const db = await bare();
    await createPolicy(db, 'FOR ALL TO public USING (public.has_family_access(user_id)) WITH CHECK (public.has_family_access(user_id))');
    await expect(db.exec(reconcile)).resolves.not.toThrow();
    expect(await probeRow(db)).toHaveLength(0);
  });
});

describe('K: instalação nova × ambiente preexistente', () => {
  it('migrations na ordem correta produzem o mesmo contrato de autorização do ambiente atual', async () => {
    const preexisting = await bare();
    await createPolicy(preexisting, 'FOR ALL TO public USING (has_family_access(user_id)) WITH CHECK (has_family_access(user_id))'); // como em staging/produção
    await preexisting.exec(reconcile); // equivalente: nada muda
    const fresh = await bare();
    await fresh.exec(reconcile);
    await fresh.exec(MIGRATIONS.b1a);
    await preexisting.exec(MIGRATIONS.b1a);
    expect(await policySnapshot(fresh)).toBe(await policySnapshot(preexisting));
    expect(await behavior(fresh)).toEqual(await behavior(preexisting));
  });

  it('a ordem dos arquivos garante a reconciliação antes da B1A', () => {
    const names = ['20261008115900_reconcile_investments_family_policy.sql', '20261008120000_investment_portfolios_holdings.sql'];
    expect([...names].sort()).toEqual(names);
  });
});

describe('contrato textual', () => {
  const code = reconcile.replace(/^\s*--.*$/gm, '');

  it('só remove a sonda; nunca a policy existente; não recria função nem toca em family_members', () => {
    const drops = code.match(/DROP POLICY[^;]*?c_[a-z]+/g) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(d).toMatch(/c_probe/);
    expect(code).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
    expect(code).not.toMatch(/family_members/);
    expect(code).not.toMatch(/ALTER POLICY/i);
    expect(code).not.toMatch(/ALTER TABLE/i);
  });

  it('o rollback é documental e não remove a policy familiar', () => {
    const down = ROLLBACKS.reconcile;
    const sql = down.replace(/^\s*--.*$/gm, '').trim();
    expect(sql).toBe('SELECT 1;');
  });
});
