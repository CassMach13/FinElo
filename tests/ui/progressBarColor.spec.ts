import { describe, expect, it } from 'vitest';
import { resolveProgressBarColor } from '../../src/components/ui/ProgressBar';

/**
 * A barra de "Investimentos" no painel 50-30-20 ficava vermelha ao BATER a
 * meta de 20% — o oposto do que deveria acontecer numa meta de poupança,
 * onde mais é melhor.
 *
 * ===========================================================================
 * A CAUSA
 * ===========================================================================
 *
 * `Rule503020Widget` passava `color={barColor}` para `ProgressBar`, mas o
 * componente não tinha essa prop — o valor era descartado em silêncio, e o
 * componente sempre recalculava a cor sozinho pela regra "passou de 100% do
 * alvo = vermelho". Essa regra é certa para orçamento (mais gasto é ruim,
 * teto), mas errada para investimento (mais aporte é bom, piso) — e é
 * exatamente a mesma função que as duas barras usam.
 *
 * A correção não inverte a regra automática (o card de Monitoramento de
 * Orçamento continua precisando dela, sem passar `color`); ela dá ao
 * chamador o poder de dizer "esta cor é fixa, não recalcule".
 */

describe('cor da barra — orçamento continua com o sentido antigo', () => {
  // Nenhum destes testes passa `color`: é o caminho do Monitoramento de
  // Orçamento, que precisa continuar marcando de vermelho ao estourar.
  it('sem passar do alvo, fica verde', () => {
    expect(resolveProgressBarColor(50, 100)).toBe('bg-accent');
  });

  it('entre 80% e 100% do alvo, fica amarelo', () => {
    expect(resolveProgressBarColor(85, 100)).toBe('bg-yellow-500');
  });

  it('passando de 100% do alvo, fica vermelho — orçamento estourado é ruim', () => {
    expect(resolveProgressBarColor(110, 100)).toBe('bg-danger');
  });

  it('com ritmo esperado (pacing), vermelho é 20% acima do esperado', () => {
    expect(resolveProgressBarColor(130, 200, { expectedPacing: 0.5 })).toBe('bg-danger');
    expect(resolveProgressBarColor(108, 200, { expectedPacing: 0.5 })).toBe('bg-yellow-500');
    expect(resolveProgressBarColor(90, 200, { expectedPacing: 0.5 })).toBe('bg-accent');
  });
});

describe('cor fixa — o bug do 50-30-20', () => {
  it('bater ou passar da meta de investimento NÃO fica vermelho quando a cor é fixa', () => {
    // Exatamente o caso do chamado: aporte bate ou passa da meta de 20%.
    expect(resolveProgressBarColor(20, 20, { color: 'bg-green-500' })).toBe('bg-green-500');
    expect(resolveProgressBarColor(35, 20, { color: 'bg-green-500' })).toBe('bg-green-500');
  });

  it('a cor fixa vale mesmo com pacing informado — ela tem prioridade sobre as duas regras automáticas', () => {
    expect(
      resolveProgressBarColor(500, 100, { expectedPacing: 0.5, color: 'bg-green-500' })
    ).toBe('bg-green-500');
  });

  it('a cor fixa vale para qualquer categoria do 50-30-20, não só investimentos', () => {
    expect(resolveProgressBarColor(999, 50, { color: 'bg-blue-500' })).toBe('bg-blue-500');
    expect(resolveProgressBarColor(999, 30, { color: 'bg-purple-500' })).toBe('bg-purple-500');
  });
});
