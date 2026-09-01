import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import {
  isAtomicImportEnabled,
  isCardV2Enabled,
  isCardV2ShadowEnabled,
  isCreditCardEngineEnabled,
  isSmartTransactionFiltersEnabled,
  resolveAtomicImportEnabled,
} from '../src/services/featureFlagService';

const user = (overrides: Partial<User> = {}): User => ({
  id: '00000000-0000-4000-8000-000000000001',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isAtomicImportEnabled', () => {
  it('permanece desligada por padrão', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    expect(isAtomicImportEnabled(user())).toBe(false);
    expect(isAtomicImportEnabled(null)).toBe(false);
  });

  it('habilita somente a conta piloto por app_metadata com a flag global desligada', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    expect(isAtomicImportEnabled(user({
      app_metadata: { atomic_imports_enabled: true },
    }))).toBe(true);
  });

  it('não habilita por e-mail quando os metadados e a flag global estão desligados', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');

    expect(isAtomicImportEnabled(user({ email: 'CASSIOMQ@GMAIL.COM' }))).toBe(false);
    expect(isAtomicImportEnabled(user({ email: 'outro@finelo.invalid' }))).toBe(false);
  });

  it('permite rollback administrativo explícito mesmo na conta piloto', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');

    expect(isAtomicImportEnabled(user({
      email: 'cassiomq@gmail.com',
      app_metadata: { atomic_imports_enabled: false },
    }))).toBe(false);
  });

  it('não aceita opt-in vindo de user_metadata', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    expect(isAtomicImportEnabled(user({
      user_metadata: { atomic_imports_enabled: true },
    }))).toBe(false);
  });

  it('permite ativação global quando não existe opt-out', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');
    expect(isAtomicImportEnabled(user())).toBe(true);
  });

  it('opt-out administrativo prevalece sobre piloto e ativação global', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');
    expect(isAtomicImportEnabled(user({
      app_metadata: {
        atomic_imports_enabled: true,
        atomic_imports_disabled: true,
      },
    }))).toBe(false);
  });

  it('mantém o opt-out legado do usuário como desligamento de emergência', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');
    expect(isAtomicImportEnabled(user({
      user_metadata: { atomic_imports_disabled: true },
    }))).toBe(false);
  });
});

describe('isSmartTransactionFiltersEnabled', () => {
  it('permanece desligada por padrão e sem usuário autenticado', () => {
    vi.stubEnv('VITE_SMART_TRANSACTION_FILTERS_ENABLED', 'false');
    expect(isSmartTransactionFiltersEnabled(user())).toBe(false);
    expect(isSmartTransactionFiltersEnabled(null)).toBe(false);
  });

  it('permite Preview/Staging global sem exigir migration', () => {
    vi.stubEnv('VITE_SMART_TRANSACTION_FILTERS_ENABLED', 'true');
    expect(isSmartTransactionFiltersEnabled(user())).toBe(true);
  });

  it('habilita uma conta piloto por metadado individual', () => {
    vi.stubEnv('VITE_SMART_TRANSACTION_FILTERS_ENABLED', 'false');
    expect(isSmartTransactionFiltersEnabled(user({
      app_metadata: { smart_transaction_filters_enabled: true },
    }))).toBe(true);
  });

  it('não permite que user_metadata habilite o piloto administrativo', () => {
    vi.stubEnv('VITE_SMART_TRANSACTION_FILTERS_ENABLED', 'false');
    expect(isSmartTransactionFiltersEnabled(user({
      user_metadata: { smart_transaction_filters_enabled: true },
    }))).toBe(false);
  });

  it('opt-out administrativo prevalece sobre opt-in e flag global', () => {
    vi.stubEnv('VITE_SMART_TRANSACTION_FILTERS_ENABLED', 'true');
    expect(isSmartTransactionFiltersEnabled(user({
      app_metadata: {
        smart_transaction_filters_enabled: true,
        smart_transaction_filters_disabled: true,
      },
    }))).toBe(false);
  });
});

