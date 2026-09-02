import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSqlFixture } from '../helpers/sqlFixture';

/**
 * As migrations de cartão precisam bastar a si mesmas.
 *
 * Elas foram desenvolvidas aplicando passos direto no banco de staging via MCP.
 * Funcionou — staging tinha os objetos, as RPCs os usavam, os testes passavam —
 * e dois deles nunca viraram arquivo:
 *
 *   — a tabela `credit_card_reconciliation_resolution_reversals`;
 *   — a coluna `idempotency_key` em `credit_card_reconciliation_resolutions`.
 *
 * O repositório não sabia criá-los. Só o preflight de produção percebeu, porque
 * produção é o primeiro banco que conhece exclusivamente os arquivos. Um ensaio
 * em ambiente limpo confirmou: sem essas duas peças, a última migration falha
 * ao indexar uma coluna inexistente.
 *
 * Este teste é a rede que faltava. Ele não substitui o ensaio — nada substitui
 * executar as migrations num banco limpo — mas pega a classe inteira do erro
 * antes disso: um objeto usado e nunca criado.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const dir = join(currentDir, '../../supabase/migrations');

/** As migrations do trabalho de cartão, na ordem em que rodam. */
const ARQUIVOS = [
  '20260901120000_card_reconciliation_expand.sql',
  '20260901180000_card_resolution_taxonomy.sql',
  '20260901190000_card_reconciliation_reversals.sql',
  '20260902090000_card_reconciliation_revisions.sql',
  '20260902150000_card_reconciliation_snapshot_rpc.sql',
];

const conteudo = ARQUIVOS.map((f) => readSqlFixture(join(dir, f)));
const tudo = conteudo.join('\n');

const semComentarios = tudo
  .replace(/--[^\r\n]*/g, '')
  .replace(/comment\s+on\s+[\s\S]*?';/gi, '');

describe('cada arquivo roda inteiro ou não roda', () => {
  it('todas abrem e fecham transação', () => {
    for (const [i, sql] of conteudo.entries()) {
      expect(sql.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1], ARQUIVOS[i]).toBe('begin');
      expect(sql.trimEnd().endsWith('commit;'), ARQUIVOS[i]).toBe(true);
    }
  });
});

describe('nada é usado sem ser criado', () => {
  /**
   * As duas tabelas do fluxo. `resolutions` nasce na expand; `reversals` tem
   * migration própria, escrita depois de o preflight mostrar que ela não
   * existia em arquivo nenhum.
   */
  it('as tabelas do fluxo são criadas por alguma migration', () => {
    for (const tabela of [
      'credit_card_reconciliation_resolutions',
      'credit_card_reconciliation_resolution_reversals',
    ]) {
      expect(
        semComentarios,
        `${tabela} é usada mas nenhuma migration a cria`
      ).toMatch(new RegExp(`create table if not exists public\\.${tabela}`));
    }
  });

  /**
   * REGRESSÃO. A `snapshot_rpc` indexa `(user_id, idempotency_key)`. A coluna
   * vinha de um passo aplicado direto no banco; num banco limpo, o índice
   * falhava.
   */
  it('idempotency_key é criada antes de ser indexada', () => {
    const criacao = semComentarios.indexOf(
      'add column if not exists idempotency_key'
    );
    const indice = semComentarios.indexOf(
      'cc_reconciliation_resolutions_idempotency_uidx'
    );

    expect(criacao, 'a coluna idempotency_key nunca é criada').toBeGreaterThan(-1);
    expect(indice).toBeGreaterThan(-1);
    expect(criacao, 'o índice vem antes da coluna que ele indexa').toBeLessThan(indice);
  });

  /**
   * A ordem dos arquivos é a ordem de execução. Uma FK só pode apontar para
   * uma tabela já criada.
   */
  it('a tabela de reversões vem depois da tabela que ela referencia', () => {
    const expand = ARQUIVOS.indexOf('20260901120000_card_reconciliation_expand.sql');
    const reversals = ARQUIVOS.indexOf('20260901190000_card_reconciliation_reversals.sql');
    expect(reversals).toBeGreaterThan(expand);
  });

  /** O gatilho sobre reversões exige que a tabela já exista. */
  it('os gatilhos vêm depois das tabelas que observam', () => {
    const reversals = ARQUIVOS.indexOf('20260901190000_card_reconciliation_reversals.sql');
    const revisions = ARQUIVOS.indexOf('20260902090000_card_reconciliation_revisions.sql');
    expect(revisions).toBeGreaterThan(reversals);
  });
});

describe('o que as migrations exigem de fora', () => {
  /**
   * Dependências externas legítimas — objetos de sprints anteriores, já
   * presentes em produção. Se esta lista crescer, alguém acrescentou uma
   * dependência nova, e ela precisa ser conferida contra produção antes de
   * promover.
   */
  const EXTERNOS_ESPERADOS = [
    'public.contas',
    'public.credit_card_competence_payment_confirmations',
    'public.credit_card_import_lots',
    'public.credit_card_statements',
    'public.handle_updated_at',
    'public.has_family_access',
    'public.import_logs',
    'public.transactions',
  ];

  it('a lista de dependências externas não cresceu sem revisão', () => {
    const criados = new Set(
      [...tudo.matchAll(/create table if not exists (public\.[a-z_]+)/g)].map((m) => m[1])
    );
    // As funções `finelo_*_v1` são criadas por estas mesmas migrations.
    const referenciados = new Set(
      [...semComentarios.matchAll(/public\.[a-z_]+/g)]
        .map((m) => m[0])
        .filter((n) => !criados.has(n))
        .filter((n) => !n.startsWith('public.finelo_'))
    );

    expect([...referenciados].sort()).toEqual(EXTERNOS_ESPERADOS);
  });
});
