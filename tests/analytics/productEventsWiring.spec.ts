import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  getUser: vi.fn(),
  insertAccount: vi.fn(),
}));
vi.mock('../../src/services/productAnalytics', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/productAnalytics')>(
    '../../src/services/productAnalytics'
  );
  return { ...actual, trackProductEvent: mocks.track };
});
vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      if (table !== 'contas') throw new Error(`tabela inesperada: ${table}`);
      return { insert: mocks.insertAccount };
    },
  },
}));

import { useAppStore } from '../../src/hooks/useAppStore';
import { getFirstStepsState } from '../../src/domain/onboarding/firstSteps';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

describe('account_created — só depois de a conta existir no banco', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  });

  it('sucesso: um evento, sem nada da conta', async () => {
    mocks.insertAccount.mockReturnValue({
      select: async () => ({ data: [{ id: 'a1', Nome_Conta: 'Minha Conta', Tipo_Conta: 'Conta Corrente' }], error: null }),
    });
    await useAppStore.getState().addAccount({ Nome_Conta: 'Minha Conta', Tipo_Conta: 'Conta Corrente' } as never);
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith('account_created');
  });

  it('erro do banco: nenhum evento', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.insertAccount.mockReturnValue({ select: async () => ({ data: null, error: { message: 'falhou' } }) });
    await useAppStore.getState().addAccount({ Nome_Conta: 'X', Tipo_Conta: 'Conta Corrente' } as never);
    expect(mocks.track).not.toHaveBeenCalled();
  });
});

describe('first_dashboard_with_real_data — demo não conta', () => {
  it('só dado real aciona a condição que o Dashboard usa', () => {
    const demo = { Origem: 'demo.csv', Fonte: 'Demo', Categoria: 'X' };
    const real = { Origem: 'extrato.csv', Fonte: 'Nubank', Categoria: 'X' };
    expect(getFirstStepsState({ ready: true, transactions: [demo, demo], metadata: {} }).hasRealData).toBe(false);
    expect(getFirstStepsState({ ready: true, transactions: [demo, real], metadata: {} }).hasRealData).toBe(true);
  });

  it('o efeito do Dashboard exige dados carregados E dado real, com o milestone idempotente', () => {
    const dashboard = read('src/components/views/DashboardView.tsx');
    expect(dashboard).toContain("if (initialDataLoadStatus === 'ready' && firstSteps.hasRealData) {");
    expect(dashboard).toContain("trackProductMilestone('first_dashboard_with_real_data')");
    expect(dashboard).toContain("if (firstSteps.visible) void trackProductMilestone('onboarding_viewed', { version: 1 });");
  });
});

