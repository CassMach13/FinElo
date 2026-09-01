import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSqlFixture } from '../helpers/sqlFixture';

/**
 * Taxonomia simétrica e resoluções parciais.
 *
 * O que estes testes protegem é a promessa de que o banco recusa, por si, uma
 * classificação que criaria dinheiro — sinal incompatível e total oficial sem
 * procedência — e a promessa de que nada do legado é convertido aqui.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const migration = readSqlFixture(
  join(currentDir, '../../supabase/migrations/20260901180000_card_resolution_taxonomy.sql')
);
const rollback = readSqlFixture(
  join(currentDir, '../../supabase/rollbacks/20260901180000_card_resolution_taxonomy_down.sql')
);

const semComentarios = (sql: string) =>
  sql
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/comment\s+on\s+[\s\S]*?';/gi, '');

describe('atomicidade', () => {
  it('migração e rollback rodam inteiros dentro de uma transação', () => {
    for (const sql of [migration, rollback]) {
      expect(sql.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
      expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    }
  });
});

describe('taxonomia simétrica', () => {
  it('economic_debt entra ao lado das quatro existentes', () => {
    expect(migration).toMatch(
      /resolution in \('economic_credit', 'economic_debt', 'bank_adjustment',\s*'authoritative_total', 'written_off'\)/
    );
  });

  it('a semântica de cada resolução fica escrita no banco', () => {
    for (const termo of [
      'economic_credit =',
      'economic_debt =',
      'bank_adjustment =',
      'authoritative_total =',
      'written_off =',
    ]) {
      expect(migration).toContain(termo);
    }
  });

  /**
   * `written_off` era descrito apenas como «baixa consciente», o que podia ser
   * lido como baixa ECONÔMICA. A definição agora é explícita e sem efeito no
   * livro 1.
   */
  it('written_off é encerramento de reconciliação, não baixa econômica', () => {
    expect(migration).toMatch(
      /written_off = o usuário encerra conscientemente uma divergência de reconciliação SEM afirmar/
    );
    expect(migration).toMatch(/não move o livro econômico/);
  });

  it('authoritative_total é recálculo, não máscara', () => {
    expect(migration).toMatch(/a competência é RECALCULADA a partir da fonte superior/);
    expect(migration).toMatch(/não é mascarar o delta/);
  });
});

describe('o banco recusa classificação que criaria dinheiro', () => {
  it('economic_credit exige valor positivo', () => {
    expect(migration).toMatch(
      /resolution = 'economic_credit' and resolved_amount is not null and resolved_amount > 0/
    );
  });

  it('economic_debt exige valor negativo', () => {
    expect(migration).toMatch(
      /resolution = 'economic_debt' and resolved_amount is not null and resolved_amount < 0/
    );
  });

  it('ajuste e baixa exigem valor não nulo', () => {
    expect(migration).toMatch(
      /resolution in \('bank_adjustment', 'written_off'\)\s*and resolved_amount is not null and resolved_amount <> 0/
    );
  });

  it('authoritative_total não consome porção alguma', () => {
    expect(migration).toMatch(/resolution = 'authoritative_total' and resolved_amount is null/);
  });

  it('informar total oficial exige dizer de onde veio', () => {
    expect(migration).toMatch(
      /resolution <> 'authoritative_total'\s*or \(authoritative_total is not null and authoritative_source is not null\)/
    );
  });

  it('a procedência é restrita às fontes previstas', () => {
    expect(migration).toMatch(
      /authoritative_source in \('bank_app', 'bank_pdf', 'bank_api', 'user_declared'\)/
    );
  });
});

describe('resolução parcial', () => {
  it('resolved_amount é assinado e permite classificar porções', () => {
    expect(migration).toMatch(/add column if not exists resolved_amount numeric\(15, 2\) null/);
    expect(migration).toMatch(/permitindo resolução parcial/);
  });
});

describe('nenhuma conversão silenciosa do legado', () => {
  it('a migração não toca em manual_totals_json', () => {
    expect(semComentarios(migration)).not.toMatch(/manual_totals_json/i);
  });

  it('não insere linha alguma na tabela de resoluções', () => {
    expect(semComentarios(migration)).not.toMatch(/insert\s+into/i);
  });

  it('não escreve em nenhuma tabela', () => {
    expect(semComentarios(migration)).not.toMatch(/\bupdate\s+public\./i);
  });

  it('a decisão de não migrar o legado fica registrada no arquivo', () => {
    expect(migration).toMatch(/NENHUM é migrado/);
    expect(migration).toMatch(/duplicaria esse efeito/);
  });
});

describe('rollback', () => {
  it('remove as colunas acrescentadas', () => {
    for (const coluna of [
      'resolved_amount',
      'authoritative_source',
      'authoritative_at',
      'authoritative_by',
    ]) {
      expect(migration).toMatch(new RegExp(`add column if not exists ${coluna}`, 'i'));
      expect(rollback).toMatch(new RegExp(`drop column if exists ${coluna}`, 'i'));
    }
  });

  it('restaura a taxonomia de quatro valores', () => {
    expect(rollback).toMatch(
      /check \(resolution in \('economic_credit', 'bank_adjustment', 'authoritative_total', 'written_off'\)\)/
    );
  });

  /**
   * Reverter com resoluções `economic_debt` gravadas descartaria informação que
   * o usuário afirmou. O rollback falha de propósito em vez de apagar em silêncio.
   */
  it('recusa reverter se houver economic_debt gravado', () => {
    expect(rollback).toMatch(/where resolution = 'economic_debt'/);
    expect(rollback).toMatch(/raise exception/i);
    expect(rollback).toMatch(/Reclassifique-as antes de reverter/);
  });

  it('não derruba a tabela nem toca em dado financeiro', () => {
    expect(semComentarios(rollback)).not.toMatch(/drop\s+table/i);
    expect(semComentarios(rollback)).not.toMatch(/delete\s+from/i);
  });
});
