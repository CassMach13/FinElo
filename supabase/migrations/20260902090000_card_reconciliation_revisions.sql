-- Contadores de revisão para invalidar snapshots de reconciliação.
--
-- Um snapshot só é confiável enquanto nenhuma entrada do cálculo tiver mudado.
-- Estes contadores existem para que o servidor detecte isso sem recalcular nada.
--
-- ===========================================================================
-- CONTRATO DE DEPENDÊNCIAS
-- ===========================================================================
--
-- `revision` significa «alguma entrada capaz de alterar o resultado financeiro
-- mudou» — e NÃO «alguma coisa relacionada a esta conta mudou». Campos que o
-- núcleo não lê não incrementam nada.
--
-- Cada lista abaixo foi obtida por busca no núcleo puro
-- (`creditCardRebuildFromImportHistoryService` e os módulos que ele importa),
-- e o spec `reconciliationRevisionsMigration.spec.ts` amarra a migration a elas:
-- acrescentar dependência no domínio sem atualizar aqui quebra o teste.
--
-- ACCOUNT_FIELDS_USED_BY_RECONCILIATION, por ESCOPO de invalidação:
--
--   dia_vencimento  -> account        (5 usos, todos calculando vencimento;
--                                      efeito confinado à própria conta)
--   Tipo_Conta      -> account + user (porta em creditCardManualCompetence E
--                                      filtro do conjunto `cardAccounts`)
--   Nome_Conta      -> user_context   (score que atribui arquivo a conta,
--                                      avaliado sobre TODAS as contas de cartão)
--   id              -> identidade     (não muda em UPDATE)
--
--   NÃO consumidos: dia_fechamento, limite_credito, Saldo_*, Data_*.
--
-- TRANSACTION_FIELDS_USED_BY_RECONCILIATION -> account:
--   Origem, Tipo, ID_Conta, Descricao_Original, Valor, Nome_Fantasia, Data,
--   Categoria, Data_Pagamento, Total_Parcelas, ID_Transacao.
--   NÃO consumidos: Parcela_Atual, Fonte, Portador, linked_asset_id,
--   pluggy_transaction_id.
--
-- IMPORT_LOG_FIELDS_USED_BY_RECONCILIATION -> user_context (escopo USER-WIDE):
--   file_name, imported_details, import_date.
--   NÃO consumidos: total_transactions, imported_count, ignored_count,
--   ignored_details.
--
--   O escopo é user-wide porque `import_logs` NÃO tem coluna account_id: a
--   atribuição é uma cascata de três níveis — imported_details[].ID_Conta,
--   frequência de ID_Conta nas transações por Origem, e o score de Nome_Conta.
--   Reproduzir essa cascata num trigger seria um terceiro lugar onde o domínio
--   mora. Invalidar todas as contas do usuário é a escolha segura.
--
-- `mapping_rules` NÃO invalida. Buscado: zero referências no grafo do núcleo.
--   Ela é consumida pelo parser NO MOMENTO DA IMPORTAÇÃO, e o resultado fica
--   materializado em `transactions`. Alterar uma regra depois não muda transação
--   existente, logo não muda o ledger.
--
-- `user_metadata.cardPaymentKeywords` e `cardCreditKeywords` também são entrada,
--   mas vivem em `auth.users`, schema gerenciado. Deliberadamente NÃO recebem
--   trigger aqui: são cobertos por `metadata_context`, um token determinístico
--   derivado server-side. Ver DIVIDA TECNICA no fim do arquivo.

begin;

-- ---------------------------------------------------------------------------
-- Infraestrutura privada
-- ---------------------------------------------------------------------------

do $finelo_rev_preflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'finelo_reconciliation_executor'
  ) then
    create role finelo_reconciliation_executor;
  end if;
end;
$finelo_rev_preflight$;

alter role finelo_reconciliation_executor
  nologin noinherit nobypassrls connection limit 0;

create schema if not exists finelo_reconciliation_internal authorization postgres;
alter schema finelo_reconciliation_internal owner to postgres;
revoke all on schema finelo_reconciliation_internal
  from public, anon, authenticated, service_role, finelo_reconciliation_executor;
grant usage on schema public to finelo_reconciliation_executor;
grant usage on schema finelo_reconciliation_internal to finelo_reconciliation_executor;

-- Contadores. Privados: são invariante do servidor, não dado que o cliente lê.
create table if not exists finelo_reconciliation_internal.account_revisions (
  user_id uuid not null,
  account_id uuid not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, account_id)
);

