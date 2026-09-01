-- Modelo de dois livros para o módulo de cartão: econômico e de reconciliação.
--
-- FASE «EXPAND» do expand-contract. Esta migração é puramente aditiva:
-- nenhuma coluna existente é removida, renomeada ou alterada, e nenhum valor
-- financeiro é migrado. Os campos derivados nascem nulos e são preenchidos pelo
-- rebuild; os pares renomeados são copiados do nome antigo para o novo, que é
-- cópia sob outro nome, não movimentação de dinheiro.
--
-- Contexto: `statement_total_from_file` mede o que o ARQUIVO declara, não o que o
-- BANCO cobrou — em 23/23 lotes comparáveis de produção ele coincide com a soma
-- das próprias linhas. Por isso ele passa a se chamar `file_reported_total`, e o
-- valor oficial do emissor ganha campo próprio, com procedência explícita.

begin;

-- ---------------------------------------------------------------------------
-- 1. Renomeações em curso (nomes novos convivendo com os antigos)
-- ---------------------------------------------------------------------------

alter table public.credit_card_import_lots
  add column if not exists file_reported_total numeric(15, 2) null,
  add column if not exists computed_lines_total numeric(15, 2) null;

alter table public.credit_card_statements
  add column if not exists file_reported_total numeric(15, 2) null,
  add column if not exists computed_lines_total numeric(15, 2) null;

comment on column public.credit_card_import_lots.file_reported_total is
  'Total declarado pelo rodapé do arquivo importado. NÃO é autoridade sobre o valor oficial da fatura.';
comment on column public.credit_card_import_lots.computed_lines_total is
  'Soma das linhas atribuídas, calculada pelo motor.';
comment on column public.credit_card_statements.file_reported_total is
  'Total declarado pelo rodapé do arquivo importado. NÃO é autoridade sobre o valor oficial da fatura.';
comment on column public.credit_card_statements.computed_lines_total is
  'Soma das linhas atribuídas, calculada pelo motor.';

-- Cópia sob o nome novo. Idempotente: só preenche o que ainda está nulo.
update public.credit_card_import_lots
   set file_reported_total = statement_total_from_file
 where file_reported_total is null
   and statement_total_from_file is not null;

update public.credit_card_import_lots
   set computed_lines_total = lines_computed_total
 where computed_lines_total is null
   and lines_computed_total is not null;

update public.credit_card_statements
   set file_reported_total = statement_total_from_file
 where file_reported_total is null
   and statement_total_from_file is not null;

update public.credit_card_statements
   set computed_lines_total = lines_computed_total
 where computed_lines_total is null
   and lines_computed_total is not null;

-- ---------------------------------------------------------------------------
-- 2. Total autoritativo — exige procedência registrada para valer
-- ---------------------------------------------------------------------------

alter table public.credit_card_statements
  add column if not exists authoritative_statement_total numeric(15, 2) null,
  add column if not exists authoritative_source text null,
  add column if not exists authoritative_recorded_at timestamptz null,
  add column if not exists authoritative_recorded_by uuid null references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'credit_card_statements_authoritative_source_check'
  ) then
    alter table public.credit_card_statements
      add constraint credit_card_statements_authoritative_source_check
      check (authoritative_source is null
             or authoritative_source in ('bank_app', 'bank_pdf', 'bank_api', 'user_declared'));
  end if;
end $$;

-- Um total autoritativo sem procedência é indistinguível de um palpite: proíbe-se
-- gravar o valor sem dizer de onde veio.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'credit_card_statements_authoritative_provenance_check'
  ) then
    alter table public.credit_card_statements
      add constraint credit_card_statements_authoritative_provenance_check
      check (authoritative_statement_total is null or authoritative_source is not null);
  end if;
end $$;

comment on column public.credit_card_statements.authoritative_statement_total is
  'Valor oficial da fatura conforme o emissor. Primeiro nível da escada do TOTAL. Só é válido com authoritative_source preenchido.';
comment on column public.credit_card_statements.authoritative_source is
  'Procedência do total oficial: bank_app | bank_pdf | bank_api | user_declared. NUNCA preenchido automaticamente a partir de manual_totals_json.';

-- ---------------------------------------------------------------------------
-- 3. Livro 2 — reconciliação (campos derivados, preenchidos pelo rebuild)
-- ---------------------------------------------------------------------------

