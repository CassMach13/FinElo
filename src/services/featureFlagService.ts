import { User } from '@supabase/supabase-js';

type UserWithMetadata = Pick<User, 'id' | 'user_metadata' | 'app_metadata' | 'email'> | null | undefined;

export type AtomicImportServerState = 'enabled' | 'disabled' | 'unset';

type AtomicImportFlagResult = {
  data: AtomicImportServerState | null;
  error: { message: string } | null;
};

export type AtomicImportFlagReader = () => Promise<AtomicImportFlagResult>;

const clampPercent = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
};

const toRolloutBucket = (userId: string): number => {
  // Hash determinístico simples para distribuir usuários de forma estável em 0..99.
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
};

/**
 * Cartao V2 gate.
 * Priority:
 * 1) o motor novo, quando ligado, substitui o V2;
 * 2) VITE_CARD_V2_FORCE=true habilita globalmente no ambiente;
 * 3) opt-out individual desliga;
 * 4) opt-in individual liga (app_metadata tem prioridade sobre user_metadata);
 * 5) VITE_CARD_V2_ROLLOUT_PERCENT controla rollout gradual (0-100).
 *
 * Nenhum e-mail é consultado: quem é piloto é dado, não código.
 */
export const isCardV2Enabled = (user: UserWithMetadata): boolean => {
  if (!user?.id) return false;
  if (isCreditCardEngineEnabled(user)) {
    return false;
  }
  if (import.meta.env.VITE_CARD_V2_FORCE === 'true') return true;
  if (user?.app_metadata?.card_v2_disabled === true) return false;
  if (user?.user_metadata?.card_v2_disabled === true) return false;
  if (user?.app_metadata?.card_v2_enabled === true) return true;
  if (user?.user_metadata?.card_v2_enabled === true) return true;

  const rolloutPercent = clampPercent(
    Number(import.meta.env.VITE_CARD_V2_ROLLOUT_PERCENT || 0)
  );
  if (rolloutPercent <= 0) return false;
  if (rolloutPercent >= 100) return true;

  const bucket = toRolloutBucket(user.id);
  return bucket < rolloutPercent;
};

/**
 * Modo sombra: roda os cálculos do V2 sem expor a UI do V2.
 * Mesma precedência das demais; nenhum e-mail é consultado.
 */
export const isCardV2ShadowEnabled = (user: UserWithMetadata): boolean => {
  // Opt-out primeiro: um desligamento de emergência que não vence a flag global do
  // ambiente não serviria de emergência.
  if (user?.app_metadata?.card_v2_shadow_disabled === true) return false;
  if (user?.user_metadata?.card_v2_shadow_disabled === true) return false;
  if (import.meta.env.VITE_CARD_V2_SHADOW_FORCE === 'true') return true;
  if (user?.app_metadata?.card_v2_shadow_enabled === true) return true;
  return user?.user_metadata?.card_v2_shadow_enabled === true;
};

/**
 * Motor novo de cartão (migration 047).
 *
 * Prioridade:
 * 1) opt-out administrativo ou do usuário desliga imediatamente;
 * 2) opt-in em app_metadata habilita a conta piloto;
 * 3) opt-in legado em user_metadata segue aceito, por compatibilidade;
 * 4) VITE_CARD_ENGINE_FORCE=true habilita globalmente no ambiente.
 *
 * O opt-in preferencial usa `app_metadata` porque esse campo só pode ser alterado por
 * credencial administrativa, não pela própria sessão do usuário — mesmo motivo já
 * documentado em `isAtomicImportEnabled`.
 *
 * ATENÇÃO: até 2026-09-01 esta função ligava o motor comparando o e-mail do usuário com
 * um endereço fixo no código. Isso embutia a conta piloto no bundle publicado, criava um
 * caminho de código exclusivo daquela conta e contrariava o princípio que o próprio
 * projeto já fixara em teste («não habilita por e-mail»). Quem é piloto passou a ser
 * dado, não código. Não reintroduza comparação por e-mail aqui.
 */
export const isCreditCardEngineEnabled = (user: UserWithMetadata): boolean => {
  if (!user?.id) return false;
  if (user?.app_metadata?.credit_card_engine_disabled === true) return false;
  if (user?.user_metadata?.credit_card_engine_disabled === true) return false;
  if (user?.app_metadata?.credit_card_engine_enabled === true) return true;
  if (user?.user_metadata?.credit_card_engine_enabled === true) return true;
  return import.meta.env.VITE_CARD_ENGINE_FORCE === 'true';
};

/**
 * Open Finance (Belvo/Pluggy) na importação.
 * Desligado por padrão até haver provedor pay-as-you-go — reative com VITE_OPEN_FINANCE_ENABLED=true.
 */
export const isOpenFinanceEnabled = (user?: UserWithMetadata): boolean => {
  if (import.meta.env.VITE_OPEN_FINANCE_ENABLED === 'true') return true;
  return user?.user_metadata?.open_finance_enabled === true;
};

/**
 * Filtros inteligentes da Sprint 1B.
 *
 * A experiência permanece desligada por padrão. O opt-in administrativo em
 * app_metadata permite um piloto individual em produção; a variável de
 * ambiente é usada apenas para Preview/Staging ou rollout global aprovado.
 */
export const isSmartTransactionFiltersEnabled = (user?: UserWithMetadata): boolean => {
  if (!user?.id) return false;
  if (user.app_metadata?.smart_transaction_filters_disabled === true) return false;
  if (user.user_metadata?.smart_transaction_filters_disabled === true) return false;
  if (user.app_metadata?.smart_transaction_filters_enabled === true) return true;
  return import.meta.env.VITE_SMART_TRANSACTION_FILTERS_ENABLED === 'true';
};

/**
 * Importação atômica da Sprint 1A.
 * Prioridade:
 * 1) opt-out administrativo ou do usuário desabilita imediatamente;
 * 2) app_metadata.atomic_imports_enabled=false é rollback administrativo explícito;
 * 3) app_metadata.atomic_imports_enabled=true habilita somente a conta piloto;
 * 4) VITE_ATOMIC_IMPORTS_ENABLED=true habilita globalmente no ambiente.
 *
 * O opt-in individual usa app_metadata porque esse campo só pode ser alterado
 * por uma credencial administrativa, não pela própria sessão do usuário.
 */
export const isAtomicImportEnabled = (user?: UserWithMetadata): boolean => {
  if (!user?.id) return false;
  if (user.app_metadata?.atomic_imports_disabled === true) return false;
  if (user.user_metadata?.atomic_imports_disabled === true) return false;
  if (user.app_metadata?.atomic_imports_enabled === false) return false;
  if (user.app_metadata?.atomic_imports_enabled === true) return true;
  return import.meta.env.VITE_ATOMIC_IMPORTS_ENABLED === 'true';
};

/**
 * Resolve a flag individual no servidor para não depender de um JWT antigo.
 * Falhas de rede, função ausente ou resposta inesperada mantêm o fluxo legado
 * (desligado), evitando ampliar o rollout por acidente.
 */
export const resolveAtomicImportEnabled = async (
  user: UserWithMetadata,
  readServerFlag: AtomicImportFlagReader
): Promise<boolean> => {
  if (!user?.id) return false;
  if (user.user_metadata?.atomic_imports_disabled === true) return false;

  try {
    const { data, error } = await readServerFlag();
    if (error || !data) return false;
    if (data === 'disabled') return false;
    if (data === 'enabled') return true;
    if (data === 'unset') return import.meta.env.VITE_ATOMIC_IMPORTS_ENABLED === 'true';
    return false;
  } catch {
    return false;
  }
};

