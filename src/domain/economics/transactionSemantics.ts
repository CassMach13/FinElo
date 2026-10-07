import type { Account, Category, EconomicEvent, EconomicEventKind, Transaction } from '../../types';
import { isDemoTransaction } from '../onboarding/firstSteps';
import { FUNDING_ACCOUNT_OBS_PREFIX } from '../../services/creditCardDirectedPayment';
import { isCommitmentTransaction } from '../../utils/transactionPeriodFilters';

/**
 * Semântica estrutural de uma transação + políticas de visão NOMEADAS.
 *
 * FASE 2 (refatoração com equivalência total):
 * - centraliza UMA classificação estrutural (`classifyTransaction`) e as políticas que cada consumidor usa hoje;
 * - PRESERVA as diferenças atuais entre consumidores (por isso há várias políticas `*_legacy`, e não um único
 *   "é neutro?"): ex.: o Dashboard ainda inclui demo e as pernas do Pagar; Próximos lançamentos e Recorrências já
 *   excluem o marcador do Pagar; Orçamento só olha Despesa real;
 * - NÃO neutraliza eventos econômicos: `hasEconomicEvent` é só um fato e NENHUMA política o lê;
 * - a Fase 3 mudará as políticas de forma explícita (a matriz de testes mostra exatamente quais células mudam).
 *
 * FASE 3A: as políticas `*_legacy` abaixo ficam congeladas (referência/caracterização). As políticas ATIVAS
 * (`ACTIVE_TRANSACTION_VIEW_POLICIES`) acrescentam, e só isso: demo fora da visão econômica e eventos econômicos
 * NEUTROS fora. Neutralidade exige o `kind` do evento CARREGADO (`economicKindByEventId`); ter `economic_event_id`
 * sem o evento no mapa NÃO neutraliza (falso negativo é preferível a esconder renda/gasto).
 *
 * Puro: sem Supabase, store, React, relógio ou efeitos colaterais. Datas e dono NÃO fazem parte da classificação:
 * cada consumidor mantém a sua data efetiva (Data_Pagamento || Data, ou só Data nas Recorrências) e a sua
 * resolução de dono.
 *
 * Gancho para a Fase 3: um fato como `economicKind`/`isEconomicallyNeutral` entra em `TransactionSemantics`
 * (alimentado por um contexto opcional novo) e nas políticas, sem reescrever os consumidores.
 */

/** Conjuntos de categorias que a Dashboard e as análises tratam à parte (nomes de categoria). */
export interface CategorySets {
  ambos: Set<string>;
  investment: Set<string>;
}

export function buildCategorySets(categories: Category[]): CategorySets {
  return {
    ambos: new Set(categories.filter((c) => c.Tipo === 'Ambos').map((c) => c.Nome_Categoria)),
    investment: new Set(categories.filter((c) => c.is_investment).map((c) => c.Nome_Categoria)),
  };
}

/**
 * `investment` tem prioridade sobre `ambos` (uma categoria pode ser as duas coisas: o resumo de investimentos a
 * reconhece pelo conjunto de investimento). Fora de ambos os conjuntos a categoria é `operational`.
 */
export type CategoryKind = 'operational' | 'ambos' | 'investment';

export interface TransactionSemanticsContext {
  categorySets?: CategorySets;
  /** Só `Tipo_Conta` é lido. Sem a conta, a transação não é considerada de cartão. */
  accountById?: ReadonlyMap<string, Pick<Account, 'Tipo_Conta'>>;
  /** Eventos CARREGADOS (id → kind). Ausente, ou sem o id da transação → kind desconhecido → comportamento legado. */
  economicKindByEventId?: ReadonlyMap<string, EconomicEventKind>;
}

export interface TransactionSemantics {
  /** `Tipo` é Renda ou Despesa. */
  validType: boolean;
  /** `Valor` finito e diferente de zero. */
  validAmount: boolean;
  isIncome: boolean;
  isExpense: boolean;
  /** Linha da demonstração antiga (`Origem='demo.csv'` ou `Fonte='Demo'`). */
  isDemo: boolean;
  categoryKind: CategoryKind;
  /** Marcador `finelo_funding_account:` gravado pelo "Pagar" (em Observacoes ou Descricao_Original). */
  hasFundingMarker: boolean;
  isCardAccount: boolean;
  /** Renda numa conta de cartão de crédito. */
  isCardIncome: boolean;
  /** Parcela, financiamento ou recorrência explícita no lançamento. */
  isCommitment: boolean;
  /** Metadata da identidade econômica (Fase 1). FATO apenas: nenhuma política da Fase 2 o usa. */
  hasEconomicEvent: boolean;
  /** Kind do evento CARREGADO; `null` sem evento ou com evento ausente do mapa. */
  economicKind: EconomicEventKind | null;
  /** Neutralidade exige kind conhecido (credit_card_payment ou own_account_transfer). Nunca decidida só pelo id. */
  isEconomicallyNeutral: boolean;
}

