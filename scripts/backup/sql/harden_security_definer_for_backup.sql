-- Candidato de hardening. Não é migration e não foi aplicado.
-- Objetivo: preservar os papéis Supabase que já usam cada função e retirar a
-- herança implícita de EXECUTE do papel global PUBLIC. O papel dedicado de
-- backup não será membro de anon/authenticated e, portanto, ficará sem acesso.

revoke execute on function public.get_admin_crm_users() from public;
grant execute on function public.get_admin_crm_users() to anon, authenticated, service_role;

revoke execute on function public.get_admin_metrics() from public;
grant execute on function public.get_admin_metrics() to anon, authenticated, service_role;

revoke execute on function public.get_founder_count() from public;
grant execute on function public.get_founder_count() to anon, authenticated, service_role;

revoke execute on function public.has_family_access(uuid) from public;
grant execute on function public.has_family_access(uuid) to anon, authenticated, service_role;

revoke execute on function public.is_premium(uuid) from public;
grant execute on function public.is_premium(uuid) to anon, authenticated, service_role;

-- Critério pós-aplicação para o papel de backup:
-- select count(*) = 0
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where p.prosecdef
--   and n.nspname not in ('pg_catalog', 'information_schema')
--   and has_function_privilege('finelo_backup_reader', p.oid, 'EXECUTE');
