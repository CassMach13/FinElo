import { useId, useState, useSyncExternalStore } from 'react';
import { SYSTEM_DARK_QUERY, resolveAppearanceTheme, type AppearanceTheme } from '../../domain/appearance/theme';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import './appearance.css';

function systemPrefersDark() {
  return window.matchMedia?.(SYSTEM_DARK_QUERY).matches ?? true;
}

function subscribeToSystemTheme(onChange: () => void) {
  const media = window.matchMedia?.(SYSTEM_DARK_QUERY);
  media?.addEventListener?.('change', onChange);
  return () => media?.removeEventListener?.('change', onChange);
}

const subscribeToNothing = () => () => {};
const darkSnapshot = () => true;

export default function AppearanceReference({ preference }: { preference: AppearanceTheme }) {
  const id = useId();
  const automatic = preference === 'system';
  const systemDark = useSyncExternalStore(
    automatic ? subscribeToSystemTheme : subscribeToNothing,
    automatic ? systemPrefersDark : darkSnapshot,
    darkSnapshot
  );
  const theme = resolveAppearanceTheme(preference, systemDark);
  const [modalOpen, setModalOpen] = useState(false);
  const closeModal = () => {
    setModalOpen(false);
    requestAnimationFrame(() => document.getElementById(id + '-open')?.focus());
  };

  return (
    <div data-finelo-theme={theme} className="bg-theme-canvas text-theme-content rounded-xl p-4 sm:p-6">
      <div inert={modalOpen}>
        <Card title="Componentes de referência">
          <div className="space-y-4">
            <p className="text-theme-muted text-sm">Amostra de um formulário de lançamento.</p>
            <Input id={id + '-name'} label="Descrição" placeholder="Ex.: Material de escritório" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select id={id + '-category'} label="Categoria" defaultValue="casa">
                <option value="casa">Casa</option>
                <option value="trabalho">Trabalho</option>
              </Select>
              <Input id={id + '-date'} label="Data" type="date" defaultValue="2026-11-04" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button id={id + '-open'} type="button" onClick={() => setModalOpen(true)}>Abrir modal</Button>
              <Button type="button" variant="secondary" disabled>Indisponível</Button>
            </div>
          </div>
        </Card>
      </div>
      <Modal
        isOpen={modalOpen}
        title="Exemplo de modal"
        dialogLabel="Exemplo de modal"
        onClose={closeModal}
        hideCloseButton
        footer={
          <Button
            type="button"
            autoFocus
            onClick={closeModal}
            onKeyDown={event => {
              if (event.key === 'Tab') event.preventDefault();
              if (event.key === 'Escape') closeModal();
            }}
          >
            Fechar
          </Button>
        }
      >
        <p>Esta amostra usa dados fictícios.</p>
      </Modal>
    </div>
  );
}