/** Detecção ÚNICA do marcador do Pagar (por texto estrutural gravado pelo fluxo; nunca valor/data). */
export const hasFundingAccountMarker = (t: Pick<Transaction, 'Observacoes' | 'Descricao_Original'>): boolean =>
  [t.Observacoes, t.Descricao_Original].some((raw) => String(raw ?? '').includes(FUNDING_ACCOUNT_OBS_PREFIX));

/** Kinds que a V1 trata como economicamente neutros. Um kind futuro (ex.: refund) precisa entrar aqui de forma explícita. */
const NEUTRAL_KINDS: ReadonlySet<EconomicEventKind> = new Set<EconomicEventKind>(['credit_card_payment', 'own_account_transfer']);

/** id → kind, só dos kinds conhecidos. Não carrega `source` (as políticas não o usam). */
export function buildEconomicKindByEventId(
  events: ReadonlyArray<Pick<EconomicEvent, 'id' | 'kind'>>
): ReadonlyMap<string, EconomicEventKind> {
  const map = new Map<string, EconomicEventKind>();
  for (const e of events) if (NEUTRAL_KINDS.has(e.kind)) map.set(e.id, e.kind);
  return map;
}

const EMPTY_SETS: CategorySets = { ambos: new Set(), investment: new Set() };

export function classifyCategory(categoria: string, sets: CategorySets): CategoryKind {
  if (sets.investment.has(categoria)) return 'investment';
  if (sets.ambos.has(categoria)) return 'ambos';
  return 'operational';
}

