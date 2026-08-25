import type { AtomicCardCompetenceEvidenceCycle } from './atomicRebuildCompetenceForensics';
import type { AtomicCardProvenanceReport } from './atomicRebuildProvenance';
import { simulateAtomicCardResidualStatementDryRun } from './atomicRebuildResidualStatementDryRun';
import {
  compareAtomicCardProjections,
  type AtomicCardProjectionComparison,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardProjection,
} from './atomicRebuildShadow';

export type AtomicCardEndToEndDryRunStatus =
  | 'not-needed'
  | 'converged'
  | 'partial'
  | 'blocked';

export type AtomicCardEndToEndDryRunBlockerCode =
  | 'shadow-not-safe'
  | 'persisted-source-not-engine'
  | 'residual-step-blocked'
  | 'checksum-not-conserved'
  | 'entry-count-not-conserved'
  | 'statement-count-not-conserved'
  | 'payment-count-not-conserved'
  | 'economic-content-mutated'
  | 'source-provenance-mutated'
  | 'protected-metadata-not-preserved'
  | 'protected-metadata-coverage-mismatch'
  | 'entry-records-not-preserved'
  | 'payment-records-not-preserved'
  | 'structural-difference-remains';

export type AtomicCardEndToEndDryRunRecommendationCode =
  | 'no-end-to-end-change-needed'
  | 'review-converged-projection'
  | 'preserve-all-physical-records'
  | 'preserve-economic-content-and-provenance'
  | 'preserve-protected-file-evidence'
  | 'treat-protected-metadata-as-informational'
  | 'design-reversible-execution-contract-next'
  | 'resolve-end-to-end-blockers'
  | 'keep-writes-disabled';

export interface AtomicCardEndToEndDryRunBlockerProfile {
  code: AtomicCardEndToEndDryRunBlockerCode;
  count: number;
}

export interface AtomicCardEndToEndDryRunReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  eligibleForWrite: false;
  checksum: string;
  status: AtomicCardEndToEndDryRunStatus;
  readyForReversibleExecutionPlanning: boolean;
  sequentialStatus: 'not-needed' | 'complete' | 'partial' | 'blocked';
  residualStatementStatus: 'not-needed' | 'explained' | 'partial' | 'blocked';
  structuralDifferenceCountBefore: number;
  structuralDifferenceCountAfter: number;
  informationalDifferenceCountAfter: number;
  changedTransactionCountAfter: number;
  changedStatementCountAfter: number;
  changedPaymentCountAfter: number;
  entryCountBefore: number;
  entryCountAfter: number;
  statementCountBefore: number;
  statementCountAfter: number;
  paymentCountBefore: number;
  paymentCountAfter: number;
  hypotheticalIdentityUpdateCount: number;
  hypotheticalCompetenceUpdateCount: number;
  hypotheticalStatementFieldUpdateCount: number;
  hypotheticalTotalUpdateCount: number;
  intentionalTypeReviewCount: number;
  dateMutationCount: number;
  amountMutationCount: number;
  sourceMutationCount: number;
  protectedStatementCount: number;
  protectedMetadataPreserved: boolean;
  protectedMetadataCoverageComplete: boolean;
  physicalRecordCountsPreserved: boolean;
  entryRecordsPreservedByResidualStep: boolean;
  paymentRecordsPreservedByResidualStep: boolean;
  outsideWindowPaymentWarningCount: number;
  blockerProfiles: AtomicCardEndToEndDryRunBlockerProfile[];
  recommendationCodes: AtomicCardEndToEndDryRunRecommendationCode[];
}

export interface AtomicCardEndToEndDryRunSimulation {
  /** Clone interno para compor diagnósticos posteriores, nunca um payload de escrita. */
  persisted: PersistedAtomicCardProjection;
  report: AtomicCardEndToEndDryRunReport;
}

const BLOCKER_ORDER: AtomicCardEndToEndDryRunBlockerCode[] = [
  'shadow-not-safe',
  'persisted-source-not-engine',
  'residual-step-blocked',
  'checksum-not-conserved',
  'entry-count-not-conserved',
  'statement-count-not-conserved',
  'payment-count-not-conserved',
  'economic-content-mutated',
  'source-provenance-mutated',
  'protected-metadata-not-preserved',
  'protected-metadata-coverage-mismatch',
  'entry-records-not-preserved',
  'payment-records-not-preserved',
  'structural-difference-remains',
];

