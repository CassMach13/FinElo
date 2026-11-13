import './remaining.css';
import { useId, useState } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { APPEARANCE_THEME_KEY, isAppearancePilotEnabled, isAppearanceTheme, type AppearanceTheme } from '../../domain/appearance/theme';
import Card from '../ui/Card';

const options = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Automático' },
] as const;

function AppearanceSelector({ preference }: { preference: AppearanceTheme }) {
  const updateUserPreferences = useAppStore(state => state.updateUserPreferences);
  const group = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function save(theme: AppearanceTheme) {
    setSaving(true);
    setError(false);
    try {
      await updateUserPreferences({ [APPEARANCE_THEME_KEY]: theme });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="no-print space-y-4" aria-label="Aparência">
      <Card title="Aparência">
        <fieldset disabled={saving} aria-describedby={group + '-help'}>
          <legend data-finance="content" className="font-semibold text-light">Tema do aplicativo</legend>
          <p data-finance="content" id={group + '-help'} className="mt-1 text-sm text-slate-300">O tema das telas autenticadas fica salvo na sua conta. Automático acompanha a aparência do dispositivo.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {options.map(({ value, label }) => (
              <label data-finance="content" key={value} className="inline-flex min-h-8 items-center gap-2 text-light">
                <input type="radio" name={group} checked={preference === value} onChange={() => void save(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {saving && <p data-finance="content" role="status" className="text-sm text-slate-300">Salvando aparência…</p>}
        {error && <p data-finance="negative" role="alert" className="text-sm text-red-300">Não foi possível salvar. Escolha o tema novamente para tentar de novo.</p>}
      </Card>
    </section>
  );
}

export default function AppearanceSettings() {
  const user = useAppStore(state => state.user);
  if (!user || !isAppearancePilotEnabled(user)) return null;
  const value = user.user_metadata[APPEARANCE_THEME_KEY];
  return <div key={user.id}><AppearanceSelector preference={isAppearanceTheme(value) ? value : 'dark'} /></div>;
}
