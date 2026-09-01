import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSqlFixture } from '../helpers/sqlFixture';

/**
 * O token das palavras-chave de classificação.
 *
 * Duas promessas precisam sobreviver a qualquer edição futura deste arquivo:
 *
 *   1. o token descreve o estado ATUAL de `auth.users`, nunca o JWT;
 *   2. quando a leitura não acontece, a função LEVANTA — nunca devolve um token
 *      plausível sobre uma entrada que não foi lida.
 *
 * A segunda existe porque a alternativa é invisível: um leitor sem privilégio
 * sob RLS enxerga zero linhas e um token derivado disso seria constante para
 * todo mundo, para sempre. Constante parece «nada mudou», e todo snapshot
 * passaria na validação.
 *
 * O comportamento foi medido em staging com oito cenários (token muda ao gravar
 * palavras; estável ao regravar as mesmas; estável ao mexer em chave não
 * consumida; muda ao trocar as duas listas de lugar; levanta 42501 para usuário
 * inexistente e 22004 para uuid nulo; volta ao valor original ao restaurar).
 * O que este arquivo protege é a ESTRUTURA que produziu esse comportamento.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const migration = readSqlFixture(
  join(currentDir, '../../supabase/migrations/20260902120000_card_reconciliation_metadata_context.sql')
);
const rollback = readSqlFixture(
  join(currentDir, '../../supabase/rollbacks/20260902120000_card_reconciliation_metadata_context_down.sql')
);

/**
 * A prosa do arquivo, com as quebras de linha do comentário colapsadas.
 *
 * O que estes testes exigem é que a AFIRMAÇÃO esteja escrita — não que ela caiba
 * nas mesmas colunas. Reformatar um parágrafo não pode quebrar um teste.
 */
