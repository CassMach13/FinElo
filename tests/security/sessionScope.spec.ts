import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureSession,
  commitSessionIdentity,
  endSession,
  getActiveSessionUserId,
  getSessionEpoch,
  hasPendingOperationFromOtherIdentity,
  observeSessionInstance,
  onSessionTransition,
  pendingSessionOperations,
  readBearerIdentity,
  resetSessionScopeForTests,
  trackSessionOperation,
} from '../../src/domain/session/sessionScope';
import { fakeJwt } from '../helpers/fakeJwt';

beforeEach(() => resetSessionScopeForTests());

describe('geração da sessão (epoch)', () => {
  it('A → B invalida o ticket de A', () => {
    commitSessionIdentity('A');
    const a = captureSession();
    commitSessionIdentity('B');
    expect(a.isCurrent()).toBe(false);
    expect(captureSession().isCurrent()).toBe(true);
  });

  it('A → B → A não reabilita o ticket da primeira sessão de A', () => {
    commitSessionIdentity('A');
    const first = captureSession();
    commitSessionIdentity('B');
    commitSessionIdentity('A');
    const second = captureSession();
    expect(first.userId).toBe(second.userId);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    expect(second.epoch).toBeGreaterThan(first.epoch);
  });

  it('logout → novo login do mesmo usuário abre outra geração', () => {
    commitSessionIdentity('A');
    const before = captureSession();
    endSession();
    expect(getActiveSessionUserId()).toBeNull();
    commitSessionIdentity('A');
    expect(before.isCurrent()).toBe(false);
  });

  it('renovação de token / metadados do mesmo usuário NÃO muda a geração', () => {
    commitSessionIdentity('A');
    observeSessionInstance('A', 'sess-1');
    const ticket = captureSession();
    const epoch = getSessionEpoch();
    expect(commitSessionIdentity('A')).toBe(false);
    expect(observeSessionInstance('A', 'sess-1')).toBe(false);
    expect(getSessionEpoch()).toBe(epoch);
    expect(ticket.isCurrent()).toBe(true);
  });

  it('nova instância de login do mesmo usuário (novo session_id) invalida a anterior', () => {
    commitSessionIdentity('A');
    observeSessionInstance('A', 'sess-1');
    const ticket = captureSession();
    expect(observeSessionInstance('A', 'sess-2')).toBe(true);
    expect(ticket.isCurrent()).toBe(false);
  });

  it('instância de outro usuário que não o ativo é ignorada (a troca de identidade é quem decide)', () => {
    commitSessionIdentity('A');
    const ticket = captureSession();
    expect(observeSessionInstance('B', 'sess-x')).toBe(false);
    expect(ticket.isCurrent()).toBe(true);
  });

  it('cada transição chama a limpeza central registrada, com a identidade anterior', () => {
    const seen: Array<[string | null, string | null]> = [];
    const off = onSessionTransition(({ userId, previousUserId }) => seen.push([previousUserId, userId]));
    commitSessionIdentity('A');
    commitSessionIdentity('B');
    endSession();
    off();
    commitSessionIdentity('C');
    expect(seen).toEqual([[null, 'A'], ['A', 'B'], ['B', null]]);
  });

  it('uma limpeza que falha não impede as demais', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const second = vi.fn();
    const off1 = onSessionTransition(() => {
      throw new Error('boom');
    });
    const off2 = onSessionTransition(second);
    commitSessionIdentity('A');
    expect(second).toHaveBeenCalledTimes(1);
    off1();
    off2();
    err.mockRestore();
  });
});

describe('operações em voo por identidade', () => {
  it('registra até terminar, inclusive em falha', async () => {
    commitSessionIdentity('A');
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const ok = trackSessionOperation(captureSession(), new Promise<void>((r) => (resolve = r)), 'ok');
    const bad = trackSessionOperation(captureSession(), new Promise<void>((_, r) => (reject = r)), 'bad');
    expect(pendingSessionOperations()).toHaveLength(2);
    commitSessionIdentity('B');
    expect(hasPendingOperationFromOtherIdentity('B')).toBe(true);
    expect(hasPendingOperationFromOtherIdentity('A')).toBe(false);
    resolve();
    reject(new Error('x'));
    await ok;
    await expect(bad).rejects.toThrow('x');
    await Promise.resolve();
    expect(pendingSessionOperations()).toHaveLength(0);
    expect(hasPendingOperationFromOtherIdentity('B')).toBe(false);
  });

  it('operação iniciada sem usuário não é rastreada', () => {
    trackSessionOperation(captureSession(), new Promise(() => undefined));
    expect(pendingSessionOperations()).toHaveLength(0);
  });
});

describe('leitura do portador', () => {
  it('extrai sub e session_id de um JWT de usuário', () => {
    expect(readBearerIdentity(fakeJwt({ sub: 'u1', session_id: 's1', role: 'authenticated' }))).toEqual({ sub: 'u1', sessionId: 's1' });
  });
  it('chave anônima/publicável não é identidade de usuário', () => {
    expect(readBearerIdentity(fakeJwt({ role: 'anon', iss: 'supabase' }))).toBeNull();
    expect(readBearerIdentity('sb_publishable_abc123')).toBeNull();
    expect(readBearerIdentity('')).toBeNull();
    expect(readBearerIdentity('a.%%%.c')).toBeNull();
  });
});
