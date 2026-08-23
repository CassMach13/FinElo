\set ON_ERROR_STOP on

-- Rollback operacional para retornar ao estado observado antes da instalação.
-- Não é migration automática. Produção exige autorização explícita.
-- O DROP ROLE falha de forma segura caso o papel possua dependências inesperadas.

begin;

select case when exists (
  select 1 from pg_roles where rolname = 'finelo_backup_reader'
) then 'true' else 'false' end as finelo_backup_reader_exists
\gset

\if :finelo_backup_reader_exists
  revoke pg_read_all_data from finelo_backup_reader;
  revoke all on database postgres from finelo_backup_reader;
  drop role finelo_backup_reader;
\endif

-- Restaura os grants PUBLIC observados antes do hardening. Os grants explícitos
-- para anon/authenticated podem permanecer porque não ampliam o estado anterior.
grant execute on function public.get_admin_crm_users() to public;
grant execute on function public.get_admin_metrics() to public;
grant execute on function public.get_founder_count() to public;
grant execute on function public.has_family_access(uuid) to public;
grant execute on function public.is_premium(uuid) to public;

commit;
