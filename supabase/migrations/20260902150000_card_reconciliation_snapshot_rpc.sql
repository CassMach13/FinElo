-- Snapshot verificado pelo servidor, e as RPCs que agem sobre ele.
--
-- ===========================================================================
-- O PROBLEMA QUE ISTO RESOLVE
-- ===========================================================================
--
-- Resolver uma divergência move dinheiro entre livros. Se o VALOR movido vier
-- do navegador, um cliente manipulado fabrica crédito que nunca existiu. O
-- browser não pode ser autoridade sobre a existência, a magnitude nem o sinal
-- da diferença.
--
-- Então o valor vem daqui: a Edge Function calcula a diferença com o núcleo
-- puro, grava um snapshot, e a RPC de resolução lê o valor DO SNAPSHOT. O
-- cliente escolhe a CLASSIFICAÇÃO — o que a diferença significa — e nunca o
-- número.
--
-- ===========================================================================
-- POR QUE SECURITY INVOKER, E NÃO O PADRÃO SECURITY DEFINER
-- ===========================================================================
--
-- As migrations `sprint_2*` usam SECURITY DEFINER com papel dedicado sem
-- privilégio. Aqui isso não funciona, pelo mesmo motivo já medido duas vezes
-- neste sistema: `contas` e `transactions` têm RLS, um dono `nobypassrls` lê
-- zero linhas, e dentro da função não existe `auth.uid()`. O resultado não
-- seria erro — seria uma função que acha que a conta não existe.
--
-- Estas funções são SECURITY INVOKER e o EXECUTE é concedido SÓ a
-- `service_role`, que já tem `bypassrls`. Quem chama é a Edge Function, com a
-- chave de serviço, depois de validar o JWT. Isso não amplia superfície: se a
-- chave de serviço vazar, o projeto inteiro já está perdido, com ou sem estas
-- funções.
--
-- O que NÃO se delega ao chamador, nem sendo a Edge:
--
--   * `user_id` — derivado de `contas.user_id` pelo `account_id`;
--   * a diferença e seu sinal — lidos do snapshot;
--   * se o snapshot ainda vale — comparado aqui com os contadores atuais.
--
-- O chamador escolhe a classificação e, no caso parcial, QUANTO em valor
-- absoluto. Nunca o sinal, nunca mais do que existe.

begin;

-- ---------------------------------------------------------------------------
-- O snapshot
-- ---------------------------------------------------------------------------
--
-- Uma linha por competência. Guarda a diferença em CENTAVOS (inteiro: sem
-- tolerância monetária, sem erro de ponto flutuante) e os quatro valores que
-- dizem sobre qual estado do mundo ela foi calculada.

create table if not exists finelo_reconciliation_internal.reconciliation_snapshots (
  user_id uuid not null,
  account_id uuid not null,
  reference_month text not null,
  delta_cents bigint not null,
  account_revision bigint not null,
  user_context_revision bigint not null,
  metadata_context text not null,
  domain_version text not null,
  computed_at timestamptz not null default now(),
  primary key (user_id, account_id, reference_month)
);

