import { useId, useState } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { APPEARANCE_THEME_KEY, isAppearancePilotEnabled, isAppearanceTheme, type AppearanceTheme } from '../../domain/appearance/theme';
import Card from '../ui/Card';
import AppearanceReference from './AppearanceReference';

const options = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Automático' },
] as const;

function AppearancePilot({ preference }: { preference: AppearanceTheme }) {
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
    <section className="no-print space-y-4" aria-label="Piloto de aparência">
      <Card title="Aparência">
        <fieldset disabled={saving} aria-describedby={group + '-help'}>
          <legend className="font-semibold text-light">Tema da amostra</legend>
          <p id={group + '-help'} className="mt-1 text-sm text-slate-300">A preferência fica na sua conta. Neste piloto, ela se aplica à amostra abaixo.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {options.map(({ value, label }) => (
              <label key={value} className="inline-flex min-h-8 items-center gap-2 text-light">
                <input type="radio" name={group} checked={preference === value} onChange={() => void save(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {saving && <p role="status" className="text-sm text-slate-300">Salvando aparência…</p>}
        {error && <p role="alert" className="text-sm text-red-300">Não foi possível salvar. Escolha o tema novamente para tentar de novo.</p>}
      </Card>
      <AppearanceReference preference={preference} />
    </section>
  );
}

export default function AppearanceSettings() {
  const user = useAppStore(state => state.user);
  if (!user || !isAppearancePilotEnabled(user)) return null;
  const value = user.user_metadata[APPEARANCE_THEME_KEY];
  return <div key={user.id}><AppearancePilot preference={isAppearanceTheme(value) ? value : 'dark'} /></div>;
}
