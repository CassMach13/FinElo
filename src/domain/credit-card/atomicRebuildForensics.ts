import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowEntry,
  AtomicCardShadowPayment,
  AtomicCardShadowProjection,
  AtomicCardShadowStatement,
  PersistedAtomicCardEntry,
  PersistedAtomicCardPayment,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from './atomicRebuildShadow';

export type AtomicCardForensicEntryField =
  | 'statementKey'
  | 'postedDate'
  | 'amountCents'
  | 'entryType';

export type AtomicCardForensicStatementField =
  | 'dueDate'
  | 'entryCount'
  | 'statementTotalCents'
  | 'totalPaymentsCents'
  | 'openBalanceCents';

export type AtomicCardForensicPaymentField =
  | 'statementKey'
  | 'paymentDate'
  | 'amountCents'
  | 'source';

export interface AtomicCardForensicChangeProfile<TField extends string> {
  key: string;
  fields: TField[];
  count: number;
}

export type AtomicCardDuplicateCohortCode =
  | 'deterministic-repair'
  | 'outside-shadow'
  | 'no-canonical-match'
  | 'missing-row-identity'
  | 'ambiguous-row-set';

export interface AtomicCardDuplicateCohort {
  code: AtomicCardDuplicateCohortCode;
  count: number;
}

export interface AtomicCardForensicStatementCount {
  statementKey: string;
  count: number;
}

export type AtomicCardForensicRecommendationCode =
  | 'investigate-ambiguous-transaction-identities'
  | 'investigate-missing-projection-entries'
  | 'review-competence-assignment'
  | 'repair-payment-duplicates-with-snapshot'
  | 'preserve-protected-statement-metadata'
  | 'activate-only-with-snapshot'
  | 'observe-no-structural-change';

export interface AtomicCardForensicReport {
  version: 1;
  /** O relatório é intencionalmente agregado: não contém IDs, descrições ou nomes de arquivos. */
  privacy: 'aggregated-no-identifiers';
  checksum: string;
  recommendedAction: 'investigate' | 'repair-narrow' | 'activate' | 'observe';
  recommendationCodes: AtomicCardForensicRecommendationCode[];
  structuralDifferenceCount: number;
  entryChangeProfiles: AtomicCardForensicChangeProfile<AtomicCardForensicEntryField>[];
  statementChangeProfiles: AtomicCardForensicChangeProfile<AtomicCardForensicStatementField>[];
  paymentChangeProfiles: AtomicCardForensicChangeProfile<AtomicCardForensicPaymentField>[];
  duplicateTransactionCohorts: AtomicCardDuplicateCohort[];
  missingTransactionsByStatement: AtomicCardForensicStatementCount[];
  orphanPaymentsWithIdentity: number;
  orphanPaymentsWithoutIdentity: number;
  repairableEntryRows: number;
  repairablePaymentRows: number;
  protectedStatementCount: number;
}

const ENTRY_FIELD_ORDER: AtomicCardForensicEntryField[] = [
  'statementKey',
  'postedDate',
  'amountCents',
  'entryType',
];

const STATEMENT_FIELD_ORDER: AtomicCardForensicStatementField[] = [
  'dueDate',
  'entryCount',
  'statementTotalCents',
  'totalPaymentsCents',
  'openBalanceCents',
];

const PAYMENT_FIELD_ORDER: AtomicCardForensicPaymentField[] = [
  'statementKey',
  'paymentDate',
  'amountCents',
  'source',
];

const entryFields = (
  current: PersistedAtomicCardEntry,
  expected: AtomicCardShadowEntry
): AtomicCardForensicEntryField[] =>
  ENTRY_FIELD_ORDER.filter((field) => {
    if (field === 'postedDate') return (current.postedDate || '') !== expected.postedDate;
    return current[field] !== expected[field];
  });

const statementFields = (
  current: PersistedAtomicCardStatement,
  expected: AtomicCardShadowStatement
): AtomicCardForensicStatementField[] =>
  STATEMENT_FIELD_ORDER.filter((field) => {
    if (field === 'dueDate') return (current.dueDate || '') !== expected.dueDate;
    return current[field] !== expected[field];
  });

