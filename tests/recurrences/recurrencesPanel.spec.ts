import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RecurrencesPanel, {
  RECURRENCES_DISCLAIMER,
  RECURRENCES_EMPTY,
  RECURRENCES_EMPTY_HINT,
  RECURRENCES_INTRO,
  RECURRENCES_TITLE,
  describeUsualDay,
} from '../../src/components/transactions/RecurrencesPanel';
import {
  buildRecurrenceFilterPatch,
  getRecurrenceWindow,
  type RecurrenceCandidate,
} from '../../src/domain/recurrences/detectRecurrences';
import type { Transaction } from '../../src/types';
import {
  getDefaultTransactionFilters,
  matchesTransactionFilters,
  resolveTransactionFilters,
} from '../../src/utils/transactionPeriodFilters';

const candidate = (over: Partial<RecurrenceCandidate> = {}): RecurrenceCandidate => ({
  ownerUserId: 'u1',
  normalizedName: 'netflix',
  displayName: 'Netflix',
  occurrenceCount: 5,
  monthCount: 5,
  typicalAmount: 39.9,
  minAmount: 39.9,
  maxAmount: 39.9,
  amountPattern: 'stable',
  firstOccurrenceDate: '2026-05-10',
  lastOccurrenceDate: '2026-09-10',
  usualDay: { kind: 'exact', day: 10 },
  accountCount: 1,
  hasFutureRegistered: false,
  transactionIds: [],
  ...over,
});

const render = (candidates: RecurrenceCandidate[], extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(RecurrencesPanel, { candidates, onViewTransactions: () => {}, onClose: () => {}, ...extra })
  );

