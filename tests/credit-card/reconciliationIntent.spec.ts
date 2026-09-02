import { describe, expect, it } from 'vitest';
import {
  abrirIntencao,
  aplicarResultado,
  iniciarEnvio,
  podeEnviar,
  precisaRecarregar,
  type ResultadoTentativa,
} from '../../src/domain/credit-card/reconciliationIntent';
import {
  resolutionOptionsForDelta,
  visibleResolutionOptionsForDelta,
} from '../../src/domain/credit-card/reconciliationResolutionOptions';

/**
 * A regra que impede uma resolução duplicada.
 *
 * O caso é real e foi medido na validação do 4B1: duas resoluções concorrentes
 * sobre a mesma competência fizeram uma responder em 3 segundos e a outra levar
 * mais de dois minutos, devolvendo timeout ao cliente DEPOIS de gravar. O retry
 * com a mesma chave voltou como `idempotent_replay`, apontando para a linha que
 * já existia.
 *
 * Se a interface gerasse uma chave nova nesse retry, seriam duas resoluções —
 * dinheiro duplicado por um problema de transporte.
 */

let n = 0;
const chave = () => `k-${++n}`;

describe('uma chave por intenção', () => {
  it('a chave nasce uma vez', () => {
    n = 0;
    const i = abrirIntencao(chave);
    expect(i.idempotencyKey).toBe('k-1');
    expect(iniciarEnvio(i).idempotencyKey).toBe('k-1');
  });

  it('enviar não troca a chave', () => {
    n = 0;
    let i = abrirIntencao(chave);
    const original = i.idempotencyKey;
    i = iniciarEnvio(i);
    i = aplicarResultado(i, { status: 'recusada', motivo: 'x' });
    i = iniciarEnvio(i);
    expect(i.idempotencyKey).toBe(original);
  });
});

describe('o clique repetido não envia de novo', () => {
  it('durante o envio nada mais sai', () => {
    const i = iniciarEnvio(abrirIntencao(chave));
    expect(podeEnviar(i)).toBe(false);
  });

  it('depois de confirmada, nada mais sai', () => {
    const i = aplicarResultado(iniciarEnvio(abrirIntencao(chave)), {
      status: 'confirmada',
      replay: false,
    });
    expect(podeEnviar(i)).toBe(false);
    expect(i.concluida).toBe(true);
  });

  it('depois de recusada, pode tentar de novo — com a MESMA chave', () => {
    n = 0;
    const i = aplicarResultado(iniciarEnvio(abrirIntencao(chave)), {
      status: 'recusada',
      motivo: 'porção excede o restante',
    });
    expect(podeEnviar(i)).toBe(true);
    expect(i.idempotencyKey).toBe('k-1');
    expect(i.aviso).toContain('excede');
  });
});

describe('a resposta perdida é o caso perigoso', () => {
  const perdida: ResultadoTentativa = { status: 'indeterminada', motivo: 'timeout' };

  /** Ela pode ter gravado. Descartar a chave criaria a segunda linha. */
  it('mantém a chave', () => {
    n = 0;
    const i = aplicarResultado(iniciarEnvio(abrirIntencao(chave)), perdida);
    expect(i.idempotencyKey).toBe('k-1');
    expect(podeEnviar(i)).toBe(true);
  });

  it('não conclui a intenção', () => {
    const i = aplicarResultado(iniciarEnvio(abrirIntencao(chave)), perdida);
    expect(i.concluida).toBe(false);
  });

  it('obriga a reconferir o estado no servidor', () => {
    expect(precisaRecarregar(perdida)).toBe(true);
    expect(precisaRecarregar({ status: 'recusada', motivo: 'x' })).toBe(false);
    expect(precisaRecarregar({ status: 'confirmada', replay: false })).toBe(false);
  });

  /** Uma sequência inteira sob timeout ainda usa uma única chave. */
  it('três tentativas seguidas usam a mesma chave', () => {
    n = 0;
    let i = abrirIntencao(chave);
    const chaves: string[] = [];
    for (let t = 0; t < 3; t++) {
      i = iniciarEnvio(i);
      chaves.push(i.idempotencyKey);
      i = aplicarResultado(i, perdida);
    }
    expect(new Set(chaves).size).toBe(1);
  });
});

describe('o que a tela diz', () => {
  it('replay é apresentado como já registrada, não como sucesso novo', () => {
    const i = aplicarResultado(iniciarEnvio(abrirIntencao(chave)), {
      status: 'confirmada',
      replay: true,
    });
    expect(i.aviso).toContain('já estava registrada');
    expect(i.aviso).toContain('Nada foi duplicado');
  });

  it('gravação nova é apresentada como registrada', () => {
    const i = aplicarResultado(iniciarEnvio(abrirIntencao(chave)), {
      status: 'confirmada',
      replay: false,
    });
    expect(i.aviso).toBe('Resolução registrada.');
  });
});

