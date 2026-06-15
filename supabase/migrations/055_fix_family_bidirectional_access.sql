-- ============================================================================
-- Plano Família: acesso bidirecional + e-mails case-insensitive
-- ============================================================================
-- Corrige o caso em que o titular convida o familiar e só o convidado via os dados
-- do titular. Agora ambos veem transações/contas quando o vínculo está aceito.
-- ============================================================================

-- Normalizar e-mails já gravados (sem apagar registros)
update public.family_members
set member_email = lower(trim(member_email))
where member_email is not null
  and member_email <> lower(trim(member_email));

update public.family_members fm
set owner_email = lower(trim(u.email))
from auth.users u
where fm.owner_id = u.id
  and (fm.owner_email is null or fm.owner_email <> lower(trim(u.email)));

update public.family_members
set status = 'accepted'
where status is null;

create or replace function public.has_family_access(record_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  record_email text;
begin
  if auth.uid() is null or record_user_id is null then
    return false;
  end if;

  if auth.uid() = record_user_id then
    return true;
  end if;

  if jwt_email = '' then
    return false;
  end if;

  -- Convidado aceito pelo dono do registro (vejo dados de quem me convidou)
  if exists (
    select 1
    from public.family_members fm
    where fm.owner_id = record_user_id
      and lower(trim(fm.member_email)) = jwt_email
      and fm.status = 'accepted'
  ) then
    return true;
  end if;

  select lower(trim(u.email))
  into record_email
  from auth.users u
  where u.id = record_user_id;

  if record_email is null or record_email = '' then
    return false;
  end if;

  -- Titular vê dados do familiar que convidou e foi aceito
  if exists (
    select 1
    from public.family_members fm
    where fm.owner_id = auth.uid()
      and lower(trim(fm.member_email)) = record_email
      and fm.status = 'accepted'
  ) then
    return true;
  end if;

  return false;
end;
$$;
