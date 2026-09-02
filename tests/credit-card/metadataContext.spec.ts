import { describe, expect, it } from 'vitest';
import {
  metadataCanonical,
  metadataContextToken,
  normalizeClassifierKeywords,
} from '../../src/domain/credit-card/metadataContext';

/**
 * O token das palavras-chave.
 *
 * A promessa que estes testes protegem: o token muda quando — e só quando — as
 * palavras que o motor consome mudam. Se ele mudar de menos, um snapshot
 * calculado com um conjunto de palavras passa a valer para outro, e o número
 * exibido deixa de corresponder à regra que o produziu.
 */

const token = (meta: unknown) => metadataContextToken(meta);

describe('normalização das palavras', () => {
  it('só array produz palavras', () => {
    expect(normalizeClassifierKeywords(['pagamento'])).toEqual(['pagamento']);
    expect(normalizeClassifierKeywords('pagamento')).toEqual([]);
    expect(normalizeClassifierKeywords({ 0: 'pagamento' })).toEqual([]);
    expect(normalizeClassifierKeywords(null)).toEqual([]);
    expect(normalizeClassifierKeywords(undefined)).toEqual([]);
  });

  it('descarta o que não é string e apara o que é', () => {
    expect(normalizeClassifierKeywords(['  pagamento  ', 123, null, true, ['x'], { a: 1 }, ''])).toEqual([
      'pagamento',
    ]);
  });

  it('preserva ordem e duplicatas', () => {
    expect(normalizeClassifierKeywords(['b', 'a', 'b'])).toEqual(['b', 'a', 'b']);
  });
});

describe('forma canônica', () => {
  it('as duas listas ocupam posições distintas', () => {
    expect(metadataCanonical({ cardPaymentKeywords: ['p'], cardCreditKeywords: ['c'] })).toBe(
      'v1|p:["p"]|c:["c"]'
    );
  });

  it('metadata ausente ou vazio dá a mesma forma', () => {
    const vazio = 'v1|p:[]|c:[]';
    expect(metadataCanonical({})).toBe(vazio);
    expect(metadataCanonical(null)).toBe(vazio);
    expect(metadataCanonical(undefined)).toBe(vazio);
    expect(metadataCanonical({ cardPaymentKeywords: [], cardCreditKeywords: [] })).toBe(vazio);
  });

  it('chaves que o motor não consome não entram', () => {
    expect(metadataCanonical({ theme: 'dark', cardPaymentKeywords: ['p'] })).toBe(
      metadataCanonical({ cardPaymentKeywords: ['p'] })
    );
  });

  /** Uma palavra contendo `","` não pode fingir ser duas. */
  it('cada palavra vai escapada', () => {
    expect(metadataCanonical({ cardPaymentKeywords: ['a","b'] })).toBe('v1|p:["a\\",\\"b"]|c:[]');
    expect(metadataCanonical({ cardPaymentKeywords: ['a', 'b'] })).not.toBe(
      metadataCanonical({ cardPaymentKeywords: ['a","b'] })
    );
  });

  it('a versão da normalização faz parte da forma', () => {
    expect(metadataCanonical({})).toMatch(/^v1\|/);
  });
});

describe('o token muda quando as palavras mudam', () => {
  it('gravar palavras muda o token', async () => {
    expect(await token({})).not.toBe(await token({ cardPaymentKeywords: ['pagamento'] }));
  });

  it('regravar as mesmas palavras não muda o token', async () => {
    const meta = { cardPaymentKeywords: ['pagamento fatura'], cardCreditKeywords: ['estorno'] };
    expect(await token(meta)).toBe(await token({ ...meta }));
  });

  it('mexer em chave não consumida não muda o token', async () => {
    const meta = { cardPaymentKeywords: ['pagamento'] };
    expect(await token(meta)).toBe(await token({ ...meta, theme: 'dark' }));
  });

  /** Se as duas listas fossem concatenadas, trocá-las de lugar passaria batido. */
  it('trocar as duas listas de lugar muda o token', async () => {
    expect(await token({ cardPaymentKeywords: ['a'], cardCreditKeywords: ['b'] })).not.toBe(
      await token({ cardPaymentKeywords: ['b'], cardCreditKeywords: ['a'] })
    );
  });

  it('reordenar as palavras muda o token', async () => {
    expect(await token({ cardPaymentKeywords: ['a', 'b'] })).not.toBe(
      await token({ cardPaymentKeywords: ['b', 'a'] })
    );
  });

  it('espaço em volta não muda o token, porque o motor também apara', async () => {
    expect(await token({ cardPaymentKeywords: ['  pagamento  '] })).toBe(
      await token({ cardPaymentKeywords: ['pagamento'] })
    );
  });
});

describe('o token é um hash', () => {
  it('é hexadecimal de 64 caracteres', async () => {
    expect(await token({ cardPaymentKeywords: ['pagamento'] })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('não devolve as palavras', async () => {
    expect(await token({ cardPaymentKeywords: ['pagamento'] })).not.toContain('pagamento');
  });
});
