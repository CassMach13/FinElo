import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useAppStore } from '../../hooks/useAppStore';
import { appAlert, appConfirm } from '../../hooks/useDialogStore';
import { comparableImportOriginKey } from '../../utils/importOriginKey';
import { isCreditCardEngineEnabled } from '../../services/featureFlagService';
import { creditCardRebuildFromImportHistoryService } from '../../services/creditCardRebuildFromImportHistoryService';
import type {
  AtomicCardPaymentRepairRollbackAvailability,
  AtomicCardRebuildAuditResult,
  AtomicCardRollbackAvailability,
} from '../../services/creditCardAtomicRebuildService';
import { formatCurrency } from '../../utils/formatters';
import type { Account, ImportLog, Transaction } from '../../types';
import Select from '../ui/Select';
import { unknownErrorMessage } from '../../utils/unknownError';
import {
  buildAtomicCardForensicReport,
  type AtomicCardDuplicateCohortCode,
  type AtomicCardForensicRecommendationCode,
} from '../../domain/credit-card/atomicRebuildForensics';
import {
  buildAtomicCardLineageReport,
  type AtomicCardLineageMatchCode,
  type AtomicCardLineageRecommendationCode,
  type AtomicCardLineageStatus,
} from '../../domain/credit-card/atomicRebuildLineage';
import {
  buildAtomicCardProvenanceReport,
  type AtomicCardProvenanceEvidenceCode,
  type AtomicCardProvenanceRecommendationCode,
  type AtomicCardProvenanceStatus,
} from '../../domain/credit-card/atomicRebuildProvenance';
import {
  buildAtomicCardIdentityDryRunReport,
  type AtomicCardIdentityDryRunBlockerCode,
  type AtomicCardIdentityDryRunChangeCode,
  type AtomicCardIdentityDryRunRecommendationCode,
  type AtomicCardIdentityDryRunStatus,
} from '../../domain/credit-card/atomicRebuildIdentityDryRun';
import {
  buildAtomicCardCompetenceForensicReport,
  type AtomicCardCompetenceCauseCode,
  type AtomicCardCompetenceEvidenceSource,
  type AtomicCardCompetenceForensicStatus,
  type AtomicCardCompetenceRecommendationCode,
} from '../../domain/credit-card/atomicRebuildCompetenceForensics';
import {
  buildAtomicCardCompetenceDryRunReport,
  type AtomicCardCompetenceDryRunBlockerCode,
  type AtomicCardCompetenceDryRunExclusionCode,
  type AtomicCardCompetenceDryRunRecommendationCode,
  type AtomicCardCompetenceDryRunStatus,
} from '../../domain/credit-card/atomicRebuildCompetenceDryRun';
import {
  buildAtomicCardCompetenceExceptionForensicReport,
  type AtomicCardCompetenceExceptionForensicStatus,
  type AtomicCardCompetenceExceptionLaneCode,
  type AtomicCardCompetenceExceptionRecommendationCode,
} from '../../domain/credit-card/atomicRebuildCompetenceExceptionForensics';
import {
  buildAtomicCardStatementConflictForensicReport,
  type AtomicCardStatementConflictFieldCode,
  type AtomicCardStatementConflictForensicStatus,
  type AtomicCardStatementConflictRecommendationCode,
  type AtomicCardStatementShadowMatchCode,
} from '../../domain/credit-card/atomicRebuildStatementConflictForensics';
import {
  buildAtomicCardAffectedEntryReconciliationReport,
  type AtomicCardAffectedEntryReconciliationRecommendationCode,
  type AtomicCardAffectedEntryReconciliationStatus,
} from '../../domain/credit-card/atomicRebuildAffectedEntryReconciliation';
import {
  buildAtomicCardStatementConservationDryRunReport,
  isAtomicCardActivationBlockedByStatementConservation,
  type AtomicCardStatementConservationBlockerCode,
  type AtomicCardStatementConservationDryRunStatus,
  type AtomicCardStatementConservationRecommendationCode,
} from '../../domain/credit-card/atomicRebuildStatementConservationDryRun';
import {
  buildAtomicCardStatementConservationPlanReport,
  type AtomicCardStatementConservationPlanBlockerCode,
  type AtomicCardStatementConservationPlanRecommendationCode,
  type AtomicCardStatementConservationPlanStatus,
} from '../../domain/credit-card/atomicRebuildStatementConservationPlan';
import {
  prepareAtomicCardStatementConservationExecution,
  type AtomicCardStatementConservationExecutionBlockerCode,
  type AtomicCardStatementConservationExecutionStatus,
} from '../../domain/credit-card/atomicRebuildStatementConservationExecution';
import {
  buildAtomicCardSequentialDryRunReport,
  type AtomicCardSequentialDryRunBlockerCode,
  type AtomicCardSequentialDryRunRecommendationCode,
  type AtomicCardSequentialDryRunStatus,
} from '../../domain/credit-card/atomicRebuildSequentialDryRun';
import {
  buildAtomicCardResidualStatementDryRunReport,
  type AtomicCardResidualStatementDryRunBlockerCode,
  type AtomicCardResidualStatementDryRunRecommendationCode,
  type AtomicCardResidualStatementDryRunStatus,
  type AtomicCardResidualStatementFieldCode,
} from '../../domain/credit-card/atomicRebuildResidualStatementDryRun';

const FORENSIC_FIELD_LABELS: Record<string, string> = {
  statementKey: 'competência',
  postedDate: 'data',
  amountCents: 'valor',
  entryType: 'tipo',
  dueDate: 'vencimento',
  entryCount: 'quantidade de itens',
  statementTotalCents: 'total',
  totalPaymentsCents: 'pagamentos',
  openBalanceCents: 'saldo',
  paymentDate: 'data',
  source: 'origem',
};

const FORENSIC_DUPLICATE_LABELS: Record<AtomicCardDuplicateCohortCode, string> = {
  'deterministic-repair': 'reparo determinístico',
  'outside-shadow': 'fora da reconstrução',
  'no-canonical-match': 'sem linha canônica compatível',
  'missing-row-identity': 'linha sem identidade persistida',
  'ambiguous-row-set': 'conjunto de linhas ambíguo',
};

const FORENSIC_RECOMMENDATION_LABELS: Record<AtomicCardForensicRecommendationCode, string> = {
  'investigate-ambiguous-transaction-identities': 'Investigar identidades duplicadas antes de qualquer remoção.',
  'investigate-missing-projection-entries': 'Explicar itens ausentes da projeção atual antes de reconstruir.',
  'review-competence-assignment': 'Revisar a regra de competência que concentra as mudanças de itens.',
  'repair-payment-duplicates-with-snapshot': 'Reparar somente pagamentos inequivocamente duplicados, sempre com snapshot.',
  'preserve-protected-statement-metadata': 'Preservar totais oficiais e ajustes protegidos das faturas.',
  'activate-only-with-snapshot': 'Ativar apenas com snapshot individual e revisão imutável.',
  'observe-no-structural-change': 'Manter em observação; não há mudança estrutural pendente.',
};

const LINEAGE_STATUS_LABELS: Record<AtomicCardLineageStatus, string> = {
  clean: 'nenhuma quebra de identidade detectada',
  'explained-no-safe-repair': 'linhas conservadas; quebra de identidade explicada, mas sem reparo seguro',
  'partially-explained': 'quebra de identidade parcialmente explicada',
  unresolved: 'lacuna de identidade ainda não explicada',
};

const LINEAGE_MATCH_LABELS: Record<AtomicCardLineageMatchCode, string> = {
  'exact-content-unique': 'conteúdo integral com pareamento único',
  'exact-content-ambiguous': 'conteúdo integral repetido e ambíguo',
  'competence-shift-unique': 'mesmo conteúdo em outra competência',
  'competence-shift-ambiguous': 'mesmo conteúdo repetido em outra competência',
  'type-shift-unique': 'mesma data e valor com tipo diferente',
  'type-shift-ambiguous': 'mesma data e valor com tipos ambíguos',
  'date-amount-only': 'coincidência fraca de data e valor',
  unmatched: 'sem explicação por conteúdo',
};

const LINEAGE_RECOMMENDATION_LABELS: Record<AtomicCardLineageRecommendationCode, string> = {
  'row-count-conserved-not-deleted': 'A quantidade de linhas desta projeção foi conservada; não há indício de perda por redução de volume.',
  'identity-surplus-balances-missing': 'As identidades ausentes são numericamente compensadas por linhas excedentes em grupos duplicados.',
  'content-signatures-explain-missing': 'As assinaturas de conteúdo explicam todas as identidades ausentes, sem autorizar exclusão automática.',
  'restore-source-provenance-before-repair': 'Recuperar proveniência histórica antes de escolher qual linha representa cada identidade.',
  'review-competence-before-identity-repair': 'Resolver primeiro a regra de competência; ela altera a linha usada como referência.',
  'do-not-reimport': 'Não reimportar arquivos para tentar corrigir o histórico; isso pode ampliar as duplicidades.',
  'keep-activation-blocked': 'Manter ativação e reparos bloqueados enquanto houver identidade ambígua.',
  'deterministic-repair-path-available': 'Existem linhas com reparo determinístico separado, sempre condicionado a snapshot.',
  'unexplained-row-gap': 'Persistem linhas ou identidades sem explicação suficiente; aprofundar a auditoria antes de qualquer escrita.',
};

const PROVENANCE_STATUS_LABELS: Record<AtomicCardProvenanceStatus, string> = {
  clean: 'nenhuma identidade precisa ser reconstruída',
  'fully-traceable': 'todas as identidades ausentes possuem trilha completa e única',
  'partially-traceable': 'parte das identidades possui trilha completa',
  ambiguous: 'existem colisões ou âncoras ambíguas',
  'insufficient-evidence': 'a proveniência disponível ainda é insuficiente',
};

const PROVENANCE_EVIDENCE_LABELS: Record<AtomicCardProvenanceEvidenceCode, string> = {
  'exact-provenance-content': 'origem exata e conteúdo preservado',
  'exact-provenance-competence-shift': 'origem exata, reposicionada entre competências',
  'exact-provenance-type-shift': 'origem exata, com tipo divergente',
  'exact-provenance-competence-and-type-shift': 'origem exata, com competência e tipo divergentes',
  'exact-provenance-content-mismatch': 'origem exata, mas conteúdo econômico divergente',
  'ambiguous-provenance': 'origem repetida ou ambígua',
  'missing-provenance': 'origem histórica não localizada',
  'missing-row-identity': 'linha localizada sem identidade persistida',
  'owner-not-duplicated': 'linha localizada sem duplicidade que explique a troca',
  'owner-anchor-missing': 'âncora da identidade atual não localizada',
  'owner-anchor-ambiguous': 'mais de uma âncora possível para a identidade atual',
};

const PROVENANCE_RECOMMENDATION_LABELS: Record<AtomicCardProvenanceRecommendationCode, string> = {
  'no-identity-reconstruction-needed': 'Nenhuma reconstrução de identidade é necessária nesta projeção.',
  'all-missing-identities-have-exact-provenance': 'Todas as identidades ausentes foram localizadas por origem e hash da linha.',
  'owner-anchors-confirmed': 'Cada identidade atualmente duplicada possui uma âncora independente que deve ser preservada.',
  'future-dry-run-plan-available': 'Há evidência suficiente para desenvolver futuramente um plano de simulação, ainda sem escrita.',
  'investigate-provenance-collisions': 'Investigar colisões de proveniência antes de selecionar qualquer linha.',
  'investigate-unavailable-provenance': 'Completar a trilha histórica das linhas ainda sem evidência suficiente.',
  'review-competence-before-any-repair': 'Confirmar a competência correta antes de considerar qualquer reparo de identidade.',
  'preserve-owner-anchor': 'Preservar as linhas-âncora; elas comprovam qual registro deve conservar a identidade atual.',
  'no-write-without-snapshot': 'Qualquer etapa futura de escrita exigirá snapshot individual e rollback previamente testado.',
  'do-not-reimport': 'Não reimportar arquivos para corrigir a identidade; isso pode ampliar as duplicidades.',
  'keep-activation-blocked': 'Manter projeção e reparos bloqueados nesta etapa somente leitura.',
};

const IDENTITY_DRY_RUN_STATUS_LABELS: Record<AtomicCardIdentityDryRunStatus, string> = {
  'not-needed': 'nenhuma reconstrução de identidade é necessária',
  ready: 'simulação completa e rastreável para revisão',
  blocked: 'simulação bloqueada por evidência insuficiente ou inconsistente',
};

const IDENTITY_DRY_RUN_CHANGE_LABELS: Record<AtomicCardIdentityDryRunChangeCode, string> = {
  'identity-only': 'somente identidade',
  'identity-and-competence': 'identidade e competência',
  'identity-and-type': 'identidade e tipo',
  'identity-competence-and-type': 'identidade, competência e tipo',
};

const IDENTITY_DRY_RUN_BLOCKER_LABELS: Record<AtomicCardIdentityDryRunBlockerCode, string> = {
  'persisted-source-not-engine': 'a fonte atual não é o motor persistido',
  'provenance-report-not-eligible': 'a proveniência ainda não autorizou uma simulação',
  'row-count-not-conserved': 'a quantidade de linhas não foi conservada',
  'orphan-identity-present': 'existem identidades órfãs fora do pareamento',
  'repairable-deletion-path-present': 'há um reparo de exclusão separado que deve ser resolvido antes',
  'missing-provenance': 'faltou proveniência para localizar uma linha',
  'ambiguous-provenance': 'a mesma proveniência aponta para mais de uma linha',
  'missing-row-identity': 'uma linha localizada não possui identidade persistida',
  'owner-not-duplicated': 'a identidade atual não possui a duplicidade esperada',
  'owner-anchor-missing': 'a âncora que deveria ser preservada não foi encontrada',
  'owner-anchor-ambiguous': 'mais de uma âncora poderia ser preservada',
  'economic-content-mismatch': 'data ou valor diverge do conteúdo econômico esperado',
  'candidate-reused': 'uma linha candidata seria reutilizada',
  'unrelated-duplicate-group': 'há grupos duplicados sem explicação neste plano',
  'simulation-did-not-close-identity-gap': 'a simulação não eliminou todas as lacunas de identidade',
};

const IDENTITY_DRY_RUN_RECOMMENDATION_LABELS: Record<AtomicCardIdentityDryRunRecommendationCode, string> = {
  'no-identity-reconstruction-needed': 'Nenhuma reconstrução de identidade é necessária.',
  'review-individual-dry-run': 'Revisar os grupos simulados antes de desenvolver qualquer execução futura.',
  'preserve-confirmed-anchors': 'Preservar todas as âncoras confirmadas; nenhuma delas integra a troca simulada.',
  'review-competence-changes': 'Confirmar as competências propostas antes de considerar uma etapa de escrita.',
  'review-type-changes': 'Confirmar as mudanças de tipo antes de considerar uma etapa de escrita.',
  'residual-structural-differences-remain': 'A simulação de identidade não resolve todas as diferenças estruturais da projeção.',
  'snapshot-before-future-execution': 'Uma eventual execução futura exigirá snapshot individual e rollback validado.',
  'keep-writes-disabled': 'Manter reparos e ativações desabilitados nesta etapa.',
  'investigate-dry-run-blockers': 'Investigar todos os bloqueios antes de gerar uma nova simulação.',
};

const COMPETENCE_FORENSIC_STATUS_LABELS: Record<AtomicCardCompetenceForensicStatus, string> = {
  aligned: 'competências já alinhadas',
  'root-cause-isolated': 'causa dominante isolada com alta confiança',
  'review-needed': 'padrão encontrado, mas ainda com exceções para revisar',
  blocked: 'diagnóstico bloqueado por pareamento ou conteúdo inconsistente',
};

const COMPETENCE_CAUSE_LABELS: Record<AtomicCardCompetenceCauseCode, string> = {
  'current-keyed-by-due-month': 'projeção atual usa o mês do vencimento como competência',
  'current-keyed-by-posted-month': 'projeção atual usa o mês da data do lançamento',
  'current-keyed-by-other-month': 'projeção atual usa outra competência',
  'type-only': 'somente o tipo diverge',
  'already-aligned': 'competência e tipo já alinhados',
};

const COMPETENCE_EVIDENCE_LABELS: Record<AtomicCardCompetenceEvidenceSource, string> = {
  'confirmed-import-history': 'competência confirmada no histórico da importação',
  'session-confirmed': 'competência revisada nesta sessão',
  'persisted-import-history': 'competência persistida no histórico legado',
  'suggested-automatic': 'competência sugerida automaticamente',
  'manual-transaction-rule': 'competência de lançamento manual',
  unknown: 'origem da competência não identificada',
};

const COMPETENCE_RECOMMENDATION_LABELS: Record<AtomicCardCompetenceRecommendationCode, string> = {
  'honor-confirmed-import-competence': 'Tratar a competência confirmada no histórico como fonte prioritária.',
  'separate-reference-competence-from-due-month': 'Separar definitivamente a competência da chave técnica do mês de vencimento.',
  'use-closing-day-only-as-fallback': 'Usar o dia de fechamento apenas como fallback quando não houver competência confirmada.',
  'preserve-explicit-manual-competence': 'Preservar a competência explícita dos lançamentos manuais.',
  'review-type-coupled-exceptions': 'Revisar separadamente as poucas linhas em que competência e tipo divergem juntos.',
  'develop-read-only-competence-dry-run': 'A evidência permite desenvolver uma futura simulação de competência, ainda sem escrita.',
  'investigate-unmatched-rows': 'Resolver linhas sem pareamento único antes de concluir a regra.',
  'keep-writes-disabled': 'Manter reparos, ativações e migrations desabilitados nesta etapa.',
};

const COMPETENCE_DRY_RUN_STATUS_LABELS: Record<AtomicCardCompetenceDryRunStatus, string> = {
  'not-needed': 'nenhuma correção de competência necessária',
  ready: 'simulação completa pronta para revisão',
  partial: 'simulação parcial; exceções estruturais isoladas',
  blocked: 'simulação bloqueada por evidência insuficiente',
};

const COMPETENCE_DRY_RUN_EXCLUSION_LABELS: Record<AtomicCardCompetenceDryRunExclusionCode, string> = {
  'missing-row-identity': 'linha atual sem identidade persistida',
  'identity-mismatch': 'identidade atual diverge da linha confirmada',
  'duplicate-current-identity': 'identidade atual pertence a grupo duplicado',
  'type-mismatch': 'tipo do lançamento também diverge',
  'duplicate-statement-key': 'competência possui fatura duplicada',
  'unconfirmed-competence-evidence': 'competência sem evidência confirmada',
};

const COMPETENCE_DRY_RUN_BLOCKER_LABELS: Record<AtomicCardCompetenceDryRunBlockerCode, string> = {
  'persisted-source-not-engine': 'a fonte atual não é o motor persistido',
  'forensic-report-not-eligible': 'a auditoria 2H ainda não autorizou a simulação',
  'row-count-not-conserved': 'a quantidade de linhas não foi conservada',
  'unmatched-row': 'há linha projetada sem correspondência única',
  'ambiguous-row': 'há mais de uma linha atual possível para a mesma origem',
  'economic-content-mismatch': 'data ou valor diverge do conteúdo confirmado',
  'no-safe-candidates': 'nenhuma divergência pode ser simulada com todas as garantias',
};

const COMPETENCE_DRY_RUN_RECOMMENDATION_LABELS: Record<AtomicCardCompetenceDryRunRecommendationCode, string> = {
  'no-competence-change-needed': 'Nenhuma mudança de competência precisa ser planejada.',
  'review-competence-only-simulation': 'Revisar a simulação agregada antes de desenvolver qualquer escrita.',
  'preserve-identity-date-value-and-type': 'Preservar identidade, data, valor, tipo e proveniência de cada linha.',
  'resolve-excluded-structural-anomalies': 'Resolver as exceções estruturais isoladas em fluxo separado.',
  'preserve-protected-statement-metadata': 'Preservar integralmente os metadados protegidos das faturas envolvidas.',
  'investigate-dry-run-blockers': 'Investigar todos os bloqueios antes de gerar uma nova simulação.',
  'future-execution-requires-snapshot': 'Uma eventual execução futura exigirá snapshot individual e rollback validado.',
  'keep-writes-disabled': 'Manter reparos, ativações e migrations desabilitados nesta etapa.',
};

const COMPETENCE_EXCEPTION_STATUS_LABELS: Record<AtomicCardCompetenceExceptionForensicStatus, string> = {
  'no-exceptions': 'nenhuma exceção precisa ser classificada',
  'dependencies-isolated': 'dependências isoladas em uma sequência verificável',
  'review-needed': 'classificação parcial; ainda há dependências para investigar',
  blocked: 'classificação bloqueada por contagens ou evidências inconsistentes',
};

const COMPETENCE_EXCEPTION_LANE_LABELS: Record<AtomicCardCompetenceExceptionLaneCode, string> = {
  'identity-reconstruction-prerequisite': 'reconstruir identidade antes da competência',
  'duplicate-identity-anchor-prerequisite': 'preservar âncoras de identidades duplicadas',
  'statement-structure-prerequisite': 'conciliar registros duplicados de fatura',
  'entry-type-review': 'revisar tipo do lançamento',
  'persisted-row-identity-review': 'recuperar identidade persistida da linha',
  'competence-evidence-review': 'confirmar evidência da competência',
};

const COMPETENCE_EXCEPTION_RECOMMENDATION_LABELS: Record<AtomicCardCompetenceExceptionRecommendationCode, string> = {
  'preserve-all-current-rows': 'Preservar todas as linhas atuais; esta etapa não autoriza exclusão nem substituição.',
  'run-identity-dry-run-before-competence': 'Executar primeiro a simulação de identidade; competência depende desse pareamento.',
  'preserve-confirmed-identity-anchors': 'Preservar as âncoras confirmadas dos grupos de identidade duplicada.',
  'reconcile-statement-records-before-competence': 'Explicar os registros duplicados de fatura antes de mover qualquer competência.',
  'protect-statement-metadata': 'Preservar totais oficiais, pagamentos e demais metadados protegidos das faturas.',
  'review-type-coupled-exceptions': 'Revisar separadamente as linhas em que o tipo também diverge.',
  'restore-persisted-row-identity': 'Recuperar a identidade persistida da linha antes de qualquer simulação adicional.',
  'confirm-competence-evidence': 'Confirmar a origem da competência antes de tratá-la como fonte de verdade.',
  'rerun-competence-dry-run-after-prerequisites': 'Reexecutar a simulação de competência somente depois de resolver os pré-requisitos.',
  'investigate-unclassified-exceptions': 'Investigar a diferença de contagem antes de considerar a classificação completa.',
  'keep-writes-disabled': 'Manter reparos, ativações e migrations desabilitados nesta etapa.',
};