-- A leitura previa da chave de idempotencia reduz a corrida; quem a ELIMINA e
-- este indice. Duas requisicoes simultaneas com a mesma intencao chegam as duas
-- ao insert, e a segunda quebra em vez de duplicar dinheiro.
create unique index if not exists cc_reconciliation_resolutions_idempotency_uidx
  on public.credit_card_reconciliation_resolutions (user_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists cc_reconciliation_reversals_idempotency_uidx
  on public.credit_card_reconciliation_resolution_reversals (user_id, idempotency_key)
  where idempotency_key is not null;

-- Uma resolucao so pode ser revertida uma vez.
create unique index if not exists cc_reconciliation_reversals_resolution_uidx
  on public.credit_card_reconciliation_resolution_reversals (resolution_id);

comment on table finelo_reconciliation_internal.reconciliation_snapshots is
  'Diferenca de reconciliacao calculada pelo servidor, com os quatro valores que dizem sobre qual estado do mundo foi calculada.';

revoke all on finelo_reconciliation_internal.reconciliation_snapshots
  from public, anon, authenticated, service_role;
grant select, insert, update on finelo_reconciliation_internal.reconciliation_snapshots
  to service_role;
grant usage on schema finelo_reconciliation_internal to service_role;

-- O grant tem de partir do dono da funcao. Emitido por `postgres`, que nao e
-- dono, ele e recusado.
grant finelo_reconciliation_executor to postgres with set true, inherit false;
set role finelo_reconciliation_executor;
grant execute on function finelo_reconciliation_internal.current_revisions(uuid, uuid)
  to service_role;
reset role;
revoke finelo_reconciliation_executor from postgres;

-- ---------------------------------------------------------------------------
-- Gravar o snapshot
-- ---------------------------------------------------------------------------
--
-- PROTOCOLO R0 == R1 == ATUAL. A Edge lê os contadores ANTES de ler os dados
-- (R0) e DEPOIS (R1). Se R0 <> R1, alguém escreveu no meio da leitura e o que
-- ela montou pode misturar dois estados: ela nem chega aqui. Se R0 == R1, ela
-- passa esse valor, e esta função confirma que ele ainda é o ATUAL no momento
-- do commit. Três iguais, ou nada é gravado.
--
-- Sem a terceira comparação, uma escrita entre a segunda leitura da Edge e o
-- commit passaria despercebida.

create or replace function public.finelo_write_reconciliation_snapshot_v1(
  p_account_id uuid,
  p_reference_month text,
  p_delta_cents bigint,
  p_observed_account_revision bigint,
  p_observed_user_context_revision bigint,
  p_metadata_context text,
  p_domain_version text
)
returns jsonb
language plpgsql
set search_path = ''
set lock_timeout = '4s'
set statement_timeout = '15s'
as $write_snap$
declare
  v_user_id uuid;
  v_acc bigint;
  v_ctx bigint;
begin
  if p_account_id is null or p_reference_month is null then
    raise exception 'snapshot: conta e competencia sao obrigatorias' using errcode = '22004';
  end if;
  if p_metadata_context is null or p_domain_version is null then
    raise exception 'snapshot: sem metadata_context ou domain_version nao ha como detectar stale'
      using errcode = '22004';
  end if;

  -- A identidade vem da conta, nunca do chamador.
  select c.user_id into v_user_id from public.contas c where c.id = p_account_id;
  if v_user_id is null then
    raise exception 'snapshot: conta % inexistente ou sem dono', p_account_id using errcode = '42501';
  end if;

  select account_revision, user_context_revision into v_acc, v_ctx
    from finelo_reconciliation_internal.current_revisions(v_user_id, p_account_id);

  if v_acc <> p_observed_account_revision or v_ctx <> p_observed_user_context_revision then
    raise exception 'snapshot stale: entradas mudaram durante o calculo (conta %/%; contexto %/%)',
      p_observed_account_revision, v_acc, p_observed_user_context_revision, v_ctx
      using errcode = '40001';
  end if;

  insert into finelo_reconciliation_internal.reconciliation_snapshots as s
    (user_id, account_id, reference_month, delta_cents,
     account_revision, user_context_revision, metadata_context, domain_version, computed_at)
  values (v_user_id, p_account_id, p_reference_month, p_delta_cents,
          v_acc, v_ctx, p_metadata_context, p_domain_version, pg_catalog.now())
  on conflict (user_id, account_id, reference_month) do update
    set delta_cents = excluded.delta_cents,
        account_revision = excluded.account_revision,
        user_context_revision = excluded.user_context_revision,
        metadata_context = excluded.metadata_context,
        domain_version = excluded.domain_version,
        computed_at = excluded.computed_at;

  return pg_catalog.jsonb_build_object(
    'account_revision', v_acc,
    'user_context_revision', v_ctx,
    'delta_cents', p_delta_cents);
end;
$write_snap$;

-- ---------------------------------------------------------------------------
-- Resolver
-- ---------------------------------------------------------------------------
--
-- Sem `p_delta`, sem `p_sign`, sem `p_amount` livre. O chamador diz O QUE a
-- diferença é; quanto ela vale sai do snapshot.
--
-- `p_portion_cents` existe para resolução PARCIAL e é sempre um valor absoluto:
-- o sinal vem do snapshot. Nulo significa «a diferença inteira».

create or replace function public.finelo_resolve_reconciliation_v1(
  p_account_id uuid,
  p_reference_month text,
  p_resolution text,
  p_idempotency_key text,
  p_metadata_context text,
  p_domain_version text,
  p_portion_cents bigint default null,
  p_authoritative_total_cents bigint default null,
  p_authoritative_source text default null,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = ''
set lock_timeout = '4s'
set statement_timeout = '15s'
as $resolve$
declare
  v_user_id uuid;
  v_snap finelo_reconciliation_internal.reconciliation_snapshots%rowtype;
  v_acc bigint;
  v_ctx bigint;
  v_restante_cents bigint;
  v_porcao_cents bigint;
  v_existente public.credit_card_reconciliation_resolutions%rowtype;
  v_id uuid;
begin
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'resolucao: chave de idempotencia obrigatoria — sem ela um retry duplica dinheiro'
      using errcode = '22004';
  end if;

  select c.user_id into v_user_id from public.contas c where c.id = p_account_id;
  if v_user_id is null then
    raise exception 'resolucao: conta % inexistente ou sem dono', p_account_id using errcode = '42501';
  end if;

  -- Serializa a competencia inteira: duas requisicoes concorrentes sobre a
  -- mesma competencia viram fila, nao corrida.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || '|' || p_account_id::text || '|' || p_reference_month, 0));

  -- IDEMPOTENCIA ANTES DE STALE. Um retry da MESMA intencao tem de devolver o
  -- mesmo resultado mesmo que o mundo tenha andado desde entao; tratá-lo como
  -- stale faria o cliente tentar de novo, e a tentativa seguinte duplicaria.
  select * into v_existente
    from public.credit_card_reconciliation_resolutions r
   where r.user_id = v_user_id and r.idempotency_key = p_idempotency_key;

  if found then
    return pg_catalog.jsonb_build_object(
      'id', v_existente.id, 'idempotent_replay', true,
      'resolution', v_existente.resolution, 'resolved_amount', v_existente.resolved_amount);
  end if;

  select * into v_snap
    from finelo_reconciliation_internal.reconciliation_snapshots s
   where s.user_id = v_user_id and s.account_id = p_account_id
     and s.reference_month = p_reference_month;

  if not found then
    raise exception 'resolucao: sem snapshot para %/%. O valor tem de ser calculado pelo servidor antes.',
      p_account_id, p_reference_month using errcode = '55000';
  end if;

  select account_revision, user_context_revision into v_acc, v_ctx
    from finelo_reconciliation_internal.current_revisions(v_user_id, p_account_id);

  if v_snap.account_revision <> v_acc
     or v_snap.user_context_revision <> v_ctx
     or v_snap.metadata_context is distinct from p_metadata_context
     or v_snap.domain_version is distinct from p_domain_version then
    raise exception 'resolucao: snapshot stale. Recalcule antes de resolver.' using errcode = '40001';
  end if;

  if v_snap.delta_cents = 0 then
    raise exception 'resolucao: nao ha diferenca a resolver nesta competencia' using errcode = '22004';
  end if;

  -- O snapshot JA E o restante. O nucleo devolve
  -- `unresolvedReconciliationDeltaCents`, liquido das resolucoes ja gravadas e
  -- nao revertidas: subtrair de novo aqui contaria em dobro e impediria o
  -- usuario de fechar a propria divergencia (delta bruto 2200, 800 resolvidos,
  -- snapshot 1400, e a conta erradamente daria 600 de espaco).
  --
  -- Quem impede duas requisicoes concorrentes de resolverem mais do que existe
  -- nao e aritmetica, e o contador: inserir uma resolucao dispara o gatilho que
  -- incrementa `account_revision`, entao a segunda encontra o snapshot stale e
  -- e recusada. O lock abaixo garante que ela so olhe depois do commit da
  -- primeira.
  v_restante_cents := v_snap.delta_cents;

  if p_resolution = 'authoritative_total' then
    -- Nao consome porcao alguma: recalcula a competencia a partir da fonte.
    if p_authoritative_total_cents is null or p_authoritative_source is null then
      raise exception 'resolucao: informar total oficial exige valor e procedencia' using errcode = '22004';
    end if;

    insert into public.credit_card_reconciliation_resolutions
      (user_id, account_id, reference_month, delta_amount, resolution,
       authoritative_total, authoritative_source, authoritative_at, authoritative_by,
       note, resolved_by, idempotency_key)
    values (v_user_id, p_account_id, p_reference_month,
            pg_catalog.round(v_snap.delta_cents / 100.0, 2), p_resolution,
            pg_catalog.round(p_authoritative_total_cents / 100.0, 2), p_authoritative_source,
            pg_catalog.now(), v_user_id, p_note, v_user_id, p_idempotency_key)
    returning id into v_id;

    return pg_catalog.jsonb_build_object('id', v_id, 'idempotent_replay', false,
      'resolution', p_resolution, 'resolved_amount', null);
  end if;

  -- As demais consomem uma porcao. O SINAL vem do snapshot; o chamador so pode
  -- dizer QUANTO, em valor absoluto, e nunca mais do que sobrou.
  if v_restante_cents = 0 then
    raise exception 'resolucao: esta competencia ja esta inteiramente resolvida' using errcode = '22004';
  end if;

  v_porcao_cents := coalesce(pg_catalog.abs(p_portion_cents), pg_catalog.abs(v_restante_cents));

  if v_porcao_cents <= 0 then
    raise exception 'resolucao: porcao tem de ser positiva' using errcode = '22004';
  end if;
  if v_porcao_cents > pg_catalog.abs(v_restante_cents) then
    raise exception 'resolucao: porcao de % excede os % que restam',
      v_porcao_cents, pg_catalog.abs(v_restante_cents) using errcode = '22003';
  end if;

  -- Assinado como o restante: nunca cria dinheiro no sentido oposto.
  v_porcao_cents := pg_catalog.sign(v_restante_cents)::bigint * v_porcao_cents;

  insert into public.credit_card_reconciliation_resolutions
    (user_id, account_id, reference_month, delta_amount, resolution,
     resolved_amount, note, resolved_by, idempotency_key)
  values (v_user_id, p_account_id, p_reference_month,
          pg_catalog.round(v_snap.delta_cents / 100.0, 2), p_resolution,
          pg_catalog.round(v_porcao_cents / 100.0, 2), p_note, v_user_id, p_idempotency_key)
  returning id into v_id;

  return pg_catalog.jsonb_build_object('id', v_id, 'idempotent_replay', false,
    'resolution', p_resolution,
    -- Arredondado na saida: `centavos / 100.0` e numeric de escala longa, e a
    -- Edge repassa este JSON adiante. A coluna ja guarda numeric(15,2).
    'resolved_amount', pg_catalog.round(v_porcao_cents / 100.0, 2),
    'remaining_cents', v_restante_cents - v_porcao_cents);
