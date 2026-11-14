import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionFencedFetch, sessionFenceDecision } from '../../src/domain/session/sessionFence';
import {
  captureSession,
  commitSessionIdentity,
  endSession,
  readBearerIdentity,
  resetSessionScopeForTests,
  trackSessionOperation,
} from '../../src/domain/session/sessionScope';
import { fakeJwt, userJwt } from '../helpers/fakeJwt';

const URL_BASE = 'https://project.supabase.test';
const ANON = 'sb_publishable_test_key';

/** Backend falso: registra quem (sub do portador) fez cada requisição, como a RLS enxergaria. */
function fakeBackend() {
  const seen: Array<{ method: string; path: string; sub: string | null }> = [];
  const rows: Array<{ id: string; user_id: string; name: string }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    const sub = readBearerIdentity(auth.replace(/^Bearer /, ''))?.sub ?? null;
    seen.push({ method, path: url.pathname, sub });
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '[]'));
      const inserted = (Array.isArray(body) ? body : [body]).map((r: { name: string }, i: number) => ({
        id: `r${rows.length + i + 1}`,
        user_id: sub ?? 'anon',
        name: r.name,
      }));
      rows.push(...inserted);
      return new Response(JSON.stringify(inserted), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(rows.filter((r) => r.user_id === sub)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { seen, rows, fetchImpl };
}

let token: string | null = null;
const makeClient = (backend: ReturnType<typeof fakeBackend>) =>
  createClient(URL_BASE, ANON, {
    // Como o cliente global: o token é o da sessão ATUAL no momento do envio, não o de quem iniciou.
    accessToken: async () => token,
    global: { fetch: createSessionFencedFetch(URL_BASE, backend.fetchImpl) },
  });

beforeEach(() => {
  resetSessionScopeForTests();
  token = null;
});

describe('barreira de rede — decisão', () => {
  it('Auth passa intacto (login, renovação de token, logout, recuperação de senha)', () => {
    commitSessionIdentity('A');
    for (const path of ['/auth/v1/token?grant_type=refresh_token', '/auth/v1/logout', '/auth/v1/recover', '/auth/v1/user']) {
      expect(sessionFenceDecision(`${URL_BASE}${path}`, 'POST', userJwt('B'), URL_BASE)).toBeNull();
    }
  });
  it('fora do projeto Supabase não interfere', () => {
    commitSessionIdentity('A');
    expect(sessionFenceDecision('https://outro.example/rest/v1/x', 'POST', userJwt('B'), URL_BASE)).toBeNull();
  });
  it('chave anônima não é tratada como identidade', () => {
    commitSessionIdentity('A');
    expect(sessionFenceDecision(`${URL_BASE}/rest/v1/x`, 'POST', fakeJwt({ role: 'anon' }), URL_BASE)).toBeNull();
    expect(sessionFenceDecision(`${URL_BASE}/rest/v1/x`, 'POST', null, URL_BASE)).toBeNull();
  });
  it('R0: sem identidade ativa (logout pendente, inicialização, recuperação de senha) nenhuma credencial de usuário sai', () => {
    for (const path of ['/rest/v1/transactions', '/storage/v1/object/x', '/functions/v1/f']) {
      expect(sessionFenceDecision(`${URL_BASE}${path}`, 'GET', userJwt('A'), URL_BASE)).toBe('no_active_identity');
      expect(sessionFenceDecision(`${URL_BASE}${path}`, 'POST', userJwt('A'), URL_BASE)).toBe('no_active_identity');
      // Chave publicável (dados públicos, ex.: contagem de fundadores) segue.
      expect(sessionFenceDecision(`${URL_BASE}${path}`, 'GET', ANON, URL_BASE)).toBeNull();
    }
    // Auth (logout, recuperação de senha, novo login) nunca é barrado.
    expect(sessionFenceDecision(`${URL_BASE}/auth/v1/logout`, 'POST', userJwt('A'), URL_BASE)).toBeNull();
    expect(sessionFenceDecision(`${URL_BASE}/auth/v1/user`, 'PUT', userJwt('A'), URL_BASE)).toBeNull();
  });

  it('R1: a aba exibe A; nada sai com credencial de B (REST, Storage, Functions, leitura ou escrita)', () => {
    commitSessionIdentity('A');
    for (const path of ['/rest/v1/transactions', '/rest/v1/rpc/x', '/storage/v1/object/b/f', '/functions/v1/fn']) {
      expect(sessionFenceDecision(`${URL_BASE}${path}`, 'GET', userJwt('B'), URL_BASE)).toBe('identity_mismatch');
      expect(sessionFenceDecision(`${URL_BASE}${path}`, 'POST', userJwt('B'), URL_BASE)).toBe('identity_mismatch');
    }
    expect(sessionFenceDecision(`${URL_BASE}/rest/v1/transactions`, 'GET', userJwt('A'), URL_BASE)).toBeNull();
  });
});

describe('barreira de rede — cliente supabase-js real', () => {
  it('sincronização normal da conta atual: lê e grava com a própria credencial', async () => {
    const backend = fakeBackend();
    const db = makeClient(backend);
    commitSessionIdentity('A');
    token = userJwt('A');
    const ins = await db.from('items').insert([{ name: 'a1' }]).select();
    expect(ins.error).toBeNull();
    const read = await db.from('items').select('*');
    expect(read.data).toEqual([{ id: 'r1', user_id: 'A', name: 'a1' }]);
  });

  it('operação pendente de A não grava com o token de B depois da troca (A → B)', async () => {
    const backend = fakeBackend();
    const db = makeClient(backend);
    commitSessionIdentity('A');
    token = userJwt('A');
    let resume!: () => void;
    const gate = new Promise<void>((r) => (resume = r));
    const opOfA = trackSessionOperation(
      captureSession(),
      (async () => {
        await gate; // ex.: aguardando getUser/um diálogo/uma leitura
        return db.from('items').insert([{ name: 'de A' }]).select();
      })()
    );
    // Troca: B entra; o SDK global passa a anexar o token de B.
    endSession();
    commitSessionIdentity('B');
    token = userJwt('B');
    resume();
    const result = await opOfA;
    expect(result.error?.message).toContain('SessionFenceError');
    expect(backend.rows).toEqual([]);
    expect(backend.seen.filter((r) => r.method === 'POST')).toEqual([]);
  });

  it('durante a quarentena B lê normalmente; grava assim que a operação de A termina', async () => {
    const backend = fakeBackend();
    const db = makeClient(backend);
    commitSessionIdentity('A');
    let finishA!: () => void;
    trackSessionOperation(captureSession(), new Promise<void>((r) => (finishA = r)));
    commitSessionIdentity('B');
    token = userJwt('B');
    expect((await db.from('items').select('*')).error).toBeNull();
    const blocked = await db.from('items').insert([{ name: 'b1' }]).select();
    expect(blocked.error?.message).toContain('SessionFenceError');
    finishA();
    await Promise.resolve();
    await Promise.resolve();
    const ok = await db.from('items').insert([{ name: 'b1' }]).select();
    expect(ok.error).toBeNull();
    expect(backend.rows).toEqual([{ id: 'r1', user_id: 'B', name: 'b1' }]);
  });

  it('múltiplas abas: outra aba trocou a sessão compartilhada para B; esta (ainda A) não envia nada como B', async () => {
    const backend = fakeBackend();
    const db = makeClient(backend);
    commitSessionIdentity('A');
    token = userJwt('B'); // storage compartilhado já tem B; evento ainda não processado nesta aba
    const read = await db.from('items').select('*');
    const write = await db.from('items').insert([{ name: 'x' }]).select();
    expect(read.error?.message).toContain('SessionFenceError');
    expect(write.error?.message).toContain('SessionFenceError');
    expect(backend.seen).toEqual([]);
    commitSessionIdentity('B'); // evento SIGNED_IN(B) processado
    expect((await db.from('items').select('*')).error).toBeNull();
  });

  it('A → B → A: operação da primeira sessão de A não grava na nova sessão de A, nem como B', async () => {
    const backend = fakeBackend();
    const db = makeClient(backend);
    commitSessionIdentity('A');
    let resume!: () => void;
    const gate = new Promise<void>((r) => (resume = r));
    const first = trackSessionOperation(captureSession(), (async () => {
      await gate;
      return db.from('items').insert([{ name: 'tardia' }]).select();
    })());
    commitSessionIdentity('B');
    token = userJwt('B');
    // Enquanto B está ativo, nada de A sai com B.
    expect((await db.from('items').insert([{ name: 'b' }]).select()).error?.message).toContain('SessionFenceError');
    commitSessionIdentity('A');
    token = userJwt('A', 'sess-A-2');
    resume();
    const stale = await first;
    expect(stale.error?.message).toContain('SessionFenceError');
    expect(backend.rows).toHaveLength(0);
    expect(backend.seen.some((r) => r.method === 'POST')).toBe(false);
    // Terminada a operação antiga, a nova sessão de A grava normalmente.
    await Promise.resolve();
    expect((await db.from('items').insert([{ name: 'nova' }]).select()).error).toBeNull();
    expect(backend.rows.map((r) => [r.user_id, r.name])).toEqual([['A', 'nova']]);
  });

  it('logout pendente: o SDK ainda guarda o token de A, mas nada sai com ele', async () => {
    const backend = fakeBackend();
    const db = makeClient(backend);
    commitSessionIdentity('A');
    token = userJwt('A');
    endSession(); // o servidor ainda não respondeu ao logout
    expect((await db.from('items').select('*')).error?.message).toContain('SessionFenceError');
    expect((await db.from('items').insert([{ name: 'x' }]).select()).error?.message).toContain('SessionFenceError');
    expect(backend.seen).toHaveLength(0);
  });

  it('sessão expirada / logout: requisições saem anônimas (a RLS nega) e a barreira não as atribui a ninguém', async () => {
    const backend = fakeBackend();
    const db = makeClient(backend);
    commitSessionIdentity('A');
    trackSessionOperation(captureSession(), new Promise(() => undefined));
    endSession();
    token = null;
    const read = await db.from('items').select('*');
    expect(read.error).toBeNull();
    expect(backend.seen.at(-1)?.sub).toBeNull();
  });

  it('falha de rede continua chegando como erro normal do cliente', async () => {
    const db = createClient(URL_BASE, ANON, {
      accessToken: async () => userJwt('A'),
      global: { fetch: createSessionFencedFetch(URL_BASE, async () => { throw new TypeError('Failed to fetch'); }) },
    });
    commitSessionIdentity('A');
    const r = await db.from('items').select('*');
    expect(r.error?.message).toContain('Failed to fetch');
  });
});