// ---------------------------------------------------------------------------

describe('as opções que a interface mostra', () => {
  const c = (reais: number) => Math.round(reais * 100);

  it('só crédito, ajuste e valor oficial', () => {
    expect(visibleResolutionOptionsForDelta(c(0.22)).map((o) => o.kind)).toEqual([
      'economic_credit',
      'bank_adjustment',
      'authoritative_total',
    ]);
  });

  it('encerrar sem classificar e cobrança real ficam fora', () => {
    for (const delta of [c(0.22), c(-0.22)]) {
      const kinds = visibleResolutionOptionsForDelta(delta).map((o) => o.kind);
      expect(kinds).not.toContain('reconciliation_write_off');
      expect(kinds).not.toContain('economic_debt');
    }
  });

  /** Sair da UI não é sair do domínio: o banco e o núcleo continuam aceitando. */
  it('o domínio segue oferecendo as cinco', () => {
    const completo = resolutionOptionsForDelta(c(0.22)).map((o) => o.kind);
    expect(completo).toContain('reconciliation_write_off');
    expect(resolutionOptionsForDelta(c(-0.22)).map((o) => o.kind)).toContain('economic_debt');
  });

  it('diferença zero não oferece nada', () => {
    expect(visibleResolutionOptionsForDelta(0)).toEqual([]);
  });

  /**
   * O texto do ajuste não pode prometer que o limite fica igual: quando aquele
   * valor cobria o déficit de outra competência, o déficit descoberto vira
   * obrigação econômica.
   */
  it('o ajuste avisa que outra diferença pode reaparecer', () => {
    const ajuste = visibleResolutionOptionsForDelta(c(0.22)).find(
      (o) => o.kind === 'bank_adjustment'
    )!;
    expect(ajuste.consequence).toMatch(/não vira crédito/i);
    expect(ajuste.consequence).toMatch(/reaparece/i);
    expect(ajuste.consequence).not.toMatch(/limite disponível não muda/);
  });

  it('o crédito avisa que abate as próximas faturas', () => {
    const credito = visibleResolutionOptionsForDelta(c(0.22)).find(
      (o) => o.kind === 'economic_credit'
    )!;
    expect(credito.consequence).toMatch(/abatem as próximas faturas/i);
    expect(credito.movesEconomicLedger).toBe(true);
  });

  it('o valor oficial exige valor e procedência', () => {
    const oficial = visibleResolutionOptionsForDelta(c(0.22)).find(
      (o) => o.kind === 'authoritative_total'
    )!;
    expect(oficial.requiresAuthoritativeTotal).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('o card projeta com as mesmas entradas do servidor', () => {
  /**
   * REGRESSÃO da validação visual do 4B2. A resolução era gravada, o servidor
   * recalculava certo, e o card seguia mostrando «A CONCILIAR» depois do
   * reload: `computeAccountCardDisplay` chamava a projeção sem as resoluções.
   *
   * O teste é sobre a FORMA do contrato — que a opção existe e chega à
   * projeção — porque o efeito financeiro em si já está coberto em
   * `resolutionsClearDelta`.
   */
  it('a opção de resoluções existe e é repassada à projeção', async () => {
    const fonte = await import('node:fs').then((fs) =>
      fs.readFileSync('src/components/transactions/accountBalanceCardMetrics.ts', 'utf8')
    );

    expect(fonte).toMatch(/reconciliationResolutions\?: Record<string, ReconciliationResolutionInput\[\]>/);
    expect(fonte).toMatch(/resolutionsByMonth: reconciliationResolutions/);
  });

  /**
   * Resolvida a diferença, o selo some — e o acesso precisa continuar, senão o
   * usuário fica sem caminho para DESFAZER.
   */
  it('o acesso ao fluxo sobrevive à resolução', async () => {
    const fonte = await import('node:fs').then((fs) =>
      fs.readFileSync('src/components/transactions/AccountBalanceCard.tsx', 'utf8')
    );

    const condicoes = fonte.match(
      /\(reconciliacaoPendente \|\| reconciliacaoResolvida\) && reconciliacaoReferenceMonth && onOpenReconciliation/g
    );
    // As DUAS ramificações de layout. Uma validação anterior encontrou o selo
    // presente em apenas uma delas.
    expect(condicoes?.length).toBe(2);
  });
});
