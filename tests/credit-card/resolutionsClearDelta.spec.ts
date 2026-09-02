import { describe, expect, it } from 'vitest';
import {
  projectCardTwoLedger,
  centsToCurrency,
  type CompetenceHistoryLike,
} from '../../src/domain/credit-card/twoLedgerProjection';
import type { ReconciliationResolutionInput } from '../../src/domain/credit-card/twoLedgerBalance';

/**
 * Resolver uma divergência tem de fazê-la SUMIR.
 *
 * Parece óbvio, e não era: a projeção montava a entrada do núcleo sem preencher
 * `resolutions`. O usuário classificaria os R$ 0,22, o banco gravaria a
 * resolução, e «A CONCILIAR» continuaria exibindo o mesmo valor — com o agravante
 * de que o snapshot gravado pelo servidor também ficaria bruto, permitindo
 * resolver a mesma diferença de novo.
 *
 * Estes testes prendem as duas pontas: a diferença some da tela, e some do
 * número que o servidor usa para autorizar a próxima resolução.
 */

const c = (reais: number) => Math.round(reais * 100);
const HOJE = '2026-09-01';

const comp = (
  referenceMonth: string,
  statementTotal: number,
  totalPayments: number
): CompetenceHistoryLike => ({
  referenceMonth,
  competenceBR: referenceMonth,
  dueDate: `${referenceMonth}-10`,
  statementTotal,
  totalPayments,
});

const projetar = (
  cards: CompetenceHistoryLike[],
  resolutionsByMonth?: Record<string, ReconciliationResolutionInput[]>
) => projectCardTwoLedger(cards, { asOf: HOJE, resolutionsByMonth });

const delta = (p: ReturnType<typeof projetar>, mes: string) =>
  p.competences.find((x) => x.referenceMonth === mes)?.unresolvedReconciliationDeltaCents;

// ---------------------------------------------------------------------------

describe('a cadeia real dos R$ 0,22', () => {
  /**
   * 2024-12 paga R$ 0,22 a mais. 2025-02 paga R$ 60,30 a mais. 2025-03 tem
   * déficit bruto de R$ 61,24, que o suspense acumulado de R$ 60,52 compensa,
   * deixando R$ 0,72 de obrigação econômica — quitada pela confirmação manual,
   * que já vem somada em `totalPayments`.
   */
  const cadeia = (): CompetenceHistoryLike[] => [
    comp('2024-12', 6052.63, 6052.85),
    comp('2025-02', 5798.44, 5858.74),
    comp('2025-03', 6777.72, 6717.2),
  ];

  it('sem resolução alguma, a diferença de 2024-12 está lá para ser classificada', () => {
    const p = projetar(cadeia());
    expect(delta(p, '2024-12')).toBe(c(0.22));
  });

  /** Nem dívida fictícia nem crédito fictício: o livro 1 fecha em zero. */
  it('nenhuma competência da cadeia carrega dívida econômica', () => {
    const p = projetar(cadeia());
    for (const comp of p.competences) {
      expect(comp.economicOpenBalanceCents, comp.referenceMonth).toBe(0);
      expect(comp.economicStatus, comp.referenceMonth).toBe('paid');
    }
    expect(p.economicUsedCents).toBe(0);
  });

  it('classificar os R$ 0,22 como crédito real zera a diferença de 2024-12', () => {
    const p = projetar(cadeia(), {
      '2024-12': [{ kind: 'economic_credit', resolvedAmountCents: c(0.22) }],
    });

    expect(delta(p, '2024-12')).toBe(0);
    expect(p.competences.find((x) => x.referenceMonth === '2024-12')?.reconciliationStatus).toBe(
      'resolved'
    );
  });

  /**
   * ATENÇÃO — comportamento que a tela precisa contar direito.
   *
   * Os R$ 0,22 de 2024-12 estavam no suspense compensando o déficit de 2025-03.
   * Declará-los ajuste do banco ou encerrá-los sem classificar os RETIRA desse
   * bolso: o déficit de 2025-03 deixa de estar coberto e vira R$ 0,22 de
   * obrigação econômica real.
   *
   * Isso é aritmeticamente honesto — se aquele valor não era dinheiro, o mês
   * seguinte pagou R$ 0,22 a menos de verdade — mas é surpreendente para quem
   * clica. Nenhuma das duas vira CRÉDITO, e é isso que as separa de
   * `economic_credit`.
   */
  it('ajuste do banco zera a diferença, não vira crédito, e descobre o déficit que ela cobria', () => {
    const semResolver = projetar(cadeia());
    const resolvido = projetar(cadeia(), {
      '2024-12': [{ kind: 'bank_adjustment', resolvedAmountCents: c(0.22) }],
    });

    expect(delta(resolvido, '2024-12')).toBe(0);
    expect(resolvido.economicCarryCents).toBe(semResolver.economicCarryCents);
    expect(resolvido.economicUsedCents).toBe(c(0.22));
    expect(
      resolvido.competences.find((x) => x.referenceMonth === '2025-03')?.economicOpenBalanceCents
    ).toBe(c(0.22));
  });

  it('encerrar sem classificar tem o mesmo efeito, e também não vira crédito', () => {
    const semResolver = projetar(cadeia());
    const resolvido = projetar(cadeia(), {
      '2024-12': [{ kind: 'reconciliation_write_off', resolvedAmountCents: c(0.22) }],
    });

    expect(delta(resolvido, '2024-12')).toBe(0);
    expect(resolvido.economicCarryCents).toBe(semResolver.economicCarryCents);
    expect(resolvido.economicUsedCents).toBe(c(0.22));
  });

  /** Só `economic_credit` mantém o valor dentro do livro econômico. */
  it('classificar como crédito real não faz dívida aparecer em lugar nenhum', () => {
    const resolvido = projetar(cadeia(), {
      '2024-12': [{ kind: 'economic_credit', resolvedAmountCents: c(0.22) }],
    });

    expect(resolvido.economicUsedCents).toBe(0);
    for (const comp of resolvido.competences) {
      expect(comp.economicOpenBalanceCents, comp.referenceMonth).toBe(0);
    }
  });
});