describe('resolveAtomicImportEnabled', () => {
  it('lê o opt-in atual diretamente do servidor mesmo com JWT sem a flag', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    const readServerFlag = vi.fn().mockResolvedValue({ data: 'enabled', error: null });

    await expect(resolveAtomicImportEnabled(user(), readServerFlag)).resolves.toBe(true);
    expect(readServerFlag).toHaveBeenCalledOnce();
  });

  it('aceita o rollback atual do servidor mesmo quando o JWT ainda contém opt-in antigo', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    const readServerFlag = vi.fn().mockResolvedValue({ data: 'disabled', error: null });

    await expect(resolveAtomicImportEnabled(user({
      app_metadata: { atomic_imports_enabled: true },
    }), readServerFlag)).resolves.toBe(false);
  });

  it('mantém desligado quando a consulta de servidor falha', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');

    await expect(resolveAtomicImportEnabled(user(), async () => ({
      data: null,
      error: { message: 'função indisponível' },
    }))).resolves.toBe(false);

    await expect(resolveAtomicImportEnabled(user(), async () => {
      throw new Error('rede indisponível');
    })).resolves.toBe(false);
  });

  it('aceita ativação atual do servidor mesmo quando o JWT ainda contém rollback antigo', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    const readServerFlag = vi.fn().mockResolvedValue({ data: 'enabled', error: null });

    await expect(resolveAtomicImportEnabled(user({
      app_metadata: { atomic_imports_enabled: false },
    }), readServerFlag)).resolves.toBe(true);
    expect(readServerFlag).toHaveBeenCalledOnce();
  });

  it('preserva a ativação global de staging quando não há opt-out', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');
    const readServerFlag = vi.fn().mockResolvedValue({ data: 'unset', error: null });

    await expect(resolveAtomicImportEnabled(user(), readServerFlag)).resolves.toBe(true);
    expect(readServerFlag).toHaveBeenCalledOnce();
  });

  it('faz o opt-out administrativo do servidor prevalecer sobre a ativação global', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');

    await expect(resolveAtomicImportEnabled(user(), async () => ({
      data: 'disabled',
      error: null,
    }))).resolves.toBe(false);
  });
});

/**
 * As flags de cartão nasceram no commit fundador do motor comparando o e-mail do usuário
 * com um endereço fixo. Isso embutia a conta piloto no bundle publicado e criava um
 * caminho de código exclusivo dela. Passaram a seguir o mesmo padrão já validado em
 * `isAtomicImportEnabled`: metadado + ambiente, nunca e-mail.
 */
const EMAIL_QUE_JA_FOI_PILOTO = 'cassiomq@gmail.com';

describe('flags de cartão não consultam e-mail', () => {
  const semAmbiente = () => {
    vi.stubEnv('VITE_CARD_ENGINE_FORCE', 'false');
    vi.stubEnv('VITE_CARD_V2_FORCE', 'false');
    vi.stubEnv('VITE_CARD_V2_SHADOW_FORCE', 'false');
    vi.stubEnv('VITE_CARD_V2_ROLLOUT_PERCENT', '0');
  };

  it('o e-mail que já foi piloto não habilita mais nada sozinho', () => {
    semAmbiente();
    const piloto = user({ email: EMAIL_QUE_JA_FOI_PILOTO });

    expect(isCreditCardEngineEnabled(piloto)).toBe(false);
    expect(isCardV2Enabled(piloto)).toBe(false);
    expect(isCardV2ShadowEnabled(piloto)).toBe(false);
  });

  it('dois usuários com os mesmos metadados recebem o mesmo resultado, independente do e-mail', () => {
    semAmbiente();
    const a = user({ email: EMAIL_QUE_JA_FOI_PILOTO, app_metadata: { credit_card_engine_enabled: true } });
    const b = user({ email: 'outra.pessoa@exemplo.com', app_metadata: { credit_card_engine_enabled: true } });

    expect(isCreditCardEngineEnabled(a)).toBe(isCreditCardEngineEnabled(b));
    expect(isCreditCardEngineEnabled(a)).toBe(true);
  });
});

