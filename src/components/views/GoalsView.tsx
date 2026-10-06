import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { appConfirm } from '../../hooks/useDialogStore';
import type { FinancialGoal } from '../../types';
import { splitAndSortGoals } from '../../domain/goals/goalProgress';
import { localTodayIso } from '../../utils/dateOnly';
import Button from '../ui/Button';
import { InformationCircleIcon } from '../ui/icons';
import GoalCard from '../goals/GoalCard';
import GoalFormModal, { type GoalFormValue } from '../goals/GoalFormModal';
import UpdateGoalValueModal from '../goals/UpdateGoalValueModal';

export const GOALS_TITLE = 'Objetivos';
export const GOALS_SUBTITLE = 'Acompanhe quanto falta para os seus planos.';
export const GOALS_MANUAL_NOTE = 'Os valores são informados por você. O FinElo não movimenta suas contas.';
export const GOALS_EMPTY_TITLE = 'Transforme seus planos em objetivos acompanháveis.';
export const GOALS_EMPTY_CTA = 'Criar primeiro objetivo';
export const GOALS_DELETE_MESSAGE =
  'Excluir este objetivo? Isso não altera suas contas nem suas transações.';

export interface GoalsPanelProps {
  goals: FinancialGoal[];
  status: 'idle' | 'loading' | 'success' | 'error';
  today: string;
  onRetry: () => void;
  onCreate: (value: GoalFormValue) => Promise<boolean>;
  onEdit: (id: string, value: GoalFormValue) => Promise<boolean>;
  onUpdateCurrent: (id: string, value: number) => Promise<boolean>;
  onArchive: (id: string) => Promise<boolean>;
  onUnarchive: (id: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  /** Só para teste/SSR. */
  initialShowArchived?: boolean;
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; goal: FinancialGoal }
  | { kind: 'value'; goal: FinancialGoal };

/** Apresentação pura: sem acesso ao store, para poder ser testada. */
export const GoalsPanel: React.FC<GoalsPanelProps> = ({
  goals,
  status,
  today,
  onRetry,
  onCreate,
  onEdit,
  onUpdateCurrent,
  onArchive,
  onUnarchive,
  onDelete,
  initialShowArchived = false,
}) => {
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [showArchived, setShowArchived] = useState(initialShowArchived);
  const { main, archived } = useMemo(() => splitAndSortGoals(goals), [goals]);

  const close = () => setModal({ kind: 'none' });

  const confirmDelete = async (goal: FinancialGoal) => {
    const ok = await appConfirm(GOALS_DELETE_MESSAGE, 'Excluir objetivo', 'Excluir', 'danger');
    if (ok) await onDelete(goal.id);
  };

  const cardProps = {
    today,
    onUpdateValue: (g: FinancialGoal) => setModal({ kind: 'value', goal: g }),
    onEdit: (g: FinancialGoal) => setModal({ kind: 'edit', goal: g }),
    onArchive: (g: FinancialGoal) => void onArchive(g.id),
    onUnarchive: (g: FinancialGoal) => void onUnarchive(g.id),
    onDelete: (g: FinancialGoal) => void confirmDelete(g),
  };

  const isEmpty = goals.length === 0;

  return (
    <div id="goals-view" className="space-y-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">{GOALS_TITLE}</h1>
          <p className="text-sm text-gray-400">{GOALS_SUBTITLE}</p>
        </div>
        <Button onClick={() => setModal({ kind: 'create' })} className="shrink-0">
          + Novo objetivo
        </Button>
      </div>

      <p className="flex items-start gap-1.5 text-xs leading-snug text-gray-500">
        <InformationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{GOALS_MANUAL_NOTE}</span>
      </p>

      {status === 'error' && isEmpty ? (
        <div role="alert" className="rounded-2xl border border-white/5 bg-secondary/30 p-6 text-center">
          <p className="text-sm text-gray-300">Não foi possível carregar seus objetivos.</p>
          <Button variant="secondary" className="mt-3" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      ) : (status === 'idle' || status === 'loading') && isEmpty ? (
        <p className="text-sm text-gray-400" aria-live="polite">
          Carregando objetivos…
        </p>
      ) : isEmpty ? (
        <div className="rounded-2xl border border-white/5 bg-secondary/30 p-8 text-center">
          <p className="mx-auto max-w-sm text-lg font-semibold text-white">{GOALS_EMPTY_TITLE}</p>
          <Button className="mt-4" onClick={() => setModal({ kind: 'create' })}>
            {GOALS_EMPTY_CTA}
          </Button>
        </div>
      ) : (
        <>
          {main.length > 0 && (
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Objetivos">
              {main.map((g) => (
                <li key={g.id} className="min-w-0">
                  <GoalCard goal={g} {...cardProps} />
                </li>
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <section>
              <button
                type="button"
                aria-expanded={showArchived}
                aria-controls="goals-archived"
                onClick={() => setShowArchived((v) => !v)}
                className="rounded text-sm font-semibold text-gray-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {showArchived ? '▾' : '▸'} Arquivados ({archived.length})
              </button>
              {showArchived && (
                <ul id="goals-archived" className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {archived.map((g) => (
                    <li key={g.id} className="min-w-0">
                      <GoalCard goal={g} {...cardProps} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {modal.kind === 'create' && (
        <GoalFormModal today={today} onClose={close} onSave={onCreate} />
      )}
      {modal.kind === 'edit' && (
        <GoalFormModal goal={modal.goal} today={today} onClose={close} onSave={(v) => onEdit(modal.goal.id, v)} />
      )}
      {modal.kind === 'value' && (
        <UpdateGoalValueModal goal={modal.goal} onClose={close} onSave={(v) => onUpdateCurrent(modal.goal.id, v)} />
      )}
    </div>
  );
};

const GoalsView: React.FC = () => {
  const goals = useAppStore((s) => s.goals);
  const status = useAppStore((s) => s.goalsStatus);
  const user = useAppStore((s) => s.user);
  const fetchGoals = useAppStore((s) => s.fetchGoals);
  const createGoal = useAppStore((s) => s.createGoal);
  const updateGoal = useAppStore((s) => s.updateGoal);
  const updateGoalCurrentAmount = useAppStore((s) => s.updateGoalCurrentAmount);
  const archiveGoal = useAppStore((s) => s.archiveGoal);
  const unarchiveGoal = useAppStore((s) => s.unarchiveGoal);
  const deleteGoal = useAppStore((s) => s.deleteGoal);

  // Carrega ao abrir a view (e se o usuário mudar); fetchGoals não repete busca já feita.
  useEffect(() => {
    void fetchGoals();
  }, [fetchGoals, user?.id]);

  return (
    <GoalsPanel
      goals={goals}
      status={status}
      today={localTodayIso()}
      onRetry={() => void fetchGoals({ force: true })}
      onCreate={(v) =>
        createGoal({
          name: v.name,
          target_amount: v.target_amount,
          current_amount: v.current_amount ?? 0,
          target_date: v.target_date,
        })
      }
      onEdit={(id, v) =>
        updateGoal(id, { name: v.name, target_amount: v.target_amount, target_date: v.target_date })
      }
      onUpdateCurrent={updateGoalCurrentAmount}
      onArchive={archiveGoal}
      onUnarchive={unarchiveGoal}
      onDelete={deleteGoal}
    />
  );
};

export default GoalsView;
