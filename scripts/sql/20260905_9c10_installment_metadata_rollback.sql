-- Chamado 20260905-9C10 — rollback explícito do reparo histórico, NÃO executado.
-- NÃO é migration. Fail-closed: só restaura NULL/NULL no conjunto exato aprovado.

begin;
set transaction isolation level serializable;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

lock table public.credit_cards in share mode;
lock table public.credit_card_entries in share mode;
lock table public.transactions in share row exclusive mode;

create temporary table finelo_9c10_rollback_snapshot on commit drop as
with linked as (
  select
    t."ID_Transacao" as transaction_id,
    e.id as entry_id,
    e.installment_current as current_installment,
    e.installment_total as total_installments,
    count(*) over (partition by e.transaction_id) as link_count,
    to_jsonb(t) as transaction_before_rollback,
    to_jsonb(e) as entry_before_rollback,
    to_jsonb(c) as card_before_rollback
  from public.transactions t
  join public.credit_card_entries e
    on e.transaction_id = t."ID_Transacao"
  join public.credit_cards c
    on c.id = e.card_id
   and c.account_id = e.account_id
   and c.user_id = e.user_id
  where e.account_id = '97d11eb6-ed8d-47d0-9639-956ad222eb16'::uuid
    and e.card_id = '4c839d44-c1d1-4486-9b93-5c5077a1d37b'::uuid
)
select *
from linked
where (transaction_before_rollback ->> 'Parcela_Atual')::integer = current_installment
  and (transaction_before_rollback ->> 'Total_Parcelas')::integer = total_installments
  and current_installment between 1 and total_installments
  and total_installments > 1
  and link_count = 1
  and (transaction_before_rollback ->> 'user_id')::uuid =
      (entry_before_rollback ->> 'user_id')::uuid
  and (transaction_before_rollback ->> 'ID_Conta')::uuid =
      (entry_before_rollback ->> 'account_id')::uuid
  and (transaction_before_rollback ->> 'Valor')::numeric =
      (entry_before_rollback ->> 'amount')::numeric
  and (transaction_before_rollback ->> 'Data')::timestamptz::date =
      (entry_before_rollback ->> 'posted_date')::date
  and (entry_before_rollback ->> 'source_file_name') =
      (transaction_before_rollback ->> 'Origem')
  and nullif(btrim(coalesce(transaction_before_rollback ->> 'Origem', '')), '') is not null
  and lower(btrim(transaction_before_rollback ->> 'Origem')) <> 'manual'
  and lower(btrim(coalesce(transaction_before_rollback ->> 'Fonte', ''))) = 'manual';

do $guard$
declare
  candidate_count integer;
  identity_sha256 text;
  invariant_sha256 text;
begin
  select
    count(*)::integer,
    encode(extensions.digest(
      convert_to(coalesce(string_agg(
        transaction_id::text || '|' || entry_id::text,
        E'\n' order by transaction_id, entry_id
      ), ''), 'UTF8'),
      'sha256'
    ), 'hex'),
    encode(extensions.digest(
      convert_to(coalesce(string_agg(
        concat_ws('|',
          transaction_id::text,
          entry_id::text,
          (transaction_before_rollback - 'Parcela_Atual' - 'Total_Parcelas')::text,
          entry_before_rollback::text,
          card_before_rollback::text
        ),
        E'\n' order by transaction_id, entry_id
      ), ''), 'UTF8'),
      'sha256'
    ), 'hex')
  into candidate_count, identity_sha256, invariant_sha256
  from pg_temp.finelo_9c10_rollback_snapshot;

  if candidate_count <> 67
     or identity_sha256 <> '92d7311e810b92df05054e994f92746af551430254a1f53886a40d343b364ea3'
     or invariant_sha256 <> 'a1379912b521e6c0609dd5f00dc4de96b6839f32fce5f074aae39c390c701357' then
    raise exception using
      errcode = 'P0001',
      message = format(
        '9C10 rollback recusado: conjunto divergente (count=%s, identity=%s, invariant=%s)',
        candidate_count, identity_sha256, invariant_sha256
      );
  end if;
end
$guard$;

update public.transactions t
set
  "Parcela_Atual" = null,
  "Total_Parcelas" = null
from pg_temp.finelo_9c10_rollback_snapshot s
where t."ID_Transacao" = s.transaction_id;

do $validate$
declare
  restored_count integer;
begin
  select count(*)::integer
  into restored_count
  from pg_temp.finelo_9c10_rollback_snapshot s
  join public.transactions t on t."ID_Transacao" = s.transaction_id
  join public.credit_card_entries e on e.id = s.entry_id
  join public.credit_cards c on c.id = (s.entry_before_rollback ->> 'card_id')::uuid
  where t."Parcela_Atual" is null
    and t."Total_Parcelas" is null
    and (to_jsonb(t) - 'Parcela_Atual' - 'Total_Parcelas') =
        (s.transaction_before_rollback - 'Parcela_Atual' - 'Total_Parcelas')
    and to_jsonb(e) = s.entry_before_rollback
    and to_jsonb(c) = s.card_before_rollback;

  if restored_count <> 67 then
    raise exception using
      errcode = 'P0001',
      message = format(
        '9C10 rollback recusado: validação cobriu %s de 67 linhas',
        restored_count
      );
  end if;
end
$validate$;

select
  count(*)::integer as restored_count,
  encode(extensions.digest(
    convert_to(string_agg(
      transaction_id::text || '|' || entry_id::text,
      E'\n' order by transaction_id, entry_id
    ), 'UTF8'),
    'sha256'
  ), 'hex') as identity_sha256,
  'a1379912b521e6c0609dd5f00dc4de96b6839f32fce5f074aae39c390c701357'::text
    as invariant_sha256
from pg_temp.finelo_9c10_rollback_snapshot;

commit;