alter table public.credit_card_statements
  add column if not exists reconciliation_adjustment numeric(15, 2) null,
  add column if not exists unresolved_reconciliation_delta numeric(15, 2) null,
  add column if not exists economic_status text null,
  add column if not exists reconciliation_status text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'credit_card_statements_economic_status_check'
  ) then
    alter table public.credit_card_statements
      add constraint credit_card_statements_economic_status_check
      check (economic_status is null
             or economic_status in ('paid', 'open', 'overdue', 'settled_confirmed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'credit_card_statements_reconciliation_status_check'
  ) then
    alter table public.credit_card_statements
      add constraint credit_card_statements_reconciliation_status_check
      check (reconciliation_status is null
             or reconciliation_status in ('reconciled', 'adjusted', 'unreconciled', 'resolved'));
  end if;
end $$;

comment on column public.credit_card_statements.reconciliation_adjustment is
  'authoritative_statement_total − computed_lines_total. Livro 2. Nunca alimenta carry econômico.';
comment on column public.credit_card_statements.unresolved_reconciliation_delta is
  'Diferença observada cuja natureza não está provada. Livro 2. Não vira dívida nem crédito sem resolução explícita.';
comment on column public.credit_card_statements.economic_status is
  'Livro 1: paid | open | overdue | settled_confirmed. Nulo até o rebuild preencher. Só «overdue» habilita o badge VENCIDA.';
comment on column public.credit_card_statements.reconciliation_status is
  'Livro 2: reconciled | adjusted | unreconciled | resolved. Ortogonal a economic_status — uma competência pode estar paga e não reconciliada.';

-- ---------------------------------------------------------------------------
-- 4. Confirmações: autoridade sobre LIQUIDAÇÃO, não sobre TOTAL
-- ---------------------------------------------------------------------------

alter table public.credit_card_competence_payment_confirmations
  add column if not exists confirmation_type text not null default 'amount';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cc_competence_payment_confirm_type_check'
  ) then
    alter table public.credit_card_competence_payment_confirmations
      add constraint cc_competence_payment_confirm_type_check
      check (confirmation_type in ('amount', 'full'));
  end if;
end $$;

comment on column public.credit_card_competence_payment_confirmations.confirmation_type is
  'amount = valor reconhecido como pago (semântica histórica, default). full = fatura confirmada como integralmente quitada: zera o saldo econômico e impede reaparecer como vencida, sem reescrever totais nem pagamentos.';

-- ---------------------------------------------------------------------------
-- 5. Resoluções de reconciliação — o evento que move valor do livro 2 ao livro 1
-- ---------------------------------------------------------------------------

create table if not exists public.credit_card_reconciliation_resolutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  reference_month text not null
    check (reference_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  delta_amount numeric(15, 2) not null,
  resolution text not null
    check (resolution in ('economic_credit', 'bank_adjustment', 'authoritative_total', 'written_off')),
  authoritative_total numeric(15, 2) null,
  note text null,
  resolved_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cc_reconciliation_resolution_total_check
    check (resolution <> 'authoritative_total' or authoritative_total is not null)
);

comment on table public.credit_card_reconciliation_resolutions is
  'Trilha de auditoria das diferenças de reconciliação resolvidas. Log de eventos: a resolução vigente de uma competência é a mais recente. Sem um registro aqui, um excedente sem total autoritativo permanece inerte no livro 2 — a intenção nunca é inferida da magnitude.';
comment on column public.credit_card_reconciliation_resolutions.resolution is
  'economic_credit = vira carry no livro 1 (prepagamento declarado pelo usuário); bank_adjustment = permanece no livro 2, explicado; authoritative_total = o usuário informou o valor oficial; written_off = baixa consciente.';
comment on column public.credit_card_reconciliation_resolutions.delta_amount is
  'O delta que existia no momento da resolução. Guardado para auditoria: permite detectar que o delta mudou depois de resolvido.';

create index if not exists idx_cc_reconciliation_resolution_account
  on public.credit_card_reconciliation_resolutions (account_id);
create index if not exists idx_cc_reconciliation_resolution_lookup
  on public.credit_card_reconciliation_resolutions (user_id, account_id, reference_month, resolved_at desc);

drop trigger if exists trg_cc_reconciliation_resolution_updated_at
  on public.credit_card_reconciliation_resolutions;
create trigger trg_cc_reconciliation_resolution_updated_at
before update on public.credit_card_reconciliation_resolutions
for each row execute procedure public.handle_updated_at();

alter table public.credit_card_reconciliation_resolutions enable row level security;

drop policy if exists "Family read reconciliation resolutions"
  on public.credit_card_reconciliation_resolutions;
create policy "Family read reconciliation resolutions"
  on public.credit_card_reconciliation_resolutions for select
  using (public.has_family_access(user_id));

drop policy if exists "Family insert reconciliation resolutions"
  on public.credit_card_reconciliation_resolutions;
create policy "Family insert reconciliation resolutions"
  on public.credit_card_reconciliation_resolutions for insert
  with check (public.has_family_access(user_id));

drop policy if exists "Family update reconciliation resolutions"
  on public.credit_card_reconciliation_resolutions;
create policy "Family update reconciliation resolutions"
  on public.credit_card_reconciliation_resolutions for update
  using (public.has_family_access(user_id));

drop policy if exists "Family delete reconciliation resolutions"
  on public.credit_card_reconciliation_resolutions;
create policy "Family delete reconciliation resolutions"
  on public.credit_card_reconciliation_resolutions for delete
  using (public.has_family_access(user_id));

commit;
