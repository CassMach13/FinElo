import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSqlFixture } from '../helpers/sqlFixture';

/**
 * Fase «expand» do modelo de dois livros (econômico e de reconciliação).
 *
 * O que estes testes protegem não é a sintaxe — é a promessa feita ao aprovar o
 * modelo: a migração é puramente aditiva, não move dinheiro, e não deixa nenhum
 * caminho pelo qual um total ganhe autoridade sem procedência registrada.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const migration = readSqlFixture(
  join(currentDir, '../../supabase/migrations/20260901120000_card_reconciliation_expand.sql')
);
const rollback = readSqlFixture(
  join(currentDir, '../../supabase/rollbacks/20260901120000_card_reconciliation_expand_down.sql')
);

/**
 * Só o SQL que executa: fora ficam os comentários `--`, os blocos `/* *\/` e as
 * declarações `comment on`. Documentar «não fazemos X» não pode passar por fazer X,
 * e é justamente num `comment on` que a regra sobre `manual_totals_json` está escrita.
 */
const semComentarios = (sql: string) =>
  sql
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/comment\s+on\s+[\s\S]*?';/gi, '');

/** A linha de declaração de uma coluna adicionada, para inspecionar sua nulidade. */
const declaracaoDe = (coluna: string) =>
  semComentarios(migration)
    .split(/\r?\n/)
    .find((linha) => new RegExp(`add column if not exists ${coluna}\\b`, 'i').test(linha)) ?? '';

