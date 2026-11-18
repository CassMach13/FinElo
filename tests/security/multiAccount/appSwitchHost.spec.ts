/**
 * Etapa 2 — o anfitrião REAL da troca (app): troca concluída reinicia a página (nenhuma continuação da conta anterior
 * sobrevive); rollback recarrega os dados na mesma página. É essa reinicialização que fecha a janela das operações
 * de serviço/componente suspensas fora do cliente Supabase (ver switchConcurrency.spec.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appSwitchHost } from '../../../src/domain/session/accounts/appAccountSessions';
import { useAppStore } from '../../../src/hooks/useAppStore';

const settledWithin = async (p: Promise<unknown>, ms: number) => {
  let done = false;
  void p.then(() => (done = true), () => (done = true));
  await new Promise((r) => setTimeout(r, ms));
  return done;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Etapa 2 — anfitrião da troca no app', () => {
  it('troca concluída: reinicia a página e a promessa nunca resolve (a fase switching fica até a página sair)', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const fetchAllData = vi.fn(async () => undefined);
    useAppStore.setState({ fetchAllData } as never);
    const pending = appSwitchHost.reload('switched');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchAllData).not.toHaveBeenCalled();
    expect(await settledWithin(pending, 50)).toBe(false);
  });

  it('rollback: recarrega os dados da conta anterior na mesma página, sem reiniciá-la', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const fetchAllData = vi.fn(async () => undefined);
    useAppStore.setState({ fetchAllData } as never);
    await appSwitchHost.reload('rolled_back');
    expect(fetchAllData).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
