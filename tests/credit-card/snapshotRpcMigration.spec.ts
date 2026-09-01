import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSqlFixture } from '../helpers/sqlFixture';

/**
 * O snapshot verificado pelo servidor, e as RPCs que agem sobre ele.
 *
 * A promessa central: o VALOR que uma resolução move nunca vem do navegador. O
 * cliente diz o que a diferença significa; quanto ela vale sai do snapshot que
 * o servidor calculou. Um cliente manipulado pode escolher a classificação
 * errada — pode mentir sobre o significado — mas não consegue fabricar um
 * número.
 *
 * Dezessete cenários foram medidos em staging: revisão observada errada,
 * resolver sem snapshot, metadata e domain_version divergentes, porção maior
 * que a diferença, parcial válida, retry idempotente, segunda resolução sem
 * recalcular, porção acima do restante, restante inteiro, reversão, reversão
 * dupla, retry de reversão, stale por mudança real de entrada, e total oficial
 * com e sem procedência. Este arquivo prende a estrutura que os produziu.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const migration = readSqlFixture(
  join(currentDir, '../../supabase/migrations/20260902150000_card_reconciliation_snapshot_rpc.sql')
);

const prosa = (sql: string) =>
  sql
    .split(/\r?\n/)
    .map((linha) => linha.replace(/^\s*--\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

const semComentarios = (sql: string) =>
  sql
    .replace(/--[^\r\n]*/g, '')
    .replace(/comment\s+on\s+[\s\S]*?';/gi, '');

function corpo(delimitador: string): string {
  const marca = `$${delimitador}$`;
  const inicio = migration.indexOf(marca);
  const fim = migration.indexOf(marca, inicio + marca.length);
  expect(inicio, `função ${delimitador} não existe`).toBeGreaterThan(-1);
  return migration.slice(inicio + marca.length, fim);
}

/** A lista de parâmetros de uma função, do `(` até o `)` que fecha. */
function assinatura(nome: string): string {
  const inicio = migration.indexOf(`create or replace function public.${nome}(`);
  expect(inicio, `função ${nome} não existe`).toBeGreaterThan(-1);
  const abre = migration.indexOf('(', inicio);
  return migration.slice(abre, migration.indexOf('returns', abre));
}

// ---------------------------------------------------------------------------

describe('atomicidade', () => {
  it('a migração roda inteira dentro de uma transação', () => {
    expect(migration.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
    expect(migration.trimEnd().endsWith('commit;')).toBe(true);
  });
});

describe('o navegador não é autoridade sobre o número', () => {
  /**
   * REGRESSÃO da versão descartada, em que o cliente asseverava o delta. Nenhum
   * parâmetro pode carregar o valor, o sinal ou a existência da diferença.
   */
  it('a RPC de resolução não aceita delta nem sinal', () => {
    const params = assinatura('finelo_resolve_reconciliation_v1');
    for (const proibido of ['p_delta', 'p_sign', 'p_signal', 'p_sinal', 'p_reconciliation_delta']) {
      expect(params, `parâmetro ${proibido} devolveria a autoridade ao cliente`).not.toContain(proibido);
    }
  });

  it('o valor vem do snapshot', () => {
    const c = corpo('resolve');
    expect(c).toMatch(/v_restante_cents := v_snap\.delta_cents;/);
    expect(c).toMatch(/from finelo_reconciliation_internal\.reconciliation_snapshots s/);
  });

  /** A porção parcial é valor ABSOLUTO; o sinal é imposto pelo snapshot. */
  it('o sinal da porção é imposto pelo restante, não escolhido', () => {
    const c = corpo('resolve');
    expect(c).toMatch(/pg_catalog\.abs\(p_portion_cents\)/);
    expect(c).toMatch(/v_porcao_cents := pg_catalog\.sign\(v_restante_cents\)::bigint \* v_porcao_cents/);
  });

  it('resolver sem snapshot é recusado', () => {
    expect(corpo('resolve')).toMatch(/sem snapshot para[\s\S]{0,140}errcode = '55000'/);
  });

  it('a identidade vem da conta, nunca do chamador', () => {
    for (const f of ['resolve', 'write_snap']) {
      expect(corpo(f)).toMatch(/select c\.user_id into v_user_id from public\.contas c where c\.id = p_account_id/);
    }
    for (const nome of ['finelo_resolve_reconciliation_v1', 'finelo_write_reconciliation_snapshot_v1']) {
      expect(assinatura(nome)).not.toContain('p_user_id');
    }
  });
});

describe('o snapshot já é o restante', () => {
  /**
   * REGRESSÃO. O núcleo devolve `unresolvedReconciliationDeltaCents`, líquido
   * das resoluções já gravadas. Uma versão anterior subtraía o já resolvido
   * outra vez: com delta bruto 2200 e 800 resolvidos, o snapshot vale 1400 e a
   * conta dava 600 de espaço — o usuário ficava impedido de fechar a própria
   * divergência.
   */
  it('não subtrai de novo o que já foi resolvido', () => {
    const c = corpo('resolve');
    expect(c).not.toMatch(/v_ja_resolvido/);
    expect(c).not.toMatch(/sum\(\s*pg_catalog\.round\(r\.resolved_amount/);
  });

  it('o motivo fica escrito', () => {
    expect(prosa(migration)).toContain('subtrair de novo aqui contaria em dobro');
  });
});

describe('duas ações concorrentes não resolvem mais do que existe', () => {
  it('a competência inteira é serializada', () => {
    expect(corpo('resolve')).toMatch(
      /pg_advisory_xact_lock\(\s*\n?\s*pg_catalog\.hashtextextended\(v_user_id::text \|\| '\|' \|\| p_account_id::text \|\| '\|' \|\| p_reference_month/
    );
  });

  /** A segunda encontra o contador já incrementado pela primeira. */
  it('a proteção é o contador, e isso fica escrito', () => {
    expect(prosa(migration)).toContain('incrementa `account_revision`');
    expect(corpo('resolve')).toMatch(
      /v_snap\.account_revision <> v_acc\s*\n\s*or v_snap\.user_context_revision <> v_ctx/
    );
  });

  it('porção acima do restante é recusada', () => {
    expect(corpo('resolve')).toMatch(
      /v_porcao_cents > pg_catalog\.abs\(v_restante_cents\)[\s\S]{0,200}errcode = '22003'/
    );
  });
});

describe('idempotência', () => {
  it('a chave é obrigatória nas duas RPCs de escrita', () => {
    for (const f of ['resolve', 'reverse']) {
      expect(corpo(f)).toMatch(/p_idempotency_key is null or pg_catalog\.btrim\(p_idempotency_key\) = ''/);
    }
  });

  /**
   * A verificação vem ANTES da checagem de stale: um retry da mesma intenção
   * tem de devolver o mesmo resultado mesmo que o mundo tenha andado. Tratá-lo
   * como stale faria o cliente tentar de novo, e a tentativa seguinte
   * duplicaria.
   */
  it('a checagem de idempotência precede a de stale', () => {
    const c = corpo('resolve');
    // A BUSCA pela chave, não só a palavra `idempotent_replay`: apagar a busca
    // e deixar o `return` deixaria a ordem parecendo certa com a checagem
    // ausente.
    const posBusca = c.search(/where r\.user_id = v_user_id and r\.idempotency_key = p_idempotency_key/);
    const posSnapshot = c.indexOf('from finelo_reconciliation_internal.reconciliation_snapshots');
    const posStale = c.indexOf('snapshot stale');

    expect(posBusca, 'a busca pela chave de idempotência sumiu').toBeGreaterThan(-1);
    expect(posSnapshot).toBeGreaterThan(posBusca);
    expect(posStale).toBeGreaterThan(posBusca);
  });

  /** A leitura prévia reduz a corrida; quem a elimina é o índice único. */
  it('o índice único é o que realmente impede a duplicação', () => {
    expect(migration).toMatch(
      /create unique index if not exists cc_reconciliation_resolutions_idempotency_uidx\s*\n\s*on public\.credit_card_reconciliation_resolutions \(user_id, idempotency_key\)/
    );
    expect(migration).toMatch(
      /create unique index if not exists cc_reconciliation_reversals_idempotency_uidx/
    );
  });
});

describe('stale detection', () => {
  it('os quatro valores são comparados', () => {
    const c = corpo('resolve');
    for (const campo of ['account_revision', 'user_context_revision', 'metadata_context', 'domain_version']) {
      expect(c, `${campo} não é comparado`).toContain(`v_snap.${campo}`);
    }
  });

  /**
   * R0 == R1 == ATUAL. A Edge confirma R0 == R1 antes de chamar; esta função
   * confirma que o valor ainda é o atual no commit. Sem a terceira comparação,
   * uma escrita entre a segunda leitura da Edge e o commit passaria batido.
   */
  it('gravar o snapshot confirma que a revisão observada ainda é a atual', () => {
    expect(corpo('write_snap')).toMatch(
      /v_acc <> p_observed_account_revision or v_ctx <> p_observed_user_context_revision[\s\S]{0,300}errcode = '40001'/
    );
    expect(prosa(migration)).toContain('PROTOCOLO R0 == R1 == ATUAL');
  });

  it('snapshot sem metadata ou domain_version é recusado na gravação', () => {
    expect(corpo('write_snap')).toMatch(
      /p_metadata_context is null or p_domain_version is null[\s\S]{0,200}errcode = '22004'/
    );
  });
});

describe('total oficial', () => {
  it('exige valor e procedência', () => {
    expect(corpo('resolve')).toMatch(
      /p_authoritative_total_cents is null or p_authoritative_source is null[\s\S]{0,180}errcode = '22004'/
    );
  });

  it('não consome porção alguma', () => {
    const c = corpo('resolve');
    const bloco = c.slice(c.indexOf("if p_resolution = 'authoritative_total'"), c.indexOf('v_porcao_cents :='));
    expect(bloco).toContain('resolved_amount');
    expect(bloco).toMatch(/'resolved_amount', null/);
  });
});

describe('reversão auditável', () => {
  /** Um DELETE apagaria a evidência de que a afirmação existiu. */
  it('reverter acrescenta linha, nunca apaga', () => {
    const c = corpo('reverse');
    expect(c).toMatch(/insert into public\.credit_card_reconciliation_resolution_reversals/);
    expect(c).not.toMatch(/\bdelete\b/i);
    expect(c).not.toMatch(/\bupdate\b/i);
  });

  it('a mesma resolução não pode ser revertida duas vezes', () => {
    expect(corpo('reverse')).toMatch(/ja foi revertida/);
    expect(migration).toMatch(
      /create unique index if not exists cc_reconciliation_reversals_resolution_uidx\s*\n\s*on public\.credit_card_reconciliation_resolution_reversals \(resolution_id\)/
    );
  });
});

describe('só a Edge alcança estas funções', () => {
  it('EXECUTE é revogado do cliente e concedido só a service_role', () => {
    for (const nome of [
      'finelo_write_reconciliation_snapshot_v1',
      'finelo_resolve_reconciliation_v1',
      'finelo_reverse_reconciliation_v1',
    ]) {
      const revogou = new RegExp(`revoke all on function public\\.${nome}\\([\\s\\S]{0,120}?from public, anon, authenticated`);
      expect(migration, `${nome} não revoga do cliente`).toMatch(revogou);

      // `to service_role` sozinho casaria com `to service_role, authenticated`,
      // que daria ao navegador caminho direto até a RPC. A lista tem de
      // TERMINAR no service_role.
      const concedeu = new RegExp(
        `grant execute on function public\\.${nome}\\([\\s\\S]{0,120}?to service_role;`
      );
      expect(migration, `${nome} não concede exclusivamente a service_role`).toMatch(concedeu);
    }
  });

  /** Nenhum papel de cliente pode aparecer do lado direito de um `grant execute`. */
  it('nenhum papel de cliente recebe EXECUTE em lugar nenhum', () => {
    const grants = migration.match(/grant execute on function[\s\S]*?;/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      const alvo = g.slice(g.lastIndexOf(' to '));
      for (const papel of ['anon', 'authenticated', 'public']) {
        expect(alvo, `grant concede a ${papel}: ${g}`).not.toMatch(new RegExp(`\\b${papel}\\b`));
      }
    }
  });

  it('o snapshot é privado: o cliente não lê nem escreve', () => {
    expect(migration).toMatch(
      /revoke all on finelo_reconciliation_internal\.reconciliation_snapshots\s*\n\s*from public, anon, authenticated, service_role/
    );
    expect(migration).toMatch(
      /grant select, insert, update on finelo_reconciliation_internal\.reconciliation_snapshots\s*\n\s*to service_role/
    );
  });

  it('toda função fixa search_path e limita o tempo', () => {
    const funcoes = migration.match(/create or replace function public\./g)?.length ?? 0;
    expect(funcoes).toBe(4);
    expect(migration.match(/set search_path = ''/g)?.length).toBe(funcoes);
    expect(migration.match(/set statement_timeout/g)?.length).toBe(funcoes);

    // `lock_timeout` só nas três que escrevem. A leitura de contadores é
    // `stable` e não disputa lock com ninguém.
    expect(migration.match(/set lock_timeout/g)?.length).toBe(3);
  });

  /** A exceção ao padrão SECURITY DEFINER só se sustenta com o motivo escrito. */
  it('a escolha por SECURITY INVOKER fica justificada', () => {
    expect(semComentarios(migration)).not.toMatch(/security definer/i);
    const texto = prosa(migration);
    expect(texto).toContain('um dono `nobypassrls` lê zero linhas');
    expect(texto).toContain('se a chave de serviço vazar, o projeto inteiro já está perdido');
  });
});

describe('centavos, não ponto flutuante', () => {
  it('o snapshot guarda inteiro', () => {
    expect(migration).toMatch(/delta_cents bigint not null/);
  });

  it('a conversão para a coluna monetária é arredondada', () => {
    expect(corpo('resolve')).toMatch(/pg_catalog\.round\(v_porcao_cents \/ 100\.0, 2\)/);
  });
});
