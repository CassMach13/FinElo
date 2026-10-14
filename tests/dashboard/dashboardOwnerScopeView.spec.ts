import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardOwnerSelectorView, mergeOwnerOptions } from '../../src/components/dashboard/DashboardOwnerSelector';
import { FAMILY_SCOPE, SELF_SCOPE } from '../../src/domain/dashboard/dashboardOwnerScope';

const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const view = read('src/components/views/DashboardView.tsx');

describe('seletor do Dashboard', () => {
  it('opções: "Você" primeiro, familiares sem repetir (descoberta ∪ contas/transações), ordenados', () => {
    const merged = mergeOwnerOptions(
      'me',
      [{ userId: 'ana', label: 'Ana', isSelf: false }, { userId: 'me', label: 'x', isSelf: true }],
      [{ userId: 'ana', label: 'Ana (contas)' }, { userId: 'beto', label: 'Beto' }]
    );
    expect(merged).toEqual([
      { userId: 'me', label: 'Você', isSelf: true },
      { userId: 'ana', label: 'Ana', isSelf: false },
      { userId: 'beto', label: 'Beto', isSelf: false },
    ]);
  });

  it('um único proprietário: nada é exibido; com familiares, "Família (consolidado)" é uma opção explícita no fim', () => {
    expect(renderToStaticMarkup(React.createElement(DashboardOwnerSelectorView, { options: [{ userId: 'me', label: 'Você', isSelf: true }], value: SELF_SCOPE, onChange: () => {} }))).toBe('');
    const html = renderToStaticMarkup(React.createElement(DashboardOwnerSelectorView, {
      options: [{ userId: 'me', label: 'Você', isSelf: true }, { userId: 'ana', label: 'Ana', isSelf: false }],
      value: SELF_SCOPE,
      onChange: () => {},
    }));
    expect(html).toContain(`<option value="${SELF_SCOPE}" selected="">Você</option>`);
    expect(html).toContain('<option value="ana">Ana</option>');
    expect(html.indexOf(`value="${FAMILY_SCOPE}"`)).toBeGreaterThan(html.indexOf('value="ana"'));
    expect(html).toContain('Família (consolidado)');
  });
});

describe('Dashboard com a flag desligada = comportamento anterior', () => {
  it('sem escopo, as fontes são as próprias referências do store', () => {
    for (const k of ['transactions', 'accounts', 'assets', 'budgets', 'budgetMonths']) {
      const cap = k[0].toUpperCase() + k.slice(1);
      expect(view).toContain(`const scoped${cap} = scopedData?.${k} ?? ${k};`);
    }
    expect(view).toContain('ownerScopeEnabled && user?.id ? resolveDashboardScope(');
  });

  it('o caminho antigo de investimentos só roda com a flag desligada; o novo só com ela ligada', () => {
    expect(view).toContain('if (!user || ownerScopeEnabled) return;');
    expect(view).toContain('if (!user || !compareDateRange || ownerScopeEnabled) {');
    expect(view).toContain('const investmentsValue = ownerScope ? (ownerInvestments.summary?.totalCents ?? 0) / 100 : manualInvestmentsTotal;');
    expect(view).toContain('useOwnerInvestments(!!ownerScope,');
  });

  it('seletor (e a leitura de vínculos) só existe com a flag; aviso de visão só fora de "Você"', () => {
    expect(view).toMatch(/\{ownerScope && \(\n\s+<div className="mt-3">\n\s+<DashboardOwnerSelector/);
    expect(view).toContain("{ownerScope && ownerScope.kind !== 'self' && (");
  });
});

describe('Dashboard com escopo: cálculo e escrita', () => {
  it('filtra antes dos cálculos: KPIs, gráficos, orçamento, próximos lançamentos e evolução usam a lista do escopo', () => {
    for (const needle of [
      'filterTransactionsByRange(scopedTransactions, dateRange)',
      'computeDashboardPeriodMetrics(scopedTransactions,',
      'toOperationalChartData(scopedTransactions,',
      'computeMonthlyChange({ transactions: scopedTransactions,',
      'computeAnnualEvolution({ transactions: scopedTransactions,',
      'budgets: scopedBudgets,',
      'transactions={scopedTransactions}',
      'accounts={scopedAccounts}',
    ]) expect(view).toContain(needle);
  });

  it('patrimônio: contas e bens do escopo; saldo de conta com TODAS as transações da conta', () => {
    expect(view).toContain('computeAssetsTotals(scopedAssets)');
    expect(view).toContain('computeAccountsTotalAsOf(scopedAccounts, transactions, dateRange.end)');
    expect(view).toContain('computeNetWorthSnapshot(\n      scopedAccounts,\n      transactions,\n      scopedAssets,');
    expect(view).toContain(".filter((acc) => !scopedAccountIds || scopedAccountIds.has(acc.id))");
  });

  it('enquanto os investimentos do escopo carregam, não mostra patrimônio de outro titular nem comparação incompleta', () => {
    expect(view).toContain("{ownerScope && ownerInvestments.status === 'loading' ? (");
    expect(view).toContain("if (ownerScope && compareOwnerInvestments.status !== 'ready') return null;");
  });

  it('trocar de visão nunca amplia escrita: alertas que abrem edição só na própria visão; lançamentos continuam da sessão', () => {
    expect(view).toContain("const viewingOwnData = !ownerScope || ownerScope.kind === 'self';");
    expect(view).toContain('viewingOwnData ? scopedAccounts.filter(acc => !acc.bank_id) : []');
    expect(view).toContain('{viewingOwnData && showAssetReviewAlert &&');
    // nada da escrita usa o proprietário da visão
    for (const w of ['addTransaction(', 'addAccount(', 'updateAccount(', 'addCategory(']) {
      const at = view.indexOf(w);
      expect(at).toBeGreaterThan(-1);
      expect(view.slice(Math.max(0, at - 300), at + 200)).not.toMatch(/ownerScope|scopedAccounts|ownerSelection/);
    }
  });

  it('seleção e opções valem só para a sessão em que foram escolhidas', () => {
    expect(view).toContain('ownerSelectionState && ownerSelectionState.sessionUserId === user?.id ? ownerSelectionState.value : SELF_SCOPE');
    expect(view).toContain('ownerOptionsState && ownerOptionsState.sessionUserId === user?.id ? ownerOptionsState.options : []');
  });
});