end;
$resolve$;

-- ---------------------------------------------------------------------------
-- Desfazer
-- ---------------------------------------------------------------------------
--
-- Reverter é ACRESCENTAR uma linha, nunca apagar a original. Um DELETE apagaria
-- a evidencia de que a afirmacao existiu, e o historico e justamente o que
-- permite explicar uma divergencia depois.

create or replace function public.finelo_reverse_reconciliation_v1(
  p_resolution_id uuid,
  p_idempotency_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
set search_path = ''
set lock_timeout = '4s'
set statement_timeout = '15s'
as $reverse$
declare
  v_res public.credit_card_reconciliation_resolutions%rowtype;
  v_existente public.credit_card_reconciliation_resolution_reversals%rowtype;
  v_id uuid;
begin
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'reversao: chave de idempotencia obrigatoria' using errcode = '22004';
  end if;

  select * into v_res
    from public.credit_card_reconciliation_resolutions r
   where r.id = p_resolution_id;
  if not found then
    raise exception 'reversao: resolucao % inexistente', p_resolution_id using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_res.user_id::text || '|' || v_res.account_id::text
      || '|' || v_res.reference_month, 0));

  select * into v_existente
    from public.credit_card_reconciliation_resolution_reversals v
   where v.user_id = v_res.user_id and v.idempotency_key = p_idempotency_key;
  if found then
    return pg_catalog.jsonb_build_object('id', v_existente.id, 'idempotent_replay', true);
  end if;

  -- Reverter duas vezes a mesma resolucao devolveria a porcao duas vezes.
  if exists (select 1 from public.credit_card_reconciliation_resolution_reversals v
              where v.resolution_id = p_resolution_id) then
    raise exception 'reversao: resolucao % ja foi revertida', p_resolution_id using errcode = '22004';
  end if;

  insert into public.credit_card_reconciliation_resolution_reversals
    (user_id, account_id, resolution_id, idempotency_key, reason, reversed_by)
  values (v_res.user_id, v_res.account_id, p_resolution_id, p_idempotency_key, p_reason, v_res.user_id)
  returning id into v_id;

  return pg_catalog.jsonb_build_object('id', v_id, 'idempotent_replay', false,
    'reversed_resolution', p_resolution_id);
end;
$reverse$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------
--
-- Só a Edge Function chama isto, com a chave de serviço. O navegador não tem
-- caminho até aqui.

revoke all on function public.finelo_write_reconciliation_snapshot_v1(
  uuid, text, bigint, bigint, bigint, text, text) from public, anon, authenticated;
revoke all on function public.finelo_resolve_reconciliation_v1(
  uuid, text, text, text, text, text, bigint, bigint, text, text) from public, anon, authenticated;
revoke all on function public.finelo_reverse_reconciliation_v1(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.finelo_write_reconciliation_snapshot_v1(
  uuid, text, bigint, bigint, bigint, text, text) to service_role;
grant execute on function public.finelo_resolve_reconciliation_v1(
  uuid, text, text, text, text, text, bigint, bigint, text, text) to service_role;
grant execute on function public.finelo_reverse_reconciliation_v1(uuid, text, text)
  to service_role;

commit;
