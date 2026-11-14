import { createClient, isAuthRetryableFetchError, navigatorLock, type SupabaseClient } from '@supabase/supabase-js';
import { setOperationClientResolver } from '../operationBinding';
import { SessionAccountManager, type AccountManagerEnv, type AccountSyncMessage } from './accountManager';
import {
  ACCOUNT_SYNC_CHANNEL,
  accountStorageKey,
  isAccountUserId,
  legacyStorageKey,
  readAccountRegistry,
  SDK_KEY_SUFFIXES,
  writeAccountRegistry,
  writeTabAccount,
  type KeyValueStorage,
} from './accountStore';

/**
 * Ativação do gerenciador de múltiplas sessões (Etapa 2). Duas travas, ambas necessárias:
 *  - build: `VITE_MULTI_ACCOUNT_SESSIONS=true` (ausente em produção → nada muda, nenhum código novo roda);
 *  - opt-in: o navegador só entra no modo de várias contas depois de `enableMultiAccountSessions()` (Etapa 3: quando
 *    o usuário pede para adicionar outra conta). Sem isso, o app usa o cliente de conta única de sempre.
 *
 * O modo é decidido UMA vez por carregamento de página: a passagem para o modo de várias contas recarrega as abas.
 */

let manager: SessionAccountManager | null = null;

export const getSessionAccountManager = (): SessionAccountManager | null => manager;

const browserStorage = (kind: 'localStorage' | 'sessionStorage'): KeyValueStorage | null => {
  try {
    return typeof window !== 'undefined' ? window[kind] : null;
  } catch {
    return null;
  }
};

const isCallbackUrl = () => {
  if (typeof window === 'undefined') return false;
  const { hash, search } = window.location;
  return /[#&](access_token|error_description)=/.test(hash) || /[?&]code=/.test(search);
};

const browserChannel = (onModeChanged: () => void): AccountManagerEnv['channel'] => {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    const channel = new BroadcastChannel(ACCOUNT_SYNC_CHANNEL);
    channel.addEventListener('message', (event: MessageEvent<AccountSyncMessage>) => {
      if (event.data?.type === 'mode-changed') onModeChanged();
    });
    return {
      post: (message) => channel.postMessage(message),
      subscribe: (onMessage) => {
        const handler = (event: MessageEvent<AccountSyncMessage>) => onMessage(event.data);
        channel.addEventListener('message', handler);
        return () => channel.removeEventListener('message', handler);
      },
    };
  } catch {
    return null;
  }
};

export interface MultiAccountBootstrap {
  readonly client: SupabaseClient;
  readonly manager: SessionAccountManager;
}

/**
 * `null` = modo de conta única (o chamador cria o cliente global exatamente como antes). Só devolve o gerenciador
 * com a trava de build ligada E o registro de contas presente neste navegador.
 */
export function createMultiAccountSessions(supabaseUrl: string, publishableKey: string, buildEnabled: boolean): MultiAccountBootstrap | null {
  if (!buildEnabled) return null;
  const storage = browserStorage('localStorage');
  const tabStorage = browserStorage('sessionStorage');
  if (!storage || !tabStorage || readAccountRegistry(storage) === null) return null;

  const env: AccountManagerEnv = {
    supabaseUrl,
    storage,
    tabStorage,
    createClient: ({ storageKey, detectSessionInUrl, fetch }) =>
      createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl, storageKey },
        global: { fetch },
      }),
    isAuthCallbackUrl: isCallbackUrl,
    visibility:
      typeof document === 'undefined'
        ? null
        : {
            isVisible: () => document.visibilityState === 'visible',
            subscribe: (onChange) => {
              document.addEventListener('visibilitychange', onChange);
              return () => document.removeEventListener('visibilitychange', onChange);
            },
          },
    channel: browserChannel(() => undefined),
  };
  manager = new SessionAccountManager(env);
  const current = manager;
  setOperationClientResolver(() => current.activeAccountClient());
  return { client: manager.client, manager };
}

/** Modo de conta única com a trava de build ligada: outra aba ativou várias contas → esta recarrega no modo novo. */
export function watchForMultiAccountActivation(buildEnabled: boolean): void {
  if (!buildEnabled || typeof window === 'undefined') return;
  browserChannel(() => window.location.reload());
}

export type EnableOutcome =
  | { ok: true; userId: string | null }
  | { ok: false; reason: 'disabled' | 'already_enabled' | 'network' | 'validation_failed' };

