-- ============================================================================
-- Reparo pontual: alcionemq@gmail.com ↔ markus@thomastecnica.com.br
-- Execute no SQL Editor do Supabase APÓS a migration 055.
-- Não apaga dados — apenas normaliza vínculos e garante status aceito.
-- ============================================================================

do $$
declare
  alcione_id uuid;
  markus_id uuid;
  alcione_email text := 'alcionemq@gmail.com';
  markus_email text := 'markus@thomastecnica.com.br';
begin
  select id into alcione_id from auth.users where lower(trim(email)) = alcione_email;
  select id into markus_id from auth.users where lower(trim(email)) = markus_email;

  if alcione_id is null then
    raise exception 'Usuário não encontrado: %', alcione_email;
  end if;
  if markus_id is null then
    raise exception 'Usuário não encontrado: %', markus_email;
  end if;

  -- Aceitar vínculos existentes entre os dois
  update public.family_members
  set status = 'accepted',
      member_email = lower(trim(member_email)),
      owner_email = coalesce(owner_email, case owner_id
        when alcione_id then alcione_email
        when markus_id then markus_email
        else owner_email
      end)
  where (owner_id = alcione_id and lower(trim(member_email)) = markus_email)
     or (owner_id = markus_id and lower(trim(member_email)) = alcione_email);

  -- Garantir Alcione → Markus
  insert into public.family_members (owner_id, owner_email, member_email, status)
  select alcione_id, alcione_email, markus_email, 'accepted'
  where not exists (
    select 1 from public.family_members
    where owner_id = alcione_id and lower(trim(member_email)) = markus_email
  );

  -- Garantir Markus → Alcione
  insert into public.family_members (owner_id, owner_email, member_email, status)
  select markus_id, markus_email, alcione_email, 'accepted'
  where not exists (
    select 1 from public.family_members
    where owner_id = markus_id and lower(trim(member_email)) = alcione_email
  );

  raise notice 'Vínculos familiares OK entre % e %', alcione_email, markus_email;
end $$;

-- Conferência (leitura)
select fm.id, fm.owner_id, fm.owner_email, fm.member_email, fm.status, fm.created_at
from public.family_members fm
where lower(trim(fm.member_email)) in ('alcionemq@gmail.com', 'markus@thomastecnica.com.br')
   or lower(trim(fm.owner_email)) in ('alcionemq@gmail.com', 'markus@thomastecnica.com.br')
order by fm.created_at;
