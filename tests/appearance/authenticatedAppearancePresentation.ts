import { releaseAppearancePresentation } from './releaseAppearancePresentation';

/** Undo the exact scope and copy changes before checking historical source seals. */
export function authenticatedAppearancePresentation(file: string, source: string): string {
  const pairs = file === 'src/App.tsx' ? [
    ["import AuthenticatedAppearance from './components/appearance/AuthenticatedAppearance';\n", ''],
    ['<AuthenticatedAppearance><MainLayout key={user?.id} /></AuthenticatedAppearance>', '<MainLayout key={user?.id} />'],
    ['    <AuthenticatedAppearance>\n      <GlobalDialog />\n      <ReloadPrompt />\n    </AuthenticatedAppearance>', '    <GlobalDialog />\n    <ReloadPrompt />'],
  ] : file === 'src/components/appearance/AppearanceSettings.tsx' ? [
    ["import Card from '../ui/Card';", "import Card from '../ui/Card';\nimport AppearanceReference from './AppearanceReference';"],
    ['Tema do aplicativo', 'Tema da amostra'],
    ['O tema das telas autenticadas fica salvo na sua conta. Automático acompanha a aparência do dispositivo.', 'A preferência fica na sua conta. Neste piloto, ela se aplica à amostra abaixo.'],
    ['      </Card>\n    </section>', '      </Card>\n      <AppearanceReference preference={preference} />\n    </section>'],
  ] : file === 'src/components/appearance/appearance.css' ? [
    ['Light is scoped to the authenticated pilot and its overlays.', 'Light is scoped to the isolated pilot; no application-wide theme is applied.'],
    ['  [data-finelo-theme="light"] [data-appearance-part="nav-item"][data-appearance-active="true"] > [data-finance~="warning"] {\n    color: inherit;\n  }\n\n', ''],
  ] : [];

  let historical = releaseAppearancePresentation(file, source);
  for (const [current, previous] of pairs) {
    if (historical.split(current).length !== 2) throw new Error(`Unexpected appearance change in ${file}`);
    historical = historical.replace(current, previous);
  }
  return historical;
}
