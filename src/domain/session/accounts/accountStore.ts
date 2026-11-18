/**
 * Registro das contas lembradas neste navegador e conta ativa de cada aba (Etapa 2 — múltiplas sessões).
 *
 * O registro guarda SÓ metadados: id do usuário (confirmado pelo Supabase Auth), e-mail para exibição, datas e se a
 * sessão daquela conta foi encerrada. Nunca guarda senha nem token: cada sessão fica na chave própria do supabase-js
 * da conta (`accountStorageKey`), gerida pelo próprio SDK.
 *
 * `localStorage` NÃO é cofre: um XSS na origem lê tudo isto, inclusive as sessões do SDK (igual ao modo de conta única).
 * Nenhuma criptografia própria é aplicada aqui de propósito — ela não protegeria contra quem executa código na página.
 */

export const MAX_REMEMBERED_ACCOUNTS = 5;
export const ACCOUNT_REGISTRY_KEY = 'finelo.sessionAccounts.v1';
export const TAB_ACTIVE_ACCOUNT_KEY = 'finelo.sessionAccounts.active.v1';
export const TAB_PENDING_SLOT_KEY = 'finelo.sessionAccounts.pendingSlot.v1';
export const ACCOUNT_SYNC_CHANNEL = 'finelo-session-accounts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^[0-9a-z]{8,40}$/i;

export interface RememberedAccount {
  readonly userId: string;
  readonly email: string | null;
  readonly addedAt: number;
  readonly lastUsedAt: number;
  /** A sessão desta conta terminou (logout, revogação, refresh inválido): precisa entrar de novo. */
  readonly signedOut: boolean;
}

export interface AccountRegistry {
  readonly version: 1;
  readonly accounts: ReadonlyArray<RememberedAccount>;
}

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const isAccountUserId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Chave padrão do supabase-js 2.x para o projeto (`sb-<ref>-auth-token`): a do modo de conta única. */
export function legacyStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/** Chave determinística da sessão de UMA conta. Só aceita UUID: nada de entrada livre virar nome de chave. */
export function accountStorageKey(supabaseUrl: string, userId: string): string {
  if (!isAccountUserId(userId)) throw new Error('Identificador de conta inválido.');
  return `${legacyStorageKey(supabaseUrl)}.account.${userId.toLowerCase()}`;
}

/** Chave temporária de um login em andamento (senha ou OAuth) antes de o Auth confirmar de quem é a sessão. */
export function pendingStorageKey(supabaseUrl: string, slot: string): string {
  if (!SLOT.test(slot)) throw new Error('Identificador de login pendente inválido.');
  return `${legacyStorageKey(supabaseUrl)}.pending.${slot}`;
}

/** Sufixos que o supabase-js grava ao lado da sessão. */
export const SDK_KEY_SUFFIXES = ['', '-user', '-code-verifier'] as const;

const sanitize = (raw: unknown): RememberedAccount | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isAccountUserId(r.userId)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    userId: r.userId.toLowerCase(),
    email: typeof r.email === 'string' && r.email.length <= 320 ? r.email : null,
    addedAt: num(r.addedAt),
    lastUsedAt: num(r.lastUsedAt),
    signedOut: r.signedOut === true,
  };
};

/** `null` = recurso nunca ativado neste navegador (modo de conta única). */
export function readAccountRegistry(storage: KeyValueStorage): AccountRegistry | null {
  let raw: string | null;
  try {
    raw = storage.getItem(ACCOUNT_REGISTRY_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; accounts?: unknown };
    if (parsed?.version !== 1 || !Array.isArray(parsed.accounts)) return { version: 1, accounts: [] };
    const seen = new Set<string>();
    const accounts: RememberedAccount[] = [];
    for (const item of parsed.accounts) {
      const account = sanitize(item);
      if (!account || seen.has(account.userId)) continue; // sem duplicatas, mesmo se o armazenamento foi adulterado
      seen.add(account.userId);
      accounts.push(account);
      if (accounts.length === MAX_REMEMBERED_ACCOUNTS) break;
    }
    return { version: 1, accounts };
  } catch {
    return { version: 1, accounts: [] };
  }
}

export function writeAccountRegistry(storage: KeyValueStorage, registry: AccountRegistry): void {
  storage.setItem(ACCOUNT_REGISTRY_KEY, JSON.stringify({ version: 1, accounts: registry.accounts }));
}

export type UpsertOutcome = 'added' | 'updated' | 'limit_reached';

/** Inclui ou atualiza (sem duplicar) uma conta confirmada pelo Auth. Respeita o limite de contas. */
export function upsertRememberedAccount(
  registry: AccountRegistry,
  account: { userId: string; email: string | null },
  now: number
): { registry: AccountRegistry; outcome: UpsertOutcome } {
  if (!isAccountUserId(account.userId)) throw new Error('Identificador de conta inválido.');
  const userId = account.userId.toLowerCase();
  const existing = registry.accounts.find((a) => a.userId === userId);
  if (existing) {
    const updated: RememberedAccount = { ...existing, email: account.email ?? existing.email, lastUsedAt: now, signedOut: false };
    return { registry: { version: 1, accounts: registry.accounts.map((a) => (a.userId === userId ? updated : a)) }, outcome: 'updated' };
  }
  if (registry.accounts.length >= MAX_REMEMBERED_ACCOUNTS) return { registry, outcome: 'limit_reached' };
  const added: RememberedAccount = { userId, email: account.email, addedAt: now, lastUsedAt: now, signedOut: false };
  return { registry: { version: 1, accounts: [...registry.accounts, added] }, outcome: 'added' };
}

export function markAccount(registry: AccountRegistry, userId: string, patch: Partial<Pick<RememberedAccount, 'signedOut' | 'lastUsedAt'>>): AccountRegistry {
  return { version: 1, accounts: registry.accounts.map((a) => (a.userId === userId ? { ...a, ...patch } : a)) };
}

export function removeRememberedAccount(registry: AccountRegistry, userId: string): AccountRegistry {
  return { version: 1, accounts: registry.accounts.filter((a) => a.userId !== userId) };
}

/** Conta desta aba: a guardada na aba (se ainda lembrada e com sessão) ou a usada por último. */
export function resolveTabAccount(registry: AccountRegistry, tabStorage: KeyValueStorage): string | null {
  let stored: string | null = null;
  try {
    stored = tabStorage.getItem(TAB_ACTIVE_ACCOUNT_KEY);
  } catch {
    stored = null;
  }
  const usable = registry.accounts.filter((a) => !a.signedOut);
  if (stored && usable.some((a) => a.userId === stored)) return stored;
  const latest = [...usable].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
  return latest?.userId ?? null;
}

export function writeTabAccount(tabStorage: KeyValueStorage, userId: string | null): void {
  try {
    if (userId) tabStorage.setItem(TAB_ACTIVE_ACCOUNT_KEY, userId);
    else tabStorage.removeItem(TAB_ACTIVE_ACCOUNT_KEY);
  } catch {
    // Sem sessionStorage (modo privado restrito): a aba volta à conta usada por último no próximo carregamento.
  }
}