describe('resolução parcial', () => {
  const uma = () => [comp('2026-06', 500, 522)];

  it('resolver uma porção deixa o resto para depois', () => {
    const p = projetar(uma(), {
      '2026-06': [{ kind: 'bank_adjustment', resolvedAmountCents: c(8) }],
    });
    expect(delta(p, '2026-06')).toBe(c(14));
  });

  it('duas porções somadas fecham a diferença', () => {
    const p = projetar(uma(), {
      '2026-06': [
        { kind: 'bank_adjustment', resolvedAmountCents: c(8) },
        { kind: 'economic_credit', resolvedAmountCents: c(14) },
      ],
    });
    expect(delta(p, '2026-06')).toBe(0);
  });

  /**
   * O núcleo já limita a porção ao disponível. Isto protege o caso em que o
   * servidor autorizou uma porção e outra chegou por outro caminho: o excedente
   * é descartado, nunca inventado.
   */
  it('porção maior que a diferença não cria dinheiro', () => {
    const p = projetar(uma(), {
      '2026-06': [{ kind: 'economic_credit', resolvedAmountCents: c(999) }],
    });
    expect(delta(p, '2026-06')).toBe(0);
    expect(centsToCurrency(p.economicCarryCents)).toBe(22);
  });

  /** Sinal incompatível é recusado, nunca convertido em silêncio. */
  it('classificar diferença positiva como dívida não faz nada', () => {
    const p = projetar(uma(), {
      '2026-06': [{ kind: 'economic_debt', resolvedAmountCents: c(-22) }],
    });
    expect(delta(p, '2026-06')).toBe(c(22));
  });
});

describe('crédito real muda o limite; as outras classificações não', () => {
  const uma = () => [comp('2026-06', 500, 522)];

  it('economic_credit aumenta o crédito disponível', () => {
    const semResolver = projetar(uma());
    const p = projetar(uma(), {
      '2026-06': [{ kind: 'economic_credit', resolvedAmountCents: c(22) }],
    });
    expect(p.economicCarryCents - semResolver.economicCarryCents).toBe(c(22));
  });

  it('bank_adjustment e reconciliation_write_off não', () => {
    const semResolver = projetar(uma());
    for (const kind of ['bank_adjustment', 'reconciliation_write_off'] as const) {
      const p = projetar(uma(), { '2026-06': [{ kind, resolvedAmountCents: c(22) }] });
      expect(p.economicCarryCents, kind).toBe(semResolver.economicCarryCents);
    }
  });
});

describe('compatibilidade', () => {
  /** Omitir o argumento tem de dar exatamente o comportamento anterior. */
  it('sem resoluções, a projeção é a de antes', () => {
    const cards = [comp('2026-06', 500, 522), comp('2026-07', 400, 400)];
    expect(projetar(cards)).toEqual(projetar(cards, {}));
  });

  it('resolução numa competência não vaza para outra', () => {
    const p = projetar([comp('2026-06', 500, 522), comp('2026-07', 400, 430)], {
      '2026-06': [{ kind: 'bank_adjustment', resolvedAmountCents: c(22) }],
    });
    expect(delta(p, '2026-06')).toBe(0);
    expect(delta(p, '2026-07')).toBe(c(30));
  });
});

describe('o total oficial só vale acompanhado da procedência', () => {
  /**
   * REGRESSÃO da validação visual do 4B2. O valor oficial era gravado, mas o
   * card seguia mostrando a diferença: quem monta a entrada do núcleo levava
   * `authoritativeStatementTotalCents` e esquecia `authoritativeSource`, e
   * `applyAuthoritativeResolution` descarta a resolução que não tem as duas.
   *
   * O usuário informava o valor da fatura, via a confirmação, e o selo voltava.
   */
  const uma = () => [comp('2026-06', 500, 522)];

  it('com valor e procedência, a competência é recalculada', () => {
    const p = projetar(uma(), {
      '2026-06': [
        {
          kind: 'authoritative_total',
          authoritativeStatementTotalCents: c(522),
          authoritativeSource: 'bank_app',
        },
      ],
    });
    expect(delta(p, '2026-06')).toBe(0);
  });

  it('sem procedência, nada acontece — e é assim de propósito', () => {
    const p = projetar(uma(), {
      '2026-06': [
        { kind: 'authoritative_total', authoritativeStatementTotalCents: c(522) },
      ],
    });
    expect(delta(p, '2026-06')).toBe(c(22));
  });

  it('sem valor, nada acontece', () => {
    const p = projetar(uma(), {
      '2026-06': [{ kind: 'authoritative_total', authoritativeSource: 'bank_app' }],
    });
    expect(delta(p, '2026-06')).toBe(c(22));
  });

  /** O total oficial não consome porção: ele troca a fonte do total. */
  it('um total oficial maior faz a diferença mudar de sinal', () => {
    const p = projetar(uma(), {
      '2026-06': [
        {
          kind: 'authoritative_total',
          authoritativeStatementTotalCents: c(600),
          authoritativeSource: 'bank_pdf',
        },
      ],
    });
    expect(delta(p, '2026-06')).toBe(0);
    expect(
      p.competences.find((x) => x.referenceMonth === '2026-06')?.economicOpenBalanceCents
    ).toBe(c(78));
  });
});
