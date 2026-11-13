import { describe, expect, it } from 'vitest';
import {
  NoRowsWrittenError,
  REFUSED_MESSAGE,
  UNCERTAIN_MESSAGE,
  classifyThrownSave,
  isDefinitiveRefusal,
  persistedInStore,
  saveNewTransactions,
} from '../src/utils/transactionSaveOutcome';

const payload = (over: Record<string, unknown> = {}) => ({
  ID_Conta: 'acc-1',
  Nome_Fantasia: 'Padaria',
  Categoria: 'Alimentação',
  Tipo: 'Despesa' as 'Despesa' | 'Renda',
  Valor: -42.5,
  ...over,
});
const row = (id: string, over: Record<string, unknown> = {}) => ({ ID_Transacao: id, ...payload(over) });

/** Transporte sintético: nenhuma escrita real; o «store» é só um array. */
function harness(add: (p: unknown) => Promise<unknown[]>, initial: ReturnType<typeof row>[] = []) {
  let store = [...initial];
  return {
    calls: [] as unknown[],
    set(next: typeof store) {
      store = next;
    },
    deps(self: { calls: unknown[] }) {
      return {
        add: (p: unknown) => {
          self.calls.push(p);
          return add(p) as Promise<never>;
        },
        readTransactions: () => store,
      };
    },
  };
}

describe('saveNewTransactions — classificação do resultado', () => {
  it('linhas devolvidas na quantidade pedida = saved', async () => {
    const h = harness(async () => [row('t1')]);
    await expect(saveNewTransactions([payload()], h.deps(h))).resolves.toEqual({ status: 'saved' });
    expect(h.calls).toHaveLength(1);
  });

  it('lote recorrente/parcelado: uma chamada com todas as linhas; só saved se todas voltarem', async () => {
    const lote = [payload({ Valor: -10, Nome_Fantasia: 'TV (1/3)' }), payload({ Valor: -10, Nome_Fantasia: 'TV (2/3)' }), payload({ Valor: -10, Nome_Fantasia: 'TV (3/3)' })];
    const ok = harness(async (p) => (p as unknown[]).map((_, i) => row(`t${i}`)));
    await expect(saveNewTransactions(lote, ok.deps(ok))).resolves.toEqual({ status: 'saved' });
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]).toHaveLength(3);

    const parcial = harness(async () => [row('t0'), row('t1')]);
    const out = await saveNewTransactions(lote, parcial.deps(parcial));
    expect(out.status).toBe('uncertain');
    expect(parcial.calls).toHaveLength(1);
  });

  it('resposta vazia NÃO é sucesso', async () => {
    const h = harness(async () => []);
    const out = await saveNewTransactions([payload()], h.deps(h));
    expect(out).toEqual({ status: 'uncertain', message: UNCERTAIN_MESSAGE.create });
    expect(h.calls).toHaveLength(1); // sem reenvio
  });

  it('resposta vazia, mas a linha nova está no store = saved (o store prova)', async () => {
    const h = harness(async () => {
      h.set([row('novo')]);
      return [];
    });
    await expect(saveNewTransactions([payload()], h.deps(h))).resolves.toEqual({ status: 'saved' });
  });

  it('o store só prova com linhas NOVAS: uma igual já existente não conta', async () => {
    const h = harness(async () => [], [row('antiga')]);
    const out = await saveNewTransactions([payload()], h.deps(h));
    expect(out.status).toBe('uncertain');
  });

  it('erro estruturado do servidor = refused, nada gravado, sem reenvio', async () => {
    const h = harness(async () => {
      throw Object.assign(new Error('violates check'), { code: '23514' });
    });
    expect(await saveNewTransactions([payload()], h.deps(h))).toEqual({
      status: 'refused',
      message: REFUSED_MESSAGE.create,
    });
    expect(h.calls).toHaveLength(1);
  });

  it('falha de rede (sem SQLSTATE) = uncertain, sem reenvio', async () => {
    const h = harness(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await saveNewTransactions([payload()], h.deps(h))).status).toBe('uncertain');
    expect(h.calls).toHaveLength(1);
  });

  it('exceção tardia depois do insert (linhas já no store) = saved, não falha', async () => {
    const h = harness(async () => {
      h.set([row('t1')]);
      throw new Error('recálculo falhou depois do insert');
    });
    await expect(saveNewTransactions([payload()], h.deps(h))).resolves.toEqual({ status: 'saved' });
  });

  it('códigos de runtime não são recusa definitiva', () => {
    for (const code of ['ETIME', 'ECONNRESET', 'ETIMEDOUT', '', undefined]) {
      expect(isDefinitiveRefusal({ code })).toBe(false);
    }
    for (const code of ['23505', '42501', 'P0001', 'PGRST116']) {
      expect(isDefinitiveRefusal({ code })).toBe(true);
    }
    expect(isDefinitiveRefusal(null)).toBe(false);
    expect(isDefinitiveRefusal(new NoRowsWrittenError())).toBe(true);
  });

  it('persistedInStore compara por centavos e conta multiplicidade', () => {
    const before = new Set<string | undefined>();
    expect(persistedInStore(before, [payload({ Valor: -10.005 })], [row('a', { Valor: -10.01 })])).toBe(true);
    expect(persistedInStore(before, [payload(), payload()], [row('a')])).toBe(false);
    expect(persistedInStore(before, [], [row('a')])).toBe(false);
  });
});

describe('classifyThrownSave — edição', () => {
  it('recusa definitiva e nenhuma linha atualizada = refused; o resto = uncertain', () => {
    expect(classifyThrownSave({ code: '42501' }, 'edit').status).toBe('refused');
    expect(classifyThrownSave(new NoRowsWrittenError(), 'edit')).toEqual({
      status: 'refused',
      message: REFUSED_MESSAGE.edit,
    });
    expect(classifyThrownSave(new TypeError('Failed to fetch'), 'edit')).toEqual({
      status: 'uncertain',
      message: UNCERTAIN_MESSAGE.edit,
    });
  });
});
