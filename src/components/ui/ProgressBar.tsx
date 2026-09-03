import React from 'react';

interface ProgressBarProps {
  value: number;
  max: number;
  expectedPacing?: number; // 0.0 to 1.0 (defaults to 1.0 if not provided)
  /**
   * Cor fixa do preenchimento (ex. 'bg-green-500'). Quando informada, tem
   * prioridade sobre o cálculo automático abaixo — existe para barras cujo
   * "mais é melhor" (ex. investimentos numa meta 50-30-20), onde marcar de
   * vermelho ao ultrapassar o alvo inverteria o sentido do indicador.
   *
   * Sem esta cor, `resolveProgressBarColor` assume que exceder `max` é
   * sempre ruim — correto para orçamento/gasto, errado para meta de
   * poupança. O chamador decide qual dos dois sentidos vale.
   */
  color?: string;
}

/**
 * A cor do preenchimento, isolada do JSX para poder ser testada sem
 * renderizar nada.
 */
export function resolveProgressBarColor(
  value: number,
  max: number,
  options: { expectedPacing?: number; color?: string } = {}
): string {
  const { expectedPacing, color } = options;
  if (color) return color;

  const percentage = max > 0 ? (value / max) * 100 : 0;

  if (expectedPacing !== undefined && expectedPacing >= 0) {
    // Dynamic pacing logic
    const expectedValue = max * expectedPacing;

    // We give a tiny 5% tolerance
    if (value > max || value > expectedValue * 1.20) {
      return 'bg-danger'; // Over 20% above expected - Red
    }
    if (value > expectedValue * 1.05) {
      return 'bg-yellow-500'; // Slightly above expected - Yellow
    }
    return 'bg-accent';
  }

  // Fallback logic for basic progress bars
  return percentage > 100 ? 'bg-danger' : percentage > 80 ? 'bg-yellow-500' : 'bg-accent';
}

const ProgressBar: React.FC<ProgressBarProps> = ({ value, max, expectedPacing, color }) => {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  const clampedPercentage = Math.min(percentage, 100);
  const barColor = resolveProgressBarColor(value, max, { expectedPacing, color });

  return (
    <div className="w-full bg-primary rounded-full h-2.5">
      <div
        className={`${barColor} h-2.5 rounded-full transition-all duration-500`}
        style={{ width: `${clampedPercentage}%` }}
      ></div>
    </div>
  );
};

export default ProgressBar;
