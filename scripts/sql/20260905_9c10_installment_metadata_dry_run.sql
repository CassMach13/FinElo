-- Chamado 20260905-9C10 — inventário read-only do reparo histórico.
-- NÃO é migration. NÃO altera dados. Execute antes de qualquer autorização de reparo.
-- O resultado aprovado deve permanecer exatamente em 67 linhas e nos dois hashes abaixo.

begin transaction read only;

with linked as (
  select
    t."ID_Transacao" as transaction_id,
    e.id as entry_id,
    t."Data"::date as transaction_date,
    t."Valor"::numeric as transaction_amount,
    t."Origem" as transaction_origin,
    t."Fonte" as transaction_source,
    t."Parcela_Atual" as transaction_installment_current,
    t."Total_Parcelas" as transaction_installment_total,
    e.source_file_name,
    e.source_row_index,
    e.posted_date as entry_date,
    e.amount::numeric as entry_amount,
    e.installment_current as entry_installment_current,
    e.installment_total as entry_installment_total,
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
),
candidates as (
  select *
  from linked
  where transaction_installment_current is null
    and transaction_installment_total is null
    and entry_installment_current between 1 and entry_installment_total
    and entry_installment_total > 1
    and link_count = 1
    and (transaction_before ->> 'user_id')::uuid = (entry_before ->> 'user_id')::uuid
    and (transaction_before ->> 'ID_Conta')::uuid = (entry_before ->> 'account_id')::uuid
    and transaction_amount = entry_amount
    and transaction_date = entry_date
    and source_file_name = transaction_origin
    and nullif(btrim(coalesce(transaction_origin, '')), '') is not null
    and lower(btrim(transaction_origin)) <> 'manual'
    and lower(btrim(coalesce(transaction_source, ''))) = 'manual'
),
metrics as (
  select
    count(*)::integer as candidate_count,
    encode(extensions.digest(
      convert_to(coalesce(string_agg(
        transaction_id::text || '|' || entry_id::text,
        E'\n' order by transaction_id, entry_id
      ), ''), 'UTF8'),
      'sha256'
    ), 'hex') as identity_sha256,
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
    ), 'hex') as invariant_sha256
  from candidates
)
select
  m.candidate_count,
  m.identity_sha256,
  m.invariant_sha256,
  (
    m.candidate_count = 67
    and m.identity_sha256 = '92d7311e810b92df05054e994f92746af551430254a1f53886a40d343b364ea3'
    and m.invariant_sha256 = 'a1379912b521e6c0609dd5f00dc4de96b6839f32fce5f074aae39c390c701357'
  ) as approved_candidate_set,
  c.transaction_id,
  c.entry_id,
  c.source_file_name,
  c.source_row_index,
  c.transaction_date,
  c.transaction_amount,
  c.entry_installment_current as repair_installment_current,
  c.entry_installment_total as repair_installment_total
from metrics m
left join candidates c on true
order by c.transaction_id, c.entry_id;

rollback;
