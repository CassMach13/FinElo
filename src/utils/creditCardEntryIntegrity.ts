export interface IncomingCreditCardEntryRow {
  transaction_id: string | null;
  card_id: string;
  account_id: string;
  source_file_name: string;
  source_row_hash: string;
  [key: string]: unknown;
}

export interface ExistingCreditCardEntryIdentity {
  id: string;
  transaction_id: string | null;
  card_id: string;
  account_id: string;
  source_file_name: string;
  source_row_hash: string;
}

export interface CreditCardEntryPersistencePlan<T extends IncomingCreditCardEntryRow> {
  upserts: T[];
  updates: Array<{ id: string; row: T }>;
}

const integrityError = (message: string): Error =>
  new Error(`Integridade da projeção do cartão: ${message}`);

/**
 * Planeja a persistência usando transaction_id como identidade imutável.
 * Nunca decide por valor/descrição, pois lançamentos legítimos podem repeti-los.
 */
export function planCreditCardEntryPersistence<T extends IncomingCreditCardEntryRow>(
  incoming: T[],
  existing: ExistingCreditCardEntryIdentity[]
): CreditCardEntryPersistencePlan<T> {
  const incomingTransactionIds = new Set<string>();
  incoming.forEach((row) => {
    if (!row.transaction_id) return;
    if (incomingTransactionIds.has(row.transaction_id)) {
      throw integrityError(`a transação ${row.transaction_id} apareceu mais de uma vez no mesmo lote.`);
    }
    incomingTransactionIds.add(row.transaction_id);
  });

  const existingByTransactionId = new Map<string, ExistingCreditCardEntryIdentity[]>();
  existing.forEach((row) => {
    if (!row.transaction_id) return;
    const rows = existingByTransactionId.get(row.transaction_id) || [];
    rows.push(row);
    existingByTransactionId.set(row.transaction_id, rows);
  });

  const upserts: T[] = [];
  const updates: Array<{ id: string; row: T }> = [];

  incoming.forEach((row) => {
    if (!row.transaction_id) {
      upserts.push(row);
      return;
    }

    const matches = existingByTransactionId.get(row.transaction_id) || [];
    if (matches.length === 0) {
      upserts.push(row);
      return;
    }
    if (matches.length > 1) {
      throw integrityError(
        `a transação ${row.transaction_id} já possui ${matches.length} projeções; nenhuma foi alterada.`
      );
    }

    const current = matches[0];
    const sameOrigin =
      current.card_id === row.card_id &&
      current.account_id === row.account_id &&
      current.source_file_name === row.source_file_name;
    if (!sameOrigin) {
      throw integrityError(
        `a transação ${row.transaction_id} já está vinculada a outro cartão, conta ou arquivo.`
      );
    }

    if (current.source_row_hash === row.source_row_hash) {
      upserts.push(row);
    } else {
      updates.push({ id: current.id, row });
    }
  });

  return { upserts, updates };
}