const prosa = (sql: string) =>
  sql
    .split(/\r?\n/)
    .map((linha) => linha.replace(/^\s*--\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

const semComentarios = (sql: string) =>
  sql
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/comment\s+on\s+[\s\S]*?';/gi, '');

/** O corpo de uma função, entre os delimitadores `$nome$`. */
function corpo(delimitador: string): string {
  const marca = `$${delimitador}$`;
  const inicio = migration.indexOf(marca);
  const fim = migration.indexOf(marca, inicio + marca.length);
  expect(inicio, `função ${delimitador} não existe`).toBeGreaterThan(-1);
  expect(fim).toBeGreaterThan(inicio);
  return migration.slice(inicio + marca.length, fim);
}

// ---------------------------------------------------------------------------

describe('atomicidade', () => {
  it('migração e rollback rodam inteiros dentro de uma transação', () => {
    for (const sql of [migration, rollback]) {
      expect(sql.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
      expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    }
  });
});

describe('a fonte é a tabela, nunca o JWT', () => {
  it('o token lê auth.users', () => {
    expect(corpo('meta_ctx')).toMatch(/from auth\.users u\s*\n\s*where u\.id = p_user_id/);
  });

  /**
   * `auth.jwt()`, `auth.uid()` e `current_setting('request.jwt...')` descrevem o
   * momento do login, não o momento da verificação. Nenhum deles pode aparecer.
   */
  it('nenhuma leitura de JWT em lugar nenhum', () => {
    const limpo = semComentarios(migration);
    expect(limpo).not.toMatch(/auth\.jwt\s*\(/i);
    expect(limpo).not.toMatch(/request\.jwt/i);
    expect(limpo).not.toMatch(/current_setting\s*\(/i);
  });

  it('o motivo fica escrito, para ninguém "simplificar" isso depois', () => {
    expect(prosa(migration)).toContain('O token nunca vem do JWT');
    expect(prosa(migration)).toContain('as palavras podem ter mudado depois');
  });
});

describe('sem leitura não há token', () => {
  it('a ausência da linha levanta exceção em vez de devolver hash', () => {
    const c = corpo('meta_ctx');
    expect(c).toMatch(/if not found then\s*\n\s*raise exception/);
    expect(c).toMatch(/errcode = '42501'/);
  });

  it('uuid nulo levanta antes de qualquer leitura', () => {
    const c = corpo('meta_ctx');
    const posNulo = c.indexOf("errcode = '22004'");
    const posLeitura = c.indexOf('from auth.users');
    expect(posNulo).toBeGreaterThan(-1);
    expect(posNulo).toBeLessThan(posLeitura);
  });

  /** Um `return` no lugar do `raise` devolveria o hash de `{}` — o mesmo para todos. */
  it('não existe caminho que devolva token sem ter lido', () => {
    const c = corpo('meta_ctx');
    const retornos = c.match(/\breturn\b/g) ?? [];
    expect(retornos.length).toBe(1);
  });
});

describe('a superfície é um uuid entrando e um hash saindo', () => {
  it('devolve hash, nunca as palavras', () => {
    const c = corpo('meta_ctx');
    expect(c).toMatch(/pg_catalog\.encode\(\s*\n?\s*pg_catalog\.sha256\(/);
    expect(c).not.toMatch(/return v_meta/);
  });

  it('lê uma coluna, escolhida por igualdade de uuid', () => {
    const c = corpo('meta_ctx');
    expect(c).toMatch(/select u\.raw_user_meta_data into v_meta/);
    expect(c).not.toMatch(/select \*/);
    expect(c).not.toMatch(/u\.email|u\.phone|encrypted_password|confirmation_token/i);
  });

  it('não existe SQL dinâmico dentro do SECURITY DEFINER de postgres', () => {
    expect(corpo('meta_ctx')).not.toMatch(/\bexecute\b/i);
    expect(corpo('meta_ctx')).not.toMatch(/format\s*\(/i);
  });

  it('toda função fixa o search_path', () => {
    const funcoes = migration.match(/create or replace function/g)?.length ?? 0;
    const fixados = migration.match(/set search_path = ''/g)?.length ?? 0;
    expect(funcoes).toBe(3);
    expect(fixados).toBe(funcoes);
  });

  it('EXECUTE é revogado do cliente e concedido só ao executor', () => {
    expect(migration).toMatch(
      /revoke all on function finelo_reconciliation_internal\.metadata_context\(uuid\)\s*\n\s*from public, anon, authenticated, service_role/
    );
    expect(migration).toMatch(
      /grant execute on function finelo_reconciliation_internal\.metadata_context\(uuid\)\s*\n\s*to finelo_reconciliation_executor/
    );
  });
});

describe('a normalização espelha o cliente', () => {
  const c = () => corpo('kw');

  it('só arrays produzem palavras', () => {
    expect(c()).toMatch(/jsonb_typeof\(p_value\) = 'array'/);
    expect(c()).toMatch(/else '\[\]'::jsonb end/);
  });

  it('elementos não-string são descartados', () => {
    expect(c()).toMatch(/where pg_catalog\.jsonb_typeof\(e\.value\) = 'string'/);
  });

  it('cada palavra passa por trim e as vazias somem', () => {
    expect(c()).toMatch(/pg_catalog\.btrim\(e\.value #>> '\{\}'\)/);
    expect(c()).toMatch(/where k <> ''/);
  });

  it('a ordem original é preservada', () => {
    expect(c()).toMatch(/with ordinality/);
    expect(corpo('canon')).toMatch(/order by ord/);
  });

  it('as duas listas não se confundem', () => {
    const canon = corpo('canon');
    expect(canon).toContain("p_meta -> 'cardPaymentKeywords'");
    expect(canon).toContain("p_meta -> 'cardCreditKeywords'");
    expect(canon).toMatch(/'v1\|p:\['/);
    expect(canon).toMatch(/'\]\|c:\['/);
  });

  /**
   * REGRESSÃO. `to_jsonb(array)::text` rende `["a", "b"]` — com espaço depois da
   * vírgula. Esse espaço é detalhe de implementação do PostgreSQL: se um upgrade
   * o mudasse, todo token mudaria de uma vez.
   */
  it('o formato não depende de como o PostgreSQL rende um array', () => {
    const canon = corpo('canon');
    expect(canon).toMatch(/pg_catalog\.string_agg\(pg_catalog\.to_jsonb\(k\)::text, ','/);
    expect(canon).not.toMatch(/to_jsonb\(pg_catalog\.array_agg/);
  });

  /** Uma palavra contendo `","` não pode fingir ser duas. */
  it('cada palavra vai escapada como string JSON', () => {
    expect(corpo('canon')).toMatch(/pg_catalog\.to_jsonb\(k\)::text/);
  });

  it('a versão da normalização entra no token', () => {
    expect(corpo('canon')).toMatch(/'v1\|/);
    expect(prosa(migration)).toContain('O prefixo `v1` versiona a própria normalização');
  });
});

describe('a decisão sobre a posse fica justificada', () => {
  /**
   * O padrão `sprint_2*` é papel dedicado sem privilégio. Aqui ele foi tentado e
   * é impossível; a exceção só se sustenta enquanto o motivo estiver escrito.
   */
  it('as quatro tentativas e por que falharam estão no arquivo', () => {
    const texto = prosa(migration);
    expect(texto).toContain('RLS ATIVA e ZERO políticas');
    expect(texto).toContain('o grant de coluna é aceito');
    expect(texto).toContain('USAGE sem grant option');
    expect(texto).toContain('emite um WARNING, a migration reporta SUCESSO');
    expect(texto).toContain('lê a base inteira. É pior que o problema');
  });

  it('a saída estrutural fica registrada como dívida', () => {
    expect(prosa(migration)).toContain('A SAÍDA ESTRUTURAL');
    expect(prosa(migration)).toContain('Movê-la elimina de uma vez o `bypassrls`');
  });

  /** O papel que não funciona não pode ficar por aí com `bypassrls`. */
  it('a tentativa anterior é removida, não deixada para trás', () => {
    expect(migration).toMatch(/drop role finelo_metadata_reader/);
    expect(migration).not.toMatch(/create role finelo_metadata_reader/);
  });

  it('nenhum papel novo com bypassrls é criado', () => {
    expect(semComentarios(migration)).not.toMatch(/\bbypassrls\b/i);
  });
});

describe('nenhum efeito financeiro', () => {
  it('a migração não escreve em tabela nenhuma', () => {
    const limpo = semComentarios(migration);
    expect(limpo).not.toMatch(/\binsert\s+into\b/i);
    expect(limpo).not.toMatch(/\bupdate\s+(public|auth)\./i);
    expect(limpo).not.toMatch(/\bdelete\s+from\b/i);
  });

  it('não instala gatilho em auth.users', () => {
    expect(semComentarios(migration)).not.toMatch(/create\s+trigger/i);
    expect(prosa(migration)).toContain('Instalar gatilho ali foi DESCARTADO');
  });
});

describe('rollback', () => {
  it('derruba as três funções criadas', () => {
    for (const f of ['metadata_context(uuid)', 'metadata_canonical(jsonb)', 'metadata_keywords(jsonb)']) {
      expect(rollback).toContain(`drop function if exists finelo_reconciliation_internal.${f}`);
    }
  });

  /** O token é derivado: não há dado a preservar. */
  it('não toca em dado nem recria o papel que não funciona', () => {
    const limpo = semComentarios(rollback);
    expect(limpo).not.toMatch(/\bdelete\s+from\b/i);
    expect(limpo).not.toMatch(/\bupdate\s+/i);
    expect(limpo).not.toMatch(/create role/i);
  });

  it('o sentido da reversão fica escrito', () => {
    expect(prosa(rollback)).toContain(
      'melhor recusar a validação do que validar sem checar as palavras'
    );
  });
});