const SEQUENTIAL_DRY_RUN_STATUS_LABELS: Record<AtomicCardSequentialDryRunStatus, string> = {
  'not-needed': 'nenhuma mudança sequencial é necessária',
  complete: 'sequência concluída no clone sem diferenças estruturais',
  partial: 'sequência concluída; diferenças residuais permanecem isoladas',
  blocked: 'sequência bloqueada por invariantes ou evidências insuficientes',
};

const SEQUENTIAL_DRY_RUN_BLOCKER_LABELS: Record<AtomicCardSequentialDryRunBlockerCode, string> = {
  'identity-step-blocked': 'a reconstrução de identidade não pôde ser comprovada',
  'competence-step-blocked': 'a simulação de competência não pôde ser concluída',
  'row-count-not-conserved': 'a quantidade física de linhas mudou no clone',
  'physical-row-identity-not-conserved': 'a identidade física das linhas não foi conservada',
  'identity-gap-remains': 'ainda existem identidades ausentes, duplicadas ou órfãs',
  'economic-content-mutated': 'data ou valor foi alterado indevidamente',
  'source-provenance-mutated': 'a proveniência histórica foi alterada indevidamente',
  'statement-records-mutated': 'os registros de fatura foram modificados pelo diagnóstico',
  'payment-records-mutated': 'os registros de pagamento foram modificados pelo diagnóstico',
};

const SEQUENTIAL_DRY_RUN_RECOMMENDATION_LABELS: Record<AtomicCardSequentialDryRunRecommendationCode, string> = {
  'no-sequential-change-needed': 'Nenhuma reconstrução sequencial precisa ser planejada.',
  'review-sequential-simulation': 'Revisar o resultado conjunto antes de desenhar qualquer operação futura.',
  'preserve-all-physical-rows': 'Preservar todas as linhas físicas; a sequência não autoriza exclusões.',
  'preserve-confirmed-identity-anchors': 'Preservar as âncoras confirmadas dos grupos de identidade.',
  'preserve-economic-content-and-provenance': 'Conservar data, valor e proveniência histórica de cada linha.',
  'review-residual-statement-and-payment-differences': 'Tratar separadamente as diferenças residuais de faturas, pagamentos ou tipos.',
  'resolve-sequential-blockers': 'Resolver todos os bloqueios antes de repetir a simulação sequencial.',
  'keep-writes-disabled': 'Manter reparos, ativações e migrations desabilitados nesta etapa.',
};

const RESIDUAL_STATEMENT_DRY_RUN_STATUS_LABELS: Record<AtomicCardResidualStatementDryRunStatus, string> = {
  'not-needed': 'nenhuma divergência residual de liquidação precisa ser explicada',
  explained: 'a origem das divergências de fatura foi isolada no clone',
  partial: 'parte das divergências foi explicada; resíduos permanecem isolados',
  blocked: 'a separação foi bloqueada por evidência insuficiente ou invariante',
};

const RESIDUAL_STATEMENT_FIELD_LABELS: Record<AtomicCardResidualStatementFieldCode, string> = {
  totalPaymentsCents: 'quitação aplicada à competência',
  openBalanceCents: 'saldo derivado da fatura',
};

const RESIDUAL_STATEMENT_DRY_RUN_BLOCKER_LABELS: Record<AtomicCardResidualStatementDryRunBlockerCode, string> = {
  'sequential-step-blocked': 'a simulação sequencial anterior ainda está bloqueada',
  'persisted-source-not-engine': 'a projeção atual não veio integralmente do engine',
  'statement-pair-not-unique': 'uma fatura não possui par único entre projeção atual e sombra',
  'payment-ledger-not-aligned': 'os vínculos físicos de pagamento ainda divergem da sombra',
  'non-settlement-statement-difference': 'há diferenças em campos que não pertencem à liquidação',
  'shadow-payment-total-not-conserved': 'o total de pagamentos da sombra não fecha com seus vínculos',
  'statement-count-not-conserved': 'a quantidade física de faturas mudou no clone',
  'protected-metadata-mutated': 'metadados protegidos do arquivo foram modificados',
  'entry-records-mutated': 'linhas de lançamento foram modificadas por esta etapa',
  'payment-records-mutated': 'linhas físicas de pagamento foram modificadas por esta etapa',
  'settlement-difference-remains': 'uma divergência de liquidação permaneceu após a separação',
};

const RESIDUAL_STATEMENT_DRY_RUN_RECOMMENDATION_LABELS: Record<AtomicCardResidualStatementDryRunRecommendationCode, string> = {
  'no-residual-statement-rebase-needed': 'Nenhuma separação adicional de liquidação precisa ser planejada.',
  'separate-file-payment-from-applied-settlement': 'Separar o pagamento informado no próprio arquivo da quitação efetivamente aplicada à competência.',
  'use-payment-links-for-settlement': 'Usar os vínculos materiais de pagamento para determinar qual fatura foi quitada.',
  'preserve-protected-file-totals': 'Preservar os totais oficiais do arquivo como evidência histórica, sem tratá-los como quitação da mesma competência.',
  'retain-outside-window-payment-as-context': 'Manter pagamentos anteriores à janela como contexto histórico, sem forçar um destino inexistente.',
  'review-non-settlement-statement-fields': 'Revisar separadamente vencimento, contagem ou total quando algum deles também divergir.',
  'resolve-payment-ledger-before-rebase': 'Alinhar primeiro os vínculos de pagamento antes de simular qualquer campo derivado.',
  'keep-writes-disabled': 'Manter reparos, ativações e migrations desabilitados nesta etapa.',
};

const COMPETENCE_IDENTITY_PREREQUISITE_LABELS = {
  'not-needed': 'não necessária',
  'covered-by-ready-dry-run': 'coberta pela simulação de identidade',
  partial: 'cobertura parcial',
  blocked: 'bloqueada',
} as const;

const COMPETENCE_STATEMENT_PREREQUISITE_LABELS = {
  'not-needed': 'não necessária',
  isolated: 'estrutura duplicada isolada',
  'review-needed': 'duplicidade conflitante ou protegida',
  blocked: 'estrutura não localizada',
} as const;

const STATEMENT_CONFLICT_STATUS_LABELS: Record<AtomicCardStatementConflictForensicStatus, string> = {
  'no-duplicates': 'nenhuma fatura duplicada encontrada',
  'conflict-isolated': 'conflito isolado e conservação classificada',
  'review-needed': 'metadados protegidos ainda exigem revisão',
  blocked: 'auditoria bloqueada por contagens inconsistentes',
};

const STATEMENT_CONFLICT_FIELD_LABELS: Record<AtomicCardStatementConflictFieldCode, string> = {
  'due-date': 'vencimento',
  'entry-count': 'quantidade de lançamentos',
  'statement-total': 'total materializado da fatura',
  'payment-total': 'total materializado de pagamentos',
  'open-balance': 'saldo materializado',
  'protected-metadata-presence': 'presença de metadados protegidos',
  'manual-totals-presence': 'presença de ajuste manual',
  'file-statement-total': 'total oficial do arquivo',
  'file-payment-total': 'pagamento oficial do arquivo',
};

const STATEMENT_SHADOW_MATCH_LABELS: Record<AtomicCardStatementShadowMatchCode, string> = {
  'unique-shadow-compatible-record': 'um único registro coincide com os campos derivados da sombra',
  'multiple-shadow-compatible-records': 'mais de um registro coincide com os campos derivados da sombra',
  'no-shadow-compatible-record': 'nenhum registro coincide integralmente com a sombra',
  'missing-shadow-statement': 'a fatura correspondente não existe na sombra',
};

const STATEMENT_CONFLICT_RECOMMENDATION_LABELS: Record<AtomicCardStatementConflictRecommendationCode, string> = {
  'preserve-all-current-statement-records': 'Preservar os registros atuais; esta auditoria não seleciona nem remove uma fatura.',
  'preserve-manual-payload-verbatim': 'Conservar integralmente o conteúdo manual protegido, sem reinterpretar ou descartar campos.',
  'preserve-official-file-totals': 'Conservar os totais oficiais provenientes dos arquivos e separá-los dos valores derivados.',
  'review-conflicting-protected-values': 'Revisar os metadados protegidos conflitantes antes de qualquer simulação de consolidação.',
  'use-shadow-only-for-derived-field-comparison': 'Usar a sombra apenas para confrontar campos derivados; ela não substitui evidência manual ou oficial.',
  'simulate-metadata-conservation-before-any-merge': 'A próxima etapa permitida é somente uma simulação de conservação, ainda sem gravar ou mesclar registros.',
  'investigate-unclassified-statement-groups': 'Investigar a divergência de contagens antes de avançar.',
  'keep-writes-disabled': 'Manter exclusões, reparos, ativações e migrations desabilitados.',
};

const AFFECTED_ENTRY_RECONCILIATION_STATUS_LABELS: Record<AtomicCardAffectedEntryReconciliationStatus, string> = {
  'no-duplicates': 'nenhuma duplicidade para reconciliar',
  'no-pending-competence-shift': 'duplicidade existente, sem troca de competência pendente',
  'explained-by-current-attachment': 'contagem explicada pelas vinculações atuais',
  'explained-by-projected-target': 'contagem explicada pelo destino projetado',
  'explained-on-both-sides': 'contagem confirmada nos dois lados da comparação',
  blocked: 'proveniência da contagem ainda inconsistente',
};

const AFFECTED_ENTRY_RECONCILIATION_RECOMMENDATION_LABELS: Record<AtomicCardAffectedEntryReconciliationRecommendationCode, string> = {
  'treat-upstream-count-as-competence-exceptions': 'Interpretar a contagem reconciliada como exceções de competência, não como linhas necessariamente vinculadas hoje à fatura duplicada.',
  'distinguish-current-attachment-from-projected-target': 'Manter separadas a vinculação física atual e a competência pretendida pela reconstrução sombra.',
  'preserve-all-statement-records': 'Preservar integralmente os registros duplicados durante esta investigação.',
  'investigate-count-provenance': 'Investigar a proveniência das contagens antes de liberar a análise de conflitos.',
  'keep-writes-disabled': 'Manter reparos, ativações, exclusões e migrations desabilitados.',
};

const STATEMENT_CONSERVATION_STATUS_LABELS: Record<AtomicCardStatementConservationDryRunStatus, string> = {
  'no-duplicates': 'nenhuma duplicidade para simular',
  'simulation-complete': 'conservação simulada sem perda de metadados',
  'review-needed': 'simulação parcial; há evidências que exigem revisão',
  blocked: 'simulação bloqueada por pré-requisitos inconsistentes',
};

const STATEMENT_CONSERVATION_BLOCKER_LABELS: Record<AtomicCardStatementConservationBlockerCode, string> = {
  'upstream-report-mismatch': 'relatórios upstream não pertencem à mesma reconstrução sombra',
  'count-reconciliation-blocked': 'a contagem afetada ainda não foi reconciliada',
  'unclassified-duplicate-group': 'grupo duplicado não localizado integralmente',
  'missing-shadow-statement': 'fatura correspondente ausente na sombra',
  'multiple-manual-payloads': 'mais de um payload manual no mesmo grupo',
  'conflicting-official-statement-totals': 'totais oficiais de fatura conflitantes',
  'conflicting-official-payment-totals': 'totais oficiais de pagamento conflitantes',
  'unknown-protected-metadata': 'metadado protegido sem origem classificável',
};

const STATEMENT_CONSERVATION_RECOMMENDATION_LABELS: Record<AtomicCardStatementConservationRecommendationCode, string> = {
  'derive-operational-fields-from-shadow': 'Usar a sombra somente para simular os campos operacionais derivados da fatura.',
  'preserve-protected-metadata-without-row-selection': 'Conservar os metadados protegidos do grupo completo sem eleger uma linha como vencedora.',
  'keep-all-duplicate-records-unchanged': 'Manter todos os registros duplicados fisicamente inalterados durante a simulação.',
  'review-ambiguous-protected-metadata': 'Revisar payloads ou totais protegidos ambíguos antes de desenhar um plano executável.',
  'review-missing-shadow-statements': 'Reconstruir a fatura sombra ausente antes de repetir a simulação.',
  'investigate-upstream-prerequisites': 'Resolver as divergências dos relatórios anteriores antes de avançar.',
  'design-reversible-conservation-plan-next': 'A próxima etapa pode desenhar um plano reversível, ainda separado de qualquer escrita.',
  'keep-writes-disabled': 'Manter seleção, exclusão, mescla, reparo, ativação e migration desabilitados.',
};

const STATEMENT_CONSERVATION_PLAN_STATUS_LABELS: Record<AtomicCardStatementConservationPlanStatus, string> = {
  'no-duplicates': 'nenhuma duplicidade exige plano',
  'plan-ready': 'plano reversível desenhado e conferido',
  'review-needed': 'plano suspenso; há evidências que exigem revisão',
  blocked: 'plano bloqueado por pré-requisitos inconsistentes',
};

const STATEMENT_CONSERVATION_PLAN_BLOCKER_LABELS: Record<AtomicCardStatementConservationPlanBlockerCode, string> = {
  'upstream-report-mismatch': 'o relatório da Sprint 2M não pertence à mesma reconstrução sombra',
  'conservation-simulation-not-complete': 'a simulação de conservação da Sprint 2M não foi concluída',
  'conservation-plan-not-eligible': 'a Sprint 2M não autorizou o desenho do plano reversível',
  'persisted-revision-missing': 'a revisão opaca da projeção atual não foi vinculada ao plano',
  'duplicate-group-cardinality-mismatch': 'a quantidade de grupos duplicados não fecha com as linhas localizadas',
  'missing-shadow-statement': 'uma fatura duplicada não possui correspondente na sombra',
  'protected-metadata-conservation-failed': 'a simulação não comprovou a conservação integral dos metadados protegidos',
  'derived-mismatch-remains': 'a simulação ainda contém divergências nos campos derivados',
  'invalid-replacement-cardinality': 'a substituição proposta não reduziria a duplicidade de forma determinística',
};

const STATEMENT_CONSERVATION_PLAN_RECOMMENDATION_LABELS: Record<AtomicCardStatementConservationPlanRecommendationCode, string> = {
  'snapshot-complete-duplicate-groups': 'Fotografar integralmente as faturas duplicadas e todos os vínculos afetados antes de qualquer escrita futura.',
  'create-new-composite-without-winner-selection': 'Criar futuramente uma fatura composta nova, sem eleger arbitrariamente uma linha antiga como vencedora.',
  'relink-entries-and-payments-atomically': 'Religar itens e pagamentos na mesma transação de banco; qualquer divergência deve cancelar tudo.',
  'verify-projection-revision-and-checksum': 'Exigir a mesma revisão persistida e o mesmo checksum da auditoria imediatamente antes da execução.',
  'verify-counts-and-metadata-before-commit': 'Conferir cardinalidade, totais derivados e metadados protegidos antes do commit.',
  'rollback-only-if-after-revision-matches': 'Permitir rollback somente se nenhuma alteração posterior tiver mudado a revisão da projeção.',
  'review-upstream-conservation-evidence': 'Revisar as evidências anteriores antes de transformar este desenho em implementação transacional.',
  'implement-transactional-rpc-in-later-sprint': 'Uma Sprint posterior poderá implementar a operação no banco, ainda com migration e piloto separados.',
  'keep-writes-disabled': 'Manter reparos, ativações, exclusões, mesclas e migrations desabilitados nesta Sprint.',
};

const STATEMENT_CONSERVATION_EXECUTION_STATUS_LABELS: Record<AtomicCardStatementConservationExecutionStatus, string> = {
  'no-duplicates': 'nenhuma duplicidade exige consolidação',
  'contract-ready': 'contrato transacional preparado para homologação',
  blocked: 'contrato bloqueado por evidências incompletas ou conflitantes',
};

const STATEMENT_CONSERVATION_EXECUTION_BLOCKER_LABELS: Record<AtomicCardStatementConservationExecutionBlockerCode, string> = {
  'upstream-plan-not-ready': 'o plano reversível anterior não está pronto ou pertence a outra auditoria',
  'invalid-persisted-revision': 'a revisão opaca persistida não possui formato válido',
  'invalid-shadow-checksum': 'o checksum da reconstrução sombra não possui formato válido',
  'multiple-groups-require-separate-audits': 'há mais de uma competência duplicada; cada grupo exige auditoria e transação separadas',
  'duplicate-group-cardinality-mismatch': 'a quantidade de faturas físicas não coincide com o plano revisado',
  'missing-source-identities': 'uma fatura física não possui identidade única verificável',
  'mixed-card-group': 'as linhas duplicadas não pertencem inequivocamente ao mesmo cartão',
  'missing-shadow-statement': 'a competência duplicada não possui fatura correspondente na sombra',
  'ambiguous-shadow-statement': 'a sombra possui mais de uma fatura para a mesma competência',
  'multiple-manual-payloads': 'mais de uma linha contém payload manual protegido',
  'missing-manual-payload': 'há indicação de metadado manual, mas o conteúdo protegido não foi recuperado',
  'conflicting-official-statement-totals': 'os totais oficiais de fatura entram em conflito',
  'conflicting-official-payment-totals': 'os totais oficiais de pagamento entram em conflito',
  'conflicting-computed-line-totals': 'os totais calculados das linhas entram em conflito',
  'unknown-protected-metadata': 'há metadado protegido cuja origem não pode ser conservada com segurança',
  'upstream-link-count-mismatch': 'as contagens atuais de vínculos não coincidem com o plano revisado',
};