describe('fiação dos demais eventos (contrato)', () => {
  const dashboard = read('src/components/views/DashboardView.tsx');
  const imports = read('src/components/views/ImportView.tsx');
  const transactions = read('src/components/views/TransactionsView.tsx');
  const app = read('src/App.tsx');

  it('dismiss e resume só no clique de "Agora não" / "Retomar"; concluir o passo 3 não é dispensar', () => {
    expect(dashboard).toContain("if (firstSteps.phase !== 'view') void trackProductEvent('onboarding_dismissed', { version: 1 });");
    expect(dashboard).toContain("void trackProductEvent('onboarding_resumed', { version: 1 });");
    expect(dashboard).toContain('onDismiss={handleFirstStepsDismiss}');
    expect(dashboard).toContain('onClick={handleFirstStepsResume}');
  });

  it('lançamento manual: depois de gravar, nos dois lugares que criam', () => {
    for (const source of [dashboard, transactions]) {
      const gravou = source.indexOf('await addTransaction(payloads.length === 1 ? payloads[0] : payloads);');
      const evento = source.indexOf("trackProductEvent('manual_transaction_created')", gravou);
      expect(gravou).toBeGreaterThan(0);
      expect(evento).toBeGreaterThan(gravou);
    }
  });

  it('importação: começa nos dois processadores; concluída só se entrou linha; falha com estágio da lista', () => {
    expect(imports.split("void trackProductEvent('import_started');").length - 1).toBe(2);
    expect(imports.split("if (importResult.imported > 0) void trackProductEvent('import_completed');").length - 1).toBe(2);
    expect(imports.split("void trackProductEvent('import_failed', { stage: failureStage });").length - 1).toBe(2);
    for (const stage of ['file', 'parse', 'mapping', 'quota']) {
      expect(imports).toContain(`trackProductEvent('import_failed', { stage: '${stage}' })`);
    }
    expect(imports).toContain("failureStage = 'persist';");
  });

  it('Open Finance: depois dos gates Premium, quando o fluxo prossegue', () => {
    const gate = imports.indexOf("setShowPaywallModal('extra_bank'); return; }");
    const evento = imports.indexOf("trackProductEvent('open_finance_started')");
    expect(gate).toBeGreaterThan(0);
    expect(evento).toBeGreaterThan(gate);
  });

  it('Open Finance: só depois de gravar (resultado de confirmReviewedTransactions), antes do callback, sem await', () => {
    const modal = read('src/components/modals/OpenFinanceReviewModal.tsx');
    const confirmou = modal.indexOf('await confirmReviewedTransactions(');
    const evento = modal.indexOf('void trackOpenFinanceCompleted(res);', confirmou);
    const callback = modal.indexOf('onSuccess(res.inserted, res.merged);', confirmou);
    expect(confirmou).toBeGreaterThan(0);
    expect(evento).toBeGreaterThan(confirmou);
    expect(callback).toBeGreaterThan(evento);
    expect(modal.split('trackOpenFinanceCompleted').length - 1).toBe(2);
  });

  it('a sessão registra o evento junto com a atividade do usuário', () => {
    expect(app).toContain('if (isAuthReady && user?.id) void trackAppSessionStarted();');
    // import + efeito: o ouvinte de auth não chama mais (a sessão restaurada na carga nunca chegava ali)
    expect(app.split('trackAppSessionStarted').length - 1).toBe(2);
  });
});

describe('revisão de privacidade: toda chamada de tracking do código', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /[.]tsx?$/.test(name) ? [full] : [];
    });

  const files = walk('src').filter((f) => !f.replace(/[\\]/g, '/').endsWith('services/productAnalytics.ts'));
  const calls = files.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const found = [...source.matchAll(/(trackProductEvent|trackProductMilestone)\(([^)]*)\)/g)];
    return found.map((m) => ({ file, fn: m[1], args: m[2].trim() }));
  });

  it('existem chamadas (o teste não está vazio)', () => {
    expect(calls.length).toBeGreaterThanOrEqual(15);
  });

  it('cada chamada tem só o nome do evento e, no máximo, { version: 1 } ou { stage: <lista> }', () => {
    const nome = "'[a-z_]+'";
    const aceitas = [
      new RegExp(`^${nome}$`),
      new RegExp(`^${nome}, \\{ version: 1 \\}$`),
      new RegExp(`^${nome}, \\{ stage: ('(file|parse|mapping|persist|quota|unknown)'|failureStage) \\}$`),
    ];
    for (const call of calls) {
      expect(aceitas.some((re) => re.test(call.args)), `${call.file}: ${call.fn}(${call.args})`).toBe(true);
    }
  });

  it('só eventos do contrato v1 são usados', () => {
    const permitidos = new Set([
      'onboarding_viewed', 'onboarding_dismissed', 'onboarding_resumed', 'account_created', 'import_started',
      'import_completed', 'import_failed', 'manual_transaction_created', 'open_finance_started', 'open_finance_completed',
      'first_dashboard_with_real_data',
    ]);
    for (const call of calls) {
      const nome = /^'([a-z_]+)'/.exec(call.args)?.[1] ?? '';
      expect(permitidos.has(nome), `${call.file}: ${nome}`).toBe(true);
    }
  });
});
