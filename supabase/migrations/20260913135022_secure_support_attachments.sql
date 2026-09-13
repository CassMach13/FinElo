-- 20260903-A1AA: referências persistentes para anexos privados de suporte.
-- Esta migration não altera attachment_url: o campo permanece como fallback legado.

begin;

alter table public.support_tickets
  add column if not exists attachment_path text;

alter table public.support_messages
  add column if not exists attachment_path text;

comment on column public.support_tickets.attachment_path is
  'Caminho interno no bucket privado support-attachments; attachment_url permanece somente para legado.';
comment on column public.support_messages.attachment_path is
  'Caminho interno no bucket privado support-attachments; attachment_url permanece somente para legado.';

create index if not exists support_tickets_attachment_path_idx
  on public.support_tickets (attachment_path)
  where attachment_path is not null;

create index if not exists support_messages_attachment_path_idx
  on public.support_messages (attachment_path)
  where attachment_path is not null;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'support-attachments',
  'support-attachments',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do nothing;

-- Falha fechada caso um bucket homônimo já exista com contrato menos restritivo.
do $migration_preflight$
declare
  bucket_row storage.buckets%rowtype;
  expected_mime_types constant text[] := array[
    'image/jpeg',
    'image/png',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[];
begin
  select *
    into bucket_row
    from storage.buckets
   where id = 'support-attachments';

  if not found
     or bucket_row.name <> 'support-attachments'
     or bucket_row.public is distinct from false
     or bucket_row.file_size_limit is distinct from 10485760
     or bucket_row.allowed_mime_types is null
     or cardinality(bucket_row.allowed_mime_types) <> cardinality(expected_mime_types)
     or not (bucket_row.allowed_mime_types @> expected_mime_types)
     or not (bucket_row.allowed_mime_types <@ expected_mime_types) then
    raise exception 'support-attachments não corresponde ao contrato privado de 10 MiB e MIME allowlist';
  end if;
end
$migration_preflight$;

-- As policies históricas de INSERT das tabelas são permissivas. Estas policies
-- RESTRICTIVE impedem que um chamador persista a referência privada de outro
-- usuário, mesmo que uma policy permissiva existente autorize a criação do registro.
drop policy if exists "support ticket attachment namespace guard" on public.support_tickets;
create policy "support ticket attachment namespace guard"
on public.support_tickets
as restrictive
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (
    attachment_path is null
    or (
      cardinality(string_to_array(attachment_path, '/')) = 4
      and (string_to_array(attachment_path, '/'))[1] = (select auth.uid())::text
      and (string_to_array(attachment_path, '/'))[2] = 'tickets'
      and (string_to_array(attachment_path, '/'))[3] = id::text
      and (string_to_array(attachment_path, '/'))[4] ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|pdf|doc|docx)$'
    )
  )
);

drop policy if exists "support message attachment namespace guard" on public.support_messages;
create policy "support message attachment namespace guard"
on public.support_messages
as restrictive
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and (
    attachment_path is null
    or (
      cardinality(string_to_array(attachment_path, '/')) = 4
      and (string_to_array(attachment_path, '/'))[1] = (select auth.uid())::text
      and (string_to_array(attachment_path, '/'))[2] = 'messages'
      and (string_to_array(attachment_path, '/'))[3] = id::text
      and (string_to_array(attachment_path, '/'))[4] ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|pdf|doc|docx)$'
    )
  )
);

drop policy if exists "support attachments insert own namespace" on storage.objects;
create policy "support attachments insert own namespace"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'support-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and cardinality(storage.foldername(name)) = 3
  and (storage.foldername(name))[2] in ('tickets', 'messages')
  and (storage.foldername(name))[3] ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and storage.filename(name) ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|pdf|doc|docx)$'
);

drop policy if exists "support attachments select authorized" on storage.objects;
create policy "support attachments select authorized"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'support-attachments'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or lower((select auth.jwt() ->> 'email')) = 'cassiomq@gmail.com'
    or exists (
      select 1
        from public.support_tickets as ticket
       where ticket.attachment_path = storage.objects.name
         and ticket.user_id = (select auth.uid())
    )
    or exists (
      select 1
        from public.support_messages as message
        join public.support_tickets as ticket
          on ticket.id = message.ticket_id
       where message.attachment_path = storage.objects.name
         and ticket.user_id = (select auth.uid())
    )
  )
);

-- DELETE existe apenas para compensar upload cujo INSERT no banco falhou.
-- Uma referência persistida torna o objeto imutável por esta superfície.
drop policy if exists "support attachments cleanup own unreferenced" on storage.objects;
create policy "support attachments cleanup own unreferenced"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'support-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (
    select 1
      from public.support_tickets as ticket
     where ticket.attachment_path = storage.objects.name
  )
  and not exists (
    select 1
      from public.support_messages as message
     where message.attachment_path = storage.objects.name
  )
);

commit;