describe('migração expand — atomicidade', () => {
  it('roda inteira dentro de uma transação', () => {
    expect(migration.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
    expect(migration.trimEnd().endsWith('commit;')).toBe(true);
  });

  it('o rollback também é transacional', () => {
    expect(rollback.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
    expect(rollback.trimEnd().endsWith('commit;')).toBe(true);
  });
});

describe('migração expand — puramente aditiva', () => {
  it('não remove nenhuma coluna', () => {
    expect(semComentarios(migration)).not.toMatch(/drop\s+column/i);
  });

  it('não renomeia nada — os nomes antigos continuam existindo', () => {
    expect(semComentarios(migration)).not.toMatch(/rename\s+(column|to)/i);
  });

  it('não altera o tipo nem a nulidade de coluna existente', () => {
    expect(semComentarios(migration)).not.toMatch(/alter\s+column/i);
  });

  it('não derruba tabela alguma', () => {
    expect(semComentarios(migration)).not.toMatch(/drop\s+table/i);
  });

  /**
   * A fase contract é que remove os nomes antigos, numa migração posterior e só
   * depois que todas as leituras tiverem migrado. Se alguém antecipar isso para
   * cá, este teste falha antes de chegar a produção.
   */
  it('as colunas antigas seguem intocadas', () => {
    const sql = semComentarios(migration);
    for (const legada of ['statement_total_from_file', 'lines_computed_total']) {
      expect(sql).not.toMatch(new RegExp(`drop\\s+column\\s+(if\\s+exists\\s+)?${legada}`, 'i'));
    }
  });
});

describe('migração expand — nenhum valor financeiro é movido', () => {
  const updates = () => semComentarios(migration).match(/update\s+public\.[\s\S]*?;/gi) ?? [];

  it('os únicos UPDATEs copiam o valor antigo para o nome novo', () => {
    expect(updates().length).toBe(4);

    for (const stmt of updates()) {
      // Cada UPDATE é exatamente «novo := antigo», condicionado a novo ainda nulo.
      expect(stmt).toMatch(
        /set\s+(file_reported_total|computed_lines_total)\s*=\s*(statement_total_from_file|lines_computed_total)/i
      );
      expect(stmt).toMatch(/where\s+(file_reported_total|computed_lines_total)\s+is\s+null/i);
    }
  });

  it('nenhum UPDATE toca saldo, total ou pagamento', () => {
    for (const stmt of updates()) {
      expect(stmt).not.toMatch(/set\s+[\s\S]*?(open_balance|statement_total|total_payments)\s*=/i);
    }
  });

  it('os campos derivados nascem nulos, para o rebuild preencher', () => {
    for (const derivado of [
      'reconciliation_adjustment',
      'unresolved_reconciliation_delta',
      'economic_status',
      'reconciliation_status',
    ]) {
      const decl = declaracaoDe(derivado);
      expect(decl).not.toBe('');
      expect(decl).not.toMatch(/not\s+null/i);
      expect(semComentarios(migration)).not.toMatch(new RegExp(`set\\s+${derivado}\\s*=`, 'i'));
    }
  });
});

describe('total autoritativo exige procedência', () => {
  it('gravar o valor sem dizer de onde veio é proibido pelo banco', () => {
    expect(migration).toMatch(
      /check\s*\(\s*authoritative_statement_total is null or authoritative_source is not null\s*\)/i
    );
  });

  it('a procedência é restrita às fontes previstas', () => {
    expect(migration).toMatch(
      /authoritative_source in \('bank_app', 'bank_pdf', 'bank_api', 'user_declared'\)/i
    );
  });

  /**
   * `manual_totals_json.use_manual` foi investigado e REPROVADO como fonte
   * autoritativa: a migration 048 o define como override do motor, e o payload
   * mistura statement_total com total_payments sob a mesma flag. Promovê-lo
   * automaticamente reintroduziria a fusão das duas escadas.
   */
  it('nada é promovido a autoritativo a partir de manual_totals_json', () => {
    const sql = semComentarios(migration);
    expect(sql).not.toMatch(/set\s+authoritative_statement_total\s*=/i);
    expect(sql).not.toMatch(/manual_totals_json/i);
  });
});

describe('confirmações — compatibilidade das linhas existentes', () => {
  it("confirmation_type entra com default 'amount', a semântica histórica", () => {
    expect(migration).toMatch(
      /add column if not exists confirmation_type text not null default 'amount'/i
    );
  });

  it('só os dois tipos previstos são aceitos', () => {
    expect(migration).toMatch(/check \(confirmation_type in \('amount', 'full'\)\)/i);
  });
});

describe('tabela de resoluções', () => {
  it('cobre as quatro saídas possíveis de um delta', () => {
    expect(migration).toMatch(
      /resolution in \('economic_credit', 'bank_adjustment', 'authoritative_total', 'written_off'\)/i
    );
  });

  it('informar total oficial sem o valor é impossível', () => {
    expect(migration).toMatch(
      /check \(resolution <> 'authoritative_total' or authoritative_total is not null\)/i
    );
  });

  it('registra autor e momento — é trilha de auditoria, não flag', () => {
    expect(migration).toMatch(/resolved_at timestamptz not null default now\(\)/i);
    expect(migration).toMatch(/resolved_by uuid references auth\.users\(id\)/i);
  });

  it('tem RLS ligada e as quatro políticas de acesso familiar', () => {
    expect(migration).toMatch(
      /alter table public\.credit_card_reconciliation_resolutions enable row level security/i
    );
    for (const acao of ['select', 'insert', 'update', 'delete']) {
      expect(migration).toMatch(
        new RegExp(`on public\\.credit_card_reconciliation_resolutions for ${acao}`, 'i')
      );
    }
    expect(migration.match(/public\.has_family_access\(user_id\)/g)).toHaveLength(4);
  });
});

describe('rollback desfaz exatamente o que a migração cria', () => {
  const criadas = [
    'file_reported_total',
    'computed_lines_total',
    'authoritative_statement_total',
    'authoritative_source',
    'authoritative_recorded_at',
    'authoritative_recorded_by',
    'reconciliation_adjustment',
    'unresolved_reconciliation_delta',
    'economic_status',
    'reconciliation_status',
    'confirmation_type',
  ];

  it.each(criadas)('remove a coluna %s', (coluna) => {
    expect(migration).toMatch(new RegExp(`add column if not exists ${coluna}`, 'i'));
    expect(rollback).toMatch(new RegExp(`drop column if exists ${coluna}`, 'i'));
  });

  it('remove a tabela de resoluções', () => {
    expect(rollback).toMatch(/drop table if exists public\.credit_card_reconciliation_resolutions/i);
  });

  it('não toca nas colunas antigas — reverter não perde dado financeiro', () => {
    expect(rollback).not.toMatch(/drop column if exists statement_total_from_file/i);
    expect(rollback).not.toMatch(/drop column if exists lines_computed_total/i);
  });
});
