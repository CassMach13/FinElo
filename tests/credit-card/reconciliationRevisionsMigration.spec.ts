import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSqlFixture } from '../helpers/sqlFixture';

/**
 * Contadores de revisão: o contrato de dependências, amarrado.
 *
 * `revision` precisa significar «alguma entrada capaz de alterar o resultado
 * financeiro mudou», e não «alguma coisa relacionada a esta conta mudou». Esse
 * significado só se sustenta se a lista de campos vigiados continuar igual à
 * lista de campos que o núcleo puro realmente lê.
 *
 * Estes testes prendem as duas pontas: se alguém acrescentar uma dependência no
 * domínio sem estendê-la aqui, ou o contrário, o teste quebra.
 *
 * O comportamento em si — quem incrementa o quê — foi medido em staging com
 * uma sonda de doze cenários. O que estes testes protegem é a ESTRUTURA que
 * produziu aquele comportamento.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const migration = readSqlFixture(
  join(currentDir, '../../supabase/migrations/20260902090000_card_reconciliation_revisions.sql')
);
const rollback = readSqlFixture(
  join(currentDir, '../../supabase/rollbacks/20260902090000_card_reconciliation_revisions_down.sql')
);

const semComentarios = (sql: string) =>
  sql
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/comment\s+on\s+[\s\S]*?';/gi, '');

/** O corpo de um `create trigger`, do nome até o `;` final. */
function trigger(nome: string): string {
  const inicio = migration.indexOf(`create trigger ${nome}`);
  expect(inicio, `gatilho ${nome} não existe`).toBeGreaterThan(-1);
  const fim = migration.indexOf(';', inicio);
  return migration.slice(inicio, fim);
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

describe('contrato de dependências — contas', () => {
  /**
   * `dia_vencimento` é o único campo de `contas` cujo efeito fica confinado à
   * própria conta. Ele entra em `account_revision` e em mais nada.
   */
  it('dia_vencimento invalida a conta e só a conta', () => {
    expect(migration).toMatch(
      /if old\.dia_vencimento is distinct from new\.dia_vencimento then\s*\n\s*perform finelo_reconciliation_internal\.bump_account_revision/
    );
  });

  /**
   * `Nome_Conta` alimenta o score que decide a QUAL conta um arquivo pertence.
   * O score é avaliado sobre todas as contas de cartão do usuário, então
   * renomear uma conta pode mudar o resultado de OUTRA — é contexto, não conta.
   */
  it('Nome_Conta invalida contexto, nunca a conta isoladamente', () => {
    expect(migration).toMatch(
      /elsif old\."Nome_Conta" is distinct from new\."Nome_Conta"[\s\S]{0,120}?bump_user_context_revision/
    );
    expect(migration).not.toMatch(
      /old\."Nome_Conta" is distinct from new\."Nome_Conta"[\s\S]{0,120}?bump_account_revision/
    );
  });

  it('Tipo_Conta invalida os dois: muda o cálculo próprio e o conjunto de candidatas', () => {
    expect(migration).toMatch(
      /if old\."Tipo_Conta" is distinct from new\."Tipo_Conta" then\s*\n\s*perform finelo_reconciliation_internal\.bump_account_revision[\s\S]{0,120}?bump_user_context_revision/
    );
  });

  /**
   * Só as três colunas do contrato acordam o gatilho. A asserção é sobre o
   * CONJUNTO, não sobre a ordem: reordenar a lista no `update of` não muda
   * nada, e um teste sensível à ordem quebraria por motivo errado.
   */
  it('o gatilho de contas escuta exatamente as colunas do contrato', () => {
    const corpo = trigger('trg_contas_reconciliation_revision');
    const colunas = corpo
      .match(/after update of ([^\n]+)/)?.[1]
      .split(',')
      .map((c) => c.trim().replace(/"/g, ''))
      .sort();

    expect(colunas).toEqual(['Nome_Conta', 'Tipo_Conta', 'dia_vencimento']);
    for (const fora of ['dia_fechamento', 'limite_credito', 'Saldo_Inicial', 'Data_Saldo_Inicial']) {
      expect(corpo).not.toContain(fora);
    }
  });

  it('criar ou apagar conta de cartão muda o universo do score', () => {
    const corpo = trigger('trg_contas_lifecycle_reconciliation_revision');
    expect(corpo).toContain('after insert or delete on public.contas');
    expect(migration).toMatch(/if old\."Tipo_Conta" = 'Cartão de Crédito' then\s*\n\s*perform finelo_reconciliation_internal\.bump_user_context_revision/);
  });
});

describe('contrato de dependências — transactions', () => {
  const consumidos = [
    'ID_Conta',
    'Origem',
    'Tipo',
    'Descricao_Original',
    'Valor',
    'Nome_Fantasia',
    'Data',
    'Categoria',
    'Data_Pagamento',
    'Total_Parcelas',
  ];

  it('todas as colunas consumidas pelo núcleo acordam o gatilho', () => {
    const corpo = trigger('trg_transactions_reconciliation_revision');
    for (const coluna of consumidos) {
      expect(corpo, `coluna ${coluna} fora do gatilho`).toContain(`"${coluna}"`);
    }
  });

  /**
   * `Parcela_Atual` e `Portador` aparecem em `atomicRebuildShadow`, que o núcleo
   * puro não importa. `Fonte`, `pluggy_transaction_id` e `linked_asset_id` não
   * aparecem em lugar nenhum do grafo. Nenhum dos cinco pode invalidar.
   */
  it('colunas fora do grafo do núcleo não acordam o gatilho', () => {
    const corpo = trigger('trg_transactions_reconciliation_revision');
    for (const coluna of ['Parcela_Atual', 'Fonte', 'Portador', 'pluggy_transaction_id', 'linked_asset_id']) {
      expect(corpo, `coluna ${coluna} invalidaria sem motivo`).not.toContain(coluna);
    }
  });

  /** Mover uma transação de conta muda o resultado das DUAS. */
  it('trocar de conta invalida origem e destino', () => {
    expect(migration).toMatch(
      /if tg_op = 'UPDATE' and old\."ID_Conta" is distinct from new\."ID_Conta" then\s*\n\s*perform finelo_reconciliation_internal\.bump_account_revision\(old\.user_id, old\."ID_Conta"\)/
    );
  });
});

describe('contrato de dependências — import_logs', () => {
  /**
   * `import_logs` não tem `account_id`. A atribuição a uma conta é uma cascata
   * de três níveis, e reproduzi-la em SQL criaria um terceiro lugar onde o
   * domínio mora. O escopo user-wide é a escolha segura, e está escrito.
   */
  it('o escopo é user-wide, com o motivo registrado', () => {
    expect(migration).toMatch(/import_logs.*NÃO tem coluna account_id/is);
    expect(migration).toMatch(/Invalidar todas as contas do usuário é a escolha segura/);
  });

  it('só os três campos consumidos disparam UPDATE', () => {
    const corpo = trigger('trg_import_logs_update_reconciliation_revision');
    expect(corpo).toContain('after update of file_name, import_date, imported_details');
    for (const fora of ['total_transactions', 'imported_count', 'ignored_count', 'ignored_details']) {
      expect(corpo).not.toContain(fora);
    }
  });

  /** A cláusula WHEN só enxerga OLD/NEW; separar os gatilhos foi obrigatório. */
  it('INSERT/DELETE e UPDATE são gatilhos separados', () => {
    expect(trigger('trg_import_logs_reconciliation_revision')).toContain(
      'after insert or delete on public.import_logs'
    );
    expect(semComentarios(migration)).not.toMatch(/when \([^)]*tg_op/i);
  });
});

describe('mapping_rules não é entrada do ledger', () => {
  it('nenhum gatilho é instalado sobre mapping_rules', () => {
    expect(semComentarios(migration)).not.toMatch(/on public\.mapping_rules/i);
  });

  it('o motivo fica registrado, para ninguém "consertar" isso depois', () => {
    expect(migration).toMatch(/`mapping_rules` NÃO invalida\. Buscado: zero referências/);
    expect(migration).toMatch(/materializado em `transactions`/);
  });
});

describe('identidade vem sempre da própria linha', () => {
  /**
   * REGRESSÃO. A primeira versão do gatilho de `credit_card_statements` derivava
   * `user_id` com um `select` em `public.contas`. `contas` tem RLS, o dono da
   * função é `nobypassrls` e dentro do gatilho não existe `auth.uid()`: o select
   * devolvia zero linhas, o `user_id` virava NULL e o incremento era descartado
   * — sem erro nenhum. O snapshot ficava stale justamente quando o total OFICIAL
   * da fatura mudava. A sonda em staging mediu 0 onde esperava +1.
   */
  it('nenhuma função de gatilho lê outra tabela para descobrir o usuário', () => {
    expect(semComentarios(migration)).not.toMatch(/\b(from|join)\s+public\./i);
  });

  it('o gatilho do total autoritativo usa new.user_id', () => {
    expect(migration).toMatch(
      /\$tg_stmt\$\s*begin\s*perform finelo_reconciliation_internal\.bump_account_revision\(new\.user_id, new\.account_id\)/
    );
  });

  it('o executor não recebe SELECT em nenhuma tabela de negócio', () => {
    expect(semComentarios(migration)).not.toMatch(
      /grant\s+[^;]*select[^;]*\bon\s+public\.[a-z_]+\s+to\s+finelo_reconciliation_executor/i
    );
  });

  it('a armadilha fica documentada no arquivo', () => {
    expect(migration).toMatch(/falha em SILENCIO/i);
    expect(migration).toMatch(/transforma falta de privilegio em ausencia de invalidacao/i);
  });
});

describe('o total autoritativo é vigiado', () => {
  it('mudar o total oficial invalida a conta', () => {
    const corpo = trigger('trg_statement_authoritative_revision');
    expect(corpo).toContain('after update of authoritative_statement_total, authoritative_source');
    expect(corpo).toMatch(
      /old\.authoritative_statement_total is distinct from new\.authoritative_statement_total/
    );
  });
});

describe('regravar o mesmo valor não invalida nada', () => {
  /**
   * `UPDATE OF` diz quais colunas ACORDAM o gatilho; só `IS DISTINCT FROM`
   * impede o incremento quando o UPDATE regravou o valor que já estava lá.
   * Sem ele, um `save` de formulário inflaria as revisões e todo snapshot
   * morreria a cada salvamento.
   */
  it('todo gatilho de UPDATE compara OLD com NEW', () => {
    for (const nome of [
      'trg_contas_reconciliation_revision',
      'trg_import_logs_update_reconciliation_revision',
      'trg_statement_authoritative_revision',
    ]) {
      const corpo = trigger(nome);
      const temWhen = /when \(/.test(corpo);
      const funcao = nome === 'trg_contas_reconciliation_revision';
      expect(temWhen || funcao, `${nome} não compara OLD com NEW`).toBe(true);
    }
    expect(migration).toMatch(/is distinct from/);
  });
});

describe('privacidade dos contadores', () => {
  it('vivem em schema privado, fora do alcance do cliente', () => {
    expect(migration).toContain('create schema if not exists finelo_reconciliation_internal');
    expect(migration).toMatch(
      /revoke all on schema finelo_reconciliation_internal\s*\n\s*from public, anon, authenticated, service_role/
    );
    for (const tabela of ['account_revisions', 'user_context_revisions']) {
      expect(migration).toMatch(
        new RegExp(`revoke all on finelo_reconciliation_internal\\.${tabela}\\s*\\n\\s*from public, anon, authenticated, service_role`)
      );
    }
  });

  it('o papel dedicado não loga, não herda e não ignora RLS', () => {
    expect(migration).toMatch(
      /alter role finelo_reconciliation_executor\s*\n\s*nologin noinherit nobypassrls connection limit 0/
    );
  });

  it('toda função fixa o search_path', () => {
    const funcoes = migration.match(/create or replace function/g)?.length ?? 0;
    const fixados = migration.match(/set search_path = ''/g)?.length ?? 0;
    expect(funcoes).toBeGreaterThan(0);
    expect(fixados).toBe(funcoes);
  });

  it('a posse passa ao executor e o privilégio de criar é devolvido', () => {
    expect(migration).toContain('grant create on schema finelo_reconciliation_internal to finelo_reconciliation_executor');
    expect(migration).toContain('revoke create on schema finelo_reconciliation_internal from finelo_reconciliation_executor');
    expect(migration).toContain('revoke finelo_reconciliation_executor from postgres');
  });
});

describe('nenhum efeito financeiro', () => {
  it('a migração não escreve em tabela de negócio', () => {
    const limpo = semComentarios(migration);
    expect(limpo).not.toMatch(/\bupdate\s+public\./i);
    expect(limpo).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(limpo).not.toMatch(/\bdelete\s+from\s+public\./i);
  });

  it('não instala gatilho em auth.users', () => {
    expect(semComentarios(migration)).not.toMatch(/on\s+auth\.users/i);
  });

  it('a decisão sobre auth.users e a dívida ficam registradas', () => {
    expect(migration).toMatch(/DESCARTADO/);
    expect(migration).toMatch(/metadata_context/);
    expect(migration).toMatch(/Divida: mover essas duas configuracoes/);
  });
});

describe('rollback', () => {
  it('remove os gatilhos antes das funções', () => {
    const primeiroTrigger = rollback.indexOf('drop trigger');
    const primeiraFuncao = rollback.indexOf('drop function');
    expect(primeiroTrigger).toBeGreaterThan(-1);
    expect(primeiraFuncao).toBeGreaterThan(primeiroTrigger);
  });

  it('derruba todos os gatilhos instalados', () => {
    const instalados = [...migration.matchAll(/create trigger (\w+)/g)].map((m) => m[1]);
    expect(instalados.length).toBeGreaterThan(0);
    for (const nome of instalados) {
      expect(rollback, `gatilho ${nome} sobreviveria ao rollback`).toContain(`drop trigger if exists ${nome}`);
    }
  });

  it('não toca em dado financeiro', () => {
    const limpo = semComentarios(rollback);
    expect(limpo).not.toMatch(/\bdelete\s+from\s+public\./i);
    expect(limpo).not.toMatch(/\bupdate\s+public\./i);
    expect(limpo).not.toMatch(/drop\s+table\s+(if exists\s+)?public\./i);
  });

  /** Reverter pode causar recálculo desnecessário, nunca aceitar um stale. */
  it('o sentido seguro da perda fica escrito', () => {
    expect(rollback).toMatch(/recomeçam do zero/);
    expect(rollback).toMatch(/recálculo desnecessário, nunca um snapshot stale aceito como\s*\n--\s*válido/);
  });
});
