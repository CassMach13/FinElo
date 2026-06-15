-- ============================================================================
-- Reparo pontual: alcionemq@gmail.com — lançamentos manuais Itaú em abril/2026
-- com Data_Pagamento em maio/2026 devem competir em 05/2026 (não 04/2026).
-- Tabela de contas: public.contas (não "accounts").
-- Execute no SQL Editor do Supabase. Não apaga dados.
-- ============================================================================

do $$
declare
  alcione_id uuid;
  itau_card_id uuid;
  updated_count int := 0;
  alcione_email text := 'alcionemq@gmail.com';
begin
  select id into alcione_id from auth.users where lower(trim(email)) = alcione_email;
  if alcione_id is null then
    raise exception 'Usuário não encontrado: %', alcione_email;
  end if;

  select a.id into itau_card_id
  from public.contas a
  where a.user_id = alcione_id
    and a."Tipo_Conta" = 'Cartão de Crédito'
    and lower(a."Nome_Conta") like '%ita%'
  order by a."Nome_Conta"
  limit 1;

  if itau_card_id is null then
    raise exception 'Cartão Itaú não encontrado para %', alcione_email;
  end if;

  -- Compras de abril com pagamento em maio/2026
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
    and t."Tipo" = 'Despesa'
    and t."Data"::date >= '2026-04-01'::date
    and t."Data"::date < '2026-05-01'::date
    and t."Data_Pagamento"::date >= '2026-05-01'::date
    and t."Data_Pagamento"::date < '2026-06-01'::date
    and coalesce(t."Descricao_Original", '') !~* 'finelo_competence:2026-05';

  get diagnostics updated_count = row_count;

  -- Cashback / estorno manual em maio com marcador errado (04/2026)
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

  raise notice 'Marcadores finelo_competence:2026-05 aplicados em % compra(s) de abril; cashback/estornos de maio corrigidos', updated_count;
end $$;

-- Conferência (leitura)
select
  t."ID_Transacao",
  t."Data",
  t."Data_Pagamento",
  t."Nome_Fantasia",
  t."Valor",
  t."Descricao_Original"
from public.transactions t
join auth.users u on u.id = t.user_id
where lower(trim(u.email)) = 'alcionemq@gmail.com'
  and lower(coalesce(t."Origem", 'manual')) = 'manual'
  and t."Tipo" = 'Despesa'
  and t."Data"::date >= '2026-04-01'::date
  and t."Data"::date < '2026-05-01'::date
  and t."Data_Pagamento"::date >= '2026-05-01'::date
order by t."Data_Pagamento", t."Data";

-- Cashback / estornos de maio
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
