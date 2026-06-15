-- ============================================================================
-- Reparo: cashback/estorno Itaú de maio/2026 → finelo_competence:2026-05
-- Usuária: alcionemq@gmail.com
-- Cole e execute NO SQL EDITOR DO SUPABASE (bloco inteiro).
-- ============================================================================

do $$
declare
  alcione_id uuid;
  itau_card_id uuid;
  updated_count int := 0;
begin
  select id into alcione_id from auth.users where lower(trim(email)) = 'alcionemq@gmail.com';
  if alcione_id is null then
    raise exception 'Usuário não encontrado: alcionemq@gmail.com';
  end if;

  select a.id into itau_card_id
  from public.contas a
  where a.user_id = alcione_id
    and a."Tipo_Conta" = 'Cartão de Crédito'
    and lower(a."Nome_Conta") like '%ita%'
  order by a."Nome_Conta"
  limit 1;

  if itau_card_id is null then
    raise exception 'Cartão Itaú não encontrado para alcionemq@gmail.com';
  end if;

  update public.transactions t
  set "Descricao_Original" = case
    when length(trim(regexp_replace(coalesce(t."Descricao_Original", ''), 'finelo_competence:\d{4}-\d{2}', '', 'gi'))) > 0
      then trim(regexp_replace(coalesce(t."Descricao_Original", ''), 'finelo_competence:\d{4}-\d{2}', '', 'gi'))
        || ' finelo_competence:2026-05'
    else 'finelo_competence:2026-05'
  end
  where t.user_id = alcione_id
    and t."ID_Conta" = itau_card_id
    and lower(coalesce(t."Origem", 'manual')) = 'manual'
    and t."Tipo" = 'Renda'
    and t."Data"::date >= '2026-05-01'::date
    and t."Data"::date < '2026-06-01'::date
    and coalesce(t."Descricao_Original", '') !~* 'finelo_competence:2026-05';

  get diagnostics updated_count = row_count;
  raise notice 'Cashback/estornos de maio corrigidos: % linha(s)', updated_count;
end $$;

-- Conferência: deve mostrar finelo_competence:2026-05 na Descricao_Original
select
  t."ID_Transacao",
  t."Data",
  t."Nome_Fantasia",
  t."Valor",
  t."Descricao_Original"
from public.transactions t
join auth.users u on u.id = t.user_id
where lower(trim(u.email)) = 'alcionemq@gmail.com'
  and lower(coalesce(t."Origem", 'manual')) = 'manual'
  and t."Tipo" = 'Renda'
  and t."Data"::date >= '2026-05-01'::date
  and t."Data"::date < '2026-06-01'::date
order by t."Data";