describe('isCreditCardEngineEnabled', () => {
  const semAmbiente = () => vi.stubEnv('VITE_CARD_ENGINE_FORCE', 'false');

  it('permanece desligada por padrão', () => {
    semAmbiente();
    expect(isCreditCardEngineEnabled(user())).toBe(false);
  });

  it('sem usuário autenticado permanece desligada', () => {
    vi.stubEnv('VITE_CARD_ENGINE_FORCE', 'true');
    expect(isCreditCardEngineEnabled(null)).toBe(false);
  });

  it('habilita a conta piloto por app_metadata', () => {
    semAmbiente();
    expect(
      isCreditCardEngineEnabled(user({ app_metadata: { credit_card_engine_enabled: true } }))
    ).toBe(true);
  });

  it('aceita o opt-in legado em user_metadata, por compatibilidade', () => {
    semAmbiente();
    expect(
      isCreditCardEngineEnabled(user({ user_metadata: { credit_card_engine_enabled: true } }))
    ).toBe(true);
  });

  it('opt-out administrativo prevalece sobre opt-in e sobre a flag global', () => {
    vi.stubEnv('VITE_CARD_ENGINE_FORCE', 'true');
    expect(
      isCreditCardEngineEnabled(
        user({
          app_metadata: { credit_card_engine_enabled: true, credit_card_engine_disabled: true },
        })
      )
    ).toBe(false);
  });

  it('permite ativação global pelo ambiente', () => {
    vi.stubEnv('VITE_CARD_ENGINE_FORCE', 'true');
    expect(isCreditCardEngineEnabled(user())).toBe(true);
  });
});

describe('isCardV2Enabled', () => {
  const semAmbiente = () => {
    vi.stubEnv('VITE_CARD_ENGINE_FORCE', 'false');
    vi.stubEnv('VITE_CARD_V2_FORCE', 'false');
    vi.stubEnv('VITE_CARD_V2_ROLLOUT_PERCENT', '0');
  };

  it('permanece desligada por padrão', () => {
    semAmbiente();
    expect(isCardV2Enabled(user())).toBe(false);
  });

  it('o motor novo, quando ligado, desliga o V2 na mesma conta', () => {
    semAmbiente();
    const comMotor = user({ app_metadata: { credit_card_engine_enabled: true, card_v2_enabled: true } });
    expect(isCreditCardEngineEnabled(comMotor)).toBe(true);
    expect(isCardV2Enabled(comMotor)).toBe(false);
  });

  it('habilita por metadado quando o motor está desligado', () => {
    semAmbiente();
    expect(isCardV2Enabled(user({ app_metadata: { card_v2_enabled: true } }))).toBe(true);
  });

  it('opt-out prevalece sobre opt-in', () => {
    semAmbiente();
    expect(
      isCardV2Enabled(user({ app_metadata: { card_v2_enabled: true, card_v2_disabled: true } }))
    ).toBe(false);
  });

  it('rollout percentual de 100 habilita todo mundo', () => {
    vi.stubEnv('VITE_CARD_ENGINE_FORCE', 'false');
    vi.stubEnv('VITE_CARD_V2_FORCE', 'false');
    vi.stubEnv('VITE_CARD_V2_ROLLOUT_PERCENT', '100');
    expect(isCardV2Enabled(user())).toBe(true);
  });
});

describe('isCardV2ShadowEnabled', () => {
  it('permanece desligada por padrão', () => {
    vi.stubEnv('VITE_CARD_V2_SHADOW_FORCE', 'false');
    expect(isCardV2ShadowEnabled(user())).toBe(false);
  });

  it('habilita por metadado', () => {
    vi.stubEnv('VITE_CARD_V2_SHADOW_FORCE', 'false');
    expect(
      isCardV2ShadowEnabled(user({ app_metadata: { card_v2_shadow_enabled: true } }))
    ).toBe(true);
  });

  it('opt-out prevalece até sobre a flag global do ambiente', () => {
    vi.stubEnv('VITE_CARD_V2_SHADOW_FORCE', 'true');
    expect(
      isCardV2ShadowEnabled(user({ app_metadata: { card_v2_shadow_disabled: true } }))
    ).toBe(false);
  });

  it('flag global do ambiente habilita quem não tem opt-out', () => {
    vi.stubEnv('VITE_CARD_V2_SHADOW_FORCE', 'true');
    expect(isCardV2ShadowEnabled(user())).toBe(true);
  });
});
