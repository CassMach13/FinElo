/**
 * Etapa 2 — cliente vinculado à operação no store REAL e invariância do modo de conta única.
 */
import { describe, expect, it, vi } from 'vitest';
import { operationClient, runWithOperationBinding, setOperationClientResolver } from '../../../src/domain/session/operationBinding';
import { commitSessionIdentity, resetSessionScopeForTests } from '../../../src/domain/session/sessionScope';
import { createMultiAccountSessions } from '../../../src/domain/session/accounts/multiAccountSessions';
import { supabase } from '../../../src/supabaseClient';
import { useAppStore } from '../../../src/hooks/useAppStore';

const A = 'b1a10909-1009-4e65-8a49-100000000001';
const B = 'b1a10909-1009-4e65-8a49-100000000002';

function fakeClient(label: string, calls: string[]) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const builder = (table: string) => ({
    insert: (rows: unknown) => ({
      select: async () => {
        calls.push(`${label}:insert:${table}`);
        return { data: [{ id: `${label}-1`, ...(rows as object[])[0] }], error: null };
      },
    }),
  });
  return {
    release,
    client: {
      auth: {
        getUser: async () => {
          calls.push(`${label}:getUser`);
          await gate;
          return { data: { user: { id: label === 'A' ? A : B } }, error: null };
        },
      },
      from: builder,
    },
  };
}

describe('Etapa 2 — cliente vinculado à operação (store real)', () => {
  it('a ação usa até o fim o cliente da conta que a iniciou, mesmo se a aba trocar de conta no meio', async () => {
    resetSessionScopeForTests();
    useAppStore.getState().setUser({ id: A } as never);
    const calls: string[] = [];
    const a = fakeClient('A', calls);
    const b = fakeClient('B', calls);
    let active: unknown = a.client;
    setOperationClientResolver(() => active);
    try {
      const pending = useAppStore.getState().addBudget({ category: 'x', amount: 1 } as never);
      // A aba passa a apontar para B enquanto a ação de A espera o Auth.
      active = b.client;
      a.release();
      b.release();
      await pending;
      expect(calls).toEqual(['A:getUser', 'A:insert:budgets']);
      // Uma ação nova, iniciada depois, usa o cliente de B.
      commitSessionIdentity(B);
      useAppStore.getState().setUser({ id: B } as never);
      await useAppStore.getState().addBudget({ category: 'y', amount: 2 } as never);
      expect(calls.slice(2)).toEqual(['B:getUser', 'B:insert:budgets']);
    } finally {
      setOperationClientResolver(null);
      useAppStore.getState().setUser(null);
    }
  });

  it('fora da reexecução da cerca (setUser/signOut, criação do store) vale o cliente compartilhado', () => {
    const shared = { shared: true };
    setOperationClientResolver(() => ({ bound: true }));
    try {
      expect(operationClient(shared)).toBe(shared);
      expect(runWithOperationBinding(() => operationClient(shared))).toEqual({ bound: true });
    } finally {
      setOperationClientResolver(null);
    }
    // Sem resolvedor (conta única): sempre o compartilhado.
    expect(runWithOperationBinding(() => operationClient(shared))).toBe(shared);
  });
});

describe('Etapa 2 — modo de conta única não muda', () => {
  it('sem trava de build, ou sem opt-in neste navegador, o gerenciador não existe', () => {
    expect(createMultiAccountSessions('https://projref.supabase.test', 'k', false)).toBeNull();
    // Ambiente de teste sem window/localStorage = nenhum registro: também nulo com a trava ligada.
    expect(createMultiAccountSessions('https://projref.supabase.test', 'k', true)).toBeNull();
  });

  it('o cliente global é um SupabaseClient comum com a chave padrão do projeto (não a fachada)', () => {
    expect(import.meta.env.VITE_MULTI_ACCOUNT_SESSIONS).toBeUndefined();
    const auth = supabase.auth as unknown as { storageKey: string; autoRefreshToken: boolean; detectSessionInUrl: boolean };
    expect(auth.storageKey).toMatch(/^sb-[a-z0-9-]+-auth-token$/);
    expect(auth.autoRefreshToken).toBe(true);
    expect(auth.detectSessionInUrl).toBe(true);
    expect(Object.getPrototypeOf(supabase).constructor.name).toBe('SupabaseClient');
  });

  it('a trava de build não está ligada em nenhum arquivo de ambiente versionado', async () => {
    const { readFileSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const envFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter((f) => /(^|\/)\.env/.test(f));
    expect(envFiles.length).toBeGreaterThan(0);
    for (const file of envFiles) expect(readFileSync(file, 'utf8')).not.toMatch(/VITE_MULTI_ACCOUNT_SESSIONS\s*=\s*true/);
    vi.restoreAllMocks();
  });
});