export function classifyTransaction(tx: Transaction, context: TransactionSemanticsContext = {}): TransactionSemantics {
  const sets = context.categorySets ?? EMPTY_SETS;
  const account = tx.ID_Conta ? context.accountById?.get(tx.ID_Conta) : undefined;
  const isCardAccount = account?.Tipo_Conta === 'Cartão de Crédito';
  const economicKind = tx.economic_event_id ? (context.economicKindByEventId?.get(tx.economic_event_id) ?? null) : null;
  return {
    validType: tx.Tipo === 'Renda' || tx.Tipo === 'Despesa',
    validAmount: Number.isFinite(tx.Valor) && tx.Valor !== 0,
    isIncome: tx.Tipo === 'Renda',
    isExpense: tx.Tipo === 'Despesa',
    isDemo: isDemoTransaction(tx),
    categoryKind: classifyCategory(tx.Categoria, sets),
    hasFundingMarker: hasFundingAccountMarker(tx),
    isCardAccount,
    isCardIncome: isCardAccount && tx.Tipo === 'Renda',
    isCommitment: isCommitmentTransaction(tx),
    hasEconomicEvent: Boolean(tx.economic_event_id),
    economicKind,
    isEconomicallyNeutral: economicKind !== null && NEUTRAL_KINDS.has(economicKind),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Políticas LEGADAS: reproduzem, uma a uma, o que cada consumidor já fazia antes da centralização.
// ---------------------------------------------------------------------------------------------------------

/** Dashboard (KPIs, gráficos, 50-30-20): só tira Ambos e investimento. Demo e Pagar continuam participando. */
export const isDashboardOperationalTransaction = (s: TransactionSemantics): boolean => s.categoryKind === 'operational';

/** Resumo de investimentos da Dashboard. */
export const isInvestmentTransaction = (s: TransactionSemantics): boolean => s.categoryKind === 'investment';

/** Evolução mensal/anual: Renda/Despesa com valor, sem demo, Ambos ou investimento. O Pagar ainda participa. */
export const isAnalysisOperationalTransaction = (s: TransactionSemantics): boolean =>
  s.validType && s.validAmount && !s.isDemo && s.categoryKind === 'operational';

/** Orçamento: só Despesa com valor, sem demo. Categoria e dono são regras do próprio orçamento. */
export const isBudgetSpendTransaction = (s: TransactionSemantics): boolean => s.isExpense && s.validAmount && !s.isDemo;

/** Próximos lançamentos: como a análise, sem o marcador do Pagar e sem Renda em cartão. */
export const isUpcomingEligibleTransaction = (s: TransactionSemantics): boolean =>
  s.validType && s.validAmount && !s.isDemo && s.categoryKind === 'operational' && !s.hasFundingMarker && !s.isCardIncome;

/** Recorrências (base): só Despesa com valor, sem demo, Ambos/investimento, marcador do Pagar nem compromissos. */
export const isRecurrenceBaseEligibleTransaction = (s: TransactionSemantics): boolean =>
  s.isExpense &&
  s.validAmount &&
  !s.isDemo &&
  s.categoryKind === 'operational' &&
  !s.hasFundingMarker &&
  !s.isCommitment;

/** Nomes explícitos. Não existe (ainda) uma política "economic": a neutralidade NÃO está ativa. */
export type TransactionViewPolicy =
  | 'dashboard_operational_legacy'
  | 'analysis_operational_legacy'
  | 'budget_spend_legacy'
  | 'upcoming_legacy'
  | 'recurrence_legacy';

export const TRANSACTION_VIEW_POLICIES: Readonly<Record<TransactionViewPolicy, (s: TransactionSemantics) => boolean>> = {
  dashboard_operational_legacy: isDashboardOperationalTransaction,
  analysis_operational_legacy: isAnalysisOperationalTransaction,
  budget_spend_legacy: isBudgetSpendTransaction,
  upcoming_legacy: isUpcomingEligibleTransaction,
  recurrence_legacy: isRecurrenceBaseEligibleTransaction,
};

export const isIncludedByPolicy = (s: TransactionSemantics, policy: TransactionViewPolicy): boolean =>
  TRANSACTION_VIEW_POLICIES[policy](s);

// ---------------------------------------------------------------------------------------------------------
// Políticas ATIVAS (Fase 3A): as legadas + demo fora + eventos neutros conhecidos fora.
// ---------------------------------------------------------------------------------------------------------

/** KPIs, gráficos e 50-30-20 da Dashboard. */
export const isDashboardEconomicTransaction = (s: TransactionSemantics): boolean =>
  isDashboardOperationalTransaction(s) && !s.isDemo && !s.isEconomicallyNeutral;

/** Resumo de investimentos: demo fora; a neutralidade NÃO se aplica (investimento como evento está fora da V1). */
export const isInvestmentSummaryTransaction = (s: TransactionSemantics): boolean =>
  isInvestmentTransaction(s) && !s.isDemo;

export const isAnalysisEconomicTransaction = (s: TransactionSemantics): boolean =>
  isAnalysisOperationalTransaction(s) && !s.isEconomicallyNeutral;

export const isBudgetSpendEconomicTransaction = (s: TransactionSemantics): boolean =>
  isBudgetSpendTransaction(s) && !s.isEconomicallyNeutral;

/** Mantém o marcador legado do Pagar (fallback para linhas antigas sem evento). */
export const isUpcomingEconomicTransaction = (s: TransactionSemantics): boolean =>
  isUpcomingEligibleTransaction(s) && !s.isEconomicallyNeutral;

/** Mantém o marcador legado do Pagar e os compromissos. */
export const isRecurrenceEconomicTransaction = (s: TransactionSemantics): boolean =>
  isRecurrenceBaseEligibleTransaction(s) && !s.isEconomicallyNeutral;

export type ActiveTransactionViewPolicy =
  | 'dashboard_operational'
  | 'investment_summary'
  | 'analysis_operational'
  | 'budget_spend'
  | 'upcoming'
  | 'recurrence';

export const ACTIVE_TRANSACTION_VIEW_POLICIES: Readonly<Record<ActiveTransactionViewPolicy, (s: TransactionSemantics) => boolean>> = {
  dashboard_operational: isDashboardEconomicTransaction,
  investment_summary: isInvestmentSummaryTransaction,
  analysis_operational: isAnalysisEconomicTransaction,
  budget_spend: isBudgetSpendEconomicTransaction,
  upcoming: isUpcomingEconomicTransaction,
  recurrence: isRecurrenceEconomicTransaction,
};

export const isIncludedByActivePolicy = (s: TransactionSemantics, policy: ActiveTransactionViewPolicy): boolean =>
  ACTIVE_TRANSACTION_VIEW_POLICIES[policy](s);
