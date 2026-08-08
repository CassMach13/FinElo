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
 * 1) VITE_CARD_V2_FORCE=true enables globally in the environment.
 * 2) user_metadata.card_v2_disabled=true disables for a specific user.
 * 3) user_metadata.card_v2_enabled=true enables for a specific user.
 * 4) VITE_CARD_V2_ROLLOUT_PERCENT controls gradual rollout (0-100).
 */
export const isCardV2Enabled = (user: UserWithMetadata): boolean => {
  if (!user?.id) return false;
  if (isCreditCardEngineEnabled(user)) {
    return false;
  }
  if (import.meta.env.VITE_CARD_V2_FORCE === 'true') return true;
  if (user?.email?.toLowerCase() === 'cassiomq@gmail.com') return true;
  if (user?.user_metadata?.card_v2_disabled === true) return false;
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
 * Optional shadow mode gate for running V2 calculations
 * without exposing V2 UI yet.
 */
export const isCardV2ShadowEnabled = (user: UserWithMetadata): boolean => {
  if (import.meta.env.VITE_CARD_V2_SHADOW_FORCE === 'true') return true;
  if (user?.email?.toLowerCase() === 'cassiomq@gmail.com') return true;
  return user?.user_metadata?.card_v2_shadow_enabled === true;
};

export const isCreditCardEngineEnabled = (user: UserWithMetadata): boolean => {
  if (!user?.id) return false;
  if (import.meta.env.VITE_CARD_ENGINE_FORCE === 'true') return true;
  if (user?.email?.toLowerCase() === 'cassiomq@gmail.com') return true;
  return user?.user_metadata?.credit_card_engine_enabled === true;
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

