import { describe, expect, it } from 'vitest';
import {
  buildAtomicCardRebuildShadow,
  compareAtomicCardProjections,
  type PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';
import type { Account, Transaction } from '../../src/types';

const account: Account = {
  id: 'card-account',
  user_id: 'user-1',
  Nome_Conta: 'Cartão QA',
  Tipo_Conta: 'Cartão de Crédito',
  Saldo_Inicial: 0,
  Data_Saldo_Inicial: new Date(2026, 0, 1),
  dia_vencimento: 28,
  dia_fechamento: 19,
};

const transaction = (input: {
  id: string;
  origin: string;
  date: string;
  amount: number;
  description: string;
  type?: Transaction['Tipo'];
}): Transaction => ({
  ID_Transacao: input.id,
  user_id: account.user_id,
  ID_Conta: account.id,
  Data: input.date as unknown as Date,
  Descricao_Original: input.description,
  Nome_Fantasia: input.description,
  Valor: input.amount,
  Tipo: input.type || (input.amount < 0 ? 'Despesa' : 'Renda'),
  Categoria: 'Teste',
  Origem: input.origin,
  Fonte: 'Teste',
});

const cycles = [
  {
    fileName: '10_xp_cartao_fatura_julho_2026.csv',
    referenceMonth: '2026-07',
    dueDate: '2026-08-28',
  },
  {
    fileName: '11_xp_cartao_fatura_agosto_2026.csv',
    referenceMonth: '2026-08',
    dueDate: '2026-09-28',
  },
];

describe('Sprint 2A — projeção sombra atômica', () => {
  it('mantém centavos e aplica o pagamento do arquivo seguinte na fatura anterior', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles,
      transactions: [
        transaction({
          id: 'july-purchase',
          origin: cycles[0].fileName,
          date: '2026-07-02',
          amount: -399.9,
          description: 'COMPRA JULHO',
        }),
        transaction({
          id: 'aug-payment',
          origin: cycles[1].fileName,
          date: '2026-08-20',
          amount: 399.9,
          description: 'PAGAMENTO DE FATURA',
        }),
        transaction({
          id: 'aug-purchase',
          origin: cycles[1].fileName,
          date: '2026-08-21',
          amount: -449.9,
          description: 'COMPRA AGOSTO',
        }),
      ],
    });

    expect(shadow.blockers).toEqual([]);
    expect(shadow.safeToStage).toBe(true);
    expect(shadow.sourceTransactionCount).toBe(3);
    expect(shadow.projectedEntryCount).toBe(3);

    const julyDue = shadow.statements.find((statement) => statement.statementKey === '2026-07');
    const augustDue = shadow.statements.find((statement) => statement.statementKey === '2026-08');
    expect(julyDue).toMatchObject({
      statementTotalCents: 39990,
      totalPaymentsCents: 39990,
      openBalanceCents: 0,
      status: 'paid',
    });
    expect(augustDue).toMatchObject({
      statementTotalCents: 44990,
      totalPaymentsCents: 0,
      openBalanceCents: 44990,
    });
  });

  it('preserva como alerta o pagamento anterior à primeira fatura da janela disponível', () => {
    const sameMonthCycles = [
      {
        fileName: cycles[0].fileName,
        referenceMonth: '2026-07',
        dueDate: '2026-07-28',
      },
      {
        fileName: cycles[1].fileName,
        referenceMonth: '2026-08',
        dueDate: '2026-08-28',
      },
    ];
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: sameMonthCycles,
      transactions: [
        transaction({
          id: 'july-purchase-window',
          origin: sameMonthCycles[0].fileName,
          date: '2026-07-02',
          amount: -399.9,
          description: 'COMPRA JULHO',
        }),
        transaction({
          id: 'july-payment-outside-window',
          origin: sameMonthCycles[0].fileName,
          date: '2026-07-25',
          amount: 400,
          description: 'PAGAMENTO DE FATURA',
        }),
        transaction({
          id: 'aug-payment-window',
          origin: sameMonthCycles[1].fileName,
          date: '2026-08-20',
          amount: 399.9,
          description: 'PAGAMENTO DE FATURA',
        }),
        transaction({
          id: 'aug-purchase-window',
          origin: sameMonthCycles[1].fileName,
          date: '2026-08-21',
          amount: -449.9,
          description: 'COMPRA AGOSTO',
        }),
      ],
    });

    expect(shadow.projectedPaymentCount).toBe(1);
    expect(shadow.safeToStage).toBe(true);
    expect(shadow.blockers).toEqual([]);
    expect(shadow.warnings).toContainEqual(
      expect.objectContaining({
        code: 'payment-before-rebuild-window',
        transactionId: 'july-payment-outside-window',
      })
    );
  });

  it('continua bloqueando pagamento cuja fatura anterior falta dentro da janela', () => {
    const cyclesWithGap = [
      {
        fileName: 'fatura-julho.csv',
        referenceMonth: '2026-07',
        dueDate: '2026-07-28',
      },
      {
        fileName: 'fatura-setembro.csv',
        referenceMonth: '2026-09',
        dueDate: '2026-09-28',
      },
    ];
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: cyclesWithGap,
      transactions: [
        transaction({
          id: 'july-purchase-before-gap',
          origin: cyclesWithGap[0].fileName,
          date: '2026-07-02',
          amount: -100,
          description: 'COMPRA JULHO',
        }),
        transaction({
          id: 'september-payment-with-gap',
          origin: cyclesWithGap[1].fileName,
          date: '2026-09-20',
          amount: 100,
          description: 'PAGAMENTO DE FATURA',
        }),
      ],
    });

    expect(shadow.safeToStage).toBe(false);
    expect(shadow.blockers).toContainEqual(
      expect.objectContaining({
        code: 'unresolved-imported-payment-target',
        transactionId: 'september-payment-with-gap',
      })
    );
  });

  it('não trata valores e descrições iguais como duplicidade', () => {
    const sameValueTransactions = [
      transaction({
        id: 'same-value-1',
        origin: cycles[0].fileName,
        date: '2026-07-03',
        amount: -120,
        description: 'SUPERMERCADO CENTRAL',
      }),
      transaction({
        id: 'same-value-2',
        origin: cycles[0].fileName,
        date: '2026-07-03',
        amount: -120,
        description: 'SUPERMERCADO CENTRAL',
      }),
    ];
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [cycles[0]],
      transactions: sameValueTransactions,
    });

    expect(shadow.blockers).toEqual([]);
    expect(shadow.entries.map((entry) => entry.transactionId)).toEqual([
      'same-value-1',
      'same-value-2',
    ]);
    expect(shadow.statements[0].statementTotalCents).toBe(24000);
  });

  it('preserva classificação de pagamento confirmada pelo usuário no lote', () => {
    const paymentId = 'user-confirmed-payment';
    const previousCycle = {
      fileName: '09_xp_cartao_fatura_junho_2026.csv',
      referenceMonth: '2026-06',
      dueDate: '2026-07-28',
    };
    const shadow = buildAtomicCardRebuildShadow({
      account,
      persistedEntryTypesByTransactionId: new Map([[paymentId, 'fee']]),
      cycles: [
        previousCycle,
        {
          ...cycles[0],
          paymentTransactionIds: [paymentId],
        },
      ],
      transactions: [
        transaction({
          id: 'purchase-before-confirmed-payment',
          origin: previousCycle.fileName,
          date: '2026-06-20',
          amount: -100,
          description: 'COMPRA ANTERIOR',
        }),
        transaction({
          id: paymentId,
          origin: cycles[0].fileName,
          date: '2026-07-20',
          amount: 100,
          description: 'CRÉDITO CONFIRMADO PELO USUÁRIO',
          type: 'Renda',
        }),
      ],
    });

    expect(shadow.blockers).toEqual([]);
    expect(
      shadow.entries.find((entry) => entry.transactionId === paymentId)?.entryType
    ).toBe('invoice_payment');
    expect(shadow.payments[0]).toEqual(
      expect.objectContaining({ transactionId: paymentId, source: 'imported_statement' })
    );
  });

  it('preserva classificação histórica inequívoca pela identidade imutável', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [cycles[0]],
      persistedEntryTypesByTransactionId: new Map([
        ['historical-classification', 'adjustment'],
      ]),
      transactions: [
        transaction({
          id: 'historical-classification',
          origin: cycles[0].fileName,
          date: '2026-07-10',
          amount: 10,
          description: 'CRÉDITO HISTÓRICO CONFIRMADO',
          type: 'Renda',
        }),
      ],
    });

    expect(shadow.entries[0]).toMatchObject({
      transactionId: 'historical-classification',
      statementKey: '2026-07',
      entryType: 'adjustment',
    });
  });

  it('preserva datas civis nos limites do mês', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles,
      transactions: [
        transaction({
          id: 'month-end',
          origin: cycles[0].fileName,
          date: '2026-07-31',
          amount: -0.31,
          description: 'DIA 31',
        }),
        transaction({
          id: 'month-start',
          origin: cycles[1].fileName,
          date: '2026-08-01',
          amount: -0.01,
          description: 'DIA 01',
        }),
      ],
    });

    expect(shadow.entries.find((entry) => entry.transactionId === 'month-end')?.postedDate).toBe('2026-07-31');
    expect(shadow.entries.find((entry) => entry.transactionId === 'month-start')?.postedDate).toBe('2026-08-01');
  });

  it('preserva lançamento manual em sua competência e no dia 31', () => {
    const manualCycle = {
      fileName: 'manual:2026-07',
      referenceMonth: '2026-07',
      dueDate: '2026-08-28',
    };
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [manualCycle],
      transactions: [
        transaction({
          id: 'manual-day-31',
          origin: manualCycle.fileName,
          date: '2026-07-31',
          amount: -31.31,
          description: 'COMPRA MANUAL DIA 31',
        }),
      ],
    });

    expect(shadow.blockers).toEqual([]);
    expect(shadow.entries).toContainEqual(
      expect.objectContaining({
        transactionId: 'manual-day-31',
        sourceFileName: 'manual:2026-07',
        postedDate: '2026-07-31',
        statementKey: '2026-07',
        amountCents: -3131,
      })
    );
  });

  it('aplica pagamento manual na competência escolhida sem deslocar para a fatura anterior', () => {
    const juneCycle = {
      fileName: 'fatura-junho.csv',
      referenceMonth: '2026-06',
      dueDate: '2026-07-28',
    };
    const julyCycle = cycles[0];
    const manualJulyCycle = {
      fileName: 'manual:2026-07',
      referenceMonth: '2026-07',
      dueDate: '2026-08-28',
    };
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [juneCycle, julyCycle, manualJulyCycle],
      transactions: [
        transaction({
          id: 'june-purchase',
          origin: juneCycle.fileName,
          date: '2026-06-10',
          amount: -100,
          description: 'COMPRA JUNHO',
        }),
        transaction({
          id: 'july-purchase',
          origin: julyCycle.fileName,
          date: '2026-07-10',
          amount: -50,
          description: 'COMPRA JULHO',
        }),
        transaction({
          id: 'manual-july-payment',
          origin: manualJulyCycle.fileName,
          date: '2026-08-20',
          amount: 50,
          description: 'PAGAMENTO DE FATURA',
          type: 'Renda',
        }),
      ],
    });

    expect(shadow.blockers).toEqual([]);
    expect(shadow.statements.find((statement) => statement.statementKey === '2026-06')).toMatchObject({
      statementTotalCents: 10000,
      totalPaymentsCents: 0,
      openBalanceCents: 10000,
    });
    expect(shadow.statements.find((statement) => statement.statementKey === '2026-07')).toMatchObject({
      statementTotalCents: 5000,
      totalPaymentsCents: 5000,
      openBalanceCents: 0,
      status: 'paid',
    });
    expect(shadow.projectedPaymentCount).toBe(1);
    expect(shadow.payments).toContainEqual(
      expect.objectContaining({
        transactionId: 'manual-july-payment',
        statementKey: '2026-07',
        amountCents: 5000,
        source: 'manual',
      })
    );
  });

  it('soma mil linhas em centavos sem deriva de ponto flutuante', () => {
    const stressTransactions = Array.from({ length: 1000 }, (_, index) =>
      transaction({
        id: `stress-${String(index + 1).padStart(4, '0')}`,
        origin: cycles[0].fileName,
        date: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
        amount: -0.01,
        description: 'COMPRA DE UM CENTAVO',
      })
    );
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [cycles[0]],
      transactions: stressTransactions,
    });

    expect(shadow.safeToStage).toBe(true);
    expect(shadow.projectedEntryCount).toBe(1000);
    expect(shadow.statements[0].statementTotalCents).toBe(1000);
    expect(shadow.statements[0].openBalanceCents).toBe(1000);
  });

  it('bloqueia IDs repetidos entre competências antes de qualquer ativação', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles,
      transactions: [
        transaction({
          id: 'immutable-id',
          origin: cycles[0].fileName,
          date: '2026-07-10',
          amount: -10,
          description: 'COMPRA A',
        }),
        transaction({
          id: 'immutable-id',
          origin: cycles[1].fileName,
          date: '2026-08-10',
          amount: -10,
          description: 'COMPRA B',
        }),
      ],
    });

    expect(shadow.safeToStage).toBe(false);
    expect(shadow.blockers.map((issue) => issue.code)).toContain('transaction-in-multiple-cycles');
  });

  it('bloqueia a mesma competência apontando para dois meses de vencimento', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [
        cycles[0],
        {
          fileName: 'outra-fatura-julho.csv',
          referenceMonth: '2026-07',
          dueDate: '2026-09-28',
        },
      ],
      transactions: [
        transaction({
          id: 'july-first-file',
          origin: cycles[0].fileName,
          date: '2026-07-10',
          amount: -10,
          description: 'COMPRA A',
        }),
        transaction({
          id: 'july-second-file',
          origin: 'outra-fatura-julho.csv',
          date: '2026-07-11',
          amount: -20,
          description: 'COMPRA B',
        }),
      ],
    });

    expect(shadow.safeToStage).toBe(false);
    expect(shadow.blockers.map((issue) => issue.code)).toContain(
      'conflicting-reference-due-date'
    );
  });

  it('bloqueia dias de vencimento diferentes dentro da mesma fatura mensal', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [
        cycles[0],
        {
          fileName: 'segunda-origem-julho.csv',
          referenceMonth: '2026-07',
          dueDate: '2026-08-29',
        },
      ],
      transactions: [
        transaction({
          id: 'due-day-28',
          origin: cycles[0].fileName,
          date: '2026-07-10',
          amount: -10,
          description: 'COMPRA A',
        }),
        transaction({
          id: 'due-day-29',
          origin: 'segunda-origem-julho.csv',
          date: '2026-07-11',
          amount: -20,
          description: 'COMPRA B',
        }),
      ],
    });

    expect(shadow.safeToStage).toBe(false);
    expect(shadow.blockers.map((issue) => issue.code)).toContain(
      'conflicting-statement-due-date'
    );
  });

  it('compara a sombra com a projeção persistida sem tolerância implícita de centavos', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [cycles[0]],
      transactions: [
        transaction({
          id: 'cent-check',
          origin: cycles[0].fileName,
          date: '2026-07-10',
          amount: -35,
          description: 'CAFÉ',
        }),
      ],
    });
    const statement = shadow.statements[0];
    const entry = shadow.entries[0];
    const persisted: PersistedAtomicCardProjection = {
      source: 'engine',
      statements: [
        {
          statementKey: statement.statementKey,
          dueDate: statement.dueDate,
          entryCount: statement.entryCount,
          statementTotalCents: statement.statementTotalCents + 1,
          totalPaymentsCents: statement.totalPaymentsCents,
          openBalanceCents: statement.openBalanceCents + 1,
        },
      ],
      entries: [
        {
          transactionId: entry.transactionId,
          statementKey: entry.statementKey,
          postedDate: entry.postedDate,
          amountCents: entry.amountCents,
          entryType: entry.entryType,
        },
      ],
      payments: [],
    };

    const comparison = compareAtomicCardProjections(shadow, persisted);
    expect(comparison.status).toBe('different');
    expect(comparison.safeToActivate).toBe(true);
    expect(comparison.changedStatementKeys).toEqual([statement.statementKey]);
    expect(comparison.differenceCount).toBe(1);

    const protectedComparison = compareAtomicCardProjections(shadow, {
      ...persisted,
      statements: persisted.statements.map((current) => ({
        ...current,
        hasProtectedMetadata: true,
      })),
    });
    expect(protectedComparison.protectedMetadataStatementKeys).toEqual([
      statement.statementKey,
    ]);
    expect(protectedComparison.safeToActivate).toBe(true);
    expect(protectedComparison.structuralDifferenceCount).toBe(1);
    expect(protectedComparison.activationChangeCount).toBe(1);
    expect(protectedComparison.differenceCount).toBe(2);
  });

  it('preserva metadados protegidos sem liberá-los como uma alteração isolada', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [cycles[0]],
      transactions: [
        transaction({
          id: 'protected-only',
          origin: cycles[0].fileName,
          date: '2026-07-10',
          amount: -35,
          description: 'CAFÉ',
        }),
      ],
    });
    const persisted: PersistedAtomicCardProjection = {
      source: 'engine',
      statements: shadow.statements.map((statement) => ({
        statementKey: statement.statementKey,
        dueDate: statement.dueDate,
        entryCount: statement.entryCount,
        statementTotalCents: statement.statementTotalCents,
        totalPaymentsCents: statement.totalPaymentsCents,
        openBalanceCents: statement.openBalanceCents,
        hasProtectedMetadata: true,
      })),
      entries: shadow.entries.map((entry) => ({
        transactionId: entry.transactionId,
        statementKey: entry.statementKey,
        postedDate: entry.postedDate,
        amountCents: entry.amountCents,
        entryType: entry.entryType,
      })),
      payments: [],
    };

    const comparison = compareAtomicCardProjections(shadow, persisted);
    expect(comparison.status).toBe('informational');
    expect(comparison.structuralDifferenceCount).toBe(0);
    expect(comparison.activationChangeCount).toBe(0);
    expect(comparison.differenceCount).toBe(1);
    expect(comparison.safeToActivate).toBe(false);
  });

  it('não libera ativação que precisaria criar uma linha ausente', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [cycles[0]],
      transactions: [
        transaction({
          id: 'missing-entry',
          origin: cycles[0].fileName,
          date: '2026-07-10',
          amount: -35,
          description: 'CAFÉ',
        }),
      ],
    });
    const statement = shadow.statements[0];
    const comparison = compareAtomicCardProjections(shadow, {
      source: 'engine',
      statements: [
        {
          statementKey: statement.statementKey,
          dueDate: statement.dueDate,
          entryCount: 0,
          statementTotalCents: 0,
          totalPaymentsCents: 0,
          openBalanceCents: 0,
        },
      ],
      entries: [],
      payments: [],
    });

    expect(comparison.missingTransactionIds).toEqual(['missing-entry']);
    expect(comparison.safeToActivate).toBe(false);
  });

  it('expõe IDs duplicados já existentes na projeção persistida', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [cycles[0]],
      transactions: [
        transaction({
          id: 'duplicated-current',
          origin: cycles[0].fileName,
          date: '2026-07-10',
          amount: -10,
          description: 'COMPRA',
        }),
      ],
    });
    const statement = shadow.statements[0];
    const entry = shadow.entries[0];
    const duplicateEntry = {
      transactionId: entry.transactionId,
      statementKey: entry.statementKey,
      postedDate: entry.postedDate,
      amountCents: entry.amountCents,
      entryType: entry.entryType,
    };
    const persisted: PersistedAtomicCardProjection = {
      source: 'engine',
      statements: [
        {
          statementKey: statement.statementKey,
          dueDate: statement.dueDate,
          entryCount: 2,
          statementTotalCents: statement.statementTotalCents,
          totalPaymentsCents: statement.totalPaymentsCents,
          openBalanceCents: statement.openBalanceCents,
        },
      ],
      entries: [duplicateEntry, { ...duplicateEntry }],
      payments: [],
    };

    const comparison = compareAtomicCardProjections(shadow, persisted);
    expect(comparison.status).toBe('different');
    expect(comparison.safeToActivate).toBe(false);
    expect(comparison.duplicatePersistedTransactionIds).toEqual(['duplicated-current']);
    expect(comparison.differenceCount).toBeGreaterThanOrEqual(2);
  });

  it('audita pagamentos persistidos sem ID por assinatura e bloqueia pagamento órfão', () => {
    const manualCycle = {
      fileName: 'manual:2026-07',
      referenceMonth: '2026-07',
      dueDate: '2026-08-28',
    };
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [manualCycle],
      transactions: [
        transaction({
          id: 'manual-payment-audit',
          origin: manualCycle.fileName,
          date: '2026-08-20',
          amount: 50,
          description: 'PAGAMENTO DE FATURA',
          type: 'Renda',
        }),
      ],
    });
    const statement = shadow.statements[0];
    const entry = shadow.entries[0];
    const expectedPayment = shadow.payments[0];
    const persisted: PersistedAtomicCardProjection = {
      source: 'engine',
      statements: [
        {
          statementKey: statement.statementKey,
          dueDate: statement.dueDate,
          entryCount: statement.entryCount,
          statementTotalCents: statement.statementTotalCents,
          totalPaymentsCents: statement.totalPaymentsCents,
          openBalanceCents: statement.openBalanceCents,
        },
      ],
      entries: [
        {
          transactionId: entry.transactionId,
          statementKey: entry.statementKey,
          postedDate: entry.postedDate,
          amountCents: entry.amountCents,
          entryType: entry.entryType,
        },
      ],
      payments: [
        {
          rowId: 'manual-without-transaction-id',
          transactionId: null,
          statementKey: expectedPayment.statementKey,
          paymentDate: expectedPayment.paymentDate,
          amountCents: expectedPayment.amountCents,
          source: expectedPayment.source,
        },
        {
          rowId: 'orphan-payment',
          transactionId: 'orphan-payment-transaction',
          statementKey: expectedPayment.statementKey,
          paymentDate: expectedPayment.paymentDate,
          amountCents: 1234,
          source: 'imported_statement',
        },
      ],
    };

    const comparison = compareAtomicCardProjections(shadow, persisted);
    expect(comparison.missingPaymentKeys).toEqual([]);
    expect(comparison.orphanPaymentKeys).toEqual(['orphan-payment-transaction']);
    expect(comparison.safeToActivate).toBe(false);
  });

  it('sinaliza colisão econômica quando um pagamento vinculado também existe sem identidade', () => {
    const manualCycle = {
      fileName: 'manual:2026-07',
      referenceMonth: '2026-07',
      dueDate: '2026-08-28',
    };
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [manualCycle],
      transactions: [
        transaction({
          id: 'linked-payment',
          origin: manualCycle.fileName,
          date: '2026-08-20',
          amount: 50,
          description: 'PAGAMENTO DE FATURA',
          type: 'Renda',
        }),
      ],
    });
    const statement = shadow.statements[0];
    const entry = shadow.entries[0];
    const payment = shadow.payments[0];
    const persisted: PersistedAtomicCardProjection = {
      source: 'engine',
      statements: [
        {
          statementKey: statement.statementKey,
          dueDate: statement.dueDate,
          entryCount: statement.entryCount,
          statementTotalCents: statement.statementTotalCents,
          totalPaymentsCents: statement.totalPaymentsCents,
          openBalanceCents: statement.openBalanceCents,
        },
      ],
      entries: [
        {
          transactionId: entry.transactionId,
          statementKey: entry.statementKey,
          postedDate: entry.postedDate,
          amountCents: entry.amountCents,
          entryType: entry.entryType,
        },
      ],
      payments: [
        {
          rowId: 'linked-row',
          transactionId: payment.transactionId,
          statementKey: payment.statementKey,
          paymentDate: payment.paymentDate,
          amountCents: payment.amountCents,
          source: payment.source,
        },
        {
          rowId: 'legacy-row-without-identity',
          transactionId: null,
          statementKey: payment.statementKey,
          paymentDate: payment.paymentDate,
          amountCents: payment.amountCents,
          source: payment.source,
        },
      ],
    };

    const comparison = compareAtomicCardProjections(shadow, persisted);
    expect(comparison.suspiciousPersistedPaymentEventKeys).toEqual([
      `${payment.statementKey}|${payment.paymentDate}|${payment.amountCents}|${payment.source}`,
    ]);
    expect(comparison.orphanPaymentKeys).toEqual(['row:legacy-row-without-identity']);
    expect(comparison.safeToActivate).toBe(false);
  });

  it('marca para reparo somente a linha importada sem identidade com a mesma proveniência', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles,
      transactions: [
        transaction({
          id: 'july-purchase-for-repair',
          origin: cycles[0].fileName,
          date: '2026-07-02',
          amount: -399.9,
          description: 'COMPRA JULHO',
        }),
        transaction({
          id: 'linked-imported-payment',
          origin: cycles[1].fileName,
          date: '2026-08-20',
          amount: 399.9,
          description: 'PAGAMENTOS VALIDOS',
        }),
      ],
    });
    const expectedPayment = shadow.payments[0];
    const statements = shadow.statements.map((statement) => ({
      statementKey: statement.statementKey,
      dueDate: statement.dueDate,
      entryCount: statement.entryCount,
      statementTotalCents: statement.statementTotalCents,
      totalPaymentsCents: statement.totalPaymentsCents,
      openBalanceCents: statement.openBalanceCents,
    }));
    const entries = shadow.entries.map((entry) => ({
      transactionId: entry.transactionId,
      statementKey: entry.statementKey,
      postedDate: entry.postedDate,
      amountCents: entry.amountCents,
      entryType: entry.entryType,
    }));
    const persisted: PersistedAtomicCardProjection = {
      source: 'engine',
      statements,
      entries,
      payments: [
        {
          rowId: 'linked-imported-row',
          transactionId: expectedPayment.transactionId,
          statementKey: expectedPayment.statementKey,
          paymentDate: expectedPayment.paymentDate,
          amountCents: expectedPayment.amountCents,
          source: expectedPayment.source,
          notes: 'hnew · 11_xp_cartao_fatura_agosto_2026.csv · linha 4 · Pagamentos Validos',
        },
        {
          rowId: 'legacy-imported-row',
          transactionId: null,
          statementKey: expectedPayment.statementKey,
          paymentDate: expectedPayment.paymentDate,
          amountCents: expectedPayment.amountCents,
          source: expectedPayment.source,
          notes: 'hold · 11_xp_cartao_fatura_agosto_2026.csv · linha 4 · Pagamentos Validos',
        },
      ],
    };

    const comparison = compareAtomicCardProjections(shadow, persisted);
    expect(comparison.repairablePersistedPaymentRowIds).toEqual(['legacy-imported-row']);

    persisted.payments[1].notes =
      'hold · 11_xp_cartao_fatura_agosto_2026.csv · linha 5 · Outro pagamento';
    const ambiguous = compareAtomicCardProjections(shadow, persisted);
    expect(ambiguous.repairablePersistedPaymentRowIds).toEqual([]);
  });

  it('separa duplicidade de item reparável de duplicidade ambígua', () => {
    const shadow = buildAtomicCardRebuildShadow({
      account,
      cycles: [cycles[0]],
      transactions: [
        transaction({
          id: 'duplicated-entry-repair',
          origin: cycles[0].fileName,
          date: '2026-07-10',
          amount: -10,
          description: 'COMPRA ÚNICA',
        }),
      ],
    });
    const expected = shadow.entries[0];
    const persisted: PersistedAtomicCardProjection = {
      source: 'engine',
      statements: shadow.statements.map((statement) => ({
        statementKey: statement.statementKey,
        dueDate: statement.dueDate,
        entryCount: 2,
        statementTotalCents: statement.statementTotalCents,
        totalPaymentsCents: statement.totalPaymentsCents,
        openBalanceCents: statement.openBalanceCents,
      })),
      entries: [
        {
          rowId: 'canonical-row',
          transactionId: expected.transactionId,
          statementKey: expected.statementKey,
          postedDate: expected.postedDate,
          amountCents: expected.amountCents,
          entryType: expected.entryType,
        },
        {
          rowId: 'obsolete-row',
          transactionId: expected.transactionId,
          statementKey: '2026-08',
          postedDate: expected.postedDate,
          amountCents: expected.amountCents,
          entryType: expected.entryType,
        },
      ],
      payments: [],
    };

    const repairable = compareAtomicCardProjections(shadow, persisted);
    expect(repairable.duplicatePersistedTransactionIds).toEqual([
      'duplicated-entry-repair',
    ]);
    expect(repairable.repairablePersistedEntryRowIds).toEqual(['obsolete-row']);
    expect(repairable.conflictingDuplicatePersistedTransactionIds).toEqual([]);
    expect(repairable.changedTransactionIds).toEqual([]);
    expect(repairable.safeToActivate).toBe(false);

    persisted.entries[0].statementKey = '2026-06';
    const ambiguous = compareAtomicCardProjections(shadow, persisted);
    expect(ambiguous.repairablePersistedEntryRowIds).toEqual([]);
    expect(ambiguous.conflictingDuplicatePersistedTransactionIds).toEqual([
      'duplicated-entry-repair',
    ]);
  });
});
