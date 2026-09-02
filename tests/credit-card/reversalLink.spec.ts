import { describe, expect, it } from 'vitest';
import { foiRevertida } from '../../supabase/functions/card-reconciliation/reversalLink.ts';

/**
 * Regressão de um bug que passou em silêncio.
 *
 * O desfazer gravava a linha de reversão, a trilha de auditoria ficava correta,
 * e o número não mudava: a Edge continuava contando a resolução revertida. O
 * usuário via a confirmação e seguia com o valor resolvido.
 *
 * A causa foi uma mudança de CARDINALIDADE inferida pelo PostgREST. O índice
 * único sobre `resolution_id` — criado para impedir reverter duas vezes —
 * transformou a relação em «para um», e o vínculo passou a chegar como objeto
 * ou `null` em vez de array.
 */

describe('vínculo de reversão', () => {
  it('ausente significa não revertida', () => {
    expect(foiRevertida(null)).toBe(false);
    expect(foiRevertida(undefined)).toBe(false);
  });

  /** Forma «para um», que é como o PostgREST responde HOJE. */
  it('objeto significa revertida', () => {
    expect(foiRevertida({ id: '6e701d9d-4327-4d4f-b199-5291ae3b35a6' })).toBe(true);
  });

  /** Forma «para muitos», que é como respondia ANTES do índice único. */
  it('array não vazio significa revertida; vazio, não', () => {
    expect(foiRevertida([{ id: 'x' }])).toBe(true);
    expect(foiRevertida([])).toBe(false);
  });

  /** Nenhuma das duas formas pode depender de qual o PostgREST escolheu. */
  it('as duas formas concordam', () => {
    expect(foiRevertida({ id: 'x' })).toBe(foiRevertida([{ id: 'x' }]));
    expect(foiRevertida(null)).toBe(foiRevertida([]));
  });
});
