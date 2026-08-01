import { describe, it, expect } from 'vitest';
import {
  auditImportLogLedger,
  buildImportLogAlerts,
  findImportLogsByTransactionId,
} from '../src/utils/importLogHealth';
import type { ImportLog } from '../src/types';

const baseLog = (partial: Partial<ImportLog>): ImportLog => ({
  id: 'l1',
  user_id: 'u1',
  file_name: 'Extrato_XP_Abr_2026.csv',
  import_date: new Date().toISOString(),
  total_transactions: 1,
  imported_count: 1,
  ignored_count: 0,
  ignored_details: [],
  imported_details: [{ Data: '2026-01-01', Valor: 10, Descricao_Original: 'x' }],
  ...partial,
});

describe('importLogHealth', () => {
  it('marca erro quando imported_count diverge do tamanho de imported_details', () => {
    const log = baseLog({
      imported_count: 125,
      total_transactions: 125,
      imported_details: Array.from({ length: 124 }, (_, i) => ({
        Data: '2026-01-01',
        Valor: -1,
        Descricao_Original: `linha-${i}`,
        ID_Transacao: `id-${i}`,
      })),
    });
    const r = buildImportLogAlerts(log);
    expect(r.level).toBe('error');
    expect(r.badges.some((b) => b.includes('imported_count') && b.includes('imported_details'))).toBe(true);
  });

  it('não marca «Sem IDs no log» para extrato de conta (não-cartão)', () => {
    const log = baseLog({
      file_name: 'Extrato_XP_Cassio_Abr_2026.csv',
      imported_details: [{ Data: '2026-01-01', Valor: -10 }],
    });

    const ctx = {
      accounts: [{ id: 'acc-cc', Tipo_Conta: 'Conta Corrente' as const }],
      transactions: [{ Origem: log.file_name, ID_Conta: 'acc-cc' }],
    };

    const r = buildImportLogAlerts(log, ctx);
    expect(r.badges.some((b) => b.includes('Sem IDs'))).toBe(false);
    expect(r.level).toBe('ok');
  });

  it('marca «Sem IDs no log» para fatura de cartão (nome de arquivo)', () => {
    const log = baseLog({
      file_name: 'Fatura_Cartao_XP_Cassio_Abr_2026.csv',
      imported_details: [{ Data: '2026-01-01', Valor: -10 }],
    });
    const r = buildImportLogAlerts(log);
    expect(r.badges.some((b) => b.includes('Sem IDs'))).toBe(true);
    expect(r.level).toBe('warn');
  });

  it('não marca «Sem IDs» quando o log JSON não tem IDs mas o store tem todas as transações com ID', () => {
    const file = 'Fatura_Cartao_XP_Test_Mar_2026.csv';
    const log = baseLog({
      file_name: file,
      imported_count: 3,
      total_transactions: 3,
      imported_details: [
        { Data: '2026-03-01', Valor: -10 },
        { Data: '2026-03-02', Valor: -11 },
        { Data: '2026-03-03', Valor: -12 },
      ],
    });
    const txs = [1, 2, 3].map((i) => ({
      Origem: file,
      ID_Conta: 'card1',
      ID_Transacao: `uuid-${i}`,
    }));
    const ctx = {
      accounts: [{ id: 'card1', Tipo_Conta: 'Cartão de Crédito' as const }],
      transactions: txs,
    };
    const r = buildImportLogAlerts(log, ctx);
    expect(r.badges.some((b) => b.includes('Sem IDs'))).toBe(false);
    expect(r.level).toBe('ok');
  });

  it('mantém «Sem IDs» se o ledger tem menos transações que importados', () => {
    const file = 'Fatura_Cartao_XP_Test_Fev_2026.csv';
    const log = baseLog({
      file_name: file,
      imported_count: 3,
      total_transactions: 3,
      imported_details: [
        { Data: '2026-02-01', Valor: -10 },
        { Data: '2026-02-02', Valor: -11 },
        { Data: '2026-02-03', Valor: -12 },
      ],
    });
    const ctx = {
      accounts: [{ id: 'card1', Tipo_Conta: 'Cartão de Crédito' as const }],
      transactions: [{ Origem: file, ID_Conta: 'card1', ID_Transacao: 'only-one' }],
    };
    const r = buildImportLogAlerts(log, ctx);
    expect(r.badges.some((b) => b.includes('Sem IDs'))).toBe(true);
  });

  it('mantém «Sem IDs» se alguma transação no store não tem ID_Transacao', () => {
    const file = 'Fatura_Cartao_XP_Test_Jan_2026.csv';
    const log = baseLog({
      file_name: file,
      imported_count: 2,
      total_transactions: 2,
      imported_details: [
        { Data: '2026-01-15', Valor: -5 },
        { Data: '2026-01-16', Valor: -6 },
      ],
    });
    const ctx = {
      accounts: [{ id: 'card1', Tipo_Conta: 'Cartão de Crédito' as const }],
      transactions: [
        { Origem: file, ID_Conta: 'card1', ID_Transacao: 'a' },
        { Origem: file, ID_Conta: 'card1', ID_Transacao: null },
      ],
    };
    const r = buildImportLogAlerts(log, ctx);
    expect(r.badges.some((b) => b.includes('Sem IDs'))).toBe(true);
  });
});

describe('importLogLedgerAudit', () => {
  it('distingue linhas ativas e excluidas pelo ID exato mesmo com nomes de arquivo iguais', () => {
    const current = baseLog({
      id: 'current',
      file_name: 'mesmo-nome.csv',
      imported_count: 2,
      total_transactions: 2,
      imported_details: [
        { ID_Transacao: 'tx-active', Data: '2026-08-01', Valor: -10 },
        { ID_Transacao: 'tx-deleted', Data: '2026-08-02', Valor: -20 },
      ],
    });
    const sibling = baseLog({
      id: 'sibling',
      file_name: 'mesmo-nome.csv',
      imported_details: [{ ID_Transacao: 'tx-sibling', Data: '2026-08-03', Valor: -30 }],
    });
    const transactions = [
      { ID_Transacao: 'tx-active', Origem: 'mesmo-nome.csv' },
      { ID_Transacao: 'tx-sibling', Origem: 'mesmo-nome.csv' },
    ];

    const audit = auditImportLogLedger(current, transactions);
    expect(audit.state).toBe('partial');
    expect(audit.activeTransactionIds).toEqual(['tx-active']);
    expect(audit.deletedTransactionIds).toEqual(['tx-deleted']);
    expect(buildImportLogAlerts(current, { transactions }).badges).toContain(
      'Parcial no ledger (1/2 ativas)'
    );
    expect(findImportLogsByTransactionId([current, sibling], 'tx-sibling')).toEqual([sibling]);
  });

  it('marca log totalmente orfao sem usar transacoes de lote homonimo', () => {
    const orphan = baseLog({
      id: 'orphan',
      file_name: 'duplicado.csv',
      imported_details: [{ ID_Transacao: 'tx-missing', Data: '2026-08-01', Valor: -10 }],
    });
    const transactions = [{ ID_Transacao: 'tx-other-lot', Origem: 'duplicado.csv' }];

    const audit = auditImportLogLedger(orphan, transactions);
    expect(audit.state).toBe('removed');
    const alerts = buildImportLogAlerts(orphan, { transactions });
    expect(alerts.level).toBe('error');
    expect(alerts.badges).toContain('Sem linhas ativas (0/1)');
  });
});
