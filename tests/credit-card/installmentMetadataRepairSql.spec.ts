import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSql = (name: string) => readFileSync(resolve('scripts/sql', name), 'utf8');

const dryRun = readSql('20260905_9c10_installment_metadata_dry_run.sql');
const repair = readSql('20260905_9c10_installment_metadata_repair.sql');
const rollback = readSql('20260905_9c10_installment_metadata_rollback.sql');

const TARGET_ACCOUNT = '97d11eb6-ed8d-47d0-9639-956ad222eb16';
const TARGET_CARD = '4c839d44-c1d1-4486-9b93-5c5077a1d37b';
const IDENTITY_SHA256 = '92d7311e810b92df05054e994f92746af551430254a1f53886a40d343b364ea3';
const INVARIANT_SHA256 = 'a1379912b521e6c0609dd5f00dc4de96b6839f32fce5f074aae39c390c701357';

describe('20260905-9C10 — artefatos do reparo histórico', () => {
  it('mantém o dry-run estritamente read-only e identifica cada relação', () => {
    expect(dryRun).toContain('begin transaction read only;');
    expect(dryRun).toContain('rollback;');
    expect(dryRun).toContain('c.transaction_id');
    expect(dryRun).toContain('c.entry_id');
    expect(dryRun.toLowerCase()).not.toMatch(/\b(update|insert|delete|merge|alter|create|drop|truncate)\b/);
  });

  it.each([dryRun, repair, rollback])('fixa conta, cartão, contagem e hashes aprovados', (sql) => {
    expect(sql).toContain(TARGET_ACCOUNT);
    expect(sql).toContain(TARGET_CARD);
    expect(sql).toContain('67');
    expect(sql).toContain(IDENTITY_SHA256);
    expect(sql).toContain(INVARIANT_SHA256);
    expect(sql).toMatch(/source_file_name(?:'\))? =/);
  });

  it('o reparo escreve somente os dois campos de parcela', () => {
    const update = repair.match(/update public\.transactions t[\s\S]*?where t\."ID_Transacao" = s\.transaction_id;/i)?.[0];
    expect(update).toBeTruthy();
    expect(update).toContain('"Parcela_Atual" = s.repair_installment_current');
    expect(update).toContain('"Total_Parcelas" = s.repair_installment_total');
    expect(update).not.toMatch(/"Fonte"|"Origem"|"Valor"|"Data"|statement_id|classification/i);
  });

  it('falha fechado antes da escrita e valida todos os dados não reparados', () => {
    expect(repair.indexOf('do $guard$')).toBeLessThan(repair.indexOf('update public.transactions t'));
    expect(repair).toContain('candidate_count <> 67');
    expect(repair).toContain("to_jsonb(t) - 'Parcela_Atual' - 'Total_Parcelas'");
    expect(repair).toContain('to_jsonb(e) = s.entry_before');
    expect(repair).toContain('to_jsonb(c) = s.card_before');
  });

  it('o rollback explícito só restaura NULL/NULL no mesmo conjunto exato', () => {
    const update = rollback.match(/update public\.transactions t[\s\S]*?where t\."ID_Transacao" = s\.transaction_id;/i)?.[0];
    expect(update).toBeTruthy();
    expect(update).toContain('"Parcela_Atual" = null');
    expect(update).toContain('"Total_Parcelas" = null');
    expect(update).not.toMatch(/"Fonte"|"Origem"|"Valor"|"Data"|statement_id|classification/i);
    expect(rollback).toContain('9C10 rollback recusado: conjunto divergente');
  });

  it('não inclui os artefatos na trilha automática de migrations', () => {
    expect(resolve('scripts/sql', '20260905_9c10_installment_metadata_repair.sql')).not.toContain(
      resolve('supabase/migrations')
    );
  });
});
