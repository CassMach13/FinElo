/**
 * Estado dos "Primeiros passos" — derivado dos DADOS REAIS, não de flags de progresso.
 *
 * ===========================================================================
 * PRINCÍPIOS
 * ===========================================================================
 *
 * 1. O progresso sai do que existe no banco. "Trouxe dados" é "há alguma transação que não é
 *    demonstração"; "precisa de revisão" é "há transação sem categoria". Nenhum
 *    `step1_complete` é gravado.
 * 2. O que se grava em `user_metadata` é só PREFERÊNCIA DE EXIBIÇÃO: dispensou o bloco
 *    (`onboarding_v1_dismissed_at`) e a versão. Nenhum dado financeiro vai para lá.
 * 3. Não existe "ativado = 10 transações" aqui. Esse número é um proxy de análise. O produto
 *    reage à existência de dados reais e ao estado atual do fluxo.
 * 4. Demonstração não conta. O seed antigo (`loadDemoData`) marca as linhas com
 *    `Origem = 'demo.csv'` e `Fonte = 'Demo'`; só esses identificadores são usados, nunca nome ou
 *    valor.
 *
 * ===========================================================================
 * QUEM VÊ O BLOCO
 * ===========================================================================
 *
 * - Sem dados reais (inclusive só demo): vê o bloco, no passo 1.
 * - Com dados reais: o bloco só continua (e evolui para "Confira o que entrou" / "Veja seu mês")
 *   para quem JÁ o tinha visto sem dados (`onboarding_v1_started_at`). Quem já usava o app antes
 *   desta versão tem dados e nunca viu o estado vazio, então não recebe o onboarding de repente.
 */

export const ONBOARDING_VERSION = 1;

export const ONBOARDING_META_KEYS = {
  dismissedAt: 'onboarding_v1_dismissed_at',
  startedAt: 'onboarding_v1_started_at',
  version: 'onboarding_version',
} as const;

export interface OnboardingTransactionLike {
  Origem?: string | null;
  Fonte?: string | null;
  Categoria?: string | null;
}

export type FirstStepId = 'bring' | 'review' | 'view';
export type FirstStepStatus = 'active' | 'done' | 'upcoming';
export type FirstStepsPhase = 'start' | 'review' | 'view';

export interface FirstStepsState {
  /** O bloco aparece agora. */
  visible: boolean;
  /** Foi dispensado e ainda faz sentido oferecer "Retomar primeiros passos". */
  canResume: boolean;
  phase: FirstStepsPhase;
  hasRealData: boolean;
  uncategorizedCount: number;
  steps: { id: FirstStepId; status: FirstStepStatus }[];
  /** Registrar (uma vez) que o usuário viu o bloco sem dados. */
  shouldMarkStarted: boolean;
  /** O tour automático por tela pode abrir. */
  allowAutoTour: boolean;
}

/** Linha criada pela demonstração antiga. Só os identificadores que ela grava. */
export const isDemoTransaction = (t: OnboardingTransactionLike): boolean =>
  t.Origem === 'demo.csv' || t.Fonte === 'Demo';

/** Sem categoria de verdade: vazia ou o travessão que a tela usa para "sem categoria". */
export const needsCategory = (t: OnboardingTransactionLike): boolean => {
  const category = String(t.Categoria ?? '').trim();
  return category === '' || category === '-';
};

const STEPS_BY_PHASE: Record<FirstStepsPhase, FirstStepStatus[]> = {
  start: ['active', 'upcoming', 'upcoming'],
  review: ['done', 'active', 'upcoming'],
  view: ['done', 'done', 'active'],
};

const STEP_IDS: FirstStepId[] = ['bring', 'review', 'view'];

export function getFirstStepsState(input: {
  /** Os dados iniciais terminaram de carregar. Antes disso nada aparece (evita piscar). */
  ready: boolean;
  transactions: readonly OnboardingTransactionLike[];
  metadata: Record<string, unknown> | null | undefined;
}): FirstStepsState {
  const { ready, transactions, metadata } = input;
  const real = transactions.filter((t) => !isDemoTransaction(t));
  const hasRealData = real.length > 0;
  const uncategorizedCount = real.filter(needsCategory).length;

  const phase: FirstStepsPhase = !hasRealData ? 'start' : uncategorizedCount > 0 ? 'review' : 'view';
  const dismissed = Boolean(metadata?.[ONBOARDING_META_KEYS.dismissedAt]);
  const started = Boolean(metadata?.[ONBOARDING_META_KEYS.startedAt]);

  const participates = ready && (!hasRealData || started);

  return {
    visible: participates && !dismissed,
    canResume: participates && dismissed && phase !== 'view',
    phase,
    hasRealData,
    uncategorizedCount,
    steps: STEP_IDS.map((id, index) => ({ id, status: STEPS_BY_PHASE[phase][index] })),
    shouldMarkStarted: ready && !hasRealData && !started,
    allowAutoTour: ready && hasRealData && !started,
  };
}

/** Preferências gravadas em `user_metadata`. Nada de progresso financeiro. */
export const dismissPatch = (now: Date = new Date()) => ({
  [ONBOARDING_META_KEYS.dismissedAt]: now.toISOString(),
  [ONBOARDING_META_KEYS.version]: ONBOARDING_VERSION,
});

export const resumePatch = () => ({ [ONBOARDING_META_KEYS.dismissedAt]: null });

export const startedPatch = (now: Date = new Date()) => ({
  [ONBOARDING_META_KEYS.startedAt]: now.toISOString(),
  [ONBOARDING_META_KEYS.version]: ONBOARDING_VERSION,
});
