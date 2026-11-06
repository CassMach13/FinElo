# Inventário de estilos do FinElo

Base da análise `6fa1188b1864e85da587e61c7e46009a5e82adb4`. Foram lidos 271 arquivos versionados em `src/` e nas configurações de entrada, Tailwind e Vite. 107 arquivos contêm pelo menos um candidato.

As contagens são ocorrências lexicais, inclusive variantes como hover e opacidade, referências em CSS, comentários e valores que podem ser identidade de marca ou dados. As colunas podem se sobrepor. O scan não computa CSS no navegador, não detecta todos os nomes CSS ou valores construídos em runtime e não decide quais ocorrências devem mudar. `success` foi contado como referência nomeada mesmo sem valor no Tailwind atual.

| Área | Arquivos com ocorrência | Tailwind fixo | Nomeadas | Arbitrárias | Literais |
| --- | ---: | ---: | ---: | ---: | ---: |
| demais arquivos | 32 | 437 | 90 | 2 | 89 |
| src/components/dashboard | 6 | 151 | 37 | 1 | 8 |
| src/components/investments | 12 | 232 | 33 | 0 | 9 |
| src/components/modals | 18 | 1378 | 64 | 0 | 0 |
| src/components/transactions | 5 | 170 | 17 | 0 | 0 |
| src/components/ui | 17 | 134 | 56 | 1 | 5 |
| src/components/views | 16 | 1709 | 353 | 7 | 18 |
| src/layouts | 1 | 12 | 6 | 0 | 0 |
| **Total** | 107 | 4223 | 656 | 11 | 129 |

## Valores mais frequentes

**Utilitários Tailwind de paleta fixa**

`text-white` (501) · `text-gray-400` (287) · `text-slate-400` (216) · `text-gray-500` (204) · `text-gray-300` (179) · `border-white/10` (168) · `text-slate-300` (138) · `bg-white` (104) · `border-slate-700` (77) · `border-slate-700/50` (75) · `bg-slate-800` (73) · `border-slate-600` (63) · `text-slate-200` (59) · `border-white/5` (57) · `text-emerald-300` (57) · `bg-slate-700` (54) · `text-slate-500` (47) · `text-gray-200` (45) · `text-amber-300` (41) · `text-red-400` (35) · `bg-slate-800/50` (31) · `text-slate-100` (30) · `text-rose-300` (30) · `bg-white/10` (29)

**Referências nomeadas**

`text-accent` (102) · `text-highlight` (56) · `text-danger` (55) · `text-light` (47) · `bg-highlight` (36) · `bg-secondary` (36) · `ring-highlight` (34) · `bg-accent` (32) · `ring-accent` (24) · `bg-primary` (22) · `border-highlight` (22) · `bg-secondary/30` (10) · `border-accent` (8) · `bg-accent/20` (7) · `bg-highlight/10` (7) · `bg-danger` (7) · `outline-accent` (7) · `bg-secondary/40` (7)

**Literais hex, RGB ou HSL**

`#1a202c` (4) · `#0f172a` (3) · `#0b1120` (3) · `#49d2c7` (3) · `#cbd5e1` (3) · `#1e293b` (3) · `#f7fafc` (3) · `#10b981` (3) · `#38b2ac` (3) · `#0e1622` (2) · `rgba(148, 163, 184, 0.075)` (2) · `rgba(206,218,234,0.26)` (2) · `rgba(113,137,166,0.30)` (2) · `rgba(26,38,55,.98)` (2) · `rgba(11,18,29,.99)` (2) · `rgba(0,0,0,.44)` (2) · `rgba(255,255,255,.035)` (2) · `#3bc6be` (2) · `#ea4335` (2) · `#4285f4` (2) · `#34a853` (2) · `#ff9900` (2) · `#2d3748` (2) · `#f56565` (2) · `#1a1a2e` (2)

## Arquivos com candidatos