const paymentFields = (
  current: PersistedAtomicCardPayment,
  expected: AtomicCardShadowPayment
): AtomicCardForensicPaymentField[] =>
  PAYMENT_FIELD_ORDER.filter((field) => {
    if (field === 'paymentDate') return (current.paymentDate || '') !== expected.paymentDate;
    return current[field] !== expected[field];
  });

const addProfile = <TField extends string>(
  profiles: Map<string, AtomicCardForensicChangeProfile<TField>>,
  fields: TField[]
): void => {
  if (fields.length === 0) return;
  const key = fields.join('+');
  const current = profiles.get(key);
  if (current) {
    current.count += 1;
    return;
  }
  profiles.set(key, { key, fields: [...fields], count: 1 });
};

const sortedProfiles = <TField extends string>(
  profiles: Map<string, AtomicCardForensicChangeProfile<TField>>
): AtomicCardForensicChangeProfile<TField>[] =>
  Array.from(profiles.values()).sort(
    (left, right) => right.count - left.count || left.key.localeCompare(right.key)
  );

const addCount = <TKey extends string>(counts: Map<TKey, number>, key: TKey): void => {
  counts.set(key, (counts.get(key) || 0) + 1);
};

const nearestEntryFields = (
  rows: PersistedAtomicCardEntry[],
  expected: AtomicCardShadowEntry
): AtomicCardForensicEntryField[] =>
  rows
    .map((row) => entryFields(row, expected))
    .sort(
      (left, right) =>
        left.length - right.length || left.join('+').localeCompare(right.join('+'))
    )[0] || [];

const classifyDuplicate = (
  transactionId: string,
  shadowEntries: Map<string, AtomicCardShadowEntry>,
  persistedEntries: Map<string, PersistedAtomicCardEntry[]>,
  comparison: AtomicCardProjectionComparison
): AtomicCardDuplicateCohortCode => {
  if (!comparison.conflictingDuplicatePersistedTransactionIds.includes(transactionId)) {
    return 'deterministic-repair';
  }

  const expected = shadowEntries.get(transactionId);
  if (!expected) return 'outside-shadow';
  const rows = persistedEntries.get(transactionId) || [];
  const exactRows = rows.filter((row) => entryFields(row, expected).length === 0);
  if (exactRows.length === 0) return 'no-canonical-match';
  if (rows.some((row) => !row.rowId)) return 'missing-row-identity';
  return 'ambiguous-row-set';
};

