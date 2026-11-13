import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUSY_MESSAGE,
  DUPLICATE_WARNING,
  MAX_UNCERTAIN_ENTRIES,
  createSaveGuard,
  saveGuardFor,
  sessionUncertainMemory,
  submitTransactionSave,
} from '../src/utils/transactionSaveFlow';
import { TRANSACTION_DRAFT_TTL_MS } from '../src/utils/transactionDraftStorage';
import type { TransactionSaveOutcome } from '../src/utils/transactionSaveOutcome';

const SAVED: TransactionSaveOutcome = { status: 'saved' };
const REFUSED: TransactionSaveOutcome = { status: 'refused', message: 'recusado' };
const UNCERTAIN: TransactionSaveOutcome = { status: 'uncertain', message: 'incerto' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  return data;
}

describe('submitTransactionSave', () => {
  beforeEach(() => {
    stubStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('gravação confirmada: onSaved roda uma vez e o resultado é saved', async () => {
    const guard = createSaveGuard();
    const onSaved = vi.fn();
    const save = vi.fn(async () => SAVED);
    const result = await submitTransactionSave({ guard, key: 'k', save, confirmDuplicate: vi.fn(), onSaved });
    expect(result).toEqual(SAVED);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(guard.inflight).toBe(false);
  });

  it.each([REFUSED, UNCERTAIN])('%o: onSaved NÃO roda (rascunho e campos preservados)', async (outcome) => {
    const onSaved = vi.fn();
    const result = await submitTransactionSave({
      guard: createSaveGuard(),
      key: 'k',
      save: async () => outcome,
      confirmDuplicate: vi.fn(),
      onSaved,
    });
    expect(result).toEqual(outcome);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('o handler lançar exceção nunca vira sucesso', async () => {
    const onSaved = vi.fn();
    const result = await submitTransactionSave({
      guard: createSaveGuard(),
      key: 'k',
      save: async () => {
        throw new Error('boom');
      },
      confirmDuplicate: vi.fn(),
      onSaved,
    });
    expect(result.status).toBe('uncertain');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('clique duplo: uma única tentativa; o segundo envio recebe busy', async () => {
    const guard = createSaveGuard();
    const gate = deferred<TransactionSaveOutcome>();
    const save = vi.fn(() => gate.promise);
    const request = { guard, key: 'k', save, confirmDuplicate: vi.fn() };

    const first = submitTransactionSave(request);
    const second = await submitTransactionSave(request); // mesmo instante: o primeiro ainda está em voo
    const third = await submitTransactionSave(request);
    expect(second).toEqual({ status: 'busy', message: BUSY_MESSAGE });
    expect(third.status).toBe('busy');
    expect(save).toHaveBeenCalledTimes(1);

    gate.resolve(SAVED);
    await expect(first).resolves.toEqual(SAVED);
    expect(save).toHaveBeenCalledTimes(1);
    expect(guard.inflight).toBe(false);
  });

  it('o envio em voo vale entre aberturas do modal (mesmo guarda do usuário)', async () => {
    const gate = deferred<TransactionSaveOutcome>();
    const save = vi.fn(() => gate.promise);
    const a = submitTransactionSave({ guard: saveGuardFor('u-reopen'), key: 'k', save, confirmDuplicate: vi.fn() });
    // modal fechado e reaberto: novo componente, mesmo guarda
    const b = await submitTransactionSave({ guard: saveGuardFor('u-reopen'), key: 'k', save, confirmDuplicate: vi.fn() });
    expect(b.status).toBe('busy');
    expect(save).toHaveBeenCalledTimes(1);
    gate.resolve(SAVED);
    await a;
  });

  it('resultado incerto: nada é reenviado sozinho; novo envio idêntico exige confirmação', async () => {
    const guard = createSaveGuard();
    const save = vi.fn(async () => UNCERTAIN);
    const confirmDuplicate = vi.fn(async () => false);
    const request = { guard, key: 'mesmo-conteudo', save, confirmDuplicate };

    expect((await submitTransactionSave(request)).status).toBe('uncertain');
    expect(save).toHaveBeenCalledTimes(1); // nenhuma repetição automática

    // usuário tenta de novo e RECUSA o aviso de duplicidade: nada é enviado
    expect(await submitTransactionSave(request)).toEqual({ status: 'declined' });
    expect(confirmDuplicate).toHaveBeenCalledWith(DUPLICATE_WARNING);
    expect(save).toHaveBeenCalledTimes(1);

    // usuário confirma: só então vai a segunda tentativa
    confirmDuplicate.mockResolvedValueOnce(true);
    await submitTransactionSave(request);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('A incerto → B confirmado → A de novo: a confirmação de B NÃO encerra a dúvida de A (exige aviso)', async () => {
    const guard = createSaveGuard();
    const confirmDuplicate = vi.fn(async () => false);
    const save = vi.fn<[], Promise<TransactionSaveOutcome>>(async () => UNCERTAIN);

    expect((await submitTransactionSave({ guard, key: 'A', save, confirmDuplicate })).status).toBe('uncertain');

    // B é outro conteúdo: não pede confirmação e é confirmado
    save.mockResolvedValueOnce(SAVED);
    expect(await submitTransactionSave({ guard, key: 'B', save, confirmDuplicate })).toEqual(SAVED);
    expect(confirmDuplicate).not.toHaveBeenCalled();

    // A de novo: a dúvida sobre A continua, então o aviso de duplicidade é exigido (e recusado aqui)
    expect(guard.isUncertain('A')).toBe(true);
    expect(await submitTransactionSave({ guard, key: 'A', save, confirmDuplicate })).toEqual({ status: 'declined' });
    expect(confirmDuplicate).toHaveBeenCalledTimes(1);
    expect(confirmDuplicate).toHaveBeenCalledWith(DUPLICATE_WARNING);
    expect(save).toHaveBeenCalledTimes(2); // A uma vez, B uma vez; o reenvio de A não ocorreu
  });

  it('só a dúvida do lançamento confirmado se encerra: A confirmado limpa A e preserva B', async () => {
    const guard = createSaveGuard();
    const confirmDuplicate = vi.fn(async () => true);
    await submitTransactionSave({ guard, key: 'A', save: async () => UNCERTAIN, confirmDuplicate });
    await submitTransactionSave({ guard, key: 'B', save: async () => UNCERTAIN, confirmDuplicate });
    expect(guard.isUncertain('A')).toBe(true);
    expect(guard.isUncertain('B')).toBe(true);

    // o usuário confirma o aviso e A é gravado: a dúvida de A acaba, a de B não
    expect(await submitTransactionSave({ guard, key: 'A', save: async () => SAVED, confirmDuplicate })).toEqual(SAVED);
    expect(confirmDuplicate).toHaveBeenCalledTimes(1);
    expect(guard.isUncertain('A')).toBe(false);
    expect(guard.isUncertain('B')).toBe(true);
  });

  it('conteúdo sem dúvida anterior não pede confirmação', async () => {
    const guard = createSaveGuard();
    const confirmDuplicate = vi.fn(async () => true);
    await submitTransactionSave({ guard, key: 'A', save: async () => UNCERTAIN, confirmDuplicate });
    expect(await submitTransactionSave({ guard, key: 'C', save: async () => SAVED, confirmDuplicate })).toEqual(SAVED);
    expect(confirmDuplicate).not.toHaveBeenCalled();
  });

  it('recusa (nada gravado) não marca incerteza: tentar de novo não pede confirmação', async () => {
    const guard = createSaveGuard();
    const confirmDuplicate = vi.fn(async () => true);
    await submitTransactionSave({ guard, key: 'k', save: async () => REFUSED, confirmDuplicate });
    await submitTransactionSave({ guard, key: 'k', save: async () => SAVED, confirmDuplicate });
    expect(confirmDuplicate).not.toHaveBeenCalled();
  });

  it('edição (key null) é idempotente: nunca pede confirmação de duplicidade', async () => {
    const guard = createSaveGuard();
    const confirmDuplicate = vi.fn(async () => true);
    await submitTransactionSave({ guard, key: null, save: async () => UNCERTAIN, confirmDuplicate });
    await submitTransactionSave({ guard, key: null, save: async () => SAVED, confirmDuplicate });
    expect(confirmDuplicate).not.toHaveBeenCalled();
  });

  it('a memória é limitada: passando do máximo, a dúvida mais antiga é esquecida', () => {
    const guard = createSaveGuard();
    for (let i = 0; i < MAX_UNCERTAIN_ENTRIES + 1; i += 1) guard.markUncertain(`conteudo-${i}`);
    expect(guard.isUncertain('conteudo-0')).toBe(false);
    expect(guard.isUncertain('conteudo-1')).toBe(true);
    expect(guard.isUncertain(`conteudo-${MAX_UNCERTAIN_ENTRIES}`)).toBe(true);
  });

  it('cada dúvida expira no seu próprio prazo; marcar de novo renova só aquela', () => {
    let now = 1_000;
    const guard = createSaveGuard(undefined, () => now);
    guard.markUncertain('A');
    now += TRANSACTION_DRAFT_TTL_MS - 10;
    guard.markUncertain('B');
    now += 20; // A passou do prazo; B não
    expect(guard.isUncertain('A')).toBe(false);
    expect(guard.isUncertain('B')).toBe(true);
  });

  it('a lembrança de incerteza expira junto com o rascunho', () => {
    let now = 1_000;
    const guard = createSaveGuard(undefined, () => now);
    guard.markUncertain('k');
    expect(guard.isUncertain('k')).toBe(true);
    now += TRANSACTION_DRAFT_TTL_MS + 1;
    expect(guard.isUncertain('k')).toBe(false);
  });
});

describe('troca de conta — a lembrança de incerteza não atravessa usuários', () => {
  beforeEach(() => {
    stubStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a conta A fica incerta; a conta B, com o mesmo conteúdo, não é bloqueada nem avisada', async () => {
    const confirmDuplicate = vi.fn(async () => true);
    await submitTransactionSave({ guard: saveGuardFor('user-A'), key: 'x', save: async () => UNCERTAIN, confirmDuplicate });
    expect(saveGuardFor('user-A').isUncertain('x')).toBe(true);
    expect(saveGuardFor('user-B').isUncertain('x')).toBe(false);
    expect(sessionUncertainMemory('user-B').read()).toEqual([]);
    await submitTransactionSave({ guard: saveGuardFor('user-B'), key: 'x', save: async () => SAVED, confirmDuplicate });
    expect(confirmDuplicate).not.toHaveBeenCalled();
  });

  it('um envio em voo da conta A não bloqueia a conta B', async () => {
    const gate = deferred<TransactionSaveOutcome>();
    const a = submitTransactionSave({ guard: saveGuardFor('inflight-A'), key: 'k', save: () => gate.promise, confirmDuplicate: vi.fn() });
    const b = await submitTransactionSave({ guard: saveGuardFor('inflight-B'), key: 'k', save: async () => SAVED, confirmDuplicate: vi.fn() });
    expect(b).toEqual(SAVED);
    gate.resolve(SAVED);
    await a;
  });

  it('sobrevive a recarregar a página (sessionStorage), por usuário, com várias dúvidas', () => {
    const guard = createSaveGuard(sessionUncertainMemory('user-R'));
    guard.markUncertain('A');
    guard.markUncertain('B');
    guard.clearUncertain('B');
    const reloaded = createSaveGuard(sessionUncertainMemory('user-R'));
    expect(reloaded.isUncertain('A')).toBe(true);
    expect(reloaded.isUncertain('B')).toBe(false);
    expect(createSaveGuard(sessionUncertainMemory('user-S')).isUncertain('A')).toBe(false);
  });

  it('lê o formato anterior (uma única dúvida) sem perder a dúvida', () => {
    const probe = createSaveGuard(sessionUncertainMemory('user-L'));
    probe.markUncertain('legado');
    const [entry] = sessionUncertainMemory('user-L').read();
    // objeto único, como o formato anterior gravava
    sessionStorage.setItem('finelo_new_transaction_uncertain_v1:user-L', JSON.stringify(entry));
    expect(createSaveGuard(sessionUncertainMemory('user-L')).isUncertain('legado')).toBe(true);
  });
});