| Arquivo | Tailwind fixo | Nomeadas | Arbitrárias | Literais |
| --- | ---: | ---: | ---: | ---: |
| [`src/components/modals/CreditCardInvoiceCyclesModal.tsx`](../../src/components/modals/CreditCardInvoiceCyclesModal.tsx) | 821 | 0 | 0 | 0 |
| [`src/components/views/TransactionsView.tsx`](../../src/components/views/TransactionsView.tsx) | 408 | 88 | 3 | 3 |
| [`src/components/views/ImportView.tsx`](../../src/components/views/ImportView.tsx) | 300 | 42 | 0 | 0 |
| [`src/components/views/DashboardView.tsx`](../../src/components/views/DashboardView.tsx) | 179 | 62 | 0 | 0 |
| [`src/components/views/LandingPage.tsx`](../../src/components/views/LandingPage.tsx) | 120 | 63 | 2 | 11 |
| [`src/components/views/SettingsView.tsx`](../../src/components/views/SettingsView.tsx) | 145 | 41 | 0 | 0 |
| [`src/components/views/InvestmentsView.tsx`](../../src/components/views/InvestmentsView.tsx) | 135 | 16 | 0 | 0 |
| [`src/components/views/PricingView.tsx`](../../src/components/views/PricingView.tsx) | 118 | 9 | 0 | 0 |
| [`src/components/modals/OpenFinanceReviewModal.tsx`](../../src/components/modals/OpenFinanceReviewModal.tsx) | 116 | 0 | 0 | 0 |
| [`src/components/transactions/AccountBalanceCard.tsx`](../../src/components/transactions/AccountBalanceCard.tsx) | 104 | 7 | 0 | 0 |
| [`src/components/views/HelpView.tsx`](../../src/components/views/HelpView.tsx) | 93 | 0 | 0 | 0 |
| [`src/components/views/AdminTicketsView.tsx`](../../src/components/views/AdminTicketsView.tsx) | 88 | 2 | 0 | 0 |
| [`src/components/modals/InvestmentImportModal.tsx`](../../src/components/modals/InvestmentImportModal.tsx) | 64 | 16 | 0 | 0 |
| [`src/components/admin/AdminDashboard.tsx`](../../src/components/admin/AdminDashboard.tsx) | 78 | 1 | 0 | 0 |
| [`src/components/modals/AssetDetailModal.tsx`](../../src/components/modals/AssetDetailModal.tsx) | 65 | 10 | 0 | 0 |
| [`src/components/modals/ImportDetailsModal.tsx`](../../src/components/modals/ImportDetailsModal.tsx) | 55 | 6 | 0 | 0 |
| [`src/components/modals/NewTransactionModal.tsx`](../../src/components/modals/NewTransactionModal.tsx) | 48 | 11 | 0 | 0 |
| [`src/components/help/HelpCenterBrowse.tsx`](../../src/components/help/HelpCenterBrowse.tsx) | 58 | 0 | 0 | 0 |
| [`src/components/investments/PortfolioManagerDrawer.tsx`](../../src/components/investments/PortfolioManagerDrawer.tsx) | 44 | 7 | 0 | 0 |
| [`src/components/investments/PortfolioShelf.tsx`](../../src/components/investments/PortfolioShelf.tsx) | 43 | 8 | 0 | 0 |
| [`src/components/dashboard/UpcomingEntriesCard.tsx`](../../src/components/dashboard/UpcomingEntriesCard.tsx) | 33 | 16 | 0 | 0 |
| [`src/components/views/AuthView.tsx`](../../src/components/views/AuthView.tsx) | 47 | 0 | 1 | 1 |
| [`src/components/dashboard/CurrentNetWorthCard.tsx`](../../src/components/dashboard/CurrentNetWorthCard.tsx) | 38 | 8 | 0 | 0 |
| [`src/components/views/ContasView.tsx`](../../src/components/views/ContasView.tsx) | 29 | 15 | 0 | 2 |
| [`src/components/dashboard/NetWorthSummaryCard.tsx`](../../src/components/dashboard/NetWorthSummaryCard.tsx) | 37 | 7 | 0 | 0 |
| [`src/index.css`](../../src/index.css) | 16 | 14 | 0 | 13 |
| [`src/components/charts/AnnualEvolutionChart.tsx`](../../src/components/charts/AnnualEvolutionChart.tsx) | 21 | 0 | 1 | 19 |
| [`src/components/transactions/SmartTransactionFiltersPanel.tsx`](../../src/components/transactions/SmartTransactionFiltersPanel.tsx) | 39 | 2 | 0 | 0 |
| [`src/components/investments/ClassifyInvestmentModal.tsx`](../../src/components/investments/ClassifyInvestmentModal.tsx) | 34 | 6 | 0 | 0 |
| [`src/components/modals/InvestmentModal.tsx`](../../src/components/modals/InvestmentModal.tsx) | 33 | 6 | 0 | 0 |
| [`src/components/modals/ReconciliationResolutionModal.tsx`](../../src/components/modals/ReconciliationResolutionModal.tsx) | 39 | 0 | 0 | 0 |
| [`src/services/parsers/nativeBankParsers.ts`](../../src/services/parsers/nativeBankParsers.ts) | 0 | 0 | 0 | 39 |
| [`src/components/help/CreditCardHelpGuide.tsx`](../../src/components/help/CreditCardHelpGuide.tsx) | 35 | 0 | 0 | 0 |
| [`src/components/charts/MonthlyEvolutionChart.tsx`](../../src/components/charts/MonthlyEvolutionChart.tsx) | 32 | 2 | 0 | 0 |
| [`src/components/widgets/Rule503020Widget.tsx`](../../src/components/widgets/Rule503020Widget.tsx) | 23 | 9 | 0 | 0 |
| [`src/components/modals/CardDiagnosticsModal.tsx`](../../src/components/modals/CardDiagnosticsModal.tsx) | 31 | 0 | 0 | 0 |
| [`src/components/dashboard/MonthlyChangeCard.tsx`](../../src/components/dashboard/MonthlyChangeCard.tsx) | 22 | 6 | 0 | 0 |
| [`src/components/goals/GoalCard.tsx`](../../src/components/goals/GoalCard.tsx) | 19 | 9 | 0 | 0 |
| [`src/components/budgets/BudgetManagerPanel.tsx`](../../src/components/budgets/BudgetManagerPanel.tsx) | 22 | 4 | 0 | 0 |
| [`src/components/dashboard/AnnualEvolutionCard.tsx`](../../src/components/dashboard/AnnualEvolutionCard.tsx) | 17 | 0 | 1 | 8 |
| [`src/components/ui/SummaryCard.tsx`](../../src/components/ui/SummaryCard.tsx) | 18 | 6 | 0 | 0 |
| [`src/components/investments/PortfolioFormModal.tsx`](../../src/components/investments/PortfolioFormModal.tsx) | 19 | 4 | 0 | 0 |
| [`src/components/investments/PortfolioHistoryChart.tsx`](../../src/components/investments/PortfolioHistoryChart.tsx) | 13 | 1 | 0 | 9 |
| [`src/components/modals/PayCreditCardInvoiceModal.tsx`](../../src/components/modals/PayCreditCardInvoiceModal.tsx) | 23 | 0 | 0 | 0 |
| [`src/components/ui/FamilyOwnerAuditPanel.tsx`](../../src/components/ui/FamilyOwnerAuditPanel.tsx) | 17 | 6 | 0 | 0 |
| [`src/components/ui/GlobalDialog.tsx`](../../src/components/ui/GlobalDialog.tsx) | 13 | 10 | 0 | 0 |
| [`src/components/auth/AppLock.tsx`](../../src/components/auth/AppLock.tsx) | 13 | 9 | 0 | 0 |
| [`src/components/charts/CategorySpendChart.tsx`](../../src/components/charts/CategorySpendChart.tsx) | 19 | 3 | 0 | 0 |
| [`src/components/transactions/RecurrencesPanel.tsx`](../../src/components/transactions/RecurrencesPanel.tsx) | 16 | 6 | 0 | 0 |
| [`src/components/ui/Button.tsx`](../../src/components/ui/Button.tsx) | 20 | 0 | 1 | 1 |
| [`src/components/modals/AssetModal.tsx`](../../src/components/modals/AssetModal.tsx) | 19 | 2 | 0 | 0 |
| [`src/components/modals/InstallmentSuggestionModal.tsx`](../../src/components/modals/InstallmentSuggestionModal.tsx) | 16 | 5 | 0 | 0 |
| [`src/components/ui/MultiSelect.tsx`](../../src/components/ui/MultiSelect.tsx) | 10 | 11 | 0 | 0 |
| [`src/components/views/UserAccountWidget.tsx`](../../src/components/views/UserAccountWidget.tsx) | 10 | 11 | 0 | 0 |
| [`src/utils/familyOwnerContext.ts`](../../src/utils/familyOwnerContext.ts) | 16 | 4 | 0 | 0 |
| [`src/components/help/HelpArticleContent.tsx`](../../src/components/help/HelpArticleContent.tsx) | 18 | 0 | 0 | 0 |
| [`src/components/onboarding/FirstStepsCard.tsx`](../../src/components/onboarding/FirstStepsCard.tsx) | 6 | 12 | 0 | 0 |
| [`src/layouts/MainLayout.tsx`](../../src/layouts/MainLayout.tsx) | 12 | 6 | 0 | 0 |
| [`src/components/investments/PortfolioSummary.tsx`](../../src/components/investments/PortfolioSummary.tsx) | 16 | 1 | 0 | 0 |
| [`src/components/charts/IncomeExpenseChart.tsx`](../../src/components/charts/IncomeExpenseChart.tsx) | 14 | 2 | 0 | 0 |
| [`src/components/pwa/InstallPWA.tsx`](../../src/components/pwa/InstallPWA.tsx) | 8 | 7 | 0 | 0 |
| [`src/components/views/AccountModal.tsx`](../../src/components/views/AccountModal.tsx) | 15 | 0 | 0 | 0 |
| [`src/components/investments/InvestmentBalanceDisplay.tsx`](../../src/components/investments/InvestmentBalanceDisplay.tsx) | 14 | 0 | 0 | 0 |
| [`src/components/investments/PortfolioAllocation.tsx`](../../src/components/investments/PortfolioAllocation.tsx) | 13 | 1 | 0 | 0 |
| [`src/components/investments/PortfolioMaturities.tsx`](../../src/components/investments/PortfolioMaturities.tsx) | 13 | 1 | 0 | 0 |
| [`src/components/modals/ReconciliationFlow.tsx`](../../src/components/modals/ReconciliationFlow.tsx) | 14 | 0 | 0 | 0 |
| [`src/components/ui/Input.tsx`](../../src/components/ui/Input.tsx) | 14 | 0 | 0 | 0 |
| [`src/components/modals/SaveConfigModal.tsx`](../../src/components/modals/SaveConfigModal.tsx) | 8 | 5 | 0 | 0 |
| [`src/components/views/GoalsView.tsx`](../../src/components/views/GoalsView.tsx) | 10 | 3 | 0 | 0 |
| [`src/components/charts/CompetenceInvoiceBarChart.tsx`](../../src/components/charts/CompetenceInvoiceBarChart.tsx) | 12 | 0 | 0 | 0 |
| [`src/components/investments/ClassificationBadge.tsx`](../../src/components/investments/ClassificationBadge.tsx) | 9 | 3 | 0 | 0 |
| [`src/components/modals/CategoryModal.tsx`](../../src/components/modals/CategoryModal.tsx) | 10 | 2 | 0 | 0 |
| [`src/components/modals/InviteMemberModal.tsx`](../../src/components/modals/InviteMemberModal.tsx) | 11 | 1 | 0 | 0 |
| [`src/components/investments/PortfolioConcentration.tsx`](../../src/components/investments/PortfolioConcentration.tsx) | 9 | 1 | 0 | 0 |
| [`src/components/transactions/EconomicIdentityControls.tsx`](../../src/components/transactions/EconomicIdentityControls.tsx) | 8 | 2 | 0 | 0 |
| [`src/components/ui/Select.tsx`](../../src/components/ui/Select.tsx) | 4 | 6 | 0 | 0 |
| [`src/components/family/OwnerScopeControl.tsx`](../../src/components/family/OwnerScopeControl.tsx) | 8 | 1 | 0 | 0 |
| [`src/components/ui/PeriodCompareLegend.tsx`](../../src/components/ui/PeriodCompareLegend.tsx) | 6 | 3 | 0 | 0 |
| [`src/components/views/UpdatePasswordView.tsx`](../../src/components/views/UpdatePasswordView.tsx) | 7 | 0 | 1 | 1 |
| [`src/components/pwa/ReloadPrompt.tsx`](../../src/components/pwa/ReloadPrompt.tsx) | 5 | 3 | 0 | 0 |
| [`src/components/ui/ProgressBar.tsx`](../../src/components/ui/ProgressBar.tsx) | 3 | 5 | 0 | 0 |
| [`src/components/ui/Modal.tsx`](../../src/components/ui/Modal.tsx) | 5 | 2 | 0 | 0 |
| [`src/components/ui/NavItem.tsx`](../../src/components/ui/NavItem.tsx) | 5 | 2 | 0 | 0 |
| [`src/components/ui/PeriodCompareColumns.tsx`](../../src/components/ui/PeriodCompareColumns.tsx) | 4 | 3 | 0 | 0 |
| [`tailwind.config.cjs`](../../tailwind.config.cjs) | 0 | 0 | 0 | 7 |
| [`src/components/onboarding/ImportSuccessPanel.tsx`](../../src/components/onboarding/ImportSuccessPanel.tsx) | 6 | 0 | 0 | 0 |
| [`src/components/views/PaymentSuccessView.tsx`](../../src/components/views/PaymentSuccessView.tsx) | 5 | 1 | 0 | 0 |
| [`src/hooks/useAppStore.ts`](../../src/hooks/useAppStore.ts) | 0 | 0 | 0 | 6 |
| [`src/utils/formatters.ts`](../../src/utils/formatters.ts) | 1 | 5 | 0 | 0 |
| [`src/components/TourButton.tsx`](../../src/components/TourButton.tsx) | 0 | 5 | 0 | 0 |
| [`src/components/investments/PortfolioInsightsNarrative.tsx`](../../src/components/investments/PortfolioInsightsNarrative.tsx) | 5 | 0 | 0 | 0 |
| [`src/components/ui/Card.tsx`](../../src/components/ui/Card.tsx) | 4 | 1 | 0 | 0 |
| [`src/components/ui/icons.tsx`](../../src/components/ui/icons.tsx) | 1 | 0 | 0 | 4 |
| [`src/components/dashboard/OwnerScopeNetWorthNote.tsx`](../../src/components/dashboard/OwnerScopeNetWorthNote.tsx) | 4 | 0 | 0 | 0 |
| [`src/components/modals/TermsModal.tsx`](../../src/components/modals/TermsModal.tsx) | 4 | 0 | 0 | 0 |
| [`src/components/ui/SwipeableItem.tsx`](../../src/components/ui/SwipeableItem.tsx) | 4 | 0 | 0 | 0 |
| [`src/components/ui/TransactionOwnerGroupHeader.tsx`](../../src/components/ui/TransactionOwnerGroupHeader.tsx) | 4 | 0 | 0 | 0 |
| [`src/components/auth/ProtectedRoute.tsx`](../../src/components/auth/ProtectedRoute.tsx) | 1 | 0 | 1 | 1 |
| [`src/components/transactions/accountBalanceCardMetrics.ts`](../../src/components/transactions/accountBalanceCardMetrics.ts) | 3 | 0 | 0 | 0 |
| [`src/components/ui/Skeleton.tsx`](../../src/components/ui/Skeleton.tsx) | 2 | 1 | 0 | 0 |
| [`src/Avatar.tsx`](../../src/Avatar.tsx) | 1 | 0 | 0 | 1 |
| [`src/components/goals/UpdateGoalValueModal.tsx`](../../src/components/goals/UpdateGoalValueModal.tsx) | 2 | 0 | 0 | 0 |
| [`src/components/support/SupportAttachmentLink.tsx`](../../src/components/support/SupportAttachmentLink.tsx) | 2 | 0 | 0 | 0 |
| [`vite.config.ts`](../../vite.config.ts) | 0 | 0 | 0 | 2 |
| [`index.html`](../../index.html) | 0 | 0 | 0 | 1 |
| [`src/components/goals/GoalFormModal.tsx`](../../src/components/goals/GoalFormModal.tsx) | 1 | 0 | 0 | 0 |
| [`src/components/modals/MappingRuleModal.tsx`](../../src/components/modals/MappingRuleModal.tsx) | 1 | 0 | 0 | 0 |
