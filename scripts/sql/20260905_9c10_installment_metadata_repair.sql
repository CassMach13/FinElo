-- Chamado 20260905-9C10 — reparo histórico preparado, NÃO executado.
-- NÃO é migration. Exige autorização própria, dry-run aprovado e backup validado.
-- Altera exclusivamente transactions."Parcela_Atual" e "Total_Parcelas".

begin;
set transaction isolation level serializable;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

lock table public.credit_cards in share mode;
lock table public.credit_card_entries in share mode;
lock table public.transactions in share row exclusive mode;

create temporary table finelo_9c10_candidate_snapshot on commit drop as
with linked as (
  select
    t."ID_Transacao" as transaction_id,
    e.id as entry_id,
    e.installment_current as repair_installment_current,
    e.installment_total as repair_installment_total,
    count(*) over (partition by e.transaction_id) as link_count,
    to_jsonb(t) as transaction_before,
    to_jsonb(e) as entry_before,
    to_jsonb(c) as card_before
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
select
  transaction_id,
  entry_id,
  repair_installment_current,
  repair_installment_total,
  transaction_before,
  entry_before,
  card_before
from linked
where (transaction_before ->> 'Parcela_Atual') is null
  and (transaction_before ->> 'Total_Parcelas') is null
  and repair_installment_current between 1 and repair_installment_total
  and repair_installment_total > 1
  and link_count = 1
  and (transaction_before ->> 'user_id')::uuid = (entry_before ->> 'user_id')::uuid
  and (transaction_before ->> 'ID_Conta')::uuid = (entry_before ->> 'account_id')::uuid
  and (transaction_before ->> 'Valor')::numeric = (entry_before ->> 'amount')::numeric
  and (transaction_before ->> 'Data')::timestamptz::date = (entry_before ->> 'posted_date')::date
  and (entry_before ->> 'source_file_name') = (transaction_before ->> 'Origem')
  and nullif(btrim(coalesce(transaction_before ->> 'Origem', '')), '') is not null
  and lower(btrim(transaction_before ->> 'Origem')) <> 'manual'
  and lower(btrim(coalesce(transaction_before ->> 'Fonte', ''))) = 'manual';

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
          (transaction_before - 'Parcela_Atual' - 'Total_Parcelas')::text,
          entry_before::text,
          card_before::text
        ),
        E'\n' order by transaction_id, entry_id
      ), ''), 'UTF8'),
      'sha256'
    ), 'hex')
  into candidate_count, identity_sha256, invariant_sha256
  from pg_temp.finelo_9c10_candidate_snapshot;

  if candidate_count <> 67
     or identity_sha256 <> '92d7311e810b92df05054e994f92746af551430254a1f53886a40d343b364ea3'
     or invariant_sha256 <> 'a1379912b521e6c0609dd5f00dc4de96b6839f32fce5f074aae39c390c701357' then
    raise exception using
      errcode = 'P0001',
      message = format(
        '9C10 fail-closed: conjunto divergente (count=%s, identity=%s, invariant=%s)',
        candidate_count, identity_sha256, invariant_sha256
      );
  end if;
end
$guard$;

update public.transactions t
set
  "Parcela_Atual" = s.repair_installment_current,
  "Total_Parcelas" = s.repair_installment_total
from pg_temp.finelo_9c10_candidate_snapshot s
where t."ID_Transacao" = s.transaction_id;

do $validate$
declare
  repaired_count integer;
begin
  select count(*)::integer
  into repaired_count
  from pg_temp.finelo_9c10_candidate_snapshot s
  join public.transactions t on t."ID_Transacao" = s.transaction_id
  join public.credit_card_entries e on e.id = s.entry_id
  join public.credit_cards c on c.id = (s.entry_before ->> 'card_id')::uuid
  where t."Parcela_Atual" = s.repair_installment_current
    and t."Total_Parcelas" = s.repair_installment_total
    and (to_jsonb(t) - 'Parcela_Atual' - 'Total_Parcelas') =
        (s.transaction_before - 'Parcela_Atual' - 'Total_Parcelas')
    and to_jsonb(e) = s.entry_before
    and to_jsonb(c) = s.card_before;

  if repaired_count <> 67 then
    raise exception using
      errcode = 'P0001',
      message = format(
        '9C10 fail-closed: validação pós-reparo cobriu %s de 67 linhas',
        repaired_count
      );
  end if;
end
$validate$;

select
  count(*)::integer as repaired_count,
  encode(extensions.digest(
    convert_to(string_agg(
      transaction_id::text || '|' || entry_id::text,
      E'\n' order by transaction_id, entry_id
    ), 'UTF8'),
    'sha256'
  ), 'hex') as identity_sha256,
  'a1379912b521e6c0609dd5f00dc4de96b6839f32fce5f074aae39c390c701357'::text
    as invariant_sha256
from pg_temp.finelo_9c10_candidate_snapshot;

commit;