describe('RecurrencesPanel — textos', () => {
  it('título, introdução e esclarecimento de que são padrões, não cobranças confirmadas', () => {
    const html = render([candidate()]);
    expect(html).toContain('Possíveis gastos recorrentes');
    expect(RECURRENCES_TITLE).toBe('Possíveis gastos recorrentes');
    expect(html).toContain('O FinElo encontrou lançamentos que parecem se repetir mensalmente.');
    expect(RECURRENCES_INTRO).toContain('parecem se repetir');
    expect(html).toContain('São padrões detectados no seu histórico, não cobranças futuras confirmadas.');
    expect(RECURRENCES_DISCLAIMER).toContain('não cobranças futuras confirmadas');
  });

  it('nunca afirma assinatura, despesa fixa, previsão ou compromisso', () => {
    const html = render([
      candidate(),
      candidate({ displayName: 'Energia', normalizedName: 'energia', amountPattern: 'variable', minAmount: 100, maxAmount: 300, hasFutureRegistered: true, accountCount: 2 }),
    ]);
    const empty = render([]);
    const banned = /assinatura|despesa fixa|conta fixa|você paga todo m[êe]s|será cobrado|vai sair da sua conta|previst|comprometid|total mensal|total recorrente/i;
    expect(html).not.toMatch(banned);
    expect(empty).not.toMatch(banned);
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('sem total geral somando os valores típicos', () => {
    const html = render([candidate({ typicalAmount: 100 }), candidate({ displayName: 'B', normalizedName: 'b', typicalAmount: 50 })]);
    expect(html).not.toMatch(/R\$\s?150,00/);
    expect(html).not.toMatch(/Total/i);
  });
});

describe('RecurrencesPanel — candidato', () => {
  it('estável: nome, "Possível recorrência mensal", valor típico, histórico e valores semelhantes', () => {
    const html = render([candidate()]);
    expect(html).toContain('Netflix');
    expect(html).toContain('Possível recorrência mensal');
    expect(html).toContain('Valor típico');
    expect(html).toMatch(/R\$\s?39,90/);
    expect(html).toContain('Presente em 5 dos últimos 12 meses');
    expect(html).toContain('Valores semelhantes');
    expect(html).not.toContain('Valores variáveis');
  });

  it('variável: "Valores variáveis" com faixa histórica', () => {
    const html = render([candidate({ amountPattern: 'variable', minAmount: 100, maxAmount: 300, typicalAmount: 180 })]);
    expect(html).toContain('Valores variáveis');
    expect(html).toMatch(/R\$\s?100,00\s–\sR\$\s?300,00/);
    expect(html).not.toContain('Valores semelhantes');
  });

  it('dia provável: exato, faixa e ausência', () => {
    expect(describeUsualDay({ kind: 'exact', day: 10 })).toBe('Geralmente no dia 10');
    expect(describeUsualDay({ kind: 'range', from: 8, to: 14 })).toBe('Geralmente entre os dias 8 e 14');
    expect(describeUsualDay(null)).toBeNull();
    expect(render([candidate({ usualDay: { kind: 'exact', day: 10 } })])).toContain('Geralmente no dia 10');
    expect(render([candidate({ usualDay: { kind: 'range', from: 8, to: 14 } })])).toContain('Geralmente entre os dias 8 e 14');
    expect(render([candidate({ usualDay: null })])).not.toContain('Geralmente');
  });

  it('mais de uma conta (discreto, sem listar contas)', () => {
    expect(render([candidate({ accountCount: 2 })])).toContain('Em mais de uma conta');
    expect(render([candidate({ accountCount: 1 })])).not.toContain('Em mais de uma conta');
  });

  it('selo de futuro já registrado', () => {
    expect(render([candidate({ hasFutureRegistered: true })])).toContain('Já registrada para os próximos meses');
    expect(render([candidate({ hasFutureRegistered: false })])).not.toContain('Já registrada');
  });

  it('dono só quando o contexto o resolve; nunca UUID', () => {
    const withOwner = render([candidate({ ownerUserId: 'uuid-1234' })], { getOwnerLabel: (id: string) => (id === 'uuid-1234' ? 'Marina' : undefined) });
    expect(withOwner).toContain('Marina');
    expect(withOwner).not.toContain('uuid-1234');
    const without = render([candidate({ ownerUserId: 'uuid-1234' })]);
    expect(without).not.toContain('uuid-1234');
    const unresolved = render([candidate({ ownerUserId: 'uuid-1234' })], { getOwnerLabel: () => undefined });
    expect(unresolved).not.toContain('uuid-1234');
  });

  it('CTA "Ver lançamentos" com nome acessível', () => {
    const html = render([candidate()]);
    expect(html).toContain('Ver lançamentos');
    expect(html).toContain('aria-label="Ver lançamentos de Netflix"');
  });

  it('nome longo quebra e layout não força largura', () => {
    const html = render([candidate({ displayName: 'Mensalidade de serviço com nome muito comprido '.repeat(4) })]);
    expect(html).toContain('break-words');
    expect(html).toContain('min-w-0');
    expect(html).toContain('flex-wrap');
    expect(html).not.toMatch(/min-w-\[\d+px\]|overflow-x-(auto|scroll)/);
  });
});

describe('RecurrencesPanel — lista e estados', () => {
  const many = Array.from({ length: 7 }, (_, i) =>
    candidate({ displayName: `Item ${i}`, normalizedName: `item ${i}` })
  );

  it('mostra 5 e oferece "Mostrar mais"; expandido mostra todos e "Mostrar menos"', () => {
    const collapsed = render(many);
    expect(collapsed.match(/Possível recorrência mensal/g)).toHaveLength(5);
    expect(collapsed).toContain('Mostrar mais (2)');
    const all = render(many, { initialShowAll: true });
    expect(all.match(/Possível recorrência mensal/g)).toHaveLength(7);
    expect(all).toContain('Mostrar menos');
    expect(render(many.slice(0, 5))).not.toContain('Mostrar mais');
  });

  it('estado vazio', () => {
    const html = render([]);
    expect(html).toContain('Nenhuma possível recorrência mensal foi identificada nos últimos meses.');
    expect(RECURRENCES_EMPTY).toBe('Nenhuma possível recorrência mensal foi identificada nos últimos meses.');
    expect(html).toContain('pelo menos três meses de histórico semelhante');
    expect(RECURRENCES_EMPTY_HINT).toContain('pelo menos três meses');
    expect(html).not.toContain('Ver lançamentos');
  });

  it('botão de fechar com nome acessível', () => {
    expect(render([candidate()])).toContain('aria-label="Fechar recorrências"');
  });
});

describe('CTA "Ver lançamentos" — filtros da própria Transações', () => {
  const window = getRecurrenceWindow('2026-10-06');
  const apply = (c: RecurrenceCandidate, filterByOwner = false) =>
    // exatamente o que applyTransactionFilters faz: mescla no estado atual e resolve
    resolveTransactionFilters({ ...getDefaultTransactionFilters(), ...buildRecurrenceFilterPatch(c, window, { filterByOwner }) });

  it('Despesa, Data, 12 meses completos, texto do nome', () => {
    const f = apply(candidate());
    expect(f).toMatchObject({
      type: 'Despesa',
      dateField: 'Data',
      periodPreset: 'custom',
      viewScope: 'operation',
      startDate: '2025-10-01',
      endDate: '2026-09-30',
      text: 'Netflix',
      sourceScope: 'all',
      category: [],
      accountId: [],
    });
    expect(f.dateField).not.toBe('Pagamento');
  });

  it('o intervalo personalizado sobrevive à resolução (não vira "este mês")', () => {
    const f = apply(candidate());
    expect([f.startDate, f.endDate]).toEqual(['2025-10-01', '2026-09-30']);
  });

  it('dono entra só quando o filtro por dono existe (família)', () => {
    expect(apply(candidate({ ownerUserId: 'u9' }), true).ownerUserId).toBe('u9');
    expect(apply(candidate({ ownerUserId: 'u9' }), false).ownerUserId).toBe('');
  });

  it('o filtro filtra pela Data de compra, não pelo vencimento', () => {
    const f = apply(candidate());
    const tx = (extra: Partial<Transaction>) =>
      ({ Tipo: 'Despesa', Nome_Fantasia: 'Netflix', Descricao_Original: 'Netflix', Categoria: 'Lazer', Valor: -39.9, ...extra }) as unknown as Transaction;
    // compra em set/2026 com vencimento em out/2026: entra (Data na janela)
    expect(matchesTransactionFilters(tx({ Data: '2026-09-10' as unknown as Date, Data_Pagamento: '2026-10-10' as unknown as Date }), f)).toBe(true);
    // compra em out/2026 com vencimento em set/2026: não entra (Data fora da janela)
    expect(matchesTransactionFilters(tx({ Data: '2026-10-02' as unknown as Date, Data_Pagamento: '2026-09-10' as unknown as Date }), f)).toBe(false);
    // outra pessoa não é filtrada por nome diferente
    expect(matchesTransactionFilters(tx({ Data: '2026-09-10' as unknown as Date, Nome_Fantasia: 'Spotify', Descricao_Original: 'Spotify' }), f)).toBe(false);
  });
});

describe('Integração na TransactionsView (contrato de código)', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');
  const view = read('src/components/views/TransactionsView.tsx');
  const panel = read('src/components/transactions/RecurrencesPanel.tsx');

  it('botão "Recorrências" alterna o painel (aria-expanded) sem mudar de view', () => {
    expect(view).toContain('id="transactions-recurrences-toggle"');
    expect(view).toContain('aria-expanded={recurrencesOpen}');
    expect(view).toContain('aria-controls="transactions-recurrences"');
    expect(view).toMatch(/>\s*Recorrências\s*</);
    expect(view).toContain('{recurrencesOpen && (');
    const handler = view.slice(view.indexOf('const handleViewRecurrence'), view.indexOf('const handleOwnerFilter'));
    expect(handler).not.toMatch(/setCurrentView/);
    expect(handler).toContain('applyTransactionFilters(');
    expect(handler).toContain('buildRecurrenceFilterPatch(');
    expect(handler).toContain('setRecurrencesOpen(false)');
  });

  it('só calcula com o painel aberto, sobre as transações já carregadas, com o dono resolvido pelo contexto', () => {
    const memo = view.slice(view.indexOf('const recurrenceCandidates'), view.indexOf('const handleViewRecurrence'));
    expect(memo).toContain('recurrencesOpen');
    expect(memo).toContain('detectRecurrences(');
    expect(memo).toContain('getOwnerId: familyOwnerContext.getTransactionOwnerId');
    expect(memo).not.toMatch(/supabase|fetch\(/);
  });

  it('sem persistência, rede, analytics, Premium ou novo item de navegação', () => {
    const own = [panel, read('src/domain/recurrences/detectRecurrences.ts')].join('\n');
    expect(own).not.toMatch(/localStorage|supabase|fetch\(|trackProductEvent|isPremium|setCurrentView/);
    expect(read('src/types.ts')).not.toMatch(/recurrences/i);
    expect(read('src/layouts/MainLayout.tsx')).not.toMatch(/Recorr/i);
  });

  it('não toca em Dashboard, Próximos lançamentos nem em outras features', () => {
    expect(read('src/components/views/DashboardView.tsx')).not.toMatch(/recurrence|Recorr/i);
    expect(read('src/utils/upcomingEntries.ts')).not.toMatch(/recurrence/i);
  });
});