/** DD/MM/AAAA → YYYY-MM-DD ou null */
function parseBRDateToIso(value: string): string | null {
  const s = value.trim().replace(/\s/g, '');
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** MM/AAAA → YYYY-MM */
function parseMMAAAAToIsoMonth(value: string): string | null {
  const s = value.trim().replace(/\s/g, '');
  const m = /^(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const mm = Number(m[1]);
  const yyyy = Number(m[2]);
  if (mm < 1 || mm > 12 || yyyy < 1900 || yyyy > 2100) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}`;
}

/** Extrai dia de vencimento (1–31) digitado pelo usuário. */
function parseInvoiceDueDay(value: string): number | null {
  const n = Number(String(value).trim().replace(/\D/g, '') || NaN);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}

/** Só dígitos; valor final sempre '' ou inteiro 1–31 (cola «100000» vira «31»). */
function sanitizeInvoiceDueDayInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return '';
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1) return '';
  return String(Math.min(31, Math.floor(n)));
}

/** Competência YYYY-MM → vencimento DD/MM/AAAA no mês civil seguinte, respeitando último dia do mês. */
function computeVencimentoBRFromCompetenceIsoMonth(isoMonth: string, dueDay: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(isoMonth.trim());
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]);
  if (mo === 12) {
    mo = 1;
    y += 1;
  } else {
    mo += 1;
  }
  const last = new Date(y, mo, 0).getDate();
  const d = Math.min(Math.max(1, Math.floor(dueDay)), last);
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
}

function effectiveDueDayForAccount(accountId: string, invoiceDueDayStr: string, accounts: Account[]): number | null {
  const g = parseInvoiceDueDay(invoiceDueDayStr);
  if (g != null) return g;
  const acc = accounts.find((a) => a.id === accountId);
  const d = Number(acc?.dia_vencimento);
  if (Number.isInteger(d) && d >= 1 && d <= 31) return d;
  return null;
}

export interface CreditCardInvoiceCycleRow {
  key: string;
  accountId: string;
  accountName: string;
  originComparable: string;
  displayOrigin: string;
  txCount: number;
  /** Competência em MM/AAAA */
  competenciaBR: string;
  /** Vencimento em DD/MM/AAAA */
  vencimentoBR: string;
  /** Origem da competência usada apenas pela auditoria agregada da Sprint 2H. */
  competenceEvidenceSource?: AtomicCardCompetenceEvidenceSource;
  /** Ordenação: instante do último registro em «Histórico de importações» para esta origem; fallback: transação mais recente. */
  sortUploadMs: number;
}

/**
 * O vencimento confirmado no histórico é a fonte de verdade. Há bases legítimas
 * em que competência e vencimento ficam no mesmo mês e bases em que o vencimento
 * está no mês seguinte; recalcular sempre deslocaria silenciosamente o primeiro caso.
 */
export function resolveCreditCardInvoiceCycleDueDateIso(
  row: Pick<CreditCardInvoiceCycleRow, 'competenciaBR' | 'vencimentoBR'>,
  dueDay: number | null
): string | null {
  const persistedDueDate = parseBRDateToIso(row.vencimentoBR.trim());
  if (persistedDueDate) return persistedDueDate;

  const referenceMonth = parseMMAAAAToIsoMonth(row.competenciaBR.trim());
  if (!referenceMonth || dueDay == null) return null;
  return parseBRDateToIso(computeVencimentoBRFromCompetenceIsoMonth(referenceMonth, dueDay));
}

function updateDueDayPreservingKnownMonth(
  row: Pick<CreditCardInvoiceCycleRow, 'competenciaBR' | 'vencimentoBR'>,
  dueDay: number | null
): string {
  if (dueDay == null) return '';
  const persistedDueDate = parseBRDateToIso(row.vencimentoBR.trim());
  if (!persistedDueDate) {
    const referenceMonth = parseMMAAAAToIsoMonth(row.competenciaBR.trim());
    return referenceMonth
      ? computeVencimentoBRFromCompetenceIsoMonth(referenceMonth, dueDay)
      : '';
  }

  const year = Number(persistedDueDate.slice(0, 4));
  const month = Number(persistedDueDate.slice(5, 7));
  const lastDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(1, dueDay), lastDay);
  return `${String(safeDay).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** Infere a conta de cartão de um registro do histórico de importações. */
function resolveImportLogAccountId(
  log: ImportLog,
  transactions: Transaction[],
  accounts: Account[]
): string | null {
  const det = (log.imported_details as any[]) || [];
  const fromMeta = det.find((d) => d?.ID_Conta)?.ID_Conta;
  if (fromMeta) return String(fromMeta);

  const normalizeOrigin = (value?: string) =>
    (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  const targetOrigin = normalizeOrigin(log.file_name);
  const freq = new Map<string, number>();
  transactions
    .filter((t) => normalizeOrigin(t.Origem) === targetOrigin && t.ID_Conta)
    .forEach((t) => {
      const key = t.ID_Conta as string;
      freq.set(key, (freq.get(key) || 0) + 1);
    });
  if (freq.size === 1) return Array.from(freq.keys())[0];
  if (freq.size > 1) {
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0][0];
  }

  const normalizeLoose = (value?: string) =>
    normalizeOrigin(value)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const fileTokens = normalizeLoose(log.file_name).split(' ').filter(Boolean);
  const cardAccounts = accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito');
  const scored = cardAccounts
    .map((acc) => ({
      id: acc.id,
      score: normalizeLoose(acc.Nome_Conta)
        .split(' ')
        .filter((token) => fileTokens.includes(token)).length,
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].id : null;
}

function latestImportLogMsForComparable(importLogs: ImportLog[], originComparable: string): number {
  let max = 0;
  for (const log of importLogs) {
    if (comparableImportOriginKey(log.file_name) !== originComparable) continue;
    const ts = new Date(log.import_date || 0).getTime();
    if (!Number.isNaN(ts) && ts > max) max = ts;
  }
  return max;
}

function dominantOriginString(originWeights: Map<string, number>): string {
  const pairs = Array.from(originWeights.entries()).sort((a, b) => b[1] - a[1]);
  return pairs[0]?.[0] || '';
}

function latestLogForCardOrigin(
  importLogs: ImportLog[],
  accountId: string,
  originComparable: string
): ImportLog | undefined {
  const candidates = importLogs.filter((log) => comparableImportOriginKey(log.file_name) === originComparable);
  const ranked = candidates
    .map((log) => {
      const det = Array.isArray(log.imported_details) ? log.imported_details : [];
      const mentionsAccount = det.some((d: any) => d?.ID_Conta === accountId);
      const ts = new Date(log.import_date || 0).getTime();
      return { log, mentionsAccount, ts };
    })
    .sort((a, b) => {
      if (a.mentionsAccount !== b.mentionsAccount) return (b.mentionsAccount ? 1 : 0) - (a.mentionsAccount ? 1 : 0);
      return b.ts - a.ts;
    });
  return ranked[0]?.log;
}

/** Lê competência/vencimento já persistidos no histórico (saveCardImportLotClassification). */
function cardCycleMetaFromImportedLog(log: ImportLog | undefined, accountId: string): {
  competenciaBR: string;
  vencimentoBR: string;
  competenceEvidenceSource: AtomicCardCompetenceEvidenceSource;
} {
  if (!log) {
    return {
      competenciaBR: '',
      vencimentoBR: '',
      competenceEvidenceSource: 'unknown',
    };
  }
  const det = Array.isArray(log.imported_details) ? log.imported_details : [];
  const accountRows = det.filter((d: any) => d?.ID_Conta === accountId);
  const pool = accountRows.length > 0 ? accountRows : det;
  const metaWithRef = pool.find((d: any) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(d?.Card_Reference_Label || '')));
  if (!metaWithRef?.Card_Reference_Label) {
    return {
      competenciaBR: '',
      vencimentoBR: '',
      competenceEvidenceSource: 'unknown',
    };
  }
  const ref = String(metaWithRef.Card_Reference_Label);
  const yyyy = ref.slice(0, 4);
  const mm = ref.slice(5, 7);
  const competenciaBR = `${mm}/${yyyy}`;
  let vencimentoBR = '';
  const due = metaWithRef.Card_Due_Date;
  if (typeof due === 'string' && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(due)) {
    const [y, m, d] = due.split('-');
    vencimentoBR = `${d}/${m}/${y}`;
  }
  const competenceEvidenceSource: AtomicCardCompetenceEvidenceSource =
    String(metaWithRef.Card_Cycle_Mode || '').trim().toLowerCase() === 'manual'
      ? 'confirmed-import-history'
      : 'persisted-import-history';
  return { competenciaBR, vencimentoBR, competenceEvidenceSource };
}

function buildRowsFromStore(params: {
  accounts: Account[];
  transactions: Transaction[];
  importLogs: ImportLog[];
  filterAccountId?: string | null;
}): CreditCardInvoiceCycleRow[] {
  const { accounts, transactions, importLogs, filterAccountId } = params;
  const cardById = new Map(
    accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito').map((a) => [a.id, a])
  );

  type Agg = {
    accountId: string;
    originComparable: string;
    originWeights: Map<string, number>;
    txCount: number;
    latestTxMs: number;
  };
  const map = new Map<string, Agg>();

  transactions.forEach((t) => {
    if (!t.ID_Conta || !t.Origem || t.Origem === 'manual') return;
    if (!cardById.has(t.ID_Conta)) return;
    if (filterAccountId && t.ID_Conta !== filterAccountId) return;
    const oc = comparableImportOriginKey(String(t.Origem));
    if (!oc) return;
    const aggKey = `${t.ID_Conta}__${oc}`;
    const origStr = String(t.Origem);
    let agg = map.get(aggKey);
    if (!agg) {
      agg = {
        accountId: t.ID_Conta,
        originComparable: oc,
        originWeights: new Map(),
        txCount: 0,
        latestTxMs: 0,
      };
      map.set(aggKey, agg);
    }
    agg.txCount += 1;
    agg.originWeights.set(origStr, (agg.originWeights.get(origStr) || 0) + 1);
    const txMs = new Date(t.Data as Date | string).getTime();
    if (!Number.isNaN(txMs)) agg.latestTxMs = Math.max(agg.latestTxMs, txMs);
  });

  const rows: CreditCardInvoiceCycleRow[] = [];

  map.forEach((agg, rowKey) => {
    const account = cardById.get(agg.accountId);
    if (!account) return;

    const dominant = dominantOriginString(agg.originWeights);
    const logPick = latestLogForCardOrigin(importLogs, agg.accountId, agg.originComparable);
    const displayOrigin = logPick?.file_name || dominant;

    const logMs = latestImportLogMsForComparable(importLogs, agg.originComparable);
    const sortUploadMs = logMs > 0 ? logMs : agg.latestTxMs;

    const persisted = cardCycleMetaFromImportedLog(logPick, agg.accountId);

    rows.push({
      key: rowKey,
      accountId: agg.accountId,
      accountName: account.Nome_Conta,
      originComparable: agg.originComparable,
      displayOrigin,
      txCount: agg.txCount,
      competenciaBR: persisted.competenciaBR,
      vencimentoBR: persisted.vencimentoBR,
      competenceEvidenceSource: persisted.competenceEvidenceSource,
      sortUploadMs,
    });
  });

  if (filterAccountId) {
    importLogs.forEach((log) => {
      const accountId = resolveImportLogAccountId(log, transactions, accounts);
      if (accountId !== filterAccountId) return;
      const oc = comparableImportOriginKey(log.file_name);
      if (!oc) return;
      const aggKey = `${accountId}__${oc}`;
      if (map.has(aggKey)) return;

      const account = cardById.get(accountId);
      if (!account) return;
      const logMs = new Date(log.import_date || 0).getTime();
      const persisted = cardCycleMetaFromImportedLog(log, accountId);
      let competenciaBR = persisted.competenciaBR;
      let competenceEvidenceSource = persisted.competenceEvidenceSource;
      if (!competenciaBR.trim()) {
        const suggested = creditCardRebuildFromImportHistoryService.suggestReferenceMonth(
          log.file_name,
          log.imported_details as unknown[]
        );
        if (suggested) {
          competenciaBR = `${suggested.slice(5, 7)}/${suggested.slice(0, 4)}`;
          competenceEvidenceSource = 'suggested-automatic';
        }
      }
      let vencimentoBR = persisted.vencimentoBR;
      if (!vencimentoBR.trim() && competenciaBR.trim()) {
        const iso = parseMMAAAAToIsoMonth(competenciaBR);
        const day = Number(account.dia_vencimento) || 10;
        if (iso) vencimentoBR = computeVencimentoBRFromCompetenceIsoMonth(iso, day);
      }

      rows.push({
        key: aggKey,
        accountId,
        accountName: account.Nome_Conta,
        originComparable: oc,
        displayOrigin: log.file_name,
        txCount: 0,
        competenciaBR,
        vencimentoBR,
        competenceEvidenceSource,
        sortUploadMs: Number.isNaN(logMs) ? 0 : logMs,
      });
    });
  }

  return sortRowsByVencimentoDesc(rows);
}

/** Vencimento mais recente primeiro (auditoria); sem data válida vai ao final. */
function vencimentoSortKey(vencimentoBR: string): number {
  const iso = parseBRDateToIso(vencimentoBR.trim());
  if (!iso) return 0;
  const t = new Date(`${iso}T12:00:00`).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function sortRowsByVencimentoDesc(rows: CreditCardInvoiceCycleRow[]): CreditCardInvoiceCycleRow[] {
  return [...rows].sort((a, b) => {
    const kv = vencimentoSortKey(b.vencimentoBR) - vencimentoSortKey(a.vencimentoBR);
    if (kv !== 0) return kv;
    const ac = a.accountName.localeCompare(b.accountName, 'pt-BR');
    if (ac !== 0) return ac;
    return a.displayOrigin.localeCompare(b.displayOrigin, 'pt-BR');
  });
}

/** Mantém edição local; se o usuário não digitou competência, usa o valor vindo do histórico (persistido). */
function mergeRowsPreserveInputs(
  fresh: CreditCardInvoiceCycleRow[],
  prev: CreditCardInvoiceCycleRow[],
  invoiceDueDayStr: string,
  accounts: Account[]
): CreditCardInvoiceCycleRow[] {
  const prevByKey = new Map(prev.map((r) => [r.key, r]));
  const merged = fresh.map((r) => {
    const p = prevByKey.get(r.key);
    if (!p) return r;
    const competenciaBR = p.competenciaBR.trim() !== '' ? p.competenciaBR : r.competenciaBR;
    const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
    const vencimentoBR =
      p.vencimentoBR.trim() !== ''
        ? p.vencimentoBR
        : r.vencimentoBR.trim() !== ''
          ? r.vencimentoBR
          : updateDueDayPreservingKnownMonth({ competenciaBR, vencimentoBR: '' }, day);

    return {
      ...r,
      competenciaBR,
      vencimentoBR,
      competenceEvidenceSource:
        p.competenciaBR.trim() !== ''
          ? p.competenceEvidenceSource || 'unknown'
          : r.competenceEvidenceSource || 'unknown',
    };
  });
  return sortRowsByVencimentoDesc(merged);
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Se definido, apenas importações desta conta de cartão. */
  filterAccountId?: string | null;
  /** Camada do overlay (acima do histórico de faturas quando aberto em sequência). */
  overlayClassName?: string;
}

const CreditCardInvoiceCyclesModal: React.FC<Props> = ({
  isOpen,
  onClose,
  filterAccountId,
  overlayClassName = 'z-[70]',
}) => {
  const accounts = useAppStore((s) => s.accounts);
  const transactions = useAppStore((s) => s.transactions);
  const importLogs = useAppStore((s) => s.importLogs);
  const user = useAppStore((s) => s.user);
  const saveCardImportLotClassification = useAppStore((s) => s.saveCardImportLotClassification);
  const auditCreditCardRebuildFromImportHistory = useAppStore((s) => s.auditCreditCardRebuildFromImportHistory);
  const activateCreditCardRebuildFromImportHistory = useAppStore(
    (s) => s.activateCreditCardRebuildFromImportHistory
  );
  const getLatestAtomicCardRollback = useAppStore((s) => s.getLatestAtomicCardRollback);
  const getAtomicCardRebuildFeatureState = useAppStore(
    (s) => s.getAtomicCardRebuildFeatureState
  );
  const rollbackAtomicCardRebuild = useAppStore((s) => s.rollbackAtomicCardRebuild);
  const repairAtomicCardPaymentDuplicates = useAppStore(
    (s) => s.repairAtomicCardPaymentDuplicates
  );
  const getLatestAtomicCardPaymentRepairRollback = useAppStore(
    (s) => s.getLatestAtomicCardPaymentRepairRollback
  );
  const rollbackAtomicCardPaymentRepair = useAppStore(
    (s) => s.rollbackAtomicCardPaymentRepair
  );

  const creditCardAccounts = useMemo(
    () => accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito'),
    [accounts]
  );

  const [selectedCardAccountId, setSelectedCardAccountId] = useState('');
  const effectiveFilterAccountId = filterAccountId || selectedCardAccountId || null;

  const [rows, setRows] = useState<CreditCardInvoiceCycleRow[]>([]);
  const [invoiceDueDayStr, setInvoiceDueDayStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<
    'save' | 'audit' | 'repair' | 'repairRollback' | 'rebuild' | 'rollback' | null
  >(null);
  const [applyProgress, setApplyProgress] = useState<string | null>(null);
  const [shadowAudit, setShadowAudit] = useState<AtomicCardRebuildAuditResult | null>(null);
  const [latestRollback, setLatestRollback] = useState<AtomicCardRollbackAvailability | null>(null);
  const [latestPaymentRepairRollback, setLatestPaymentRepairRollback] =
    useState<AtomicCardPaymentRepairRollbackAvailability | null>(null);
  const [atomicActivationEnabled, setAtomicActivationEnabled] = useState(false);
  const prevIsOpenRef = useRef(false);
  const prevFilterSigRef = useRef<string | undefined>(undefined);

  const shadowAuditForensics = useMemo(
    () =>
      shadowAudit
        ? buildAtomicCardForensicReport(
            shadowAudit.shadow,
            shadowAudit.persisted,
            shadowAudit.comparison
          )
        : null,
    [shadowAudit]
  );

  const shadowAuditLineage = useMemo(
    () =>
      shadowAudit
        ? buildAtomicCardLineageReport(
            shadowAudit.shadow,
            shadowAudit.persisted,
            shadowAudit.comparison
          )
        : null,
    [shadowAudit]
  );

  const shadowAuditProvenance = useMemo(
    () =>
      shadowAudit
        ? buildAtomicCardProvenanceReport(
            shadowAudit.shadow,
            shadowAudit.persisted,
            shadowAudit.comparison
          )
        : null,
    [shadowAudit]
  );

  const shadowAuditIdentityDryRun = useMemo(
    () =>
      shadowAudit && shadowAuditProvenance
        ? buildAtomicCardIdentityDryRunReport(
            shadowAudit.shadow,
            shadowAudit.persisted,
            shadowAudit.comparison,
            shadowAuditProvenance
          )
        : null,
    [shadowAudit, shadowAuditProvenance]
  );

  const shadowAuditCompetenceForensics = useMemo(() => {
    if (!shadowAudit || !effectiveFilterAccountId) return null;
    const cycles = rows.flatMap((row) => {
      const referenceMonth = parseMMAAAAToIsoMonth(row.competenciaBR.trim());
      const dueDay = effectiveDueDayForAccount(row.accountId, invoiceDueDayStr, accounts);
      const dueDate = resolveCreditCardInvoiceCycleDueDateIso(row, dueDay);
      if (!referenceMonth || !dueDate) return [];
      return [
        {
          sourceFileName: row.displayOrigin,
          referenceMonth,
          dueDate,
          source: row.competenceEvidenceSource || 'unknown',
        },
      ];
    });
    const account = accounts.find((candidate) => candidate.id === effectiveFilterAccountId);
    return buildAtomicCardCompetenceForensicReport({
      shadow: shadowAudit.shadow,
      persisted: shadowAudit.persisted,
      cycles,
      closingDay: account?.dia_fechamento,
    });
  }, [
    shadowAudit,
    effectiveFilterAccountId,
    rows,
    invoiceDueDayStr,
    accounts,
  ]);

  const shadowAuditCompetenceDryRun = useMemo(() => {
    if (
      !shadowAudit ||
      !shadowAuditCompetenceForensics ||
      !effectiveFilterAccountId
    ) {
      return null;
    }
    const cycles = rows.flatMap((row) => {
      const referenceMonth = parseMMAAAAToIsoMonth(row.competenciaBR.trim());
      const dueDay = effectiveDueDayForAccount(row.accountId, invoiceDueDayStr, accounts);
      const dueDate = resolveCreditCardInvoiceCycleDueDateIso(row, dueDay);
      if (!referenceMonth || !dueDate) return [];
      return [
        {
          sourceFileName: row.displayOrigin,
          referenceMonth,
          dueDate,
          source: row.competenceEvidenceSource || 'unknown',
        },
      ];
    });
    const account = accounts.find((candidate) => candidate.id === effectiveFilterAccountId);
    return buildAtomicCardCompetenceDryRunReport({
      shadow: shadowAudit.shadow,
      persisted: shadowAudit.persisted,
      comparison: shadowAudit.comparison,
      forensics: shadowAuditCompetenceForensics,
      cycles,
      closingDay: account?.dia_fechamento,
    });
  }, [
    shadowAudit,
    shadowAuditCompetenceForensics,
    effectiveFilterAccountId,
    rows,
    invoiceDueDayStr,
    accounts,
  ]);

  const shadowAuditCompetenceExceptionForensics = useMemo(
    () =>
      shadowAudit && shadowAuditIdentityDryRun && shadowAuditCompetenceDryRun
        ? buildAtomicCardCompetenceExceptionForensicReport({
            persisted: shadowAudit.persisted,
            comparison: shadowAudit.comparison,
            identityDryRun: shadowAuditIdentityDryRun,
            competenceDryRun: shadowAuditCompetenceDryRun,
          })
        : null,
    [shadowAudit, shadowAuditIdentityDryRun, shadowAuditCompetenceDryRun]
  );

  const shadowAuditSequentialDryRun = useMemo(() => {
    if (!shadowAudit || !shadowAuditProvenance || !effectiveFilterAccountId) {
      return null;
    }
    const cycles = rows.flatMap((row) => {
      const referenceMonth = parseMMAAAAToIsoMonth(row.competenciaBR.trim());
      const dueDay = effectiveDueDayForAccount(row.accountId, invoiceDueDayStr, accounts);
      const dueDate = resolveCreditCardInvoiceCycleDueDateIso(row, dueDay);
      if (!referenceMonth || !dueDate) return [];
      return [
        {
          sourceFileName: row.displayOrigin,
          referenceMonth,
          dueDate,
          source: row.competenceEvidenceSource || 'unknown',
        },
      ];
    });
    const account = accounts.find((candidate) => candidate.id === effectiveFilterAccountId);
    return buildAtomicCardSequentialDryRunReport({
      shadow: shadowAudit.shadow,
      persisted: shadowAudit.persisted,
      comparison: shadowAudit.comparison,
      provenance: shadowAuditProvenance,
      cycles,
      closingDay: account?.dia_fechamento,
    });
  }, [
    shadowAudit,
    shadowAuditProvenance,
    effectiveFilterAccountId,
    rows,
    invoiceDueDayStr,
    accounts,
  ]);

  const shadowAuditResidualStatementDryRun = useMemo(() => {
    if (!shadowAudit || !shadowAuditProvenance || !effectiveFilterAccountId) {
      return null;
    }
    const cycles = rows.flatMap((row) => {
      const referenceMonth = parseMMAAAAToIsoMonth(row.competenciaBR.trim());
      const dueDay = effectiveDueDayForAccount(row.accountId, invoiceDueDayStr, accounts);
      const dueDate = resolveCreditCardInvoiceCycleDueDateIso(row, dueDay);
      if (!referenceMonth || !dueDate) return [];
      return [
        {
          sourceFileName: row.displayOrigin,
          referenceMonth,
          dueDate,
          source: row.competenceEvidenceSource || 'unknown',
        },
      ];
    });
    const account = accounts.find((candidate) => candidate.id === effectiveFilterAccountId);
    return buildAtomicCardResidualStatementDryRunReport({
      shadow: shadowAudit.shadow,
      persisted: shadowAudit.persisted,
      comparison: shadowAudit.comparison,
      provenance: shadowAuditProvenance,
      cycles,
      closingDay: account?.dia_fechamento,
    });
  }, [
    shadowAudit,
    shadowAuditProvenance,
    effectiveFilterAccountId,
    rows,
    invoiceDueDayStr,
    accounts,
  ]);

  const shadowAuditAffectedEntryReconciliation = useMemo(
    () =>
      shadowAudit && shadowAuditCompetenceExceptionForensics
        ? buildAtomicCardAffectedEntryReconciliationReport({
            shadow: shadowAudit.shadow,
            persisted: shadowAudit.persisted,
            comparison: shadowAudit.comparison,
            competenceExceptions: shadowAuditCompetenceExceptionForensics,
          })
        : null,
    [shadowAudit, shadowAuditCompetenceExceptionForensics]
  );

  const shadowAuditStatementConflictForensics = useMemo(
    () =>
      shadowAudit && shadowAuditCompetenceExceptionForensics
        ? buildAtomicCardStatementConflictForensicReport({
            shadow: shadowAudit.shadow,
            persisted: shadowAudit.persisted,
            comparison: shadowAudit.comparison,
            competenceExceptions: shadowAuditCompetenceExceptionForensics,
          })
        : null,
    [shadowAudit, shadowAuditCompetenceExceptionForensics]
  );

  const shadowAuditStatementConservationDryRun = useMemo(
    () =>
      shadowAudit &&
      shadowAuditStatementConflictForensics &&
      shadowAuditAffectedEntryReconciliation
        ? buildAtomicCardStatementConservationDryRunReport({
            shadow: shadowAudit.shadow,
            persisted: shadowAudit.persisted,
            comparison: shadowAudit.comparison,
            conflictForensics: shadowAuditStatementConflictForensics,
            affectedEntryReconciliation: shadowAuditAffectedEntryReconciliation,
          })
        : null,
    [
      shadowAudit,
      shadowAuditStatementConflictForensics,
      shadowAuditAffectedEntryReconciliation,
    ]
  );

  const shadowAuditStatementConservationPlan = useMemo(
    () =>
      shadowAudit && shadowAuditStatementConservationDryRun
        ? buildAtomicCardStatementConservationPlanReport({
            shadow: shadowAudit.shadow,
            persisted: shadowAudit.persisted,
            comparison: shadowAudit.comparison,
            conservationDryRun: shadowAuditStatementConservationDryRun,
            persistedRevision: shadowAudit.persistedRevision,
          })
        : null,
    [shadowAudit, shadowAuditStatementConservationDryRun]
  );

  const shadowAuditStatementConservationExecution = useMemo(
    () =>
      shadowAudit && shadowAuditStatementConservationPlan
        ? prepareAtomicCardStatementConservationExecution({
            shadow: shadowAudit.shadow,
            persisted: shadowAudit.persisted,
            comparison: shadowAudit.comparison,
            conservationPlan: shadowAuditStatementConservationPlan,
            persistedRevision: shadowAudit.persistedRevision,
          }).report
        : null,
    [shadowAudit, shadowAuditStatementConservationPlan]
  );

  const statementConservationBlocksActivation =
    isAtomicCardActivationBlockedByStatementConservation(
      shadowAuditStatementConservationDryRun
    );

  const shadowAuditDiagnosticLines = useMemo(() => {
    if (!shadowAudit) return [];

    const { shadow, persisted, comparison } = shadowAudit;
    const transactionById = new Map(
      transactions
        .filter((transaction) => Boolean(transaction.ID_Transacao))
        .map((transaction) => [String(transaction.ID_Transacao), transaction])
    );
    const shortId = (value: string | null | undefined): string => {
      const normalized = String(value || '').trim();
      if (!normalized) return 'sem-id';
      return normalized.length > 12 ? `${normalized.slice(0, 8)}…${normalized.slice(-4)}` : normalized;
    };
    const transactionName = (transactionId: string): string => {
      const transaction = transactionById.get(transactionId);
      const description = transaction?.Descricao_Original || transaction?.Nome_Fantasia;
      return description ? `“${description}” (${shortId(transactionId)})` : shortId(transactionId);
    };
    const money = (amountCents: number): string => formatCurrency(amountCents / 100);
    const lines: string[] = [];

    shadow.issues.forEach((issue) => {
      lines.push(
        `${issue.severity === 'blocker' ? 'Bloqueio' : 'Alerta'} ${issue.code}: ${issue.message}`
      );
    });

    const repairableEntryRows = new Set(comparison.repairablePersistedEntryRowIds);
    comparison.duplicatePersistedTransactionIds.forEach((transactionId) => {
      const duplicatedRows = persisted.entries.filter(
        (entry) => entry.transactionId === transactionId
      );
      const repairableRows = duplicatedRows.filter(
        (entry) => entry.rowId && repairableEntryRows.has(entry.rowId)
      );
      const isConflicting = comparison.conflictingDuplicatePersistedTransactionIds.includes(
        transactionId
      );
      lines.push(
        isConflicting
          ? `Duplicidade ambígua de item: ${transactionName(transactionId)} aparece ${duplicatedRows.length} vezes e nenhuma linha canônica coincide de forma inequívoca com a fonte. Nenhuma remoção foi executada.`
          : `Plano de reparo somente leitura: ${transactionName(transactionId)} aparece ${duplicatedRows.length} vezes; ${repairableRows.length} linha(s) materializada(s) é(são) candidata(s) segura(s) à remoção, preservando a linha que coincide com a fonte. Nenhuma remoção foi executada.`
      );
    });

    comparison.changedTransactionIds.forEach((transactionId) => {
      const current = persisted.entries.find((entry) => entry.transactionId === transactionId);
      const expected = shadow.entries.find((entry) => entry.transactionId === transactionId);
      if (!current || !expected) return;
      lines.push(
        `Item ${transactionName(transactionId)}: atual [fatura ${current.statementKey}, data ${current.postedDate || '—'}, ${money(current.amountCents)}, ${current.entryType}] → sombra [fatura ${expected.statementKey}, data ${expected.postedDate}, ${money(expected.amountCents)}, ${expected.entryType}].`
      );
    });

    comparison.missingTransactionIds.forEach((transactionId) => {
      const expected = shadow.entries.find((entry) => entry.transactionId === transactionId);
      lines.push(
        `Item ausente na projeção atual: ${transactionName(transactionId)}${
          expected ? `; sombra em ${expected.statementKey}, ${expected.postedDate}, ${money(expected.amountCents)}, ${expected.entryType}` : ''
        }.`
      );
    });
    comparison.orphanTransactionIds.forEach((transactionId) => {
      const current = persisted.entries.find((entry) => entry.transactionId === transactionId);
      lines.push(
        `Item órfão na projeção atual: ${transactionName(transactionId)}${
          current ? `; atual em ${current.statementKey}, ${current.postedDate || '—'}, ${money(current.amountCents)}, ${current.entryType}` : ''
        }.`
      );
    });

    comparison.missingStatementKeys.forEach((statementKey) => {
      const expected = shadow.statements.find((statement) => statement.statementKey === statementKey);
      lines.push(
        `Fatura ausente na projeção atual: ${statementKey}${
          expected ? `; sombra com vencimento ${expected.dueDate}, ${expected.entryCount} itens, total ${money(expected.statementTotalCents)}, pagamentos ${money(expected.totalPaymentsCents)} e saldo ${money(expected.openBalanceCents)}` : ''
        }.`
      );
    });
    comparison.orphanStatementKeys.forEach((statementKey) => {
      const current = persisted.statements.find((statement) => statement.statementKey === statementKey);
      lines.push(
        `Fatura órfã na projeção atual: ${statementKey}${
          current ? `; vencimento ${current.dueDate || '—'}, ${current.entryCount} itens, total ${money(current.statementTotalCents)}, pagamentos ${money(current.totalPaymentsCents)} e saldo ${money(current.openBalanceCents)}` : ''
        }.`
      );
    });
    comparison.changedStatementKeys.forEach((statementKey) => {
      const current = persisted.statements.find((statement) => statement.statementKey === statementKey);
      const expected = shadow.statements.find((statement) => statement.statementKey === statementKey);
      if (!current || !expected) return;
      lines.push(
        `Fatura ${statementKey}: atual [venc. ${current.dueDate || '—'}, ${current.entryCount} itens, total ${money(current.statementTotalCents)}, pagamentos ${money(current.totalPaymentsCents)}, saldo ${money(current.openBalanceCents)}] → sombra [venc. ${expected.dueDate}, ${expected.entryCount} itens, total ${money(expected.statementTotalCents)}, pagamentos ${money(expected.totalPaymentsCents)}, saldo ${money(expected.openBalanceCents)}].`
      );
    });

    comparison.missingPaymentKeys.forEach((paymentKey) => {
      const expected = shadow.payments.find(
        (payment) => payment.transactionId === paymentKey || `shadow:${payment.sourceRowHash}` === paymentKey
      );
      lines.push(
        `Pagamento ausente na projeção atual: ${expected ? transactionName(expected.transactionId) : shortId(paymentKey)}${
          expected ? `; sombra quita ${expected.statementKey} em ${expected.paymentDate}, ${money(expected.amountCents)}, origem ${expected.source}` : ''
        }.`
      );
    });
    comparison.orphanPaymentKeys.forEach((paymentKey) => {
      const current = persisted.payments.find(
        (payment) => payment.transactionId === paymentKey || `row:${payment.rowId}` === paymentKey
      );
      lines.push(
        `Pagamento órfão na projeção atual: ${current?.transactionId ? transactionName(current.transactionId) : shortId(paymentKey)}${
          current ? `; atual quita ${current.statementKey} em ${current.paymentDate || '—'}, ${money(current.amountCents)}, origem ${current.source}` : ''
        }.`
      );
    });
    comparison.changedPaymentTransactionIds.forEach((transactionId) => {
      const current = persisted.payments.find((payment) => payment.transactionId === transactionId);
      const expected = shadow.payments.find((payment) => payment.transactionId === transactionId);
      if (!current || !expected) return;
      lines.push(
        `Pagamento ${transactionName(transactionId)}: atual [quita ${current.statementKey}, data ${current.paymentDate || '—'}, ${money(current.amountCents)}, ${current.source}] → sombra [quita ${expected.statementKey}, data ${expected.paymentDate}, ${money(expected.amountCents)}, ${expected.source}].`
      );
    });

    comparison.suspiciousPersistedPaymentEventKeys.forEach((eventKey) => {
      const matchingPayments = persisted.payments.filter(
        (payment) =>
          [
            payment.statementKey,
            payment.paymentDate || '',
            payment.amountCents,
            payment.source,
          ].join('|') === eventKey
      );
      const sample = matchingPayments[0];
      if (!sample) return;
      const identities = matchingPayments
        .map((payment) =>
          [
            payment.transactionId
              ? `transação ${shortId(payment.transactionId)}`
              : `linha sem transação ${shortId(payment.rowId)}`,
            payment.createdAt ? `criada em ${payment.createdAt}` : null,
            payment.notes ? `nota “${payment.notes}”` : null,
          ]
            .filter(Boolean)
            .join(', ')
        )
        .join(' + ');
      lines.push(
        `Possível pagamento duplicado: ${matchingPayments.length} linhas representam ${money(sample.amountCents)} em ${sample.paymentDate || '—'}, quitando ${sample.statementKey}, origem ${sample.source} (${identities}).`
      );
    });
    comparison.repairablePersistedPaymentRowIds.forEach((rowId) => {
      const obsolete = persisted.payments.find((payment) => payment.rowId === rowId);
      if (!obsolete) return;
      const replacement = persisted.payments.find(
        (payment) =>
          Boolean(payment.transactionId) &&
          payment.statementKey === obsolete.statementKey &&
          payment.paymentDate === obsolete.paymentDate &&
          payment.amountCents === obsolete.amountCents &&
          payment.source === obsolete.source
      );
      lines.push(
        `Plano de reparo somente leitura: a linha sem identidade ${shortId(rowId)} é candidata segura à remoção; preservar ${replacement?.transactionId ? `a linha vinculada à ${transactionName(replacement.transactionId)}` : 'a linha vinculada à transação'}. Nenhuma remoção foi executada.`
      );
    });

    if (comparison.protectedMetadataStatementKeys.length > 0) {
      comparison.protectedMetadataStatementKeys.forEach((statementKey) => {
        const statement = persisted.statements.find(
          (candidate) => candidate.statementKey === statementKey
        );
        const metadata = [
          statement?.statementTotalFromFileCents != null
            ? `total oficial do arquivo ${money(statement.statementTotalFromFileCents)}`
            : null,
          statement?.totalPaymentsFromFileCents != null
            ? `pagamentos encontrados no extrato ${money(statement.totalPaymentsFromFileCents)}`
            : null,
          statement?.manualTotalsPresent ? 'ajustes manuais presentes' : null,
        ].filter(Boolean);
        lines.push(
          `Metadados protegidos da fatura ${statementKey}: ${metadata.join(', ') || 'presente'}. Eles não podem ser descartados por uma futura troca.`
        );
      });
    }

    return lines;
  }, [shadowAudit, transactions]);

  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      prevFilterSigRef.current = undefined;
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
      setShadowAudit(null);
      setLatestRollback(null);
      setLatestPaymentRepairRollback(null);
      setAtomicActivationEnabled(false);
      return;
    }

    const openedNow = !prevIsOpenRef.current;
    prevIsOpenRef.current = true;

    const filterSig = effectiveFilterAccountId ?? '';
    const filterChanged =
      prevFilterSigRef.current !== undefined && prevFilterSigRef.current !== filterSig;
    prevFilterSigRef.current = filterSig;

    // Durante «Aplicar», saveCardImportLotClassification dispara fetchImportLogs — não pode resetar a tabela.
    if (busy) return;

    if (!effectiveFilterAccountId) {
      if (openedNow) setRows([]);
      return;
    }

    const s = useAppStore.getState();
    const fresh = buildRowsFromStore({
      accounts: s.accounts,
      transactions: s.transactions,
      importLogs: s.importLogs,
      filterAccountId: effectiveFilterAccountId,
    });

    if (openedNow || filterChanged) {
      setRows(fresh);
      setShadowAudit(null);
      if (effectiveFilterAccountId) {
        const acc = accounts.find((a) => a.id === effectiveFilterAccountId);
        const dAcc = Number(acc?.dia_vencimento);
        const dayFromVen = fresh
          .filter((row) => row.accountId === effectiveFilterAccountId)
          .map((row) => {
            const isoDue = parseBRDateToIso(row.vencimentoBR.trim());
            if (!isoDue) return null;
            const dd = Number(isoDue.slice(8, 10));
            return dd >= 1 && dd <= 31 ? dd : null;
          })
          .find((x) => x != null);
        if (dayFromVen != null) {
          setInvoiceDueDayStr(String(dayFromVen));
        } else if (Number.isInteger(dAcc) && dAcc >= 1 && dAcc <= 31) {
          setInvoiceDueDayStr(String(dAcc));
        } else {
          setInvoiceDueDayStr('');
        }
      } else {
        setInvoiceDueDayStr('');
      }
      return;
    }

    setRows((prev) => mergeRowsPreserveInputs(fresh, prev, invoiceDueDayStr, accounts));
  }, [isOpen, busy, effectiveFilterAccountId, accounts, transactions, importLogs, invoiceDueDayStr]);

  useEffect(() => {
    if (!isOpen || filterAccountId) return;
    if (selectedCardAccountId) return;
    const first = creditCardAccounts[0]?.id;
    if (first) setSelectedCardAccountId(first);
  }, [isOpen, filterAccountId, selectedCardAccountId, creditCardAccounts]);

  useEffect(() => {
    let active = true;
    if (!isOpen || !effectiveFilterAccountId) {
      setLatestRollback(null);
      return () => {
        active = false;
      };
    }

    void getLatestAtomicCardRollback(effectiveFilterAccountId)
      .then((snapshot) => {
        if (active) setLatestRollback(snapshot);
      })
      .catch((error) => {
        console.error('[CreditCardInvoiceCyclesModal][LatestAtomicRollback]', error);
        if (active) setLatestRollback(null);
      });

    return () => {
      active = false;
    };
  }, [isOpen, effectiveFilterAccountId, getLatestAtomicCardRollback]);

  useEffect(() => {
    let active = true;
    if (!isOpen || !effectiveFilterAccountId) {
      setLatestPaymentRepairRollback(null);
      return () => {
        active = false;
      };
    }

    void getLatestAtomicCardPaymentRepairRollback(effectiveFilterAccountId)
      .then((snapshot) => {
        if (active) setLatestPaymentRepairRollback(snapshot);
      })
      .catch((error) => {
        console.error('[CreditCardInvoiceCyclesModal][LatestPaymentRepairRollback]', error);
        if (active) setLatestPaymentRepairRollback(null);
      });

    return () => {
      active = false;
    };
  }, [
    isOpen,
    effectiveFilterAccountId,
    getLatestAtomicCardPaymentRepairRollback,
  ]);

  useEffect(() => {
    let active = true;
    if (!isOpen || !user) {
      setAtomicActivationEnabled(false);
      return () => {
        active = false;
      };
    }
    void getAtomicCardRebuildFeatureState().then((enabled) => {
      if (active) setAtomicActivationEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, [isOpen, user, getAtomicCardRebuildFeatureState]);

  const engineOn = user ? isCreditCardEngineEnabled(user) : false;

  const filteredAccountName = useMemo(
    () =>
      effectiveFilterAccountId
        ? accounts.find((a) => a.id === effectiveFilterAccountId)?.Nome_Conta ?? null
        : null,
    [effectiveFilterAccountId, accounts]
  );

  const rowsSortedByVencimento = useMemo(() => sortRowsByVencimentoDesc(rows), [rows]);
  const manualCardTransactionCount = useMemo(
    () =>
      effectiveFilterAccountId
        ? transactions.filter(
            (transaction) =>
              transaction.ID_Conta === effectiveFilterAccountId &&
              String(transaction.Origem || 'manual').trim().toLowerCase() === 'manual'
          ).length
        : 0,
    [effectiveFilterAccountId, transactions]
  );
  const hasAuditSource = rows.length > 0 || manualCardTransactionCount > 0;

  const previewByRowKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof creditCardRebuildFromImportHistoryService.previewCycles>[number]>();
    if (!effectiveFilterAccountId || rows.length === 0) return map;
    const previews = creditCardRebuildFromImportHistoryService.previewCycles(
      effectiveFilterAccountId,
      rowsSortedByVencimento.map((r) => {
        const refIso = parseMMAAAAToIsoMonth(r.competenciaBR.trim());
        const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
        const dueDate = resolveCreditCardInvoiceCycleDueDateIso(r, day) || '';
        return {
          fileName: r.displayOrigin,
          referenceMonth: refIso || '',
          dueDate,
        };
      }),
      transactions
    );
    rowsSortedByVencimento.forEach((r, i) => {
      if (previews[i]) map.set(r.key, previews[i]);
    });
    return map;
  }, [effectiveFilterAccountId, rowsSortedByVencimento, transactions, invoiceDueDayStr, accounts, user]);

  const validateRow = useCallback(
    (r: CreditCardInvoiceCycleRow): string | null => {
      const refIso = parseMMAAAAToIsoMonth(r.competenciaBR.trim());
      if (!refIso) {
        return `Competência inválida em "${r.displayOrigin}" — use MM/AAAA (ex.: 02/2026 para fevereiro de 2026).`;
      }
      const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
      if (resolveCreditCardInvoiceCycleDueDateIso(r, day)) return null;

      return `Informe o dia de vencimento (1–31) acima ou cadastre «dia de vencimento» na conta «${r.accountName}».`;
    },
    [invoiceDueDayStr, accounts]
  );

  const rowIsoValues = useCallback(
    (r: CreditCardInvoiceCycleRow) => {
      const referenceMonth = parseMMAAAAToIsoMonth(r.competenciaBR.trim())!;
      const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
      const dueDate = resolveCreditCardInvoiceCycleDueDateIso(r, day);
      if (!dueDate) {
        throw new Error(`Defina o dia de vencimento ou complete o vencimento em "${r.displayOrigin}".`);
      }
      return { referenceMonth, dueDate };
    },
    [invoiceDueDayStr, accounts]
  );

  const handleSaveCycleMetadata = useCallback(async () => {
    if (!user) {
      await appAlert('Faça login para continuar.', 'Sessão', 'warning');
      return;
    }
    if (!effectiveFilterAccountId) {
      await appAlert('Selecione o cartão de crédito.', 'Cartão', 'warning');
      return;
    }
    if (rows.length === 0) {
      await appAlert('Não há arquivos deste cartão no histórico de importações.', 'Histórico', 'warning');
      return;
    }

    for (const row of rows) {
      const error = validateRow(row);
      if (error) {
        await appAlert(error, 'Validação', 'warning');
        return;
      }
    }

    const stateBeforeSave = useAppStore.getState();
    const persistedRows = buildRowsFromStore({
      accounts: stateBeforeSave.accounts,
      transactions: stateBeforeSave.transactions,
      importLogs: stateBeforeSave.importLogs,
      filterAccountId: effectiveFilterAccountId,
    });
    const persistedByKey = new Map(persistedRows.map((row) => [row.key, row]));
    const changes = rows
      .map((row) => {
        const previousRow = persistedByKey.get(row.key);
        const next = rowIsoValues(row);
        let previous: ReturnType<typeof rowIsoValues> | null = null;
        if (previousRow) {
          try {
            previous = rowIsoValues(previousRow);
          } catch {
            previous = null;
          }
        }
        if (
          previous &&
          previous.referenceMonth === next.referenceMonth &&
          previous.dueDate === next.dueDate
        ) {
          return null;
        }
        return { row, previous, next };
      })
      .filter((change): change is NonNullable<typeof change> => change !== null);

    if (changes.length === 0) {
      await appAlert('Nenhuma competência ou vencimento foi alterado.', 'Histórico', 'warning');
      return;
    }

    const confirmed = await appConfirm(
      `Salvar ${changes.length} ajuste(s) de competência no histórico? Esta ação não move, exclui ou recria transações, itens, pagamentos ou faturas.`,
      'Salvar competências sem reconstruir',
      'Salvar ajustes',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setOperation('save');
    setApplyProgress(`Salvando ${changes.length} ajuste(s) somente nos metadados do histórico…`);
    const attempted: typeof changes = [];

    try {
      for (const change of changes) {
        attempted.push(change);
        const result = await saveCardImportLotClassification(
          change.row.displayOrigin,
          effectiveFilterAccountId,
          change.next.referenceMonth,
          change.next.dueDate
        );
        if (result.updatedLogs < 1 || (result.errors?.length || 0) > 0) {
          throw new Error(result.errors?.join(' ') || result.message);
        }
      }

      const refreshed = useAppStore.getState();
      setRows(
        buildRowsFromStore({
          accounts: refreshed.accounts,
          transactions: refreshed.transactions,
          importLogs: refreshed.importLogs,
          filterAccountId: effectiveFilterAccountId,
        })
      );
      setShadowAudit(null);
      await appAlert(
        `${changes.length} ajuste(s) salvo(s). As transações, faturas e pagamentos permaneceram intactos. Execute a auditoria antes de qualquer reconstrução.`,
        'Competências salvas com segurança',
        'success'
      );
    } catch (error: unknown) {
      const rollbackFailures: string[] = [];
      for (const change of [...attempted].reverse()) {
        if (!change.previous) {
          rollbackFailures.push(`${change.row.displayOrigin}: não havia metadado anterior para restaurar.`);
          continue;
        }
        try {
          const rollback = await saveCardImportLotClassification(
            change.row.displayOrigin,
            effectiveFilterAccountId,
            change.previous.referenceMonth,
            change.previous.dueDate
          );
          if (rollback.updatedLogs < 1 || (rollback.errors?.length || 0) > 0) {
            rollbackFailures.push(
              rollback.errors?.join(' ') || `${change.row.displayOrigin}: ${rollback.message}`
            );
          }
        } catch (rollbackError: unknown) {
          rollbackFailures.push(
            `${change.row.displayOrigin}: ${unknownErrorMessage(rollbackError, 'falha ao restaurar')}`
          );
        }
      }

      const baseMessage = unknownErrorMessage(error, 'Falha ao salvar as competências.');
      await appAlert(
        rollbackFailures.length === 0
          ? `${baseMessage}\n\nOs metadados anteriores foram restaurados. Nenhuma transação, fatura ou pagamento foi alterado.`
          : `${baseMessage}\n\nA restauração dos metadados não foi concluída: ${rollbackFailures.join(' ')}`,
        rollbackFailures.length === 0 ? 'Ajustes não salvos' : 'Atenção: restauração incompleta',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [
    user,
    effectiveFilterAccountId,
    rows,
    validateRow,
    rowIsoValues,
    saveCardImportLotClassification,
  ]);

  const handleApplyWithConfirm = useCallback(async () => {
    if (!user) {
      await appAlert('Faça login para continuar.', 'Sessão', 'warning');
      return;
    }
    if (!engineOn) {
      await appAlert(
        'Ative o motor de cartão nas preferências para reconstruir faturas a partir das importações.',
        'Motor de cartão',
        'warning'
      );
      return;
    }
    if (!effectiveFilterAccountId) {
      await appAlert('Selecione o cartão de crédito (conta escolhida na importação).', 'Cartão', 'warning');
      return;
    }
    if (rows.length === 0) {
      await appAlert('Não há arquivos deste cartão no histórico de importações.', 'Histórico', 'warning');
      return;
    }
    if (!atomicActivationEnabled) {
      await appAlert(
        'A ativação atômica permanece desligada para esta conta. A auditoria e o salvamento de competências continuam disponíveis sem alterar a conciliação.',
        'Sprint 2C em modo escuro',
        'warning'
      );
      return;
    }
    if (statementConservationBlocksActivation) {
      await appAlert(
        shadowAuditStatementConservationDryRun
          ? 'A ativação permanece bloqueada porque o relatório da Sprint 2M declarou “Elegível para escrita: não”. A simulação continua disponível somente para auditoria, sem alterar dados.'
          : 'A ativação permanece bloqueada até que uma auditoria gere o relatório de conservação da Sprint 2M e ele autorize explicitamente a escrita.',
        'Ativação bloqueada pela Sprint 2M',
        'warning'
      );
      return;
    }
    if (!shadowAudit?.comparison.safeToActivate) {
      await appAlert(
        'A reconstrução está bloqueada porque a auditoria atual ainda não declarou a troca segura. Salve apenas as competências e investigue as diferenças antes de reconstruir.',
        'Reconstrução protegida',
        'warning'
      );
      return;
    }

    for (const r of rows) {
      const err = validateRow(r);
      if (err) {
        await appAlert(err, 'Validação', 'warning');
        return;
      }
    }

    const confirmed = await appConfirm(
      `Ativar atomicamente a projeção auditada de ${rows.length} arquivo(s)? O banco repetirá todas as validações, atualizará apenas linhas já existentes e salvará um snapshot individual para desfazer.`,
      'Ativar projeção auditada',
      'Ativar com snapshot',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setOperation('rebuild');
    setApplyProgress('Reauditando e bloqueando a projeção no banco…');

    try {
      const cycles = rows.map((r) => {
        const { referenceMonth, dueDate } = rowIsoValues(r);
        return {
          fileName: r.displayOrigin,
          referenceMonth,
          dueDate,
        };
      });

      setApplyProgress(`Aplicando ${cycles.length} arquivo(s) em uma única transação…`);
      const result = await activateCreditCardRebuildFromImportHistory(
        effectiveFilterAccountId,
        cycles,
        shadowAudit
      );

      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
      setShadowAudit(result.postActivationAudit);
      setLatestRollback({
        snapshotId: result.snapshotId,
        accountId: effectiveFilterAccountId,
        shadowChecksum: result.shadowChecksum,
        appliedAt: new Date().toISOString(),
      });

      await appAlert(
        [
          'Projeção ativada e verificada em uma única transação.',
          `${result.statementsUpdated} fatura(s), ${result.entriesUpdated} item(ns) e ${result.paymentsUpdated} pagamento(s) atualizados.`,
          `Snapshot para rollback: ${result.snapshotId}.`,
          'Nenhum lançamento financeiro foi criado ou excluído.',
        ].join('\n'),
        'Ativação atômica concluída',
        'success'
      );
    } catch (e: unknown) {
      console.error('[CreditCardInvoiceCyclesModal]', e);
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
      const raw = unknownErrorMessage(e, 'Falha ao ativar a projeção.');
      const isNetwork =
        /failed to fetch|network|connection closed|err_connection/i.test(raw) ||
        (e instanceof TypeError && raw.includes('fetch'));
      await appAlert(
        isNetwork
          ? 'A conexão com o servidor foi interrompida. O banco confirma a ativação de forma indivisível; audite novamente para verificar o estado antes de repetir.'
          : raw || 'Falha ao ativar a projeção. Nenhuma alteração parcial é aceita pelo banco.',
        'Ativação não concluída',
        'danger'
      );
    }
  }, [
    user,
    engineOn,
    atomicActivationEnabled,
    statementConservationBlocksActivation,
    shadowAuditStatementConservationDryRun,
    effectiveFilterAccountId,
    rows,
    shadowAudit,
    validateRow,
    rowIsoValues,
    activateCreditCardRebuildFromImportHistory,
  ]);

  const handleDeterministicPaymentRepair = useCallback(async () => {
    if (!effectiveFilterAccountId || !shadowAudit) return;
    const repairRows = shadowAudit.comparison.repairablePersistedPaymentRowIds;
    if (repairRows.length === 0) return;

    const confirmed = await appConfirm(
      [
        `A auditoria encontrou ${repairRows.length} materialização(ões) antiga(s) de pagamento sem identidade.`,
        'O banco removera somente essas linhas redundantes, preservando as linhas vinculadas as transacoes originais.',
        'Nenhuma transacao, fatura, importacao ou metadado do extrato sera apagado.',
        'Um snapshot individual será criado antes da remoção para permitir rollback exato.',
      ].join('\n'),
      'Reparar pagamento duplicado',
      'Criar snapshot e reparar',
      'warning'
    );
    if (!confirmed) return;

    const cycles = rows.map((row) => {
      const { referenceMonth, dueDate } = rowIsoValues(row);
      return { fileName: row.displayOrigin, referenceMonth, dueDate };
    });

    setBusy(true);
    setOperation('repair');
    setApplyProgress('Reauditando, bloqueando a revisão e criando o snapshot do reparo...');
    try {
      const result = await repairAtomicCardPaymentDuplicates(
        effectiveFilterAccountId,
        cycles,
        shadowAudit
      );
      setShadowAudit(result.postRepairAudit);
      setLatestRollback(null);
      setLatestPaymentRepairRollback({
        snapshotId: result.snapshotId,
        accountId: effectiveFilterAccountId,
        appliedAt: new Date().toISOString(),
      });
      await appAlert(
        [
          `${result.deletedPayments} materialização(ões) redundante(s) removida(s).`,
          'As transacoes e as linhas canonicas foram preservadas.',
          `Snapshot para rollback: ${result.snapshotId}.`,
          'A auditoria foi executada novamente automaticamente; confira o novo resultado antes de qualquer ativacao.',
        ].join('\n'),
        'Reparo atômico concluído',
        'success'
      );
    } catch (error: unknown) {
      console.error('[CreditCardInvoiceCyclesModal][PaymentRepair]', error);
      await appAlert(
        unknownErrorMessage(
          error,
          'O reparo foi recusado. Nenhuma remoção parcial é aceita pelo banco.'
        ),
        'Reparo não concluído',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [
    effectiveFilterAccountId,
    shadowAudit,
    rows,
    rowIsoValues,
    repairAtomicCardPaymentDuplicates,
  ]);

  const handlePaymentRepairRollback = useCallback(async () => {
    if (!latestPaymentRepairRollback) return;
    const confirmed = await appConfirm(
      'Restaurar exatamente as linhas removidas pelo último reparo? O banco recusará o rollback se a projeção tiver mudado depois dele.',
      'Desfazer reparo de pagamento',
      'Restaurar snapshot',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setOperation('repairRollback');
    setApplyProgress('Validando a revisão e restaurando o snapshot do reparo...');
    try {
      const result = await rollbackAtomicCardPaymentRepair(
        latestPaymentRepairRollback.snapshotId
      );
      setLatestPaymentRepairRollback(null);
      setShadowAudit(null);
      await appAlert(
        `${result.restoredPayments} pagamento(s) materializado(s) restaurado(s). Execute uma nova auditoria para confirmar o estado.`,
        'Rollback do reparo concluido',
        'success'
      );
    } catch (error: unknown) {
      console.error('[CreditCardInvoiceCyclesModal][PaymentRepairRollback]', error);
      await appAlert(
        unknownErrorMessage(
          error,
          'O rollback foi recusado. Nenhuma restauracao parcial foi aceita.'
        ),
        'Rollback do reparo não concluído',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [latestPaymentRepairRollback, rollbackAtomicCardPaymentRepair]);

  const handleRollback = useCallback(async () => {
    if (!latestRollback) return;
    const confirmed = await appConfirm(
      `Desfazer integralmente a ativação ${latestRollback.shadowChecksum}? O banco só permitirá o rollback se nenhuma linha da projeção tiver mudado depois da ativação.`,
      'Desfazer ativação atômica',
      'Restaurar snapshot',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setOperation('rollback');
    setApplyProgress('Validando a revisão atual e restaurando o snapshot em uma única transação…');
    try {
      const result = await rollbackAtomicCardRebuild(latestRollback.snapshotId);
      setLatestRollback(null);
      setShadowAudit(null);
      await appAlert(
        `Snapshot ${result.snapshotId} restaurado com sucesso. A projeção voltou exatamente à revisão anterior.`,
        'Rollback concluído',
        'success'
      );
    } catch (error: unknown) {
      console.error('[CreditCardInvoiceCyclesModal][AtomicRollback]', error);
      await appAlert(
        unknownErrorMessage(
          error,
          'O rollback foi recusado. Nenhuma alteração parcial foi aceita pelo banco.'
        ),
        'Rollback não concluído',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [latestRollback, rollbackAtomicCardRebuild]);

  const handleShadowAudit = useCallback(async () => {
    if (!user) {
      await appAlert('Faça login para continuar.', 'Sessão', 'warning');
      return;
    }
    if (!effectiveFilterAccountId) {
      await appAlert('Selecione o cartão de crédito.', 'Cartão', 'warning');
      return;
    }
    if (!hasAuditSource) {
      await appAlert('Não há lançamentos importados ou manuais deste cartão para auditar.', 'Histórico', 'warning');
      return;
    }

    for (const row of rows) {
      const error = validateRow(row);
      if (error) {
        await appAlert(error, 'Validação', 'warning');
        return;
      }
    }

    const cycles = rows.map((row) => {
      const { referenceMonth, dueDate } = rowIsoValues(row);
      return {
        fileName: row.displayOrigin,
        referenceMonth,
        dueDate,
      };
    });

    setBusy(true);
    setOperation('audit');
    setApplyProgress('Montando a projeção em memória e comparando com o banco, sem alterar dados…');
    try {
      const result = await auditCreditCardRebuildFromImportHistory(
        effectiveFilterAccountId,
        cycles
      );
      setShadowAudit(result);

      const { shadow, persisted, comparison } = result;
      const statusLabel =
        comparison.status === 'blocked'
          ? 'BLOQUEADA'
          : comparison.status === 'identical'
            ? 'IDÊNTICA'
            : comparison.status === 'informational'
              ? 'CONCILIADA — somente evidências protegidas permanecem'
            : comparison.safeToActivate
              ? 'DIFERENTE — apta para uma futura troca atômica'
              : 'DIFERENTE — requer investigação antes de qualquer troca';
      const issueLines = shadow.issues
        .slice(0, 5)
        .map((issue) => `• ${issue.message}`);
      await appAlert(
        [
          `Auditoria ${statusLabel}. Nenhum dado foi alterado.`,
          `Fonte atual: ${persisted.source}.`,
          `Sombra: ${shadow.sourceTransactionCount} transações, ${shadow.projectedEntryCount} itens, ${shadow.projectedPaymentCount} pagamentos e ${shadow.statements.length} faturas.`,
          `Diferenças: ${comparison.differenceCount}. Bloqueios: ${shadow.blockers.length}. Alertas: ${shadow.warnings.length}.`,
          `Duplicidades atuais: ${comparison.duplicatePersistedTransactionIds.length} transação(ões) (${comparison.repairablePersistedEntryRowIds.length} linha(s) com reparo determinístico; ${comparison.conflictingDuplicatePersistedTransactionIds.length} ID(s) ambíguo(s)), ${comparison.duplicatePersistedPaymentTransactionIds.length} pagamento(s) por ID, ${comparison.suspiciousPersistedPaymentEventKeys.length} evento(s) de pagamento sem identidade e ${comparison.duplicatePersistedStatementKeys.length} competência(s).`,
          `Ausentes na projeção atual: ${comparison.missingTransactionIds.length} transação(ões), ${comparison.missingPaymentKeys.length} pagamento(s) e ${comparison.missingStatementKeys.length} fatura(s).`,
          `Órfãos na projeção atual: ${comparison.orphanTransactionIds.length} transação(ões), ${comparison.orphanPaymentKeys.length} pagamento(s) e ${comparison.orphanStatementKeys.length} fatura(s).`,
          `Alterados: ${comparison.changedTransactionIds.length} transação(ões), ${comparison.changedPaymentTransactionIds.length} pagamento(s) e ${comparison.changedStatementKeys.length} fatura(s).`,
          `Faturas com metadados protegidos: ${comparison.protectedMetadataStatementKeys.length}.`,
          comparison.status === 'informational'
            ? 'Nova troca atômica necessária: não; a projeção estrutural já está conciliada.'
            : `Apta para futura troca atômica: ${comparison.safeToActivate ? 'sim' : 'não'}.`,
          `Checksum: ${shadow.checksum}.`,
          ...issueLines,
        ].join('\n'),
        comparison.status === 'blocked' ||
          (comparison.status === 'different' && !comparison.safeToActivate)
          ? 'Auditoria requer investigação'
          : comparison.status === 'informational'
            ? 'Auditoria conciliada'
            : 'Auditoria somente leitura',
        comparison.status === 'blocked' ||
          (comparison.status === 'different' && !comparison.safeToActivate)
          ? 'danger'
          : comparison.status === 'identical' || comparison.status === 'informational'
            ? 'success'
            : 'warning'
      );
    } catch (error: unknown) {
      console.error('[CreditCardInvoiceCyclesModal][ShadowAudit]', error);
      setShadowAudit(null);
      await appAlert(
        unknownErrorMessage(error, 'Falha ao auditar a projeção do cartão.'),
        'Auditoria não concluída',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [
    user,
    effectiveFilterAccountId,
    hasAuditSource,
    rows,
    validateRow,
    rowIsoValues,
    auditCreditCardRebuildFromImportHistory,
  ]);

  const handleInvoiceDueDayChange = useCallback(
    (value: string) => {
      setShadowAudit(null);
      const sanitized = sanitizeInvoiceDueDayInput(value);
      setInvoiceDueDayStr(sanitized);
      setRows((prev) =>
        sortRowsByVencimentoDesc(
          prev.map((r) => {
            const day = effectiveDueDayForAccount(r.accountId, sanitized, accounts);
            const ven = updateDueDayPreservingKnownMonth(r, day);
            return { ...r, vencimentoBR: ven };
          })
        )
      );
    },
    [accounts]
  );

  const handleCompetenciaChange = useCallback(
    (key: string, value: string) => {
      setShadowAudit(null);
      setRows((prev) =>
        sortRowsByVencimentoDesc(
          prev.map((r) => {
            if (r.key !== key) return r;
            const iso = parseMMAAAAToIsoMonth(value.trim());
            const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
            const ven = iso && day != null ? computeVencimentoBRFromCompetenceIsoMonth(iso, day) : '';
            return {
              ...r,
              competenciaBR: value,
              vencimentoBR: ven,
              competenceEvidenceSource: 'session-confirmed',
            };
          })
        )
      );
    },
    [invoiceDueDayStr, accounts]
  );

  const summaryHint = useMemo(() => {
    if (!engineOn) return 'Motor de cartão desativado para este usuário.';
    if (!effectiveFilterAccountId) return 'Selecione o cartão para listar os arquivos do histórico de importações.';
    if (rows.length === 0 && manualCardTransactionCount > 0) {
      return `${manualCardTransactionCount} lançamento(s) manual(is) disponível(is) para auditoria somente leitura.`;
    }
    if (rows.length === 0) return 'Nenhum arquivo deste cartão no histórico (nem transações vinculadas).';
    return `${rows.length} arquivo(s) e ${manualCardTransactionCount} lançamento(s) manual(is) em «${filteredAccountName}».`;
  }, [engineOn, rows.length, manualCardTransactionCount, filteredAccountName, effectiveFilterAccountId]);

  const modalTitle = filteredAccountName
    ? `Faturas pelo histórico — ${filteredAccountName}`
    : 'Reconstruir faturas pelo histórico de importações';

  const showAccountColumn = !effectiveFilterAccountId;
  const showCardPicker = !filterAccountId;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !busy && onClose()}
      title={modalTitle}
      overlayClassName={overlayClassName}
      className="max-w-5xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => !busy && onClose()}>
            Fechar
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !effectiveFilterAccountId || rows.length === 0}
            onClick={handleSaveCycleMetadata}
          >
            {operation === 'save' ? 'Salvando…' : 'Salvar competências'}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !effectiveFilterAccountId || !hasAuditSource}
            onClick={handleShadowAudit}
          >
            {operation === 'audit' ? 'Auditando…' : 'Auditar sem alterar dados'}
          </Button>
          {latestPaymentRepairRollback && (
            <Button variant="secondary" disabled={busy} onClick={handlePaymentRepairRollback}>
              {operation === 'repairRollback'
                ? 'Restaurando reparo...'
                : 'Desfazer último reparo'}
            </Button>
          )}
          {Boolean(shadowAudit?.comparison.repairablePersistedPaymentRowIds.length) && (
            <Button
              variant="secondary"
              disabled={busy || !atomicActivationEnabled || !effectiveFilterAccountId}
              onClick={handleDeterministicPaymentRepair}
              title={
                atomicActivationEnabled
                  ? 'Remove somente materializações antigas com contraparte canônica e cria snapshot para rollback.'
                  : 'Reparo desligado pelo kill switch individual da Sprint 2C.'
              }
            >
              {operation === 'repair'
                ? 'Reparando duplicidade...'
                : 'Reparar duplicidade com snapshot'}
            </Button>
          )}
          {latestRollback && (
            <Button variant="secondary" disabled={busy} onClick={handleRollback}>
              {operation === 'rollback' ? 'Restaurando…' : 'Desfazer última ativação'}
            </Button>
          )}
          <Button
            disabled={
              busy ||
              !engineOn ||
              !atomicActivationEnabled ||
              statementConservationBlocksActivation ||
              !effectiveFilterAccountId ||
              rows.length === 0 ||
              !shadowAudit?.comparison.safeToActivate
            }
            onClick={handleApplyWithConfirm}
            title={
              !atomicActivationEnabled
                ? 'Ativação desligada pelo kill switch individual da Sprint 2C.'
                : !shadowAuditStatementConservationDryRun
                  ? 'Ativação bloqueada até a auditoria gerar o relatório de conservação da Sprint 2M.'
                  : statementConservationBlocksActivation
                    ? 'Ativação bloqueada: o relatório da Sprint 2M declara “Elegível para escrita: não”.'
                : shadowAudit?.comparison.safeToActivate
                ? 'A auditoria atual permite atualizar as linhas existentes atomicamente.'
                : 'A ativação só é liberada após uma auditoria segura e sem criação ou exclusão de linhas.'
            }
          >
            {operation === 'rebuild'
              ? 'Ativando…'
              : shadowAuditStatementConservationDryRun && statementConservationBlocksActivation
                ? 'Ativação bloqueada pela Sprint 2M'
                : 'Ativar projeção com snapshot'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-300 leading-relaxed">
          Lista os arquivos do <strong className="text-white">histórico de importações</strong> do cartão escolhido (ex.: Cartão XP).
          Para cada arquivo, confira ou informe a <strong className="text-white">competência</strong> (<strong className="text-white">MM/AAAA</strong>) e o{' '}
          <strong className="text-white">vencimento</strong> (o valor confirmado no histórico é preservado; o cálculo automático só preenche datas ausentes).
          Use <strong className="text-white">Salvar competências</strong> para registrar apenas esses metadados, sem alterar lançamentos ou conciliação.
          Uma ativação só é liberada depois de uma auditoria segura. A Sprint 2C atualiza apenas linhas que já existem, em uma única transação, e cria um snapshot individual para desfazer. A projeção <strong className="text-white">soma as linhas de saída</strong> do extrato para o total da fatura e os{' '}
          <strong className="text-white">estornos</strong> na competência do arquivo; <strong className="text-white">pagamentos de fatura</strong> no CSV quitam a competência <strong className="text-white">anterior</strong> (padrão N+1 do extrato).
        </p>

        {showCardPicker && (
          <Select
            label="Cartão (conta escolhida na importação)"
            value={selectedCardAccountId}
            onChange={(e) => setSelectedCardAccountId(e.target.value)}
            disabled={busy || creditCardAccounts.length === 0}
          >
            <option value="">Selecione o cartão…</option>
            {creditCardAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.Nome_Conta}
              </option>
            ))}
          </Select>
        )}
        <p className="text-xs text-gray-500">{summaryHint}</p>
        <p className="text-[11px] text-slate-600">
          Arquivos ordenados por <strong className="text-slate-400">vencimento</strong> (mais recente no topo) para facilitar a auditoria.
        </p>

        {busy && applyProgress && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2.5 text-sm text-cyan-100"
          >
            <span className="font-medium text-white">Em andamento.</span> {applyProgress}
          </div>
        )}

        {shadowAudit && (
          <div
            className={`rounded-xl border px-3 py-3 text-xs ${
              shadowAudit.comparison.status === 'blocked' ||
              (shadowAudit.comparison.status === 'different' &&
                !shadowAudit.comparison.safeToActivate)
                ? 'border-red-500/40 bg-red-500/10 text-red-100'
                : shadowAudit.comparison.status === 'identical' ||
                    shadowAudit.comparison.status === 'informational'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
            }`}
          >
            <p className="font-semibold text-white">
              Sprint 2C — auditoria e ativação atômica:{' '}
              {shadowAudit.comparison.status === 'blocked'
                ? 'bloqueada'
                : shadowAudit.comparison.status === 'identical'
                  ? 'projeção idêntica'
                  : shadowAudit.comparison.status === 'informational'
                    ? 'projeção conciliada; evidências preservadas'
                  : shadowAudit.comparison.safeToActivate
                    ? 'diferenças reparáveis encontradas'
                    : 'diferenças que exigem investigação'}
            </p>
            <p className="mt-1 leading-relaxed">
              {shadowAudit.shadow.sourceTransactionCount} transações ·{' '}
              {shadowAudit.shadow.projectedEntryCount} itens ·{' '}
              {shadowAudit.shadow.projectedPaymentCount} pagamentos ·{' '}
              {shadowAudit.shadow.statements.length} faturas ·{' '}
              {shadowAudit.comparison.differenceCount} diferenças ({shadowAudit.comparison.structuralDifferenceCount} estruturais) ·{' '}
              {shadowAudit.shadow.blockers.length} bloqueios ·{' '}
              {shadowAudit.comparison.status === 'informational'
                ? 'nenhuma nova troca atômica necessária'
                : `futura troca atômica ${shadowAudit.comparison.safeToActivate ? 'apta' : 'não apta'}`}. Nenhum dado foi gravado.
            </p>
            <p className="mt-1 font-mono text-[10px] opacity-75">{shadowAudit.shadow.checksum}</p>
            {shadowAuditForensics && (
              <div className="mt-3 rounded-lg border border-cyan-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Etapa forense — causas agregadas</p>
                  <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                    somente leitura · sem identificadores
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Ação recomendada:{' '}
                  <strong className="text-white">
                    {shadowAuditForensics.recommendedAction === 'investigate'
                      ? 'investigar antes de reparar'
                      : shadowAuditForensics.recommendedAction === 'repair-narrow'
                        ? 'reparo estreito com snapshot'
                        : shadowAuditForensics.recommendedAction === 'activate'
                          ? 'ativação individual com snapshot'
                          : 'observar sem alterar'}
                  </strong>
                  . O agrupamento abaixo não contém descrições, nomes de arquivos nem IDs de transações.
                </p>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Itens alterados por campo</p>
                    {shadowAuditForensics.entryChangeProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.entryChangeProfiles.slice(0, 6).map((profile) => (
                          <li key={profile.key} className="flex justify-between gap-2">
                            <span>{profile.fields.map((field) => FORENSIC_FIELD_LABELS[field] || field).join(' + ')}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma alteração de item.</p>
                    )}
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Faturas alteradas por campo</p>
                    {shadowAuditForensics.statementChangeProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.statementChangeProfiles.slice(0, 6).map((profile) => (
                          <li key={profile.key} className="flex justify-between gap-2">
                            <span>{profile.fields.map((field) => FORENSIC_FIELD_LABELS[field] || field).join(' + ')}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma alteração de fatura.</p>
                    )}
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Pagamentos alterados por campo</p>
                    {shadowAuditForensics.paymentChangeProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.paymentChangeProfiles.slice(0, 6).map((profile) => (
                          <li key={profile.key} className="flex justify-between gap-2">
                            <span>{profile.fields.map((field) => FORENSIC_FIELD_LABELS[field] || field).join(' + ')}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma alteração de pagamento.</p>
                    )}
                  </div>
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Duplicidades de itens</p>
                    {shadowAuditForensics.duplicateTransactionCohorts.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.duplicateTransactionCohorts.map((cohort) => (
                          <li key={cohort.code} className="flex justify-between gap-2">
                            <span>{FORENSIC_DUPLICATE_LABELS[cohort.code]}</span>
                            <strong className="text-white">{cohort.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma duplicidade de item.</p>
                    )}
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Itens ausentes por competência</p>
                    {shadowAuditForensics.missingTransactionsByStatement.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.missingTransactionsByStatement.slice(0, 8).map((cohort) => (
                          <li key={cohort.statementKey} className="flex justify-between gap-2">
                            <span>{cohort.statementKey === 'unknown' ? 'competência não identificada' : cohort.statementKey}</span>
                            <strong className="text-white">{cohort.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhum item ausente.</p>
                    )}
                  </div>
                </div>

                <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                  <p>
                    Pagamentos órfãos: <strong className="text-white">{shadowAuditForensics.orphanPaymentsWithIdentity}</strong> com identidade e{' '}
                    <strong className="text-white">{shadowAuditForensics.orphanPaymentsWithoutIdentity}</strong> sem identidade · candidatos determinísticos:{' '}
                    <strong className="text-white">{shadowAuditForensics.repairableEntryRows}</strong> item(ns) e{' '}
                    <strong className="text-white">{shadowAuditForensics.repairablePaymentRows}</strong> pagamento(s) · faturas protegidas:{' '}
                    <strong className="text-white">{shadowAuditForensics.protectedStatementCount}</strong>.
                  </p>
                  {shadowAuditForensics.recommendationCodes.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                      {shadowAuditForensics.recommendationCodes.map((code) => (
                        <li key={code}>{FORENSIC_RECOMMENDATION_LABELS[code]}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {shadowAuditLineage && (
              <div className="mt-3 rounded-lg border border-violet-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Etapa forense — conservação e linhagem</p>
                  <span className="rounded-full border border-violet-300/30 bg-violet-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100">
                    explicativo · não autoriza reparo
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Diagnóstico: <strong className="text-white">{LINEAGE_STATUS_LABELS[shadowAuditLineage.status]}</strong>.
                  O pareamento usa somente assinaturas de conteúdo em memória; nenhuma linha foi escolhida para exclusão ou atualização.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Linhas projetadas / persistidas</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditLineage.conservation.projectedRowCount} / {shadowAuditLineage.conservation.persistedRowCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Identidades únicas projetadas / atuais</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditLineage.conservation.projectedUniqueIdentityCount} / {shadowAuditLineage.conservation.persistedUniqueIdentityCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Identidades ausentes / linhas excedentes</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditLineage.conservation.missingIdentityCount} / {shadowAuditLineage.conservation.duplicateExcessRowCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Balanço de identidade</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditLineage.conservation.missingBalancedByDuplicateSurplus ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {shadowAuditLineage.conservation.missingIdentityCount === 0 && shadowAuditLineage.conservation.duplicateExcessRowCount === 0
                        ? 'sem déficit'
                        : shadowAuditLineage.conservation.missingBalancedByDuplicateSurplus
                          ? 'compensado exatamente'
                          : 'ainda não compensado'}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Explicação por assinatura de conteúdo</p>
                    {shadowAuditLineage.matchProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditLineage.matchProfiles.map((profile) => (
                          <li key={profile.code} className="flex justify-between gap-2">
                            <span>{LINEAGE_MATCH_LABELS[profile.code]}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma quebra de identidade para explicar.</p>
                    )}
                    <p className="mt-2 border-t border-white/10 pt-2 text-slate-300">
                      Explicadas: <strong className="text-white">{shadowAuditLineage.matchedIdentityCount}</strong> · ainda sem explicação:{' '}
                      <strong className="text-white">{shadowAuditLineage.unexplainedMissingIdentityCount}</strong> · excedentes sem correspondência:{' '}
                      <strong className="text-white">{shadowAuditLineage.unexplainedSurplusRowCount}</strong>.
                    </p>
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Coortes de origem afetadas</p>
                    {shadowAuditLineage.sourceCohorts.length > 0 ? (
                      <ul className="mt-1 space-y-1.5">
                        {shadowAuditLineage.sourceCohorts.slice(0, 8).map((cohort) => (
                          <li key={cohort.cohort} className="rounded border border-white/5 bg-black/10 px-2 py-1.5">
                            <div className="flex flex-wrap justify-between gap-2">
                              <strong className="text-white">{cohort.cohort}</strong>
                              <span>{cohort.statementKeys.join(', ') || 'competência não identificada'}</span>
                            </div>
                            <p className="mt-0.5 text-slate-400">
                              {cohort.projectedEntryCount} linha(s) · {cohort.missingIdentityCount} identidade(s) ausente(s) ·{' '}
                              {cohort.duplicateExcessRowCount} excedente(s) · {cohort.repeatedSourceRowSignatureCount} assinatura(s) de origem repetida(s)
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma coorte de origem afetada.</p>
                    )}
                    {shadowAuditLineage.sourceCohorts.length > 8 && (
                      <p className="mt-1 text-slate-500">
                        Mais {shadowAuditLineage.sourceCohorts.length - 8} coorte(s) preservada(s) no resumo agregado.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                  <p>
                    Grupos de identidade duplicada: <strong className="text-white">{shadowAuditLineage.conservation.duplicateIdentityGroupCount}</strong> ·{' '}
                    identidades órfãs: <strong className="text-white">{shadowAuditLineage.conservation.orphanIdentityCount}</strong> ·{' '}
                    linhas com reparo determinístico já comprovado: <strong className="text-white">{shadowAuditLineage.deterministicRepairRowCount}</strong>.
                  </p>
                  {shadowAuditLineage.recommendationCodes.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                      {shadowAuditLineage.recommendationCodes.map((code) => (
                        <li key={code}>{LINEAGE_RECOMMENDATION_LABELS[code]}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {shadowAuditProvenance && (
              <div className="mt-3 rounded-lg border border-cyan-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2F — proveniência histórica</p>
                  <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                    somente leitura · não cria reparo
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Diagnóstico: <strong className="text-white">{PROVENANCE_STATUS_LABELS[shadowAuditProvenance.status]}</strong>.
                  A análise cruza origem e hash apenas em memória; nomes de arquivos, hashes, lotes e IDs de linha não aparecem neste relatório.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Linhas atuais com / sem proveniência</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditProvenance.coverage.persistedRowsWithSourceIdentity} / {shadowAuditProvenance.coverage.persistedRowsWithoutSourceIdentity}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Ausentes / localizadas pela origem</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditProvenance.missingIdentityCount} / {shadowAuditProvenance.exactProvenanceMatchCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Âncoras confirmadas / pendentes</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditProvenance.ownerAnchorConfirmedCount} / {shadowAuditProvenance.ownerAnchorMissingCount + shadowAuditProvenance.ownerAnchorAmbiguousCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Candidatas rastreáveis / não resolvidas</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditProvenance.unresolvedCount === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {shadowAuditProvenance.recoveryCandidateCount} / {shadowAuditProvenance.unresolvedCount}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Evidências agregadas</p>
                    {shadowAuditProvenance.evidenceProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditProvenance.evidenceProfiles.map((profile) => (
                          <li key={profile.code} className="flex justify-between gap-2">
                            <span>{PROVENANCE_EVIDENCE_LABELS[profile.code]}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma identidade ausente exige reconstrução.</p>
                    )}
                    <p className="mt-2 border-t border-white/10 pt-2 text-slate-300">
                      Colisões atuais / projetadas:{' '}
                      <strong className="text-white">{shadowAuditProvenance.coverage.persistedSourceCollisionGroupCount}</strong> /{' '}
                      <strong className="text-white">{shadowAuditProvenance.coverage.projectedSourceCollisionGroupCount}</strong>.
                    </p>
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Coortes opacas afetadas</p>
                    {shadowAuditProvenance.sourceCohorts.length > 0 ? (
                      <ul className="mt-1 space-y-1.5">
                        {shadowAuditProvenance.sourceCohorts.slice(0, 8).map((cohort) => (
                          <li key={cohort.cohort} className="rounded border border-white/5 bg-black/10 px-2 py-1.5">
                            <div className="flex flex-wrap justify-between gap-2">
                              <strong className="text-white">{cohort.cohort}</strong>
                              <span>{cohort.statementKeys.join(', ') || 'competência não identificada'}</span>
                            </div>
                            <p className="mt-0.5 text-slate-400">
                              {cohort.missingIdentityCount} ausente(s) · {cohort.exactProvenanceMatchCount} localizada(s) ·{' '}
                              {cohort.recoveryCandidateCount} rastreável(is) · {cohort.unresolvedCount} pendente(s)
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma coorte de origem afetada.</p>
                    )}
                  </div>
                </div>

                <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                  <p>
                    Evidência para uma futura simulação individual:{' '}
                    <strong className={shadowAuditProvenance.status === 'clean' || shadowAuditProvenance.eligibleForFutureDryRunPlan ? 'text-emerald-300' : 'text-amber-300'}>
                      {shadowAuditProvenance.status === 'clean'
                        ? 'não necessária'
                        : shadowAuditProvenance.eligibleForFutureDryRunPlan
                          ? 'suficiente'
                          : 'ainda insuficiente'}
                    </strong>.
                    {' '}Isso não autoriza escrita, ativação ou reparo.
                  </p>
                  {shadowAuditProvenance.recommendationCodes.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                      {shadowAuditProvenance.recommendationCodes.map((code) => (
                        <li key={code}>{PROVENANCE_RECOMMENDATION_LABELS[code]}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {shadowAuditIdentityDryRun && (
              <div className="mt-3 rounded-lg border border-violet-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2G — simulação individual de identidade</p>
                  <span className="rounded-full border border-violet-300/30 bg-violet-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100">
                    zero escritas · sem payload de banco
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado: <strong className="text-white">{IDENTITY_DRY_RUN_STATUS_LABELS[shadowAuditIdentityDryRun.status]}</strong>.
                  A prévia usa um clone em memória, preserva as âncoras e recalcula a auditoria sem expor IDs, hashes, lotes ou nomes de arquivos.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Identidades ausentes</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditIdentityDryRun.before.missingIdentityCount} → {shadowAuditIdentityDryRun.after.missingIdentityCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Grupos duplicados</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditIdentityDryRun.before.duplicateIdentityGroupCount} → {shadowAuditIdentityDryRun.after.duplicateIdentityGroupCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Diferenças estruturais</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditIdentityDryRun.before.structuralDifferenceCount} → {shadowAuditIdentityDryRun.after.structuralDifferenceCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Linhas antes / depois</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditIdentityDryRun.rowCountDelta === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {shadowAuditIdentityDryRun.rowCountBefore} / {shadowAuditIdentityDryRun.rowCountAfter}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Escopo hipotético</p>
                    <p className="mt-1 text-slate-300">
                      {shadowAuditIdentityDryRun.hypotheticalUpdateCount} linha(s) simulada(s) ·{' '}
                      {shadowAuditIdentityDryRun.confirmedAnchorCount} âncora(s) preservada(s) ·{' '}
                      {shadowAuditIdentityDryRun.unresolvedCount} pendência(s).
                    </p>
                    <p className="mt-1 text-slate-400">
                      Operações reais executadas: <strong className="text-emerald-300">{shadowAuditIdentityDryRun.actualWriteOperationCount}</strong>.
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Depois da simulação</p>
                    <p className="mt-1 text-slate-300">
                      Identidades ainda alteradas: <strong className="text-white">{shadowAuditIdentityDryRun.after.changedIdentityCount}</strong> ·{' '}
                      diferenças residuais: <strong className="text-white">{shadowAuditIdentityDryRun.residualDifferenceCount}</strong>.
                    </p>
                    <p className="mt-1 text-slate-400">A simulação de identidade não equivale à ativação integral da projeção.</p>
                  </div>
                </div>

                {shadowAuditIdentityDryRun.changeProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Mudanças simuladas por grupo</p>
                    <ul className="mt-1 space-y-1.5">
                      {shadowAuditIdentityDryRun.changeProfiles.slice(0, 12).map((profile) => (
                        <li
                          key={`${profile.code}-${profile.fromStatementKey}-${profile.toStatementKey}-${profile.fromEntryType}-${profile.toEntryType}`}
                          className="flex flex-wrap justify-between gap-2 rounded border border-white/5 bg-black/10 px-2 py-1.5"
                        >
                          <span>
                            {profile.fromStatementKey} → {profile.toStatementKey} · {IDENTITY_DRY_RUN_CHANGE_LABELS[profile.code]}
                            {profile.fromEntryType !== profile.toEntryType
                              ? ` · ${profile.fromEntryType} → ${profile.toEntryType}`
                              : ''}
                          </span>
                          <strong className="text-white">{profile.count}</strong>
                        </li>
                      ))}
                    </ul>
                    {shadowAuditIdentityDryRun.changeProfiles.length > 12 && (
                      <p className="mt-1 text-slate-500">
                        Mais {shadowAuditIdentityDryRun.changeProfiles.length - 12} grupo(s) permanecem no resumo agregado.
                      </p>
                    )}
                  </div>
                )}

                {shadowAuditIdentityDryRun.blockerProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-amber-400/25 bg-amber-500/5 p-2">
                    <p className="font-semibold text-amber-100">Bloqueios da simulação</p>
                    <ul className="mt-1 space-y-1 text-amber-100/90">
                      {shadowAuditIdentityDryRun.blockerProfiles.map((profile) => (
                        <li key={profile.code} className="flex justify-between gap-2">
                          <span>{IDENTITY_DRY_RUN_BLOCKER_LABELS[profile.code]}</span>
                          <strong>{profile.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {shadowAuditIdentityDryRun.recommendationCodes.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                    {shadowAuditIdentityDryRun.recommendationCodes.map((code) => (
                      <li key={code}>{IDENTITY_DRY_RUN_RECOMMENDATION_LABELS[code]}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {engineOn && shadowAuditCompetenceForensics && (
              <div className="mt-3 rounded-lg border border-sky-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2H — causa das divergências de competência</p>
                  <span className="rounded-full border border-sky-300/30 bg-sky-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-100">
                    agregado · somente leitura · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Diagnóstico:{' '}
                  <strong className="text-white">
                    {COMPETENCE_FORENSIC_STATUS_LABELS[shadowAuditCompetenceForensics.status]}
                  </strong>
                  {' '}· confiança {shadowAuditCompetenceForensics.confidence === 'high'
                    ? 'alta'
                    : shadowAuditCompetenceForensics.confidence === 'medium'
                      ? 'média'
                      : shadowAuditCompetenceForensics.confidence === 'low'
                        ? 'baixa'
                        : 'não aplicável'}.
                  {' '}O relatório não contém IDs, hashes, nomes de arquivos ou payload de banco.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Linhas pareadas / projetadas</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditCompetenceForensics.matchedRowCount} / {shadowAuditCompetenceForensics.rowCountProjected}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Divergências de competência</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditCompetenceForensics.competenceMismatchCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Só competência / competência + tipo</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditCompetenceForensics.competenceOnlyMismatchCount} / {shadowAuditCompetenceForensics.competenceAndTypeMismatchCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Com evidência confirmada</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditCompetenceForensics.confirmedEvidenceMismatchCount}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Causas agregadas</p>
                    <ul className="mt-1 space-y-1">
                      {shadowAuditCompetenceForensics.causeProfiles.map((profile) => (
                        <li key={profile.code} className="flex justify-between gap-2">
                          <span>{COMPETENCE_CAUSE_LABELS[profile.code]}</span>
                          <strong className="text-white">{profile.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Fonte da competência divergente</p>
                    {shadowAuditCompetenceForensics.evidenceProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditCompetenceForensics.evidenceProfiles.map((profile) => (
                          <li key={profile.source} className="flex justify-between gap-2">
                            <span>{COMPETENCE_EVIDENCE_LABELS[profile.source]}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma competência divergente.</p>
                    )}
                  </div>
                </div>

                <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                  <p className="font-semibold text-white">Conservação e regra de fechamento</p>
                  <p className="mt-1 text-slate-300">
                    Linhas projetadas / atuais: {shadowAuditCompetenceForensics.rowCountProjected} / {shadowAuditCompetenceForensics.rowCountPersisted}
                    {' '}· não pareadas: {shadowAuditCompetenceForensics.unmatchedProjectedRowCount}
                    {' '}· ambíguas: {shadowAuditCompetenceForensics.ambiguousMatchCount}
                    {' '}· conteúdo econômico divergente: {shadowAuditCompetenceForensics.economicMismatchCount}.
                  </p>
                  {shadowAuditCompetenceForensics.closingDayConfigured ? (
                    <p className="mt-1 text-slate-300">
                      A regra configurada de fechamento apoia {shadowAuditCompetenceForensics.closingRuleSupportsExpectedCount} competência(s) divergente(s) e conflita com {shadowAuditCompetenceForensics.closingRuleConflictsExpectedCount}; ela permanece apenas como fallback.
                    </p>
                  ) : (
                    <p className="mt-1 text-slate-400">Dia de fechamento não configurado; nenhuma inferência automática foi promovida a fonte de verdade.</p>
                  )}
                  {shadowAuditCompetenceForensics.shiftProfiles.length > 0 && (
                    <p className="mt-1 text-slate-400">
                      Deslocamentos (atual → sombra):{' '}
                      {shadowAuditCompetenceForensics.shiftProfiles
                        .map((profile) => `${profile.monthsFromCurrentToExpected == null ? 'indefinido' : `${profile.monthsFromCurrentToExpected} mês(es)`}: ${profile.count}`)
                        .join(' · ')}.
                    </p>
                  )}
                </div>

                <div className="mt-2 rounded border border-sky-300/20 bg-sky-400/5 p-2">
                  <p>
                    Elegível para desenvolver uma futura simulação de competência:{' '}
                    <strong className={shadowAuditCompetenceForensics.eligibleForFutureCompetenceDryRun ? 'text-emerald-300' : 'text-amber-300'}>
                      {shadowAuditCompetenceForensics.eligibleForFutureCompetenceDryRun ? 'sim' : 'não'}
                    </strong>.
                    {' '}Operações reais executadas: <strong className="text-emerald-300">{shadowAuditCompetenceForensics.actualWriteOperationCount}</strong>.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                    {shadowAuditCompetenceForensics.recommendationCodes.map((code) => (
                      <li key={code}>{COMPETENCE_RECOMMENDATION_LABELS[code]}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {engineOn && shadowAuditCompetenceDryRun && (
              <div className="mt-3 rounded-lg border border-teal-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2I — simulação individual de competência</p>
                  <span className="rounded-full border border-teal-300/30 bg-teal-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-100">
                    clone em memória · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado:{' '}
                  <strong className="text-white">
                    {COMPETENCE_DRY_RUN_STATUS_LABELS[shadowAuditCompetenceDryRun.status]}
                  </strong>.
                  {' '}Somente a competência das linhas inequivocamente comprovadas é alterada no clone; o relatório não contém IDs, hashes, nomes de arquivos ou payload de banco.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Divergências antes / depois</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditCompetenceDryRun.competenceMismatchBefore} → {shadowAuditCompetenceDryRun.competenceMismatchAfter}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Mudanças simuladas</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditCompetenceDryRun.hypotheticalUpdateCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Exceções isoladas</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditCompetenceDryRun.excludedRowCount === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {shadowAuditCompetenceDryRun.excludedRowCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Linhas antes / depois</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditCompetenceDryRun.rowCountDelta === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {shadowAuditCompetenceDryRun.rowCountBefore} / {shadowAuditCompetenceDryRun.rowCountAfter}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Invariantes preservados</p>
                    <p className="mt-1 text-slate-300">
                      Identidade / data / valor / tipo / origem:{' '}
                      <strong className="text-emerald-300">
                        {shadowAuditCompetenceDryRun.identityMutationCount} / {shadowAuditCompetenceDryRun.dateMutationCount} / {shadowAuditCompetenceDryRun.amountMutationCount} / {shadowAuditCompetenceDryRun.typeMutationCount} / {shadowAuditCompetenceDryRun.sourceMutationCount}
                      </strong> alteração(ões).
                    </p>
                    <p className="mt-1 text-slate-400">
                      Faturas / pagamentos alterados: {shadowAuditCompetenceDryRun.statementRecordMutationCount} / {shadowAuditCompetenceDryRun.paymentRecordMutationCount}. Operações reais: <strong className="text-emerald-300">{shadowAuditCompetenceDryRun.actualWriteOperationCount}</strong>.
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Depois da simulação</p>
                    <p className="mt-1 text-slate-300">
                      Transações alteradas: {shadowAuditCompetenceDryRun.before.changedTransactionCount} → {shadowAuditCompetenceDryRun.after.changedTransactionCount} · diferenças estruturais: {shadowAuditCompetenceDryRun.before.structuralDifferenceCount} → {shadowAuditCompetenceDryRun.after.structuralDifferenceCount}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Linhas envolvendo metadados protegidos: {shadowAuditCompetenceDryRun.protectedMetadataTouchCount}.
                    </p>
                    <p className="mt-1">
                      Elegível para futura execução restrita:{' '}
                      <strong className={shadowAuditCompetenceDryRun.eligibleForFutureScopedExecution ? 'text-emerald-300' : 'text-amber-300'}>
                        {shadowAuditCompetenceDryRun.eligibleForFutureScopedExecution ? 'sim' : 'não'}
                      </strong>.
                    </p>
                  </div>
                </div>

                {shadowAuditCompetenceDryRun.changeProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Mudanças simuladas por competência</p>
                    <ul className="mt-1 space-y-1.5">
                      {shadowAuditCompetenceDryRun.changeProfiles.slice(0, 12).map((profile) => (
                        <li
                          key={`${profile.fromStatementKey}-${profile.toStatementKey}-${profile.evidenceSource}`}
                          className="flex flex-wrap justify-between gap-2 rounded border border-white/5 bg-black/10 px-2 py-1.5"
                        >
                          <span>
                            {profile.fromStatementKey} → {profile.toStatementKey} · {COMPETENCE_EVIDENCE_LABELS[profile.evidenceSource]}
                          </span>
                          <strong className="text-white">{profile.count}</strong>
                        </li>
                      ))}
                    </ul>
                    {shadowAuditCompetenceDryRun.changeProfiles.length > 12 && (
                      <p className="mt-1 text-slate-500">
                        Mais {shadowAuditCompetenceDryRun.changeProfiles.length - 12} grupo(s) permanecem no resumo agregado.
                      </p>
                    )}
                  </div>
                )}

                {shadowAuditCompetenceDryRun.exclusionProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-amber-400/25 bg-amber-500/5 p-2">
                    <p className="font-semibold text-amber-100">Exceções fora da simulação</p>
                    <ul className="mt-1 space-y-1 text-amber-100/90">
                      {shadowAuditCompetenceDryRun.exclusionProfiles.map((profile) => (
                        <li key={profile.code} className="flex justify-between gap-2">
                          <span>{COMPETENCE_DRY_RUN_EXCLUSION_LABELS[profile.code]}</span>
                          <strong>{profile.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {shadowAuditCompetenceDryRun.blockerProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-rose-400/25 bg-rose-500/5 p-2">
                    <p className="font-semibold text-rose-100">Bloqueios da simulação</p>
                    <ul className="mt-1 space-y-1 text-rose-100/90">
                      {shadowAuditCompetenceDryRun.blockerProfiles.map((profile) => (
                        <li key={profile.code} className="flex justify-between gap-2">
                          <span>{COMPETENCE_DRY_RUN_BLOCKER_LABELS[profile.code]}</span>
                          <strong>{profile.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {shadowAuditCompetenceDryRun.recommendationCodes.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                    {shadowAuditCompetenceDryRun.recommendationCodes.map((code) => (
                      <li key={code}>{COMPETENCE_DRY_RUN_RECOMMENDATION_LABELS[code]}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {engineOn && shadowAuditCompetenceExceptionForensics && (
              <div className="mt-3 rounded-lg border border-violet-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2J — dependências das exceções</p>
                  <span className="rounded-full border border-violet-300/30 bg-violet-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100">
                    auditoria agregada · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado:{' '}
                  <strong className="text-white">
                    {COMPETENCE_EXCEPTION_STATUS_LABELS[shadowAuditCompetenceExceptionForensics.status]}
                  </strong>.
                  {' '}A classificação determina somente a ordem dos pré-requisitos e não contém linhas, IDs, competências, arquivos ou payload executável.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Exceções recebidas</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditCompetenceExceptionForensics.totalExceptionCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Classificadas</p>
                    <p className="mt-1 text-base font-semibold text-emerald-300">
                      {shadowAuditCompetenceExceptionForensics.classifiedExceptionCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Sem classificação</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditCompetenceExceptionForensics.unclassifiedExceptionCount === 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {shadowAuditCompetenceExceptionForensics.unclassifiedExceptionCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Operações reais</p>
                    <p className="mt-1 text-base font-semibold text-emerald-300">
                      {shadowAuditCompetenceExceptionForensics.actualWriteOperationCount}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-sky-300/20 bg-sky-400/5 p-2">
                    <p className="font-semibold text-sky-100">Pré-requisito de identidade</p>
                    <p className="mt-1 text-slate-300">
                      {COMPETENCE_IDENTITY_PREREQUISITE_LABELS[shadowAuditCompetenceExceptionForensics.identityPrerequisite.status]} · {shadowAuditCompetenceExceptionForensics.identityPrerequisite.exceptionCount} exceção(ões).
                    </p>
                    <p className="mt-1 text-slate-400">
                      Identidades divergentes: {shadowAuditCompetenceExceptionForensics.identityPrerequisite.identityMismatchCount} · âncoras em grupos duplicados: {shadowAuditCompetenceExceptionForensics.identityPrerequisite.duplicateIdentityAnchorCount}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Simulação anterior: {shadowAuditCompetenceExceptionForensics.identityPrerequisite.hypotheticalIdentityChangeCount} troca(s), {shadowAuditCompetenceExceptionForensics.identityPrerequisite.confirmedAnchorCount} âncora(s), {shadowAuditCompetenceExceptionForensics.identityPrerequisite.unresolvedIdentityCount} não resolvida(s).
                    </p>
                  </div>
                  <div className="rounded border border-amber-300/20 bg-amber-400/5 p-2">
                    <p className="font-semibold text-amber-100">Pré-requisito das faturas</p>
                    <p className="mt-1 text-slate-300">
                      {COMPETENCE_STATEMENT_PREREQUISITE_LABELS[shadowAuditCompetenceExceptionForensics.statementPrerequisite.status]} · {shadowAuditCompetenceExceptionForensics.statementPrerequisite.affectedEntryCount} lançamento(s) afetado(s).
                    </p>
                    <p className="mt-1 text-slate-400">
                      Grupos duplicados: {shadowAuditCompetenceExceptionForensics.statementPrerequisite.duplicateGroupCount} · idênticos: {shadowAuditCompetenceExceptionForensics.statementPrerequisite.identicalGroupCount} · conflitantes: {shadowAuditCompetenceExceptionForensics.statementPrerequisite.conflictingGroupCount} · protegidos: {shadowAuditCompetenceExceptionForensics.statementPrerequisite.protectedGroupCount}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Outras revisões isoladas: {shadowAuditCompetenceExceptionForensics.otherReviewCount}.
                    </p>
                  </div>
                </div>

                {shadowAuditCompetenceExceptionForensics.laneProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Ordem forense dos pré-requisitos</p>
                    <ol className="mt-1 space-y-1.5">
                      {shadowAuditCompetenceExceptionForensics.laneProfiles.map((profile) => (
                        <li
                          key={profile.code}
                          className="flex flex-wrap justify-between gap-2 rounded border border-white/5 bg-black/10 px-2 py-1.5"
                        >
                          <span>{profile.order}. {COMPETENCE_EXCEPTION_LANE_LABELS[profile.code]}</span>
                          <strong className="text-white">{profile.count}</strong>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <div className="mt-2 rounded border border-violet-300/20 bg-violet-400/5 p-2">
                  <p>
                    Elegível para desenvolver uma futura simulação sequencial:{' '}
                    <strong className={shadowAuditCompetenceExceptionForensics.eligibleForFutureSequencedDryRun ? 'text-emerald-300' : 'text-amber-300'}>
                      {shadowAuditCompetenceExceptionForensics.eligibleForFutureSequencedDryRun ? 'sim' : 'não'}
                    </strong>.
                    {' '}Elegível para escrita: <strong className="text-rose-300">não</strong>.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                    {shadowAuditCompetenceExceptionForensics.recommendationCodes.map((code) => (
                      <li key={code}>{COMPETENCE_EXCEPTION_RECOMMENDATION_LABELS[code]}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {engineOn && shadowAuditAffectedEntryReconciliation && (
              <div className="mt-3 rounded-lg border border-cyan-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2L — reconciliação da contagem afetada</p>
                  <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                    somente contagens agregadas · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado:{' '}
                  <strong className="text-white">
                    {AFFECTED_ENTRY_RECONCILIATION_STATUS_LABELS[shadowAuditAffectedEntryReconciliation.status]}
                  </strong>.
                  {' '}Esta etapa separa o vínculo físico atual, o destino pretendido pela sombra e as exceções já classificadas pela auditoria de competência.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Vinculadas hoje</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditAffectedEntryReconciliation.currentAttachedEntryCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Destino projetado</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditAffectedEntryReconciliation.projectedTargetEntryCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Exceções de competência</p>
                    <p className="mt-1 text-base font-semibold text-cyan-200">
                      {shadowAuditAffectedEntryReconciliation.upstreamAffectedEntryCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Diferença sem explicação</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditAffectedEntryReconciliation.unexplainedCountDelta === 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {shadowAuditAffectedEntryReconciliation.unexplainedCountDelta}
                    </p>
                  </div>
                </div>

                <div className="mt-2 rounded border border-cyan-300/20 bg-cyan-400/5 p-2">
                  <p>
                    Contagem liberada para a análise forense da Sprint 2K:{' '}
                    <strong className={shadowAuditAffectedEntryReconciliation.eligibleForConflictForensics ? 'text-emerald-300' : 'text-rose-300'}>
                      {shadowAuditAffectedEntryReconciliation.eligibleForConflictForensics ? 'sim' : 'não'}
                    </strong>.
                    {' '}Elegível para escrita: <strong className="text-rose-300">não</strong>. Operações reais: <strong className="text-emerald-300">{shadowAuditAffectedEntryReconciliation.actualWriteOperationCount}</strong>.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                    {shadowAuditAffectedEntryReconciliation.recommendationCodes.map((code) => (
                      <li key={code}>{AFFECTED_ENTRY_RECONCILIATION_RECOMMENDATION_LABELS[code]}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {engineOn && shadowAuditStatementConflictForensics && (
              <div className="mt-3 rounded-lg border border-fuchsia-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2K — conflito das faturas duplicadas</p>
                  <span className="rounded-full border border-fuchsia-300/30 bg-fuchsia-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-100">
                    comparação em memória · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado:{' '}
                  <strong className="text-white">
                    {STATEMENT_CONFLICT_STATUS_LABELS[shadowAuditStatementConflictForensics.status]}
                  </strong>.
                  {' '}O relatório compara os registros campo a campo, mas mostra apenas contagens agregadas: nenhuma competência, identidade, origem ou valor financeiro é exposto.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Grupos / registros duplicados</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditStatementConflictForensics.duplicateGroupCount} / {shadowAuditStatementConflictForensics.duplicateRecordCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Exceções reconciliadas</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditStatementConflictForensics.affectedEntryCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Grupos conflitantes</p>
                    <p className="mt-1 text-base font-semibold text-amber-300">
                      {shadowAuditStatementConflictForensics.conflictingGroupCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Grupos não classificados</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditStatementConflictForensics.unclassifiedGroupCount === 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {shadowAuditStatementConflictForensics.unclassifiedGroupCount}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-amber-300/20 bg-amber-400/5 p-2">
                    <p className="font-semibold text-amber-100">Metadados que precisam ser conservados</p>
                    <p className="mt-1 text-slate-300">
                      Grupos protegidos: {shadowAuditStatementConflictForensics.protectedMetadata.protectedGroupCount} · payloads manuais: {shadowAuditStatementConflictForensics.protectedMetadata.manualPayloadRecordCount}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Com total oficial da fatura: {shadowAuditStatementConflictForensics.protectedMetadata.officialStatementTotalGroupCount} · com pagamento oficial: {shadowAuditStatementConflictForensics.protectedMetadata.officialPaymentTotalGroupCount}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Conservação inequívoca / ambígua: {shadowAuditStatementConflictForensics.protectedMetadata.unambiguousConservationGroupCount} / {shadowAuditStatementConflictForensics.protectedMetadata.ambiguousConservationGroupCount}.
                    </p>
                  </div>
                  <div className="rounded border border-sky-300/20 bg-sky-400/5 p-2">
                    <p className="font-semibold text-sky-100">Confronto com a reconstrução sombra</p>
                    {shadowAuditStatementConflictForensics.shadowMatchProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1 text-slate-300">
                        {shadowAuditStatementConflictForensics.shadowMatchProfiles.map((profile) => (
                          <li key={profile.code} className="flex justify-between gap-2">
                            <span>{STATEMENT_SHADOW_MATCH_LABELS[profile.code]}</span>
                            <strong className="text-white">{profile.groupCount}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhum grupo duplicado precisa ser confrontado.</p>
                    )}
                  </div>
                </div>

                {shadowAuditStatementConflictForensics.fieldProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Campos divergentes entre os registros</p>
                    <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                      {shadowAuditStatementConflictForensics.fieldProfiles.map((profile) => (
                        <li key={profile.code} className="flex justify-between gap-2 rounded border border-white/5 bg-black/10 px-2 py-1.5">
                          <span>{STATEMENT_CONFLICT_FIELD_LABELS[profile.code]}</span>
                          <strong className="text-white">{profile.conflictingGroupCount}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-2 rounded border border-fuchsia-300/20 bg-fuchsia-400/5 p-2">
                  <p>
                    Elegível para uma futura simulação de conservação:{' '}
                    <strong className={shadowAuditStatementConflictForensics.eligibleForFutureConservationDryRun ? 'text-emerald-300' : 'text-amber-300'}>
                      {shadowAuditStatementConflictForensics.eligibleForFutureConservationDryRun ? 'sim' : 'não'}
                    </strong>.
                    {' '}Elegível para escrita: <strong className="text-rose-300">não</strong>. Operações reais: <strong className="text-emerald-300">{shadowAuditStatementConflictForensics.actualWriteOperationCount}</strong>.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                    {shadowAuditStatementConflictForensics.recommendationCodes.map((code) => (
                      <li key={code}>{STATEMENT_CONFLICT_RECOMMENDATION_LABELS[code]}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {engineOn && shadowAuditStatementConservationDryRun && (
              <div className="mt-3 rounded-lg border border-emerald-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2M — simulação de conservação dos metadados</p>
                  <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
                    clone em memória · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado:{' '}
                  <strong className="text-white">
                    {STATEMENT_CONSERVATION_STATUS_LABELS[shadowAuditStatementConservationDryRun.status]}
                  </strong>.
                  {' '}A simulação combina campos derivados da sombra com a presença dos metadados protegidos do grupo completo, sem produzir uma alteração executável.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Grupos simulados / em revisão</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditStatementConservationDryRun.simulatedGroupCount} / {shadowAuditStatementConservationDryRun.reviewGroupCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Registros antes → depois</p>
                    <p className="mt-1 text-base font-semibold text-emerald-300">
                      {shadowAuditStatementConservationDryRun.duplicateRecordCountBefore} → {shadowAuditStatementConservationDryRun.duplicateRecordCountAfter}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Payloads manuais antes → depois</p>
                    <p className="mt-1 text-base font-semibold text-emerald-300">
                      {shadowAuditStatementConservationDryRun.manualPayloadRecordCountBefore} → {shadowAuditStatementConservationDryRun.manualPayloadRecordCountAfter}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Divergências derivadas antes → clone</p>
                    <p className="mt-1 text-base font-semibold text-cyan-200">
                      {shadowAuditStatementConservationDryRun.simulatedDerivedMismatchCountBefore} → {shadowAuditStatementConservationDryRun.simulatedDerivedMismatchCountAfter}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-emerald-300/20 bg-emerald-400/5 p-2">
                    <p className="font-semibold text-emerald-100">Invariantes de conservação</p>
                    <p className="mt-1 text-slate-300">
                      Registros com metadados protegidos: {shadowAuditStatementConservationDryRun.protectedMetadataRecordCountBefore} → {shadowAuditStatementConservationDryRun.protectedMetadataRecordCountAfter}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Valores oficiais contabilizados: {shadowAuditStatementConservationDryRun.officialMetadataValueCountBefore} → {shadowAuditStatementConservationDryRun.officialMetadataValueCountAfter} · perdas detectadas: {shadowAuditStatementConservationDryRun.protectedMetadataLossCount}.
                    </p>
                  </div>
                  <div className="rounded border border-sky-300/20 bg-sky-400/5 p-2">
                    <p className="font-semibold text-sky-100">Limites deliberados da simulação</p>
                    <p className="mt-1 text-slate-300">
                      Linhas selecionadas: {shadowAuditStatementConservationDryRun.selectedRecordCount} · exclusões: {shadowAuditStatementConservationDryRun.recordDeletionCount} · mesclas: {shadowAuditStatementConservationDryRun.recordMergeCount}.
                    </p>
                    <p className="mt-1 font-semibold text-white">
                      Nenhuma linha foi escolhida, removida ou mesclada.
                    </p>
                  </div>
                </div>

                {shadowAuditStatementConservationDryRun.blockerProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-amber-300/20 bg-amber-400/5 p-2">
                    <p className="font-semibold text-amber-100">Evidências que impedem uma simulação completa</p>
                    <ul className="mt-1 space-y-1 text-slate-300">
                      {shadowAuditStatementConservationDryRun.blockerProfiles.map((profile) => (
                        <li key={profile.code} className="flex justify-between gap-2">
                          <span>{STATEMENT_CONSERVATION_BLOCKER_LABELS[profile.code]}</span>
                          <strong className="text-white">{profile.groupCount}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-2 rounded border border-emerald-300/20 bg-emerald-400/5 p-2">
                  <p>
                    Elegível para desenhar um futuro plano reversível:{' '}
                    <strong className={shadowAuditStatementConservationDryRun.eligibleForFutureConservationPlan ? 'text-emerald-300' : 'text-amber-300'}>
                      {shadowAuditStatementConservationDryRun.eligibleForFutureConservationPlan ? 'sim' : 'não'}
                    </strong>.
                    {' '}Elegível para escrita:{' '}
                    <strong className={shadowAuditStatementConservationDryRun.eligibleForWrite ? 'text-emerald-300' : 'text-rose-300'}>
                      {shadowAuditStatementConservationDryRun.eligibleForWrite ? 'sim' : 'não'}
                    </strong>. Operações reais: <strong className="text-emerald-300">{shadowAuditStatementConservationDryRun.actualWriteOperationCount}</strong>.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                    {shadowAuditStatementConservationDryRun.recommendationCodes.map((code) => (
                      <li key={code}>{STATEMENT_CONSERVATION_RECOMMENDATION_LABELS[code]}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {engineOn && shadowAuditStatementConservationPlan && (
              <div className="mt-3 rounded-lg border border-violet-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2N — plano reversível de conservação</p>
                  <span className="rounded-full border border-violet-300/30 bg-violet-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100">
                    desenho agregado · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado:{' '}
                  <strong className="text-white">
                    {STATEMENT_CONSERVATION_PLAN_STATUS_LABELS[shadowAuditStatementConservationPlan.status]}
                  </strong>.
                  {' '}O plano substitui cada grupo duplicado por uma futura fatura composta nova, sem escolher uma linha antiga como vencedora e sem gerar payload executável.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Grupos localizados / duplicados</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditStatementConservationPlan.locatedGroupCount} / {shadowAuditStatementConservationPlan.duplicateGroupCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Faturas afetadas → compostas</p>
                    <p className="mt-1 text-base font-semibold text-violet-200">
                      {shadowAuditStatementConservationPlan.sourceStatementRecordCount} → {shadowAuditStatementConservationPlan.plannedCompositeStatementCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Vínculos de itens / pagamentos</p>
                    <p className="mt-1 text-base font-semibold text-cyan-200">
                      {shadowAuditStatementConservationPlan.affectedEntryLinkCount} / {shadowAuditStatementConservationPlan.affectedPaymentLinkCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Travas desenhadas / executáveis</p>
                    <p className="mt-1 text-base font-semibold text-emerald-300">
                      {shadowAuditStatementConservationPlan.designedGuardCount} / {shadowAuditStatementConservationPlan.executableGuardCount}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-violet-300/20 bg-violet-400/5 p-2">
                    <p className="font-semibold text-violet-100">Escopo obrigatório do snapshot futuro</p>
                    <p className="mt-1 text-slate-300">
                      Faturas: {shadowAuditStatementConservationPlan.snapshotStatementRecordCount} · vínculos de itens: {shadowAuditStatementConservationPlan.snapshotEntryLinkCount} · vínculos de pagamentos: {shadowAuditStatementConservationPlan.snapshotPaymentLinkCount}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Grupos com metadados protegidos: {shadowAuditStatementConservationPlan.protectedMetadataGroupCount} · perdas projetadas: {shadowAuditStatementConservationPlan.protectedMetadataLossCount}.
                    </p>
                  </div>
                  <div className="rounded border border-sky-300/20 bg-sky-400/5 p-2">
                    <p className="font-semibold text-sky-100">Contrato do rollback futuro</p>
                    <p className="mt-1 text-slate-300">
                      Remover compostas: {shadowAuditStatementConservationPlan.rollbackRemoveCompositeCount} · restaurar faturas: {shadowAuditStatementConservationPlan.rollbackRestoreStatementRecordCount} · restaurar vínculos: {shadowAuditStatementConservationPlan.rollbackRestoreEntryLinkCount + shadowAuditStatementConservationPlan.rollbackRestorePaymentLinkCount}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Cardinalidade reversível: {shadowAuditStatementConservationPlan.rollbackCardinalityBalanced ? 'sim' : 'não'} · revisão vinculada: {shadowAuditStatementConservationPlan.revisionGuardBound ? 'sim' : 'não'}.
                    </p>
                  </div>
                </div>

                <div className="mt-2 rounded border border-emerald-300/20 bg-emerald-400/5 p-2">
                  <p className="font-semibold text-emerald-100">Invariantes que permanecem intocadas</p>
                  <p className="mt-1 text-slate-300">
                    Alterações planejadas em valores financeiros: {shadowAuditStatementConservationPlan.plannedFinancialValueChangeCount} · alterações em transações do usuário: {shadowAuditStatementConservationPlan.plannedTransactionRecordChangeCount} · operações reais nesta Sprint: {shadowAuditStatementConservationPlan.actualWriteOperationCount}.
                  </p>
                </div>

                {shadowAuditStatementConservationPlan.blockerProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-amber-300/20 bg-amber-400/5 p-2">
                    <p className="font-semibold text-amber-100">Evidências que suspendem o plano</p>
                    <ul className="mt-1 space-y-1 text-slate-300">
                      {shadowAuditStatementConservationPlan.blockerProfiles.map((profile) => (
                        <li key={profile.code} className="flex justify-between gap-2">
                          <span>{STATEMENT_CONSERVATION_PLAN_BLOCKER_LABELS[profile.code]}</span>
                          <strong className="text-white">{profile.groupCount}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-2 rounded border border-violet-300/20 bg-violet-400/5 p-2">
                  <p>
                    Elegível para futura implementação transacional:{' '}
                    <strong className={shadowAuditStatementConservationPlan.eligibleForFutureTransactionalImplementation ? 'text-emerald-300' : 'text-amber-300'}>
                      {shadowAuditStatementConservationPlan.eligibleForFutureTransactionalImplementation ? 'sim' : 'não'}
                    </strong>.
                    {' '}Elegível para escrita agora:{' '}
                    <strong className="text-rose-300">não</strong>.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                    {shadowAuditStatementConservationPlan.recommendationCodes.map((code) => (
                      <li key={code}>{STATEMENT_CONSERVATION_PLAN_RECOMMENDATION_LABELS[code]}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {engineOn && shadowAuditStatementConservationExecution && (
              <div className="mt-3 rounded-lg border border-cyan-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2O — contrato transacional de conservação</p>
                  <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                    prévia agregada · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado:{' '}
                  <strong className="text-white">
                    {STATEMENT_CONSERVATION_EXECUTION_STATUS_LABELS[shadowAuditStatementConservationExecution.status]}
                  </strong>.
                  {' '}Este painel não contém identidades, não chama o executor e não altera dados. A operação de banco exige flag dedicada, revisão e checksum válidos, snapshot integral e uma única competência por transação.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Grupos preparados / duplicados</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditStatementConservationExecution.preparedGroupCount} / {shadowAuditStatementConservationExecution.duplicateGroupCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Faturas físicas de origem</p>
                    <p className="mt-1 text-base font-semibold text-cyan-200">
                      {shadowAuditStatementConservationExecution.sourceStatementCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Vínculos de itens / pagamentos</p>
                    <p className="mt-1 text-base font-semibold text-violet-200">
                      {shadowAuditStatementConservationExecution.expectedEntryLinkCount} / {shadowAuditStatementConservationExecution.expectedPaymentLinkCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Travas de banco preparadas</p>
                    <p className="mt-1 text-base font-semibold text-emerald-300">
                      {shadowAuditStatementConservationExecution.preparedDatabaseGuardCount} / {shadowAuditStatementConservationExecution.requiredDatabaseGuardCount}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-cyan-300/20 bg-cyan-400/5 p-2">
                    <p className="font-semibold text-cyan-100">Conservação e isolamento</p>
                    <p className="mt-1 text-slate-300">
                      Metadados protegidos localizados: {shadowAuditStatementConservationExecution.protectedMetadataSourceCount} · revisão vinculada: {shadowAuditStatementConservationExecution.revisionBound ? 'sim' : 'não'} · checksum vinculado: {shadowAuditStatementConservationExecution.checksumBound ? 'sim' : 'não'}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Cada usuário e cartão são novamente validados dentro da transação protegida por lock.
                    </p>
                  </div>
                  <div className="rounded border border-sky-300/20 bg-sky-400/5 p-2">
                    <p className="font-semibold text-sky-100">Snapshot e rollback</p>
                    <p className="mt-1 text-slate-300">
                      Vínculos legados incluídos no snapshot: {shadowAuditStatementConservationExecution.snapshotIncludesLegacyItemLinks ? 'sim' : 'não'} · rollback condicionado à revisão posterior: {shadowAuditStatementConservationExecution.rollbackRequiresAfterRevision ? 'sim' : 'não'}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      A recuperação permanece disponível mesmo com a flag de aplicação desligada.
                    </p>
                  </div>
                </div>

                {shadowAuditStatementConservationExecution.blockerCodes.length > 0 && (
                  <div className="mt-2 rounded border border-amber-300/20 bg-amber-400/5 p-2">
                    <p className="font-semibold text-amber-100">Travas que impedem a homologação transacional</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-300">
                      {shadowAuditStatementConservationExecution.blockerCodes.map((code) => (
                        <li key={code}>{STATEMENT_CONSERVATION_EXECUTION_BLOCKER_LABELS[code]}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-2 rounded border border-emerald-300/20 bg-emerald-400/5 p-2">
                  <p>
                    Apta para validar a migration no staging:{' '}
                    <strong className={shadowAuditStatementConservationExecution.eligibleForStagingMigrationValidation ? 'text-emerald-300' : 'text-amber-300'}>
                      {shadowAuditStatementConservationExecution.eligibleForStagingMigrationValidation ? 'sim' : 'não'}
                    </strong>.
                    {' '}Elegível para escrita por este painel: <strong className="text-rose-300">não</strong> · operações reais: <strong className="text-emerald-300">{shadowAuditStatementConservationExecution.actualWriteOperationCount}</strong>.
                  </p>
                </div>
              </div>
            )}
            {engineOn && shadowAuditSequentialDryRun && (
              <div className="mt-3 rounded-lg border border-fuchsia-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2Q — simulação sequencial de identidade e competência</p>
                  <span className="rounded-full border border-fuchsia-300/30 bg-fuchsia-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-100">
                    dois clones em memória · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado:{' '}
                  <strong className="text-white">
                    {SEQUENTIAL_DRY_RUN_STATUS_LABELS[shadowAuditSequentialDryRun.status]}
                  </strong>.
                  {' '}A sequência aplica primeiro a reconstrução comprovada de identidade e só então recalcula a competência, sem expor IDs, hashes, arquivos ou payload de banco.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Identidades ausentes</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditSequentialDryRun.before.missingIdentityCount} → {shadowAuditSequentialDryRun.afterSequential.missingIdentityCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Grupos duplicados</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditSequentialDryRun.before.duplicateIdentityGroupCount} → {shadowAuditSequentialDryRun.afterSequential.duplicateIdentityGroupCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Diferenças estruturais</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditSequentialDryRun.before.structuralDifferenceCount} → {shadowAuditSequentialDryRun.afterSequential.structuralDifferenceCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Linhas antes / depois</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditSequentialDryRun.rowCountDelta === 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {shadowAuditSequentialDryRun.rowCountBefore} / {shadowAuditSequentialDryRun.rowCountAfter}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-fuchsia-300/20 bg-fuchsia-400/5 p-2">
                    <p className="font-semibold text-fuchsia-100">Sequência simulada</p>
                    <p className="mt-1 text-slate-300">
                      Identidade: {IDENTITY_DRY_RUN_STATUS_LABELS[shadowAuditSequentialDryRun.identityStepStatus]} · {shadowAuditSequentialDryRun.hypotheticalIdentityUpdateCount} linha(s) · {shadowAuditSequentialDryRun.confirmedAnchorCount} âncora(s).
                    </p>
                    <p className="mt-1 text-slate-300">
                      Competência: {COMPETENCE_DRY_RUN_STATUS_LABELS[shadowAuditSequentialDryRun.competenceStepStatus]} · {shadowAuditSequentialDryRun.hypotheticalCompetenceUpdateCount} linha(s).
                    </p>
                  </div>
                  <div className="rounded border border-emerald-300/20 bg-emerald-400/5 p-2">
                    <p className="font-semibold text-emerald-100">Invariantes verificadas</p>
                    <p className="mt-1 text-slate-300">
                      Data / valor / origem: {shadowAuditSequentialDryRun.dateMutationCount} / {shadowAuditSequentialDryRun.amountMutationCount} / {shadowAuditSequentialDryRun.sourceMutationCount} alteração(ões) indevida(s).
                    </p>
                    <p className="mt-1 text-slate-400">
                      Faturas preservadas: {shadowAuditSequentialDryRun.statementRecordsPreserved ? 'sim' : 'não'} · pagamentos preservados: {shadowAuditSequentialDryRun.paymentRecordsPreserved ? 'sim' : 'não'}.
                    </p>
                  </div>
                </div>

                <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                  <p className="font-semibold text-white">Resultado combinado</p>
                  <p className="mt-1 text-slate-300">
                    Linhas com identidade reconstruída: {shadowAuditSequentialDryRun.identityMutationCount} · competência reposicionada: {shadowAuditSequentialDryRun.competenceMutationCount} · tipo revisado no clone: {shadowAuditSequentialDryRun.typeMutationCount}.
                  </p>
                  <p className="mt-1 text-slate-400">
                    Transações ainda alteradas: {shadowAuditSequentialDryRun.afterSequential.changedTransactionCount} · faturas: {shadowAuditSequentialDryRun.afterSequential.changedStatementCount} · pagamentos: {shadowAuditSequentialDryRun.afterSequential.changedPaymentCount} · diferenças residuais: {shadowAuditSequentialDryRun.residualDifferenceCount}.
                  </p>
                  <p className="mt-1">
                    Elegível para escrita: <strong className="text-rose-300">não</strong> · operações reais: <strong className="text-emerald-300">{shadowAuditSequentialDryRun.actualWriteOperationCount}</strong>.
                  </p>
                </div>

                {shadowAuditSequentialDryRun.blockerProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-rose-300/20 bg-rose-400/5 p-2">
                    <p className="font-semibold text-rose-100">Bloqueios da sequência</p>
                    <ul className="mt-1 space-y-1 text-slate-300">
                      {shadowAuditSequentialDryRun.blockerProfiles.map((profile) => (
                        <li key={profile.code} className="flex justify-between gap-2">
                          <span>{SEQUENTIAL_DRY_RUN_BLOCKER_LABELS[profile.code]}</span>
                          <strong className="text-white">{profile.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                  {shadowAuditSequentialDryRun.recommendationCodes.map((code) => (
                    <li key={code}>{SEQUENTIAL_DRY_RUN_RECOMMENDATION_LABELS[code]}</li>
                  ))}
                </ul>
              </div>
            )}
            {engineOn && shadowAuditResidualStatementDryRun && (
              <div className="mt-3 rounded-lg border border-cyan-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Sprint 2R — separação entre pagamento do arquivo e quitação aplicada</p>
                  <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                    faturas clonadas · zero escritas
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Resultado:{' '}
                  <strong className="text-white">
                    {RESIDUAL_STATEMENT_DRY_RUN_STATUS_LABELS[shadowAuditResidualStatementDryRun.status]}
                  </strong>.
                  {' '}A prévia conserva os totais informados no CSV como evidência e testa separadamente a quitação derivada dos vínculos de pagamento, sem alterar lançamentos, pagamentos ou faturas reais.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Faturas divergentes</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditResidualStatementDryRun.changedStatementCountBefore} → {shadowAuditResidualStatementDryRun.changedStatementCountAfter}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Diferenças estruturais</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditResidualStatementDryRun.structuralDifferenceCountBefore} → {shadowAuditResidualStatementDryRun.structuralDifferenceCountAfter}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Vínculos de pagamento divergentes</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditResidualStatementDryRun.changedPaymentCountBefore} → {shadowAuditResidualStatementDryRun.changedPaymentCountAfter}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Faturas físicas antes / depois</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditResidualStatementDryRun.statementCountBefore === shadowAuditResidualStatementDryRun.statementCountAfter ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {shadowAuditResidualStatementDryRun.statementCountBefore} / {shadowAuditResidualStatementDryRun.statementCountAfter}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-cyan-300/20 bg-cyan-400/5 p-2">
                    <p className="font-semibold text-cyan-100">Evidência da causa residual</p>
                    <p className="mt-1 text-slate-300">
                      Pagamento do próprio arquivo materializado na mesma competência: <strong className="text-white">{shadowAuditResidualStatementDryRun.sameCycleFilePaymentMaterializationCount}</strong> fatura(s).
                    </p>
                    <p className="mt-1 text-slate-300">
                      Cadeia física de quitação compatível com a sombra: <strong className="text-white">{shadowAuditResidualStatementDryRun.settlementChainSupportedCount}</strong> fatura(s).
                    </p>
                    <p className="mt-1 text-slate-400">
                      Evidências de pagamento protegido no arquivo: {shadowAuditResidualStatementDryRun.protectedFilePaymentEvidenceCount} · anteriores à janela: {shadowAuditResidualStatementDryRun.outsideWindowPaymentWarningCount}.
                    </p>
                  </div>
                  <div className="rounded border border-emerald-300/20 bg-emerald-400/5 p-2">
                    <p className="font-semibold text-emerald-100">Invariantes verificadas</p>
                    <p className="mt-1 text-slate-300">
                      Lançamentos preservados: {shadowAuditResidualStatementDryRun.entryRecordsPreserved ? 'sim' : 'não'} · pagamentos preservados: {shadowAuditResidualStatementDryRun.paymentRecordsPreserved ? 'sim' : 'não'}.
                    </p>
                    <p className="mt-1 text-slate-300">
                      Metadados protegidos preservados: {shadowAuditResidualStatementDryRun.protectedMetadataPreserved ? 'sim' : 'não'} · faturas protegidas: {shadowAuditResidualStatementDryRun.protectedStatementCount}.
                    </p>
                    <p className="mt-1 text-slate-400">
                      Diferenças apenas informativas após o clone: {shadowAuditResidualStatementDryRun.informationalDifferenceCountAfter}.
                    </p>
                  </div>
                </div>

                <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                  <p className="font-semibold text-white">Campos derivados testados no clone</p>
                  {shadowAuditResidualStatementDryRun.fieldProfiles.length > 0 ? (
                    <ul className="mt-1 space-y-1 text-slate-300">
                      {shadowAuditResidualStatementDryRun.fieldProfiles.map((profile) => (
                        <li key={profile.field} className="flex justify-between gap-2">
                          <span>{RESIDUAL_STATEMENT_FIELD_LABELS[profile.field]}</span>
                          <strong className="text-white">{profile.count}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-400">Nenhum campo derivado precisa ser recalculado.</p>
                  )}
                  <p className="mt-2 text-slate-400">
                    Faturas candidatas: {shadowAuditResidualStatementDryRun.candidateStatementCount} · campos hipotéticos: {shadowAuditResidualStatementDryRun.hypotheticalStatementFieldUpdateCount}.
                  </p>
                  <p className="mt-1">
                    Elegível para escrita: <strong className="text-rose-300">não</strong> · operações reais: <strong className="text-emerald-300">{shadowAuditResidualStatementDryRun.actualWriteOperationCount}</strong>.
                  </p>
                </div>

                {shadowAuditResidualStatementDryRun.blockerProfiles.length > 0 && (
                  <div className="mt-2 rounded border border-rose-300/20 bg-rose-400/5 p-2">
                    <p className="font-semibold text-rose-100">Bloqueios da separação residual</p>
                    <ul className="mt-1 space-y-1 text-slate-300">
                      {shadowAuditResidualStatementDryRun.blockerProfiles.map((profile) => (
                        <li key={profile.code} className="flex justify-between gap-2">
                          <span>{RESIDUAL_STATEMENT_DRY_RUN_BLOCKER_LABELS[profile.code]}</span>
                          <strong className="text-white">{profile.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                  {shadowAuditResidualStatementDryRun.recommendationCodes.map((code) => (
                    <li key={code}>{RESIDUAL_STATEMENT_DRY_RUN_RECOMMENDATION_LABELS[code]}</li>
                  ))}
                </ul>
              </div>
            )}
            {shadowAuditDiagnosticLines.length > 0 && (
              <details className="mt-3 rounded-lg border border-white/15 bg-slate-950/35 px-3 py-2">
                <summary className="cursor-pointer select-none font-semibold text-white">
                  Ver diagnóstico detalhado ({shadowAuditDiagnosticLines.length} linhas)
                </summary>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-relaxed">
                  {shadowAuditDiagnosticLines.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-3 space-y-2">
            <Input
              label="Dia de vencimento da fatura"
              type="text"
              inputMode="numeric"
              placeholder="ex.: 15"
              autoComplete="off"
              value={invoiceDueDayStr}
              onChange={(e) => handleInvoiceDueDayChange(e.target.value)}
              title="Dia do mês em que a fatura vence (1 a 31)"
              helpText={
                showAccountColumn
                  ? 'Opcional se cada cartão já tiver «dia de vencimento» cadastrado nas configurações da conta; nesse caso deixe em branco para usar o valor da conta.'
                  : 'Se estiver em branco, usa-se o dia cadastrado neste cartão (configurações da conta), quando existir.'
              }
              className="text-sm"
            />
          </div>
        )}

        {rows.length > 0 && (
          <div className="rounded-xl border border-slate-700 overflow-hidden">
            <div className="max-h-[min(52vh,520px)] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-800/95 border-b border-slate-700">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400">
                    <th className="px-3 py-2 font-semibold">Arquivo / origem</th>
                    {showAccountColumn && <th className="px-3 py-2 font-semibold">Cartão</th>}
                    <th className="px-3 py-2 font-semibold text-center">Lanç.</th>
                    <th className="px-3 py-2 font-semibold">Competência (MM/AAAA)</th>
                    <th className="px-3 py-2 font-semibold">Vencimento</th>
                    <th className="px-3 py-2 font-semibold text-right">Total fatura</th>
                    <th className="px-3 py-2 font-semibold text-right">Pagamentos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rowsSortedByVencimento.map((r) => (
                    <tr key={r.key} className="bg-slate-900/40 hover:bg-slate-900/70">
                      <td className="px-3 py-2 align-top text-gray-200 max-w-[200px] break-all">{r.displayOrigin}</td>
                      {showAccountColumn && (
                        <td className="px-3 py-2 align-top text-gray-300 whitespace-nowrap">{r.accountName}</td>
                      )}
                      <td className="px-3 py-2 align-top text-center text-gray-400">{r.txCount}</td>
                      <td className="px-3 py-2 align-top min-w-[118px]">
                        <Input
                          label=""
                          type="text"
                          inputMode="numeric"
                          placeholder="MM/AAAA"
                          autoComplete="off"
                          value={r.competenciaBR}
                          onChange={(e) => handleCompetenciaChange(r.key, e.target.value)}
                          className="text-xs py-1"
                          title="Mês de competência — MM/AAAA"
                        />
                      </td>
                      <td className="px-3 py-2 align-top min-w-[118px]">
                        <span
                          className="inline-block font-mono text-[11px] text-gray-300 pt-1.5 min-h-[32px]"
                          title="DD/MM/AAAA — vencimento confirmado no histórico"
                        >
                          {r.vencimentoBR.trim() || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top text-right text-rose-300 font-mono text-[11px] whitespace-nowrap">
                        {previewByRowKey.get(r.key)
                          ? formatCurrency(previewByRowKey.get(r.key)!.totals.statementTotal)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 align-top text-right text-emerald-300 font-mono text-[11px] whitespace-nowrap">
                        {previewByRowKey.get(r.key)
                          ? formatCurrency(previewByRowKey.get(r.key)!.totals.totalPayments)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-[11px] text-gray-500 leading-snug">
          A prévia usa as linhas já importadas (aba Transações). Por arquivo, a coluna Pagamentos mostra o valor do CSV; no histórico por competência, esse valor abate a fatura do mês anterior.
        </p>
        <p className="text-[11px] text-amber-300/80 leading-snug">
          <strong>Auditar sem alterar dados</strong> apenas lê e compara importações e lançamentos manuais. <strong>Reconstruir faturas deste cartão</strong> altera a projeção e permanece bloqueado até a auditoria declarar a troca segura.
        </p>
      </div>
    </Modal>
  );
};

export default CreditCardInvoiceCyclesModal;
