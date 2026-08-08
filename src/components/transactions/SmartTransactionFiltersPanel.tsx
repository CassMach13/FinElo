import React, { useMemo, useState } from 'react';
import type { Account, Category } from '../../types';
import {
  formatPeriodLabel,
  UNASSIGNED_ACCOUNT_FILTER_ID,
  type TransactionFiltersState,
  type TransactionPeriodPreset,
  type TransactionSourceScope,
} from '../../utils/transactionPeriodFilters';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Input from '../ui/Input';
import MultiSelect from '../ui/MultiSelect';
import Select from '../ui/Select';

type OwnerOption = { userId: string; label: string };

interface SmartTransactionFiltersPanelProps {
  filters: TransactionFiltersState;
  accounts: Account[];
  categories: Category[];
  owners: OwnerOption[];
  showOwnerFilter: boolean;
  totalCount: number;
  visibleCount: number;
  unassignedCount: number;
  onChange: (patch: Partial<TransactionFiltersState>) => void;
  onReset: () => void;
  onShowAll: () => void;
}

const sourceLabels: Record<TransactionSourceScope, string> = {
  all: 'Todos',
  imported: 'Importadas',
  manual: 'Manuais',
  credit_card: 'Cartão de crédito',
};

const periodLabels: Record<Exclude<TransactionPeriodPreset, 'custom'>, string> = {
  current_month: 'Este mês',
  previous_month: 'Mês anterior',
  last_30_days: 'Últimos 30 dias',
  all: 'Todo o histórico',
};