export interface LegacyMigrationEnv {
  readonly supabaseUrl: string;
  readonly storage: KeyValueStorage;
  readonly tabStorage: KeyValueStorage;
  /** Valida a cópia na chave da conta com o Auth (cliente de conta, sem renovação automática). */
  readonly validateAccountCopy: (storageKey: string) => Promise<string | null>;
  readonly lock?: <R>(name: string, acquireTimeout: number, fn: () => Promise<R>) => Promise<R>;
  readonly broadcast?: (message: AccountSyncMessage) => void;
}

/**
 * Migração do armazenamento de conta única para o gerenciador (opt-in). A sessão atual é validada com o Auth ANTES
 * (`getUser` no cliente de sempre, que renova se preciso), copiada para a chave da conta sob o lock da chave antiga
 * (nenhuma aba renova o token no meio), validada de novo na chave nova e só então a chave antiga é apagada — sem
 * `signOut`, que revogaria a sessão. Qualquer falha desfaz a cópia e deixa o modo de conta única intacto.
 */
export async function migrateLegacySession(
  legacy: Pick<SupabaseClient, 'auth'>,
  env: LegacyMigrationEnv
): Promise<EnableOutcome> {
  if (readAccountRegistry(env.storage) !== null) return { ok: false, reason: 'already_enabled' };
  const { data, error } = await legacy.auth.getUser();
  if (error && isAuthRetryableFetchError(error)) return { ok: false, reason: 'network' };
  const user = data.user;
  if (!user) {
    writeAccountRegistry(env.storage, { version: 1, accounts: [] });
    env.broadcast?.({ type: 'mode-changed' });
    return { ok: true, userId: null };
  }
  if (!isAccountUserId(user.id)) return { ok: false, reason: 'validation_failed' };
  const userId = user.id.toLowerCase();
  const oldKey = legacyStorageKey(env.supabaseUrl);
  const newKey = accountStorageKey(env.supabaseUrl, userId);
  const lock = env.lock ?? (async <R>(_n: string, _t: number, fn: () => Promise<R>) => fn());

  return lock(`lock:${oldKey}`, -1, async () => {
    for (const suffix of SDK_KEY_SUFFIXES) {
      if (suffix === '-code-verifier') continue;
      const value = env.storage.getItem(oldKey + suffix);
      if (value !== null) env.storage.setItem(newKey + suffix, value);
    }
    let confirmed: string | null = null;
    try {
      confirmed = await env.validateAccountCopy(newKey);
    } catch {
      confirmed = null;
    }
    if (confirmed?.toLowerCase() !== userId) {
      for (const suffix of SDK_KEY_SUFFIXES) env.storage.removeItem(newKey + suffix);
      return { ok: false, reason: 'validation_failed' } as const;
    }
    const now = Date.now();
    writeAccountRegistry(env.storage, {
      version: 1,
      accounts: [{ userId, email: user.email ?? null, addedAt: now, lastUsedAt: now, signedOut: false }],
    });
    writeTabAccount(env.tabStorage, userId);
    for (const suffix of SDK_KEY_SUFFIXES) env.storage.removeItem(oldKey + suffix);
    env.broadcast?.({ type: 'mode-changed' });
    return { ok: true, userId } as const;
  });
}

/** Opt-in no navegador (Etapa 3 chama ao adicionar a segunda conta). Recarregue a página em seguida. */
export async function enableMultiAccountSessions(
  legacy: SupabaseClient,
  supabaseUrl: string,
  publishableKey: string,
  buildEnabled: boolean
): Promise<EnableOutcome> {
  if (!buildEnabled) return { ok: false, reason: 'disabled' };
  const storage = browserStorage('localStorage');
  const tabStorage = browserStorage('sessionStorage');
  if (!storage || !tabStorage) return { ok: false, reason: 'disabled' };
  let channel: BroadcastChannel | null = null;
  try {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(ACCOUNT_SYNC_CHANNEL);
  } catch {
    channel = null;
  }
  try {
    return await migrateLegacySession(legacy, {
      supabaseUrl,
      storage,
      tabStorage,
      lock: typeof navigator !== 'undefined' && navigator.locks ? navigatorLock : undefined,
      broadcast: (message) => channel?.postMessage(message),
      validateAccountCopy: async (storageKey) => {
        const probe = createClient(supabaseUrl, publishableKey, {
          auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey },
        });
        const { data } = await probe.auth.getUser();
        return data.user?.id ?? null;
      },
    });
  } finally {
    channel?.close();
  }
}
