import React, { useEffect, useState } from 'react';
import type { FinancialGoal } from '../../types';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { parseMoneyInput } from '../../domain/goals/goalProgress';

interface Props {
  goal: FinancialGoal;
  onClose: () => void;
  onSave: (currentAmount: number) => Promise<boolean> | boolean;
}

/** Altera somente `current_amount`. Não é aporte nem transferência: não existe ledger. */
const UpdateGoalValueModal: React.FC<Props> = ({ goal, onClose, onSave }) => {
  const [value, setValue] = useState(String(goal.current_amount).replace('.', ','));
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const parsed = parseMoneyInput(value);
    if (parsed === null || parsed < 0) {
      setError('Informe um valor igual ou maior que zero.');
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const ok = await onSave(parsed);
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Atualizar valor"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="goal-value-form" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      <form id="goal-value-form" onSubmit={submit} className="space-y-3" noValidate>
        <p className="break-words text-sm text-gray-300">{goal.name}</p>
        <Input
          id="goal-current-value"
          label="Quanto você tem hoje para este objetivo? (R$)"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
          autoFocus
        />
        <p className="text-xs text-gray-500">
          Informe o total que você já separou. O FinElo não movimenta suas contas.
        </p>
      </form>
    </Modal>
  );
};

export default UpdateGoalValueModal;