const SmartTransactionFiltersPanel: React.FC<SmartTransactionFiltersPanelProps> = ({
  filters,
  accounts,
  categories,
  owners,
  showOwnerFilter,
  totalCount,
  visibleCount,
  unassignedCount,
  onChange,
  onReset,
  onShowAll,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const hiddenCount = Math.max(0, totalCount - visibleCount);

  const accountOptions = useMemo(
    () => [
      ...(unassignedCount > 0
        ? [{ label: `Sem conta (${unassignedCount})`, value: UNASSIGNED_ACCOUNT_FILTER_ID }]
        : []),
      ...accounts.map((account) => ({
        label: account.is_archived ? `${account.Nome_Conta} (Arquivada)` : account.Nome_Conta,
        value: account.id,
      })),
    ],
    [accounts, unassignedCount]
  );

  const categoryOptions = useMemo(
    () => [
      { label: 'Sem categoria (-)', value: '-' },
      ...categories.map((category) => ({
        label: category.Nome_Categoria,
        value: category.Nome_Categoria,
      })),
    ],
    [categories]
  );

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (filters.periodPreset !== 'all') {
      chips.push({
        key: 'period',
        label: formatPeriodLabel(filters),
        clear: () => onChange({ periodPreset: 'all', startDate: '', endDate: '' }),
      });
    }
    if (filters.text.trim()) {
      chips.push({ key: 'text', label: `Busca: ${filters.text.trim()}`, clear: () => onChange({ text: '' }) });
    }
    if (filters.sourceScope !== 'all') {
      chips.push({
        key: 'source',
        label: sourceLabels[filters.sourceScope],
        clear: () => onChange({ sourceScope: 'all' }),
      });
    }
    if (filters.viewScope === 'commitments') {
      chips.push({
        key: 'commitments',
        label: 'Parcelas e recorrências',
        clear: () => onChange({ viewScope: 'operation' }),
      });
    }
    if (filters.dateField === 'Pagamento') {
      chips.push({
        key: 'date-field',
        label: 'Data de pagamento',
        clear: () => onChange({ dateField: 'Data' }),
      });
    }
    if (filters.accountId.length > 0) {
      chips.push({
        key: 'accounts',
        label: filters.accountId.length === 1 ? '1 conta' : `${filters.accountId.length} contas`,
        clear: () => onChange({ accountId: [] }),
      });
    }
    if (filters.category.length > 0) {
      chips.push({
        key: 'categories',
        label: filters.category.length === 1 ? '1 categoria' : `${filters.category.length} categorias`,
        clear: () => onChange({ category: [] }),
      });
    }
    if (filters.type) {
      chips.push({
        key: 'type',
        label: filters.type === 'Renda' ? 'Entradas' : 'Saídas',
        clear: () => onChange({ type: '' }),
      });
    }
    if (filters.ownerUserId) {
      const owner = owners.find((item) => item.userId === filters.ownerUserId);
      chips.push({
        key: 'owner',
        label: owner?.label || 'Responsável',
        clear: () => onChange({ ownerUserId: '' }),
      });
    }
    return chips;
  }, [filters, onChange, owners]);

  const selectPeriod = (preset: Exclude<TransactionPeriodPreset, 'custom'>) => {
    if (preset === 'all') {
      onChange({ periodPreset: 'all', startDate: '', endDate: '' });
      return;
    }
    onChange({
      viewScope: filters.viewScope === 'all' ? 'operation' : filters.viewScope,
      periodPreset: preset,
    });
  };

  const selectSource = (sourceScope: TransactionSourceScope) => onChange({ sourceScope });

  const handleCustomDate = (name: 'startDate' | 'endDate', value: string) => {
    onChange({
      [name]: value,
      periodPreset: 'custom',
      viewScope: filters.viewScope === 'all' ? 'operation' : filters.viewScope,
    });
  };

  return (
    <Card className="!overflow-visible z-40 relative !p-4 sm:!p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300/80">
              Localizar lançamentos
            </p>
            <h2 className="text-lg font-bold text-white tracking-tight mt-1">
              Encontre qualquer transação
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              A busca considera descrição, conta, categoria, arquivo, data e valor.
            </p>
          </div>
          <div
            className={`rounded-xl border px-3 py-2 text-sm ${
              hiddenCount > 0
                ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
            }`}
            role="status"
          >
            <span className="font-bold tabular-nums">{visibleCount}</span> de{' '}
            <span className="font-bold tabular-nums">{totalCount}</span> visíveis
            {hiddenCount > 0 ? (
              <span className="block text-xs mt-0.5 text-amber-100/75">
                {hiddenCount} fora da visão atual — os dados não foram apagados.
              </span>
            ) : null}
          </div>
        </div>

        <Input
          id="smart-transaction-search"
          label="Busca inteligente"
          name="text"
          value={filters.text}
          onChange={(event) => onChange({ text: event.target.value })}
          placeholder="Ex.: mercado Nubank julho 120,00"
          autoComplete="off"
        />

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Período</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(periodLabels) as Array<Exclude<TransactionPeriodPreset, 'custom'>>).map((preset) => {
                const selected =
                  preset === 'all'
                    ? filters.periodPreset === 'all' || filters.viewScope === 'all'
                    : filters.periodPreset === preset && filters.viewScope !== 'all';
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => selectPeriod(preset)}
                    aria-pressed={selected}
                    className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                      selected
                        ? 'bg-accent text-slate-950 border-accent'
                        : 'bg-slate-800 text-slate-200 border-white/10 hover:bg-slate-700'
                    }`}
                  >
                    {periodLabels[preset]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">
              Origem
            </p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(sourceLabels) as TransactionSourceScope[]).map((sourceScope) => (
                <button
                  key={sourceScope}
                  type="button"
                  onClick={() => selectSource(sourceScope)}
                  aria-pressed={filters.sourceScope === sourceScope}
                  className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    filters.sourceScope === sourceScope
                      ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
                      : 'bg-slate-800 text-slate-200 border-white/10 hover:bg-slate-700'
                  }`}
                >
                  {sourceLabels[sourceScope]}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  onChange({ viewScope: filters.viewScope === 'commitments' ? 'operation' : 'commitments' })
                }
                aria-pressed={filters.viewScope === 'commitments'}
                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                  filters.viewScope === 'commitments'
                    ? 'bg-violet-500/20 text-violet-200 border-violet-400/50'
                    : 'bg-slate-800 text-slate-200 border-white/10 hover:bg-slate-700'
                }`}
              >
                Parcelas e recorrências
              </button>
            </div>
          </div>
        </div>

        {activeChips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="Filtros ativos">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              Ativos
            </span>
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                title={`Remover filtro ${chip.label}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800/90 px-2.5 py-1 text-xs text-slate-200 hover:border-cyan-400/50 hover:text-white"
              >
                {chip.label}
                <span aria-hidden className="text-slate-400">×</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setAdvancedOpen((value) => !value)}
            className="!px-4 !py-2.5"
            aria-expanded={advancedOpen}
          >
            {advancedOpen ? 'Ocultar filtros detalhados' : 'Filtros detalhados'}
          </Button>
          <Button variant="ghost" onClick={onReset} className="!px-4 !py-2.5">
            Voltar para este mês
          </Button>
          {hiddenCount > 0 ? (
            <Button variant="outline" onClick={onShowAll} className="!px-4 !py-2.5">
              Mostrar todo o histórico
            </Button>
          ) : null}
        </div>

        {advancedOpen ? (
          <div className="border-t border-white/10 pt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
              <Input
                id="smart-filter-start-date"
                label="Data inicial"
                type="date"
                name="startDate"
                value={filters.startDate}
                onChange={(event) => handleCustomDate('startDate', event.target.value)}
              />
              <Input
                id="smart-filter-end-date"
                label="Data final"
                type="date"
                name="endDate"
                value={filters.endDate}
                onChange={(event) => handleCustomDate('endDate', event.target.value)}
              />
              <Select
                id="smart-filter-date-field"
                label="Usar data de"
                name="dateField"
                value={filters.dateField}
                onChange={(event) => onChange({ dateField: event.target.value as TransactionFiltersState['dateField'] })}
              >
                <option value="Data">Compra / lançamento</option>
                <option value="Pagamento">Pagamento</option>
              </Select>
              <Select
                id="smart-filter-type"
                label="Tipo financeiro"
                name="type"
                value={filters.type}
                onChange={(event) => onChange({ type: event.target.value })}
              >
                <option value="">Entradas e saídas</option>
                <option value="Renda">Entradas</option>
                <option value="Despesa">Saídas</option>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <MultiSelect
                label="Conta"
                options={accountOptions}
                value={filters.accountId}
                onChange={(accountId) => onChange({ accountId })}
                placeholder="Todas as contas"
              />
              <MultiSelect
                label="Categoria"
                options={categoryOptions}
                value={filters.category}
                onChange={(category) => onChange({ category })}
                placeholder="Todas as categorias"
              />
              {showOwnerFilter ? (
                <Select
                  id="smart-filter-owner"
                  label="Responsável"
                  name="ownerUserId"
                  value={filters.ownerUserId}
                  onChange={(event) => onChange({ ownerUserId: event.target.value })}
                >
                  <option value="">Todas as pessoas</option>
                  {owners.map((owner) => (
                    <option key={owner.userId} value={owner.userId}>
                      {owner.label}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
};

export default SmartTransactionFiltersPanel;
