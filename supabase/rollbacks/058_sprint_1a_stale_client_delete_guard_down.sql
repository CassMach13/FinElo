-- O rollback completo segue com 057 e 056. Nenhuma linha de dados é alterada.
drop trigger if exists trg_prevent_unsafe_import_origin_delete on public.transactions;
drop function if exists public.prevent_unsafe_import_origin_delete();
