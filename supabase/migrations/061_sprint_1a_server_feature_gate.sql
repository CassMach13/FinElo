-- Sprint 1A — leitura autoritativa da flag por usuário.
-- A função é somente leitura e não altera metadados nem dados históricos.

create or replace function public.get_atomic_import_feature_state()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when u.raw_app_meta_data ->> 'atomic_imports_disabled' = 'true' then 'disabled'
    when u.raw_app_meta_data ->> 'atomic_imports_enabled' = 'true' then 'enabled'
    else 'unset'
  end
  from auth.users u
  where u.id = (select auth.uid());
$function$;

revoke all on function public.get_atomic_import_feature_state() from public;
revoke all on function public.get_atomic_import_feature_state() from anon;
grant execute on function public.get_atomic_import_feature_state() to authenticated;

comment on function public.get_atomic_import_feature_state() is
  'Retorna enabled, disabled ou unset para o usuário autenticado, sem expor metadados.';
