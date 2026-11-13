import { useId, useState, useSyncExternalStore } from 'react';
import { SYSTEM_DARK_QUERY, resolveAppearanceTheme, type AppearanceTheme } from '../../domain/appearance/theme';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import MultiSelect from '../ui/MultiSelect';
import SummaryCard from '../ui/SummaryCard';
import { SkeletonCard } from '../ui/Skeleton';
import ProgressBar from '../ui/ProgressBar';
import { NavItem } from '../ui/NavItem';
import { GlobalDialog } from '../ui/GlobalDialog';
import { DashboardIcon, SettingsIcon, UploadIcon } from '../ui/icons';
import AuthenticatedShell from '../../layouts/AuthenticatedShell';
import { createDialogStore, type DialogVariant } from '../../hooks/useDialogStore';
import UserAccountWidget from '../views/UserAccountWidget';
import './appearance.css';

const referenceDialogs = createDialogStore();

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
  const [selection, setSelection] = useState<string[]>(['casa']);
  const [nav, setNav] = useState('dashboard');
  const [dialogVariant, setDialogVariant] = useState<DialogVariant>('warning');
  const dialogOpen = referenceDialogs(state => state.isOpen);
  const closeModal = () => {
    setModalOpen(false);
    requestAnimationFrame(() => document.getElementById(id + '-open')?.focus());
  };

  return (
    <div data-finelo-theme={theme} className="bg-theme-canvas text-theme-content rounded-xl overflow-hidden">
      <div inert={modalOpen || dialogOpen}>
        <AuthenticatedShell
          idPrefix={id + '-reference-'}
          header={<><span className="text-lg font-bold">FinElo · Amostra</span><UserAccountWidget position="top" /></>}
          navigation={<>
            <h1 className="hidden lg:block text-xl font-bold mb-6 px-3">FinElo</h1>
            <div className="flex landscape:max-lg:flex-col lg:flex-col justify-around w-full gap-1">
              <NavItem view="dashboard" label="Dashboard" icon={<DashboardIcon />} isActive={nav === 'dashboard'} onClick={() => setNav('dashboard')} />
              <NavItem view="import" label="Importar" icon={<UploadIcon />} isActive={nav === 'import'} onClick={() => setNav('import')} />
              <NavItem view="settings" label="Configurações" icon={<SettingsIcon />} isActive={nav === 'settings'} onClick={() => setNav('settings')} badge={2} />
            </div>
            <div className="hidden lg:block mt-auto"><UserAccountWidget /></div>
          </>}
        >
        <div className="space-y-4">
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
            <MultiSelect label="Contas da amostra" options={[{value:'casa',label:'Casa'},{value:'trabalho',label:'Trabalho'}]} value={selection} onChange={setSelection} />
            <Input id={id + '-error'} label="Campo inválido" error="Informe uma descrição." defaultValue="" />
            <Input id={id + '-disabled'} label="Campo desabilitado" disabled defaultValue="Somente leitura" />
            <Select id={id + '-dialog-type'} label="Tipo de diálogo" value={dialogVariant} onChange={event => setDialogVariant(event.target.value as DialogVariant)}>
              <option value="info">Informação</option><option value="warning">Alerta</option><option value="danger">Erro</option><option value="success">Sucesso</option>
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button id={id + '-open'} type="button" onClick={() => setModalOpen(true)}>Abrir modal</Button>
              <Button type="button" variant="secondary" disabled>Indisponível</Button>
              <Button type="button" variant="secondary">Secundário</Button>
              <Button type="button" variant="outline">Contorno</Button>
              <Button type="button" variant="ghost">Discreto</Button>
              <Button type="button" variant="secondary" onClick={() => void referenceDialogs.getState().openDialog({ title:'Confirmação da amostra', message:'Dados fictícios. Nenhum lançamento será gravado.', variant:dialogVariant, confirmText:'Confirmar' })}>Abrir diálogo</Button>
            </div>
          </div>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard title="Saldo da amostra" value="R$ 1.250,00" subValue="Dados fictícios" icon={<DashboardIcon />} tooltip="Resumo de referência" compare={{periodLabel:'mês anterior',value:'R$ 1.100,00',deltaLabel:'+13,6%',deltaTone:'positive'}} />
          <SummaryCard title="Saídas da amostra" value="R$ 350,00" variant="danger" subValue="Dados fictícios" icon={<UploadIcon />} />
          <SummaryCard title="Reserva" value="R$ 500,00" variant="success" />
          <SummaryCard title="Limite" value="R$ 900,00" variant="warning" />
        </div>
        <Card title="Estados de carregamento e progresso">
          <div className="space-y-4">
            <SkeletonCard />
            <ProgressBar value={50} max={100} />
            <ProgressBar value={85} max={100} />
            <ProgressBar value={120} max={100} />
          </div>
        </Card>
        </div>
        </AuthenticatedShell>
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
      <GlobalDialog dialogStore={referenceDialogs} />
    </div>
  );
}
