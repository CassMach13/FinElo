import React, { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { appConfirm } from '../../hooks/useDialogStore';
import type { Budget, BudgetMonth, Category } from '../../types';
import {
  buildManagerRows,
  canNavigateToMonth,
  editRightsFor,
  nextMonth,
  planCopyFromPreviousMonth,
  planManagerSave,
  previousMonth,
  type CivilMonth,
  type ManagerRow,
} from '../../domain/budgets/monthlyBudget';
import { parseMoneyInput } from '../../domain/goals/goalProgress';
import { MONTH_NAMES } from '../../utils/monthlyChange';
import { formatCurrency } from '../../utils/formatters';

export const BUDGET_MANAGER_TITLE = 'Gerenciar orçamento';
export const BUDGET_ONLY_OWNER_CREATES = 'Somente o responsável pode criar o orçamento deste mês.';

export interface ManagerOwner {
  userId: string;
  label: string;
}

export const monthTitle = (m: CivilMonth) => `${MONTH_NAMES[m.month - 1]}/${m.year}`;

export const sourceLabel = (row: ManagerRow, year: number): string =>
  row.monthly ? 'Deste mês' : row.effective?.source === 'annual' ? `Padrão de ${year}` : 'Sem orçamento';

export const copyResultMessage = (created: number, skipped: number): string => {
  if (created === 0 && skipped === 0) return 'Nada para copiar.';
  const base = `${created} ${created === 1 ? 'categoria copiada' : 'categorias copiadas'}`;
  return skipped > 0 ? `${created} copiadas · ${skipped} já ${skipped === 1 ? 'estava definida' : 'estavam definidas'}.` : `${base}.`;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialMonth: CivilMonth;
  /** Mês civil de hoje (limita a navegação ao próximo mês). */
  currentMonth: CivilMonth;
  currentUserId: string | null | undefined;
  categories: Category[];
  budgets: Budget[];
  budgetMonths: BudgetMonth[];
  /** Presente só com família ativa: habilita o seletor "Responsável". */
  owners?: ManagerOwner[];
  onCreateMany: (rows: Array<{ Categoria: string; year: number; month: number; amount: number }>) => Promise<boolean>;
  onUpdateAmount: (id: string, amount: number) => Promise<boolean>;
  onDeleteMonth: (id: string) => Promise<boolean>;
  /** Só para teste/SSR. */
  initialOwnerId?: string;
  initialDrafts?: Record<string, string>;
  initialMessage?: string;
}

const BudgetManagerPanel: React.FC<Props> = ({
  isOpen,
  onClose,
  initialMonth,
  currentMonth,
  currentUserId,
  categories,
  budgets,
  budgetMonths,
  owners,
  onCreateMany,
  onUpdateAmount,
  onDeleteMonth,
  initialOwnerId,
  initialDrafts,
  initialMessage,
}) => {
  const [period, setPeriod] = useState<CivilMonth>(initialMonth);
  const [ownerId, setOwnerId] = useState<string>(initialOwnerId ?? currentUserId ?? '');
  const [drafts, setDrafts] = useState<Record<string, string>>(initialDrafts ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | undefined>(initialMessage);
  const [busy, setBusy] = useState(false);

  const rights = editRightsFor(ownerId, currentUserId);
  const rows = useMemo(
    () => buildManagerRows({ ownerId, period, categories, budgets, budgetMonths, currentUserId }),
    [ownerId, period, categories, budgets, budgetMonths, currentUserId]
  );
  const copyPlan = useMemo(
    () => planCopyFromPreviousMonth({ ownerId, target: period, categories, budgets, budgetMonths, currentUserId }),
    [ownerId, period, categories, budgets, budgetMonths, currentUserId]
  );

  const familyActive = !!owners && owners.length > 1;
  const canGoNext = canNavigateToMonth(nextMonth(period), currentMonth);
  const prev = previousMonth(period);

  const go = (m: CivilMonth) => {
    setPeriod(m);
    setDrafts({});
    setErrors({});
    setMessage(undefined);
  };

  const dirty = Object.keys(drafts).length > 0;

  const save = async () => {
    const plan = planManagerSave({ rows, drafts, period, rights, parse: parseMoneyInput });
    setErrors(plan.errors);
    if (Object.keys(plan.errors).length > 0) return;
    if (plan.creates.length === 0 && plan.updates.length === 0) {
      setMessage('Nenhuma alteração para salvar.');
      return;
    }
    setBusy(true);
    try {
      let ok = true;
      if (plan.creates.length > 0) ok = await onCreateMany(plan.creates);
      for (const u of plan.updates) {
        if (!ok) break;
        ok = await onUpdateAmount(u.id, u.amount);
      }
      if (ok) {
        setDrafts({});
        setMessage('Orçamento salvo.');
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!rights.canCopy || copyPlan.toCreate.length === 0) return;
    setBusy(true);
    try {
      const ok = await onCreateMany(
        copyPlan.toCreate.map((r) => ({ Categoria: r.Categoria, year: period.year, month: period.month, amount: r.amount }))
      );
      if (ok) setMessage(copyResultMessage(copyPlan.toCreate.length, copyPlan.skippedExisting));
    } finally {
      setBusy(false);
    }
  };

  const removeMonthly = async (row: ManagerRow) => {
    if (!row.monthly) return;
    // Antes de remover: o que acontece depois.
    const fallback = budgets.find((b) => (b.user_id ?? currentUserId) === ownerId && b.Categoria === row.Categoria && b.ano === period.year);
    const text = fallback
      ? `Este mês voltará a usar o padrão anual de ${formatCurrency(fallback.Valor_Limite_Mensal)}.`
      : 'A categoria ficará sem orçamento neste mês.';
    const ok = await appConfirm(text, `Remover orçamento de ${row.Categoria}`, 'Remover', 'warning');
    if (ok) await onDeleteMonth(row.monthly.id);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={BUDGET_MANAGER_TITLE}
      className="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-xs text-gray-400" role="status" aria-live="polite">
            {message}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <Button type="button" onClick={save} disabled={busy || !dirty}>
              Salvar
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2" role="group" aria-label="Mês do orçamento">
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() => go(prev)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              ‹
            </button>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold capitalize text-white">{monthTitle(period)}</span>
            <button
              type="button"
              aria-label="Próximo mês"
              disabled={!canGoNext}
              onClick={() => go(nextMonth(period))}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
          </div>

          {familyActive && (
            <label className="flex items-center gap-2 text-xs text-gray-300">
              Responsável
              <select
                value={ownerId}
                onChange={(e) => {
                  setOwnerId(e.target.value);
                  setDrafts({});
                  setErrors({});
                  setMessage(undefined);
                }}
                className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-100"
              >
                {owners!.map((o) => (
                  <option key={o.userId} value={o.userId}>
                    {o.userId === currentUserId ? 'Você' : o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!rights.canCreate && <p className="text-xs text-amber-300/90">{BUDGET_ONLY_OWNER_CREATES}</p>}

        <div className="rounded-xl border border-white/5 bg-black/20 p-3">
          <p className="text-sm text-gray-200">
            Copiar de <span className="font-semibold">{MONTH_NAMES[prev.month - 1]}</span>
          </p>
          <p className="text-xs text-gray-400">
            {copyPlan.toCreate.length} {copyPlan.toCreate.length === 1 ? 'categoria' : 'categorias'} ·{' '}
            {formatCurrency(copyPlan.totalAmount)} planejados
            {copyPlan.skippedExisting > 0 && ` · ${copyPlan.skippedExisting} já definidas neste mês`}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-2 !px-4 !py-2 text-sm"
            onClick={copy}
            disabled={busy || !rights.canCopy || copyPlan.toCreate.length === 0}
          >
            Copiar de {MONTH_NAMES[prev.month - 1]}
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhuma categoria de despesa disponível. Crie categorias em Configurações.</p>
        ) : (
          <ul className="divide-y divide-white/5" aria-label={`Orçamento de ${monthTitle(period)}`}>
            {rows.map((row) => {
              const label = sourceLabel(row, period.year);
              const canType = row.monthly ? rights.canEditExisting : rights.canCreate && row.eligible;
              const id = `budget-row-${row.Categoria.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
              return (
                <li key={row.Categoria} className="min-w-0 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-gray-100">{row.Categoria}</p>
                      <p className="text-xs text-gray-400">
                        {label}
                        {row.effective && <> · {formatCurrency(row.effective.amount)}</>}
                      </p>
                    </div>
                    {row.monthly && rights.canDeleteExisting && (
                      <button
                        type="button"
                        onClick={() => void removeMonthly(row)}
                        className="rounded text-xs text-danger hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        aria-label={`Remover o orçamento de ${row.Categoria} deste mês`}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  {canType ? (
                    <div className="mt-1.5 max-w-xs">
                      <Input
                        id={id}
                        label={row.monthly ? 'Valor deste mês (R$)' : 'Definir valor para este mês (R$)'}
                        inputMode="decimal"
                        placeholder={row.monthly ? undefined : 'Ex.: 1500'}
                        value={drafts[row.Categoria] ?? (row.monthly ? String(row.monthly.amount).replace('.', ',') : '')}
                        onChange={(e) => setDrafts((d) => ({ ...d, [row.Categoria]: e.target.value }))}
                        error={errors[row.Categoria]}
                      />
                    </div>
                  ) : (
                    !row.eligible && row.effective && <p className="mt-1 text-xs text-gray-500">Categoria fora das regras de novos orçamentos.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default BudgetManagerPanel;
