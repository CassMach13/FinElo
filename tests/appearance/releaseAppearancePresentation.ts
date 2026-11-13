/** Reverse only the reviewed release gate/copy delta before historical source checks. */
export function releaseAppearancePresentation(file: string, source: string): string {
  const pairs = file === 'src/domain/appearance/theme.ts' ? [
    [',\n  releaseFlag = import.meta.env.VITE_APPEARANCE_RELEASE', ''],
    ["  if (!user?.id) return false;\n  // Production release and staging pilot are independent, build-time opt-ins.\n  if (mode === 'production') return releaseFlag === 'true';\n  return mode === 'staging' && flag === 'true' && user.app_metadata.appearance_pilot === true;", "  return mode === 'staging' && flag === 'true' && Boolean(user?.id && user.app_metadata.appearance_pilot === true);"],
  ] : file === 'src/components/appearance/AppearanceSettings.tsx' ? [
    ['function AppearanceSelector(', 'function AppearancePilot('],
    ['aria-label="Aparência"', 'aria-label="Piloto de aparência"'],
    ['<AppearanceSelector preference=', '<AppearancePilot preference='],
  ] : [];
  let previous = source.replaceAll('\r\n', '\n');
  for (const [current, original] of pairs) {
    if (previous.split(current).length !== 2) throw new Error(`Unexpected release change in ${file}`);
    previous = previous.replace(current, original);
  }
  return previous;
}
