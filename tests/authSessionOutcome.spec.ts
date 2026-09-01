import { describe, expect, it } from 'vitest';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from '@supabase/supabase-js';
import { classifyAuthInit, shouldDeferStartupAuthEvent } from '../src/utils/authSessionOutcome';

describe('classifyAuthInit', () => {
  it('libera conteúdo protegido quando o servidor validou o token', () => {
    expect(classifyAuthInit(true, null)).toBe('authenticated');
  });

  it('preserva a sessão persistida quando a rede falha', () => {
    const offline = new AuthRetryableFetchError('Failed to fetch', 0);
    expect(classifyAuthInit(false, offline)).toBe('offline-fallback');
  });

  it('não desloga em erro de rede mesmo com HTTP 5xx do gateway', () => {
    const unavailable = new AuthRetryableFetchError('Service temporarily unavailable', 503);
    expect(classifyAuthInit(false, unavailable)).toBe('offline-fallback');
  });

  // 403/bad_jwt é o que o Supabase Auth devolveu de fato para um token forjado
  // durante a homologação em staging; 401 cobre a variante por token expirado.
  it.each([403, 401])('purga a credencial quando o Supabase Auth recusa o token (HTTP %i)', (status) => {
    const rejected = new AuthApiError('invalid claim: missing sub claim', status, 'bad_jwt');
    expect(classifyAuthInit(false, rejected)).toBe('rejected');
  });

  it('trata visitante sem sessão como anônimo, sem nada a purgar', () => {
    expect(classifyAuthInit(false, new AuthSessionMissingError())).toBe('anonymous');
    expect(classifyAuthInit(false, null)).toBe('anonymous');
  });

  it('nunca considera autenticado um retorno sem usuário', () => {
    const outcomes = [
      classifyAuthInit(false, null),
      classifyAuthInit(false, new AuthSessionMissingError()),
      classifyAuthInit(false, new AuthApiError('bad jwt', 403, 'bad_jwt')),
      classifyAuthInit(false, new AuthRetryableFetchError('Failed to fetch', 0)),
    ];
    expect(outcomes).not.toContain('authenticated');
  });

  it('não confia no usuário quando o servidor devolveu erro junto', () => {
    const rejected = new AuthApiError('bad jwt', 403, 'bad_jwt');
    expect(classifyAuthInit(true, rejected)).toBe('rejected');
  });
});

describe('shouldDeferStartupAuthEvent', () => {
  // Homologação em staging: com um token forjado no storage, INITIAL_SESSION e
  // SIGNED_IN chegaram em ~2ms enquanto o getUser() só respondeu 403 em ~405ms.
  // Sem adiar esses eventos, o app liberava conteúdo protegido durante a janela.
  it.each(['INITIAL_SESSION', 'SIGNED_IN'])(
    'adia %s enquanto o servidor não validou a sessão',
    (event) => {
      expect(shouldDeferStartupAuthEvent(event, false)).toBe(true);
    }
  );

  it.each(['INITIAL_SESSION', 'SIGNED_IN'])(
    'processa %s normalmente depois da validação inicial',
    (event) => {
      expect(shouldDeferStartupAuthEvent(event, true)).toBe(false);
    }
  );

  // SIGNED_OUT e PASSWORD_RECOVERY só restringem ou desviam o acesso, então
  // adiá-los na partida não protege nada e atrasaria o redirecionamento.
  it.each(['SIGNED_OUT', 'PASSWORD_RECOVERY', 'TOKEN_REFRESHED', 'USER_UPDATED'])(
    'nunca adia %s',
    (event) => {
      expect(shouldDeferStartupAuthEvent(event, false)).toBe(false);
      expect(shouldDeferStartupAuthEvent(event, true)).toBe(false);
    }
  );
});
