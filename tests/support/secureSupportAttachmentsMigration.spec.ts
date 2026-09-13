import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve('supabase/migrations/20260913135022_secure_support_attachments.sql');
const rollbackPath = resolve('supabase/rollbacks/20260913135022_secure_support_attachments_down.sql');
const migration = readFileSync(migrationPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');

describe('secure support attachment migration contract', () => {
  it('creates a private 10 MiB bucket with the exact five MIME types', () => {
    expect(migration).toContain("'support-attachments'");
    expect(migration).toMatch(/'support-attachments',\s*'support-attachments',\s*false,\s*10485760/s);
    for (const mime of [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]) {
      expect(migration).toContain(`'${mime}'`);
    }
    expect(migration).not.toMatch(/update\s+storage\.buckets/i);
  });

  it('preserves attachment_url and adds attachment_path to tickets and messages', () => {
    expect(migration).toMatch(/alter table public\.support_tickets\s+add column if not exists attachment_path text/i);
    expect(migration).toMatch(/alter table public\.support_messages\s+add column if not exists attachment_path text/i);
    expect(migration).not.toMatch(/drop\s+column\s+attachment_url/i);
    expect(migration).not.toMatch(/update\s+public\.support_(tickets|messages)/i);
  });

  it('has no anonymous or public policy and grants no external privilege', () => {
    expect(migration).not.toMatch(/\bto\s+(anon|public)\b/i);
    expect(migration).not.toMatch(/\bgrant\b/i);
    expect(migration.match(/\bto authenticated\b/gi)).toHaveLength(5);
  });

  it('limits insert to the authenticated UUID namespace and supported record kinds', () => {
    expect(migration).toMatch(/for insert\s+to authenticated\s+with check/s);
    expect(migration).toContain('(storage.foldername(name))[1] = (select auth.uid())::text');
    expect(migration).toContain("(storage.foldername(name))[2] in ('tickets', 'messages')");
    expect(migration).toContain('\\.(jpg|png|pdf|doc|docx)$');
  });

  it('restricts table inserts to the authenticated namespace and the inserted record UUID', () => {
    expect(migration.match(/as restrictive/g)).toHaveLength(2);
    expect(migration).toContain('(string_to_array(attachment_path, \'/\'))[2] = \'tickets\'');
    expect(migration).toContain('(string_to_array(attachment_path, \'/\'))[2] = \'messages\'');
    expect(migration.match(/\[3\] = id::text/g)).toHaveLength(2);
    expect(migration).toContain('sender_id = (select auth.uid())');
  });

  it('allows reads only to the uploader, ticket owner, or existing admin identity', () => {
    expect(migration).toMatch(/for select\s+to authenticated\s+using/s);
    expect(migration).toContain("lower((select auth.jwt() ->> 'email')) = 'cassiomq@gmail.com'");
    expect(migration).toContain('ticket.user_id = (select auth.uid())');
    expect(migration).toContain('ticket.id = message.ticket_id');
  });

  it('allows only compensating deletion of an own unreferenced object', () => {
    expect(migration).toMatch(/for delete\s+to authenticated\s+using/s);
    expect(migration).toMatch(/not exists \(\s*select 1\s*from public\.support_tickets/s);
    expect(migration).toMatch(/not exists \(\s*select 1\s*from public\.support_messages/s);
    expect(migration).not.toMatch(/for update/i);
  });

  it('is transactional and fails closed on a pre-existing incompatible bucket', () => {
    expect(migration.trimStart().toLowerCase()).toContain('begin;');
    expect(migration.trimEnd().toLowerCase().endsWith('commit;')).toBe(true);
    expect(migration).toContain("raise exception 'support-attachments não corresponde");
    expect(migration).toContain('on conflict (id) do nothing');
  });
});

describe('support attachment rollback contract', () => {
  it('refuses rollback when a persisted reference or object exists', () => {
    expect(rollback).toContain('where attachment_path is not null');
    expect(rollback).toContain("where bucket_id = 'support-attachments'");
    expect(rollback.match(/raise exception 'rollback recusado:/g)).toHaveLength(2);
  });

  it('never deletes objects, historical references, or columns', () => {
    expect(rollback).not.toMatch(/delete\s+from\s+storage\.objects/i);
    expect(rollback).not.toMatch(/update\s+public\.support_/i);
    expect(rollback).not.toMatch(/drop\s+column/i);
    expect(rollback).not.toMatch(/truncate/i);
  });

  it('removes only the empty bucket surface and its five policies transactionally', () => {
    expect(rollback.trimStart().toLowerCase()).toContain('begin;');
    expect(rollback.trimEnd().toLowerCase().endsWith('commit;')).toBe(true);
    expect(rollback.match(/drop policy if exists/g)).toHaveLength(5);
    expect(rollback).toMatch(/delete from storage\.buckets\s+where id = 'support-attachments'/s);
  });
});
