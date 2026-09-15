import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const productionDryRun = readFileSync(
  resolve('scripts/sql/20260905_9c10_installment_metadata_dry_run.sql'),
  'utf8'
);
const productionRepair = readFileSync(
  resolve('scripts/sql/20260905_9c10_installment_metadata_repair.sql'),
  'utf8'
);
const productionRollback = readFileSync(
  resolve('scripts/sql/20260905_9c10_installment_metadata_rollback.sql'),
  'utf8'
);

const PROD_ACCOUNT = '97d11eb6-ed8d-47d0-9639-956ad222eb16';
const PROD_CARD = '4c839d44-c1d1-4486-9b93-5c5077a1d37b';
const PROD_IDENTITY = '92d7311e810b92df05054e994f92746af551430254a1f53886a40d343b364ea3';
const PROD_INVARIANT = 'a1379912b521e6c0609dd5f00dc4de96b6839f32fce5f074aae39c390c701357';

const TEST_USER = '11111111-1111-4111-8111-111111111111';
const TEST_ACCOUNT = '22222222-2222-4222-8222-222222222222';
const TEST_CARD = '33333333-3333-4333-8333-333333333333';

const databases: PGlite[] = [];

const baseSchema = `
create schema extensions;

-- PGlite não empacota pgcrypto. Esta função determinística de 32 bytes existe
-- só no PostgreSQL descartável para exercitar o contrato de hashes do script.
create function extensions.digest(input bytea, algorithm text)
returns bytea
language sql
immutable
strict
as $$
  select decode(
    md5(encode(input, 'hex')) || md5('second:' || encode(input, 'hex')),
    'hex'
  )
$$;

create table public.credit_cards (
  id uuid primary key,
  user_id uuid not null,
  account_id uuid not null,
  name text not null,
  closing_day integer not null,
  due_day integer not null,
  archived boolean not null default false
);

create table public.transactions (
  "ID_Transacao" uuid primary key,
  user_id uuid not null,
  "ID_Conta" uuid not null,
  "Data" timestamptz not null,
  "Data_Pagamento" timestamptz,
  "Descricao_Original" text not null,
  "Nome_Fantasia" text not null,
  "Parcela_Atual" integer,
  "Total_Parcelas" integer,
  "Valor" numeric not null,
  "Tipo" text not null,
  "Categoria" text not null,
  "Origem" text not null,
  "Fonte" text not null,
  linked_asset_id uuid
);

create table public.credit_card_entries (
  id uuid primary key,
  user_id uuid not null,
  card_id uuid not null references public.credit_cards(id),
  account_id uuid not null,
  import_lot_id uuid not null,
  source_file_name text not null,
  source_row_index integer not null,
  source_row_hash text not null,
  transaction_id uuid references public.transactions("ID_Transacao"),
  posted_date date,
  description_raw text not null,
  description_normalized text not null,
  amount numeric not null,
  abs_amount numeric not null,
  direction text not null,
  entry_type text not null,
  installment_current integer,
  installment_total integer,
  classification_source text not null,
  classification_confidence numeric not null,
  statement_id uuid
);

insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day)
values ('${TEST_CARD}', '${TEST_USER}', '${TEST_ACCOUNT}', 'STAGING SYNTHETIC CARD', 3, 10);

insert into public.transactions (
  "ID_Transacao", user_id, "ID_Conta", "Data", "Data_Pagamento",
  "Descricao_Original", "Nome_Fantasia", "Parcela_Atual", "Total_Parcelas",
  "Valor", "Tipo", "Categoria", "Origem", "Fonte"
)
select
  ('40000000-0000-4000-8000-00000000000' || n)::uuid,
  '${TEST_USER}',
  '${TEST_ACCOUNT}',
  make_timestamptz(2026, 6 + n, 5, 0, 0, 0),
  make_timestamptz(2026, 7 + n, 10, 0, 0, 0),
  'SYNTHETIC XP MERCHANT',
  'Synthetic installment',
  null,
  null,
  -25.00,
  'Despesa',
  'Teste',
  'synthetic_xp.csv',
  'Manual'
from generate_series(1, 3) n;

insert into public.credit_card_entries (
  id, user_id, card_id, account_id, import_lot_id, source_file_name,
  source_row_index, source_row_hash, transaction_id, posted_date,
  description_raw, description_normalized, amount, abs_amount, direction,
  entry_type, installment_current, installment_total, classification_source,
  classification_confidence
)
select
  ('50000000-0000-4000-8000-00000000000' || n)::uuid,
  '${TEST_USER}',
  '${TEST_CARD}',
  '${TEST_ACCOUNT}',
  '60000000-0000-4000-8000-000000000001',
  'synthetic_xp.csv',
  n,
  'synthetic-row-' || n,
  ('40000000-0000-4000-8000-00000000000' || n)::uuid,
  make_date(2026, 6 + n, 5),
  'SYNTHETIC XP MERCHANT',
  'SYNTHETIC XP MERCHANT',
  -25.00,
  25.00,
  'debit',
  'installment_purchase',
  n,
  3,
  'import_rule',
  1
from generate_series(1, 3) n;

-- Controle negativo: nunca integra o conjunto nem pode ser alterado.
insert into public.transactions (
  "ID_Transacao", user_id, "ID_Conta", "Data", "Descricao_Original",
  "Nome_Fantasia", "Parcela_Atual", "Total_Parcelas", "Valor", "Tipo",
  "Categoria", "Origem", "Fonte"
) values (
  '70000000-0000-4000-8000-000000000001', '${TEST_USER}', '${TEST_ACCOUNT}',
  '2026-09-01T00:00:00Z', 'MANUAL CONTROL', 'Manual control', null, null,
  -10, 'Despesa', 'Teste', 'manual', 'Manual'
);
`;