const addCount = (
  counts: Map<AtomicCardEndToEndDryRunBlockerCode, number>,
  code: AtomicCardEndToEndDryRunBlockerCode,
  count = 1
): void => {
  counts.set(code, (counts.get(code) || 0) + count);
};

const changedPaymentCount = (comparison: AtomicCardProjectionComparison): number =>
  comparison.duplicatePersistedPaymentTransactionIds.length +
  comparison.suspiciousPersistedPaymentEventKeys.length +
  comparison.missingPaymentKeys.length +
  comparison.orphanPaymentKeys.length +
  comparison.changedPaymentTransactionIds.length;

/**
 * Encadeia todas as simulações comprovadas até aqui e certifica a convergência
 * estrutural somente em memória. O relatório é agregado, não contém identidades
 * nem payload de mutação e nunca autoriza escrita por si próprio.
 */
export function simulateAtomicCardEndToEndDryRun(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  provenance: AtomicCardProvenanceReport;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
}): AtomicCardEndToEndDryRunSimulation {
  const blockers = new Map<AtomicCardEndToEndDryRunBlockerCode, number>();
  const residual = simulateAtomicCardResidualStatementDryRun(input);
  const finalPersisted = residual.persisted;
  const after = compareAtomicCardProjections(input.shadow, finalPersisted);

  if (!input.shadow.safeToStage || input.shadow.blockers.length > 0) {
    addCount(blockers, 'shadow-not-safe', Math.max(1, input.shadow.blockers.length));
  }
  if (input.persisted.source !== 'engine') {
    addCount(blockers, 'persisted-source-not-engine');
  }
  if (residual.report.status === 'blocked') {
    addCount(
      blockers,
      'residual-step-blocked',
      Math.max(
        1,
        residual.report.blockerProfiles.reduce((total, profile) => total + profile.count, 0)
      )
    );
  }
  if (residual.report.checksum !== input.shadow.checksum) {
    addCount(blockers, 'checksum-not-conserved');
  }

  const entryCountBefore = input.persisted.entries.length;
  const entryCountAfter = finalPersisted.entries.length;
  const statementCountBefore = input.persisted.statements.length;
  const statementCountAfter = finalPersisted.statements.length;
  const paymentCountBefore = input.persisted.payments.length;
  const paymentCountAfter = finalPersisted.payments.length;
  if (entryCountBefore !== entryCountAfter) {
    addCount(blockers, 'entry-count-not-conserved', Math.abs(entryCountBefore - entryCountAfter));
  }
  if (statementCountBefore !== statementCountAfter) {
    addCount(
      blockers,
      'statement-count-not-conserved',
      Math.abs(statementCountBefore - statementCountAfter)
    );
  }
  if (paymentCountBefore !== paymentCountAfter) {
    addCount(
      blockers,
      'payment-count-not-conserved',
      Math.abs(paymentCountBefore - paymentCountAfter)
    );
  }

  const economicMutationCount =
    residual.report.sequentialDateMutationCount +
    residual.report.sequentialAmountMutationCount;
  if (economicMutationCount > 0) {
    addCount(blockers, 'economic-content-mutated', economicMutationCount);
  }
  if (residual.report.sequentialSourceMutationCount > 0) {
    addCount(
      blockers,
      'source-provenance-mutated',
      residual.report.sequentialSourceMutationCount
    );
  }
  if (!residual.report.protectedMetadataPreserved) {
    addCount(blockers, 'protected-metadata-not-preserved');
  }
  if (!residual.report.entryRecordsPreserved) {
    addCount(blockers, 'entry-records-not-preserved');
  }
  if (!residual.report.paymentRecordsPreserved) {
    addCount(blockers, 'payment-records-not-preserved');
  }

  const protectedMetadataCoverageComplete =
    after.protectedMetadataStatementKeys.length === residual.report.protectedStatementCount;
  if (!protectedMetadataCoverageComplete) {
    addCount(
      blockers,
      'protected-metadata-coverage-mismatch',
      Math.max(
        1,
        Math.abs(
          after.protectedMetadataStatementKeys.length - residual.report.protectedStatementCount
        )
      )
    );
  }
  if (after.structuralDifferenceCount > 0) {
    addCount(blockers, 'structural-difference-remains', after.structuralDifferenceCount);
  }

  const physicalRecordCountsPreserved =
    entryCountBefore === entryCountAfter &&
    statementCountBefore === statementCountAfter &&
    paymentCountBefore === paymentCountAfter;
  const readyForReversibleExecutionPlanning =
    blockers.size === 0 &&
    after.structuralDifferenceCount === 0 &&
    residual.report.status !== 'partial' &&
    residual.report.status !== 'blocked';
  const status: AtomicCardEndToEndDryRunStatus =
    blockers.size > 0
      ? 'blocked'
      : input.comparison.structuralDifferenceCount === 0
        ? 'not-needed'
        : readyForReversibleExecutionPlanning
          ? 'converged'
          : 'partial';

  const recommendationCodes: AtomicCardEndToEndDryRunRecommendationCode[] = [];
  if (status === 'not-needed') {
    recommendationCodes.push('no-end-to-end-change-needed');
  } else if (status === 'converged') {
    recommendationCodes.push('review-converged-projection');
  } else {
    recommendationCodes.push('resolve-end-to-end-blockers');
  }
  recommendationCodes.push(
    'preserve-all-physical-records',
    'preserve-economic-content-and-provenance',
    'preserve-protected-file-evidence'
  );
  if (after.protectedMetadataStatementKeys.length > 0) {
    recommendationCodes.push('treat-protected-metadata-as-informational');
  }
  if (readyForReversibleExecutionPlanning) {
    recommendationCodes.push('design-reversible-execution-contract-next');
  }
  recommendationCodes.push('keep-writes-disabled');

  const report: AtomicCardEndToEndDryRunReport = {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    nonAuthoritative: true,
    executable: false,
    mutationPayloadIncluded: false,
    actualWriteOperationCount: 0,
    eligibleForWrite: false,
    checksum: input.shadow.checksum,
    status,
    readyForReversibleExecutionPlanning,
    sequentialStatus: residual.report.sequentialStatus,
    residualStatementStatus: residual.report.status,
    structuralDifferenceCountBefore: input.comparison.structuralDifferenceCount,
    structuralDifferenceCountAfter: after.structuralDifferenceCount,
    informationalDifferenceCountAfter:
      after.differenceCount - after.structuralDifferenceCount,
    changedTransactionCountAfter: after.changedTransactionIds.length,
    changedStatementCountAfter: after.changedStatementKeys.length,
    changedPaymentCountAfter: changedPaymentCount(after),
    entryCountBefore,
    entryCountAfter,
    statementCountBefore,
    statementCountAfter,
    paymentCountBefore,
    paymentCountAfter,
    hypotheticalIdentityUpdateCount:
      residual.report.sequentialHypotheticalIdentityUpdateCount,
    hypotheticalCompetenceUpdateCount:
      residual.report.sequentialHypotheticalCompetenceUpdateCount,
    hypotheticalStatementFieldUpdateCount:
      residual.report.hypotheticalStatementFieldUpdateCount,
    hypotheticalTotalUpdateCount:
      residual.report.sequentialHypotheticalIdentityUpdateCount +
      residual.report.sequentialHypotheticalCompetenceUpdateCount +
      residual.report.hypotheticalStatementFieldUpdateCount,
    intentionalTypeReviewCount: residual.report.sequentialTypeMutationCount,
    dateMutationCount: residual.report.sequentialDateMutationCount,
    amountMutationCount: residual.report.sequentialAmountMutationCount,
    sourceMutationCount: residual.report.sequentialSourceMutationCount,
    protectedStatementCount: residual.report.protectedStatementCount,
    protectedMetadataPreserved: residual.report.protectedMetadataPreserved,
    protectedMetadataCoverageComplete,
    physicalRecordCountsPreserved,
    entryRecordsPreservedByResidualStep: residual.report.entryRecordsPreserved,
    paymentRecordsPreservedByResidualStep: residual.report.paymentRecordsPreserved,
    outsideWindowPaymentWarningCount: residual.report.outsideWindowPaymentWarningCount,
    blockerProfiles: BLOCKER_ORDER
      .map((code) => ({ code, count: blockers.get(code) || 0 }))
      .filter((profile) => profile.count > 0),
    recommendationCodes,
  };

  return { persisted: finalPersisted, report };
}

export function buildAtomicCardEndToEndDryRunReport(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  provenance: AtomicCardProvenanceReport;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
}): AtomicCardEndToEndDryRunReport {
  return simulateAtomicCardEndToEndDryRun(input).report;
}