create table if not exists finelo_reconciliation_internal.user_context_revisions (
  user_id uuid primary key,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

comment on table finelo_reconciliation_internal.account_revisions is
  'Muda quando uma entrada comprovadamente confinada a esta conta muda.';
comment on table finelo_reconciliation_internal.user_context_revisions is
  'Muda quando algo capaz de alterar interpretacao, classificacao ou ATRIBUICAO entre contas do mesmo usuario muda.';

revoke all on finelo_reconciliation_internal.account_revisions
  from public, anon, authenticated, service_role;
revoke all on finelo_reconciliation_internal.user_context_revisions
  from public, anon, authenticated, service_role;
grant select, insert, update on finelo_reconciliation_internal.account_revisions
  to finelo_reconciliation_executor;
grant select, insert, update on finelo_reconciliation_internal.user_context_revisions
  to finelo_reconciliation_executor;

-- ---------------------------------------------------------------------------
-- Incrementadores
-- ---------------------------------------------------------------------------
--
-- Ordem de lock consistente em todo o arquivo: conta ANTES de contexto. Um
-- gatilho que precisa dos dois sempre os toca nessa ordem, e nunca na inversa.

create or replace function finelo_reconciliation_internal.bump_account_revision(
  p_user_id uuid, p_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $bump_acc$
begin
  if p_user_id is null or p_account_id is null then
    return;
  end if;
  insert into finelo_reconciliation_internal.account_revisions
    (user_id, account_id, revision, updated_at)
  values (p_user_id, p_account_id, 1, pg_catalog.now())
  on conflict (user_id, account_id) do update
    set revision = finelo_reconciliation_internal.account_revisions.revision + 1,
        updated_at = pg_catalog.now();
end;
$bump_acc$;

create or replace function finelo_reconciliation_internal.bump_user_context_revision(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $bump_ctx$
begin
  if p_user_id is null then
    return;
  end if;
  insert into finelo_reconciliation_internal.user_context_revisions
    (user_id, revision, updated_at)
  values (p_user_id, 1, pg_catalog.now())
  on conflict (user_id) do update
    set revision = finelo_reconciliation_internal.user_context_revisions.revision + 1,
        updated_at = pg_catalog.now();
end;
$bump_ctx$;

-- ---------------------------------------------------------------------------
-- Gatilhos: transações
-- ---------------------------------------------------------------------------

create or replace function finelo_reconciliation_internal.tg_transactions_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $tg_tx$
begin
  if tg_op = 'DELETE' then
    perform finelo_reconciliation_internal.bump_account_revision(old.user_id, old."ID_Conta");
    return old;
  end if;

  perform finelo_reconciliation_internal.bump_account_revision(new.user_id, new."ID_Conta");

  -- Mover uma transação de conta muda o resultado das DUAS.
  if tg_op = 'UPDATE' and old."ID_Conta" is distinct from new."ID_Conta" then
    perform finelo_reconciliation_internal.bump_account_revision(old.user_id, old."ID_Conta");
  end if;
  return new;
end;
$tg_tx$;

drop trigger if exists trg_transactions_reconciliation_revision on public.transactions;
create trigger trg_transactions_reconciliation_revision
after insert or delete or update of
  "ID_Conta", "Origem", "Tipo", "Descricao_Original", "Valor", "Nome_Fantasia",
  "Data", "Categoria", "Data_Pagamento", "Total_Parcelas"
on public.transactions
for each row execute function finelo_reconciliation_internal.tg_transactions_revision();

-- ---------------------------------------------------------------------------
-- Gatilhos: confirmações, resoluções, reversões, totais autoritativos
-- ---------------------------------------------------------------------------

create or replace function finelo_reconciliation_internal.tg_account_scoped_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $tg_acc$
begin
  if tg_op = 'DELETE' then
    perform finelo_reconciliation_internal.bump_account_revision(old.user_id, old.account_id);
    return old;
  end if;
  perform finelo_reconciliation_internal.bump_account_revision(new.user_id, new.account_id);
  return new;
end;
$tg_acc$;

drop trigger if exists trg_confirmations_reconciliation_revision
  on public.credit_card_competence_payment_confirmations;
create trigger trg_confirmations_reconciliation_revision
after insert or delete or update of settled_amount, confirmation_type, reference_month
on public.credit_card_competence_payment_confirmations
for each row execute function finelo_reconciliation_internal.tg_account_scoped_revision();

drop trigger if exists trg_resolutions_reconciliation_revision
  on public.credit_card_reconciliation_resolutions;
create trigger trg_resolutions_reconciliation_revision
after insert or delete or update of resolved_amount, resolution, reference_month,
  authoritative_total, authoritative_source
on public.credit_card_reconciliation_resolutions
for each row execute function finelo_reconciliation_internal.tg_account_scoped_revision();

drop trigger if exists trg_reversals_reconciliation_revision
  on public.credit_card_reconciliation_resolution_reversals;
create trigger trg_reversals_reconciliation_revision
after insert or delete
on public.credit_card_reconciliation_resolution_reversals
for each row execute function finelo_reconciliation_internal.tg_account_scoped_revision();

-- O usuario vem da PROPRIA linha, nunca de uma busca em outra tabela.
--
-- A primeira versao derivava `user_id` com `select ct.user_id from public.contas
-- ct where ct.id = new.account_id`. Isso nao funciona e falha em SILENCIO:
-- `public.contas` tem RLS, o dono desta funcao e `nologin ... nobypassrls`, e
-- dentro do gatilho nao existe `auth.uid()`. A politica nao casa com ninguem, o
-- select devolve zero linhas, `v_user_id` fica NULL e o incremento e descartado.
-- Nenhum erro aparece — apenas o contador nao anda, e o snapshot fica stale
-- exatamente quando o total OFICIAL da fatura muda. Foi assim que a sonda em
-- staging pegou: cenario 6 esperava +1 e mediu 0.
--
-- `credit_card_statements.user_id` e NOT NULL no schema, entao a busca nunca foi
-- necessaria. Derivar identidade por leitura sob RLS dentro de gatilho e um
-- antipadrao aqui: transforma falta de privilegio em ausencia de invalidacao.
create or replace function finelo_reconciliation_internal.tg_statement_authoritative_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $tg_stmt$
begin
  perform finelo_reconciliation_internal.bump_account_revision(new.user_id, new.account_id);
  return new;
end;
$tg_stmt$;

drop trigger if exists trg_statement_authoritative_revision on public.credit_card_statements;
create trigger trg_statement_authoritative_revision
after update of authoritative_statement_total, authoritative_source
on public.credit_card_statements
for each row
when (
  old.authoritative_statement_total is distinct from new.authoritative_statement_total
  or old.authoritative_source is distinct from new.authoritative_source
)
execute function finelo_reconciliation_internal.tg_statement_authoritative_revision();

-- ---------------------------------------------------------------------------
-- Gatilhos: contas — invalidação FINA
-- ---------------------------------------------------------------------------
--
-- `UPDATE OF` limita quais colunas ACORDAM o gatilho; `IS DISTINCT FROM` impede
-- incrementar quando o UPDATE regravou o mesmo valor. Renomear uma conta não
-- toca `account_revision`; mexer no limite ou no dia de fechamento não toca nada.

create or replace function finelo_reconciliation_internal.tg_contas_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $tg_contas$
declare
  v_era_cartao boolean := old."Tipo_Conta" = 'Cartão de Crédito';
  v_e_cartao boolean := new."Tipo_Conta" = 'Cartão de Crédito';
begin
  -- Conta: só o dia de vencimento, e só quando muda de fato.
  if old.dia_vencimento is distinct from new.dia_vencimento then
    perform finelo_reconciliation_internal.bump_account_revision(new.user_id, new.id);
  end if;

  -- Tipo_Conta muda o calculo da propria conta E o conjunto de candidatas.
  if old."Tipo_Conta" is distinct from new."Tipo_Conta" then
    perform finelo_reconciliation_internal.bump_account_revision(new.user_id, new.id);
    perform finelo_reconciliation_internal.bump_user_context_revision(new.user_id);
  -- Nome_Conta alimenta o score de atribuicao entre contas: contexto, nao conta.
  elsif old."Nome_Conta" is distinct from new."Nome_Conta"
        and (v_era_cartao or v_e_cartao) then
    perform finelo_reconciliation_internal.bump_user_context_revision(new.user_id);
  end if;

  return new;
end;
$tg_contas$;

drop trigger if exists trg_contas_reconciliation_revision on public.contas;
create trigger trg_contas_reconciliation_revision
after update of "Nome_Conta", "Tipo_Conta", dia_vencimento
on public.contas
for each row execute function finelo_reconciliation_internal.tg_contas_revision();

-- Criar ou apagar conta de cartão muda o universo de candidatas do score.
create or replace function finelo_reconciliation_internal.tg_contas_lifecycle_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $tg_contas_life$
begin
  if tg_op = 'DELETE' then
    if old."Tipo_Conta" = 'Cartão de Crédito' then
      perform finelo_reconciliation_internal.bump_user_context_revision(old.user_id);
    end if;
    return old;
  end if;
  if new."Tipo_Conta" = 'Cartão de Crédito' then
    perform finelo_reconciliation_internal.bump_user_context_revision(new.user_id);
  end if;
  return new;
end;
$tg_contas_life$;

drop trigger if exists trg_contas_lifecycle_reconciliation_revision on public.contas;
create trigger trg_contas_lifecycle_reconciliation_revision
after insert or delete on public.contas
for each row execute function finelo_reconciliation_internal.tg_contas_lifecycle_revision();

-- ---------------------------------------------------------------------------
-- Gatilhos: import_logs — user-wide, mas não em qualquer coluna
-- ---------------------------------------------------------------------------

create or replace function finelo_reconciliation_internal.tg_import_logs_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $tg_logs$
begin
  if tg_op = 'DELETE' then
    perform finelo_reconciliation_internal.bump_user_context_revision(old.user_id);
    return old;
  end if;
  perform finelo_reconciliation_internal.bump_user_context_revision(new.user_id);
  return new;
end;
$tg_logs$;

-- Dois gatilhos, nao um: a clausula WHEN so enxerga OLD/NEW, entao nao pode
-- distinguir a operacao. INSERT/DELETE sempre invalidam; UPDATE so quando um
-- dos tres campos consumidos muda de fato.
drop trigger if exists trg_import_logs_reconciliation_revision on public.import_logs;
create trigger trg_import_logs_reconciliation_revision
after insert or delete on public.import_logs
for each row execute function finelo_reconciliation_internal.tg_import_logs_revision();

drop trigger if exists trg_import_logs_update_reconciliation_revision on public.import_logs;
create trigger trg_import_logs_update_reconciliation_revision
after update of file_name, import_date, imported_details
on public.import_logs
for each row
when (
  old.file_name is distinct from new.file_name
  or old.import_date is distinct from new.import_date
  or old.imported_details is distinct from new.imported_details
)
execute function finelo_reconciliation_internal.tg_import_logs_revision();

-- ---------------------------------------------------------------------------
-- Leitura das revisões correntes
-- ---------------------------------------------------------------------------

create or replace function finelo_reconciliation_internal.current_revisions(
  p_user_id uuid, p_account_id uuid
)
returns table (account_revision bigint, user_context_revision bigint)
language sql
stable
security definer
set search_path = ''
as $cur$
  select
    coalesce(
      (select a.revision from finelo_reconciliation_internal.account_revisions a
        where a.user_id = p_user_id and a.account_id = p_account_id), 0)::bigint,
    coalesce(
      (select u.revision from finelo_reconciliation_internal.user_context_revisions u
        where u.user_id = p_user_id), 0)::bigint;
$cur$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------

-- Nenhum SELECT em tabela de negocio e concedido ao executor. O grant que
-- existia aqui (`grant select on public.contas`) servia a uma busca de
-- `user_id` dentro de gatilho, e era pior que inutil: dava a impressao de
-- autorizacao enquanto a RLS devolvia zero linhas em silencio. Todo gatilho
-- deste arquivo tira a identidade da PROPRIA linha que o disparou.

revoke all on function finelo_reconciliation_internal.bump_account_revision(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function finelo_reconciliation_internal.bump_user_context_revision(uuid)
  from public, anon, authenticated, service_role;
revoke all on function finelo_reconciliation_internal.current_revisions(uuid, uuid)
  from public, anon, authenticated, service_role;

grant finelo_reconciliation_executor to postgres with set true, inherit false;
grant create on schema finelo_reconciliation_internal to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.bump_account_revision(uuid, uuid)
  owner to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.bump_user_context_revision(uuid)
  owner to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.current_revisions(uuid, uuid)
  owner to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.tg_transactions_revision()
  owner to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.tg_account_scoped_revision()
  owner to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.tg_statement_authoritative_revision()
  owner to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.tg_contas_revision()
  owner to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.tg_contas_lifecycle_revision()
  owner to finelo_reconciliation_executor;
alter function finelo_reconciliation_internal.tg_import_logs_revision()
  owner to finelo_reconciliation_executor;
revoke create on schema finelo_reconciliation_internal from finelo_reconciliation_executor;
revoke finelo_reconciliation_executor from postgres;

-- ---------------------------------------------------------------------------
-- DIVIDA TECNICA registrada
-- ---------------------------------------------------------------------------
--
-- `user_metadata.cardPaymentKeywords` e `user_metadata.cardCreditKeywords` sao
-- entrada financeira do motor e moram em `auth.users`, schema gerenciado pelo
-- Supabase. Instalar trigger nosso ali e tecnicamente possivel (postgres tem
-- privilegio TRIGGER na tabela) mas foi DESCARTADO: um upgrade da plataforma
-- pode derrubar o trigger em silencio, e o snapshot ficaria stale sem aviso.
--
-- A cobertura vem de `metadata_context`, token deterministico derivado
-- server-side do estado ATUAL de auth.users — nunca do JWT, que pode estar
-- stale.
--
-- Divida: mover essas duas configuracoes para uma tabela financeira propria,
-- sob nosso controle, e entao cobri-las por contador como as demais entradas.
-- Fora do escopo do 4B1 de proposito.

commit;