export function buildAtomicCardForensicReport(
  shadow: AtomicCardShadowProjection,
  persisted: PersistedAtomicCardProjection,
  comparison: AtomicCardProjectionComparison
): AtomicCardForensicReport {
  const shadowEntries = new Map(shadow.entries.map((entry) => [entry.transactionId, entry]));
  const persistedEntries = new Map<string, PersistedAtomicCardEntry[]>();
  persisted.entries.forEach((entry) => {
    const rows = persistedEntries.get(entry.transactionId) || [];
    rows.push(entry);
    persistedEntries.set(entry.transactionId, rows);
  });

  const entryProfiles = new Map<
    string,
    AtomicCardForensicChangeProfile<AtomicCardForensicEntryField>
  >();
  comparison.changedTransactionIds.forEach((transactionId) => {
    const expected = shadowEntries.get(transactionId);
    const currentRows = persistedEntries.get(transactionId) || [];
    if (!expected || currentRows.length === 0) return;
    addProfile(entryProfiles, nearestEntryFields(currentRows, expected));
  });

  const shadowStatements = new Map(
    shadow.statements.map((statement) => [statement.statementKey, statement])
  );
  const persistedStatements = new Map(
    persisted.statements.map((statement) => [statement.statementKey, statement])
  );
  const statementProfiles = new Map<
    string,
    AtomicCardForensicChangeProfile<AtomicCardForensicStatementField>
  >();
  comparison.changedStatementKeys.forEach((statementKey) => {
    const expected = shadowStatements.get(statementKey);
    const current = persistedStatements.get(statementKey);
    if (!expected || !current) return;
    addProfile(statementProfiles, statementFields(current, expected));
  });

  const shadowPayments = new Map(
    shadow.payments
      .filter((payment) => Boolean(payment.transactionId))
      .map((payment) => [payment.transactionId, payment])
  );
  const persistedPayments = new Map(
    persisted.payments
      .filter((payment) => Boolean(payment.transactionId))
      .map((payment) => [String(payment.transactionId), payment])
  );
  const paymentProfiles = new Map<
    string,
    AtomicCardForensicChangeProfile<AtomicCardForensicPaymentField>
  >();
  comparison.changedPaymentTransactionIds.forEach((transactionId) => {
    const expected = shadowPayments.get(transactionId);
    const current = persistedPayments.get(transactionId);
    if (!expected || !current) return;
    addProfile(paymentProfiles, paymentFields(current, expected));
  });

  const duplicateCounts = new Map<AtomicCardDuplicateCohortCode, number>();
  comparison.duplicatePersistedTransactionIds.forEach((transactionId) => {
    addCount(
      duplicateCounts,
      classifyDuplicate(transactionId, shadowEntries, persistedEntries, comparison)
    );
  });

  const missingByStatement = new Map<string, number>();
  comparison.missingTransactionIds.forEach((transactionId) => {
    const statementKey = shadowEntries.get(transactionId)?.statementKey || 'unknown';
    addCount(missingByStatement, statementKey);
  });

  const orphanPaymentRows = comparison.orphanPaymentKeys
    .map((key) =>
      persisted.payments.find(
        (payment) => payment.transactionId === key || `row:${payment.rowId}` === key
      )
    )
    .filter((payment): payment is PersistedAtomicCardPayment => Boolean(payment));

  const hasAmbiguousTransactions =
    comparison.conflictingDuplicatePersistedTransactionIds.length > 0;
  const hasMissingProjectionEntries = comparison.missingTransactionIds.length > 0;
  const hasCompetenceChanges = Array.from(entryProfiles.values()).some((profile) =>
    profile.fields.includes('statementKey')
  );
  const hasNarrowPaymentRepair = comparison.repairablePersistedPaymentRowIds.length > 0;

  let recommendedAction: AtomicCardForensicReport['recommendedAction'] = 'observe';
  if (comparison.safeToActivate) {
    recommendedAction = 'activate';
  } else if (hasAmbiguousTransactions || hasMissingProjectionEntries || comparison.structuralDifferenceCount > 0) {
    recommendedAction = hasNarrowPaymentRepair && !hasAmbiguousTransactions && !hasMissingProjectionEntries
      ? 'repair-narrow'
      : 'investigate';
  }

  const recommendationCodes: AtomicCardForensicRecommendationCode[] = [];
  if (hasAmbiguousTransactions) {
    recommendationCodes.push('investigate-ambiguous-transaction-identities');
  }
  if (hasMissingProjectionEntries) {
    recommendationCodes.push('investigate-missing-projection-entries');
  }
  if (hasCompetenceChanges) recommendationCodes.push('review-competence-assignment');
  if (hasNarrowPaymentRepair) recommendationCodes.push('repair-payment-duplicates-with-snapshot');
  if (comparison.protectedMetadataStatementKeys.length > 0) {
    recommendationCodes.push('preserve-protected-statement-metadata');
  }
  if (comparison.safeToActivate) recommendationCodes.push('activate-only-with-snapshot');
  if (comparison.structuralDifferenceCount === 0) {
    recommendationCodes.push('observe-no-structural-change');
  }

  return {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    checksum: shadow.checksum,
    recommendedAction,
    recommendationCodes,
    structuralDifferenceCount: comparison.structuralDifferenceCount,
    entryChangeProfiles: sortedProfiles(entryProfiles),
    statementChangeProfiles: sortedProfiles(statementProfiles),
    paymentChangeProfiles: sortedProfiles(paymentProfiles),
    duplicateTransactionCohorts: Array.from(duplicateCounts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
    missingTransactionsByStatement: Array.from(missingByStatement.entries())
      .map(([statementKey, count]) => ({ statementKey, count }))
      .sort((left, right) => right.count - left.count || left.statementKey.localeCompare(right.statementKey)),
    orphanPaymentsWithIdentity: orphanPaymentRows.filter((payment) => Boolean(payment.transactionId)).length,
    orphanPaymentsWithoutIdentity: orphanPaymentRows.filter((payment) => !payment.transactionId).length,
    repairableEntryRows: comparison.repairablePersistedEntryRowIds.length,
    repairablePaymentRows: comparison.repairablePersistedPaymentRowIds.length,
    protectedStatementCount: comparison.protectedMetadataStatementKeys.length,
  };
}
