-- A trilha de reversão das resoluções de reconciliação.
--
-- ===========================================================================
-- POR QUE ESTA MIGRATION EXISTE SEPARADA, E TARDE
-- ===========================================================================
--
-- Esta tabela foi criada em staging durante o PR 4B1, por um passo incremental
-- aplicado direto no banco que nunca virou arquivo. O resultado: staging tinha
-- a tabela, as RPCs a referenciavam, os testes passavam — e o repositório não
-- sabia criá-la.
--
-- O preflight de produção pegou. Aplicar as migrations versionadas num banco
-- que só as conhece falharia: `20260902150000_card_reconciliation_snapshot_rpc`
-- cria índices sobre esta tabela e as RPCs a leem.
--
-- O DDL abaixo foi EXTRAÍDO do estado real de staging — colunas, tipos, FKs,
-- unicidade, índices, RLS e políticas — e não redesenhado. O que se versiona
-- aqui é o que foi validado, não uma versão conceitualmente melhor dele.
--
-- O timestamp a coloca depois de `card_resolution_taxonomy` (que ajusta
-- `credit_card_reconciliation_resolutions`, alvo da FK) e antes de
-- `card_reconciliation_revisions`, que instala gatilho sobre ela. É a mesma
-- ordem relativa em que os objetos nasceram em staging.

begin;

-- ---------------------------------------------------------------------------
-- A tabela
-- ---------------------------------------------------------------------------
--
-- Reverter é ACRESCENTAR uma linha, nunca apagar a original: a resolução
-- revertida continua na trilha, e é o que permite explicar depois o que foi
-- afirmado e desfeito. Daí `on delete restrict` na FK para a resolução — apagar
-- uma resolução que tem reversão destruiria metade da história.

create table if not exists public.credit_card_reconciliation_resolution_reversals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.contas(id) on delete cascade,
  resolution_id uuid not null unique
    references public.credit_card_reconciliation_resolutions(id) on delete restrict,
  idempotency_key text null,
  reason text null,
  reversed_at timestamptz not null default now(),
  reversed_by uuid null references auth.users(id) on delete set null
);

comment on table public.credit_card_reconciliation_resolution_reversals is
  'Reversao de uma resolucao de reconciliacao. Acrescenta linha; a original nunca e apagada.';
comment on column public.credit_card_reconciliation_resolution_reversals.resolution_id is
  'A resolucao revertida. UNIQUE: uma resolucao so pode ser revertida uma vez.';
comment on column public.credit_card_reconciliation_resolution_reversals.idempotency_key is
  'Chave da INTENCAO de reverter. Repetir com a mesma chave devolve a linha original.';

-- ---------------------------------------------------------------------------
-- Unicidade
-- ---------------------------------------------------------------------------
--
-- A leitura previa da chave reduz a corrida; quem a ELIMINA e este indice: duas
-- requisicoes simultaneas com a mesma intencao chegam as duas ao insert, e a
-- segunda quebra em vez de duplicar.

create unique index if not exists idx_cc_resolution_reversal_idempotency
  on public.credit_card_reconciliation_resolution_reversals (user_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Mesmo padrao das demais tabelas de cartao: acesso pela familia, leitura e
-- insercao. Nao ha update nem delete — uma reversao registrada nao se edita.

alter table public.credit_card_reconciliation_resolution_reversals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy
     where polrelid = 'public.credit_card_reconciliation_resolution_reversals'::regclass
       and polname = 'Family read reconciliation reversals'
  ) then
    create policy "Family read reconciliation reversals"
      on public.credit_card_reconciliation_resolution_reversals
      for select using (public.has_family_access(user_id));
  end if;

  if not exists (
    select 1 from pg_policy
     where polrelid = 'public.credit_card_reconciliation_resolution_reversals'::regclass
       and polname = 'Family insert reconciliation reversals'
  ) then
    create policy "Family insert reconciliation reversals"
      on public.credit_card_reconciliation_resolution_reversals
      for insert with check (public.has_family_access(user_id));
  end if;
end $$;

commit;