const replaceTarget = (sql: string) =>
  sql.replaceAll(PROD_ACCOUNT, TEST_ACCOUNT).replaceAll(PROD_CARD, TEST_CARD);

const readSyntheticMetrics = async (db: PGlite) => {
  const resultSets = await db.exec(replaceTarget(productionDryRun));
  const rows = resultSets.flatMap((result) => result.rows as Record<string, unknown>[]);
  const metric = rows.find((row) => row.candidate_count !== undefined);
  if (!metric) throw new Error('Dry-run sintético não retornou métricas.');
  return {
    count: Number(metric.candidate_count),
    identity: String(metric.identity_sha256),
    invariant: String(metric.invariant_sha256),
  };
};

const adaptExecutable = (
  sql: string,
  metrics: { count: number; identity: string; invariant: string }
) => replaceTarget(sql)
  .replaceAll(PROD_IDENTITY, metrics.identity)
  .replaceAll(PROD_INVARIANT, metrics.invariant)
  .replace(/\b67\b/g, String(metrics.count));

const createDatabase = async () => {
  const db = new PGlite();
  databases.push(db);
  await db.waitReady;
  await db.exec(baseSchema);
  return db;
};

const installmentRows = async (db: PGlite) => {
  const result = await db.query<{
    id: string;
    current: number | null;
    total: number | null;
    source: string;
  }>(`
    select
      "ID_Transacao"::text as id,
      "Parcela_Atual" as current,
      "Total_Parcelas" as total,
      "Fonte" as source
    from public.transactions
    order by "ID_Transacao"
  `);
  return result.rows;
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe('20260905-9C10 — reparo em PostgreSQL 17 descartável', () => {
  it('repara só a metadata, recusa repetição e executa rollback explícito', async () => {
    const db = await createDatabase();
    const version = await db.query<{ version: string }>('select version() as version');
    expect(version.rows[0].version).toContain('PostgreSQL 17');

    const metrics = await readSyntheticMetrics(db);
    expect(metrics.count).toBe(3);

    const before = await installmentRows(db);
    await db.exec(adaptExecutable(productionRepair, metrics));
    const repaired = await installmentRows(db);
    expect(repaired.slice(0, 3).map((row) => [row.current, row.total, row.source])).toEqual([
      [1, 3, 'Manual'],
      [2, 3, 'Manual'],
      [3, 3, 'Manual'],
    ]);
    expect(repaired[3]).toEqual(before[3]);

    await expect(db.exec(adaptExecutable(productionRepair, metrics))).rejects.toThrow(
      /9C10 fail-closed: conjunto divergente/i
    );
    await db.exec('rollback;');

    await db.exec(adaptExecutable(productionRollback, metrics));
    expect(await installmentRows(db)).toEqual(before);
  });

  it('aborta integralmente quando um dado invariável diverge', async () => {
    const db = await createDatabase();
    const metrics = await readSyntheticMetrics(db);
    await db.exec(`
      update public.transactions
      set "Valor" = -25.01
      where "ID_Transacao" = '40000000-0000-4000-8000-000000000002'
    `);

    await expect(db.exec(adaptExecutable(productionRepair, metrics))).rejects.toThrow(
      /9C10 fail-closed: conjunto divergente/i
    );
    await db.exec('rollback;');
    const rows = await installmentRows(db);
    expect(rows.slice(0, 3).every((row) => row.current === null && row.total === null)).toBe(true);
  });
});
