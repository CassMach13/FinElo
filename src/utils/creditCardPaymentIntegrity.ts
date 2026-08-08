import { comparableImportOriginKey } from './importOriginKey';

export interface ExistingImportedPaymentIdentity {
  id: string;
  payment_transaction_id: string | null;
  notes: string | null;
}

export interface IncomingImportedPaymentIdentity {
  sourceFileName: string;
  sourceRowIndex: number;
  transactionId?: string | null;
}

export type ImportedPaymentPersistencePlan =
  | {
      action: 'insert';
      transactionId: string | null;
    }
  | {
      action: 'update';
      rowId: string;
      transactionId: string | null;
    };

const integrityError = (message: string): Error =>
  new Error(`Integridade do pagamento importado: ${message}`);

export function importedPaymentProvenanceKey(
  sourceFileName: string,
  sourceRowIndex: number
): string {
  return `${comparableImportOriginKey(sourceFileName)}|${Number(sourceRowIndex)}`;
}

export function importedPaymentProvenanceKeyFromNotes(
  notes?: string | null
): string | null {
  if (!notes) return null;
  const match = notes.match(/^[^·]+\s+·\s+(.+?)\s+·\s+linha\s+(\d+)\s+·/i);
  if (!match) return null;
  return importedPaymentProvenanceKey(match[1], Number(match[2]));
}

export function assertUniqueImportedPaymentBatch(
  incoming: IncomingImportedPaymentIdentity[]
): void {
  const transactionIds = new Set<string>();
  const provenanceKeys = new Set<string>();

  incoming.forEach((row) => {
    const transactionId = row.transactionId?.trim() || null;
    if (transactionId) {
      if (transactionIds.has(transactionId)) {
        throw integrityError(
          `a transação ${transactionId} apareceu mais de uma vez no mesmo lote; nenhuma linha foi alterada.`
        );
      }
      transactionIds.add(transactionId);
    }

    const provenanceKey = importedPaymentProvenanceKey(
      row.sourceFileName,
      row.sourceRowIndex
    );
    if (provenanceKeys.has(provenanceKey)) {
      throw integrityError(
        `arquivo e linha apareceram mais de uma vez no mesmo lote; nenhuma linha foi alterada.`
      );
    }
    provenanceKeys.add(provenanceKey);
  });
}

/**
 * Planeja uma única gravação idempotente sem comparar valor ou descrição.
 *
 * A identidade da transação é a âncora mais forte. A proveniência exata
 * `arquivo + linha` permite promover com segurança uma projeção antiga sem
 * transaction_id para a identidade definitiva. Mais de uma linha candidata
 * é sempre tratada como histórico ambíguo: nenhuma delas deve ser escolhida,
 * mesclada ou removida automaticamente.
 */
export function planImportedPaymentPersistence(
  incoming: IncomingImportedPaymentIdentity,
  existing: ExistingImportedPaymentIdentity[]
): ImportedPaymentPersistencePlan {
  const transactionId = incoming.transactionId?.trim() || null;
  const provenanceKey = importedPaymentProvenanceKey(
    incoming.sourceFileName,
    incoming.sourceRowIndex
  );
  const byTransaction = transactionId
    ? existing.filter((row) => row.payment_transaction_id === transactionId)
    : [];
  const byProvenance = existing.filter(
    (row) => importedPaymentProvenanceKeyFromNotes(row.notes) === provenanceKey
  );

  const conflictingProvenance = byProvenance.filter(
    (row) =>
      Boolean(row.payment_transaction_id) &&
      Boolean(transactionId) &&
      row.payment_transaction_id !== transactionId
  );
  if (conflictingProvenance.length > 0) {
    throw integrityError(
      `arquivo e linha já estão vinculados a outra transação; nenhuma linha foi alterada.`
    );
  }

  const candidates = new Map<string, ExistingImportedPaymentIdentity>();
  [...byTransaction, ...byProvenance].forEach((row) => candidates.set(row.id, row));
  if (candidates.size > 1) {
    throw integrityError(
      `foram encontradas ${candidates.size} projeções para a mesma identidade; nenhuma linha foi alterada.`
    );
  }

  const current = Array.from(candidates.values())[0];
  if (!current) {
    return { action: 'insert', transactionId };
  }

  return {
    action: 'update',
    rowId: current.id,
    transactionId: transactionId || current.payment_transaction_id || null,
  };
}
