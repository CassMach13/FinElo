-- Rollback fail-closed e não destrutivo para 20260903-A1AA.
-- As colunas attachment_path são preservadas deliberadamente para que referências
-- históricas nunca sejam descartadas por uma reversão de schema.

begin;

do $rollback_preflight$
begin
  if exists (
    select 1
      from public.support_tickets
     where attachment_path is not null
  ) or exists (
    select 1
      from public.support_messages
     where attachment_path is not null
  ) then
    raise exception 'rollback recusado: existem referências persistidas em attachment_path';
  end if;

  if exists (
    select 1
      from storage.objects
     where bucket_id = 'support-attachments'
  ) then
    raise exception 'rollback recusado: existem objetos no bucket support-attachments';
  end if;
end
$rollback_preflight$;

drop policy if exists "support attachments cleanup own unreferenced" on storage.objects;
drop policy if exists "support attachments select authorized" on storage.objects;
drop policy if exists "support attachments insert own namespace" on storage.objects;
drop policy if exists "support message attachment namespace guard" on public.support_messages;
drop policy if exists "support ticket attachment namespace guard" on public.support_tickets;

delete from storage.buckets
where id = 'support-attachments';

do $rollback_postflight$
begin
  if exists (
    select 1
      from storage.buckets
     where id = 'support-attachments'
  ) then
    raise exception 'rollback incompleto: o bucket support-attachments ainda existe';
  end if;
end
$rollback_postflight$;

commit;
