import React, { useEffect, useState } from 'react';
import type { FinancialGoal } from '../../types';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import {
  GOAL_NAME_MAX_LENGTH,
  monthOf,
  validateGoalForm,
  type GoalFormErrors,
} from '../../domain/goals/goalProgress';

export interface GoalFormValue {
  name: string;
  target_amount: number;
  current_amount?: number;
  target_date: string | null;
}

interface Props {
  /** Presente = edição (não pede "quanto já tenho"; isso é só em "Atualizar valor"). */
  goal?: FinancialGoal | null;
  today: string;
  onClose: () => void;
  onSave: (value: GoalFormValue) => Promise<boolean> | boolean;
}

const GoalFormModal: React.FC<Props> = ({ goal, today, onClose, onSave }) => {
  const isEdit = !!goal;
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? String(goal.target_amount).replace('.', ',') : '');
  const [current, setCurrent] = useState('');
  const [month, setMonth] = useState(monthOf(goal?.target_date) ?? '');
  const [errors, setErrors] = useState<GoalFormErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const todayMonth = monthOf(today) ?? '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const result = validateGoalForm(
      { name, target, current, month },
      { mode: isEdit ? 'edit' : 'create', today, existingTargetDate: goal?.target_date }
    );
    setErrors(result.errors);
    if (!result.value) return;
    setSaving(true);
    try {
      const ok = await onSave(result.value);
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Editar objetivo' : 'Novo objetivo'}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="goal-form" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      <form id="goal-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          id="goal-name"
          label="Nome"
          value={name}
          maxLength={GOAL_NAME_MAX_LENGTH + 20}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Reserva de emergência"
          error={errors.name}
          autoFocus
        />
        <Input
          id="goal-target"
          label="Valor desejado (R$)"
          inputMode="decimal"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Ex.: 30000"
          error={errors.target}
        />
        {!isEdit && (
          <Input
            id="goal-current"
            label="Quanto já tenho (R$)"
            inputMode="decimal"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="0"
            error={errors.current}
          />
        )}
        <Input
          id="goal-month"
          label="Mês e ano do objetivo (opcional)"
          type="month"
          value={month}
          min={isEdit && goal?.target_date ? undefined : todayMonth}
          onChange={(e) => setMonth(e.target.value)}
          error={errors.month}
          helpText="Com um prazo, mostramos quanto guardar por mês. Sem prazo, mostramos só o progresso."
        />
        {isEdit && (
          <p className="text-xs text-gray-500">
            Para mudar quanto você já tem, use &quot;Atualizar valor&quot; no card do objetivo.
          </p>
        )}
      </form>
    </Modal>
  );
};

export default GoalFormModal;
