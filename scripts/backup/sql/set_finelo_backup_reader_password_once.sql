-- Cerimônia de uso único no SQL Editor do Supabase.
-- A senha não aparece no texto da consulta nem é persistida em tabela.
-- O resultado a mostra uma única vez para instalação imediata no DPAPI local.

begin;
set local password_encryption = 'scram-sha-256';

create temporary table finelo_reader_password_once (
  password text not null
) on commit drop;

insert into finelo_reader_password_once(password)
select translate(
  rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='),
  '+/',
  '-_'
);

do $set_password$
declare
  generated_password text;
begin
  select password into strict generated_password
  from finelo_reader_password_once;

  if generated_password !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'A senha gerada não passou na validação.';
  end if;

  execute format(
    'alter role finelo_backup_reader password %L',
    generated_password
  );
end
$set_password$;

select concat(
  substr(password, 1, 11), '.',
  substr(password, 12, 11), '.',
  substr(password, 23, 11), '.',
  substr(password, 34, 10)
) as "CODIGO_AGRUPADO_COPIE_A_LINHA_COMPLETA"
from finelo_reader_password_once;

commit;
