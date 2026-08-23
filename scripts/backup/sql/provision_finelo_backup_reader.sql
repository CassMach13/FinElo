\set ON_ERROR_STOP on

-- Operação administrativa de instalação. Não é migration automática.
-- Execute primeiro em staging. Produção exige autorização separada.
-- Uso: psql --variable finelo_backup_password='...' --file provision_finelo_backup_reader.sql

\if :{?finelo_backup_password}
\else
  \echo 'Variável finelo_backup_password ausente.'
  \quit 3
\endif

do $provision$
begin
  if not exists (select 1 from pg_roles where rolname = 'finelo_backup_reader') then
    create role finelo_backup_reader
      login
      inherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end
$provision$;

alter role finelo_backup_reader
  login
  inherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  password :'finelo_backup_password';

alter role finelo_backup_reader set default_transaction_read_only = on;
alter role finelo_backup_reader set statement_timeout = '15min';
alter role finelo_backup_reader set idle_in_transaction_session_timeout = '60s';
alter role finelo_backup_reader set search_path = pg_catalog;

revoke all on database postgres from finelo_backup_reader;
grant connect on database postgres to finelo_backup_reader;
revoke create, temporary on database postgres from finelo_backup_reader;

grant pg_read_all_data to finelo_backup_reader;

-- Uma concessão de EXECUTE via PUBLIC continua prevalecendo sobre um REVOKE
-- aplicado somente a este papel. Por isso o runner mede qualquer função
-- SECURITY DEFINER executável e bloqueia o backup até que a superfície seja
-- analisada e corrigida sem quebrar o aplicativo.
revoke execute on all functions in schema public from finelo_backup_reader;

comment on role finelo_backup_reader is
  'Credencial exclusiva do backup lógico FinElo; sem deploy, migration ou escrita de aplicação.';

select
  rolname,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolreplication,
  rolbypassrls,
  rolconfig
from pg_roles
where rolname = 'finelo_backup_reader';
