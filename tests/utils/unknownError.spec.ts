import { describe, expect, it } from 'vitest';
import { unknownErrorMessage } from '../../src/utils/unknownError';

describe('unknownErrorMessage', () => {
  it('preserva a mensagem de Error', () => {
    expect(unknownErrorMessage(new Error('falha nativa'))).toBe('falha nativa');
  });

  it('expõe campos úteis de um erro do PostgREST', () => {
    expect(
      unknownErrorMessage({
        message: 'violação de restrição',
        details: 'a linha já existe',
        hint: 'use a chave original',
        code: '23505',
      })
    ).toBe(
      'violação de restrição Detalhes: a linha já existe Sugestão: use a chave original Código: 23505'
    );
  });

  it('não devolve [object Object] para objetos desconhecidos', () => {
    expect(unknownErrorMessage({ reason: 'indisponível' })).toBe('{"reason":"indisponível"}');
  });
});
