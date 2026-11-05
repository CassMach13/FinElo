import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/components/appearance/appearance.css', import.meta.url), 'utf8');
const light = css.split('[data-finelo-theme="light"] {')[1].split('}')[0];
const colors = new Map(
  [...light.matchAll(/--appearance-([\w-]+): (\d+) (\d+) (\d+);/g)]
    .map(([, name, r, g, b]) => [name, [Number(r), Number(g), Number(b)]])
);

function luminance(channels: number[]): number {
  return channels.map(value => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}

describe('contraste da paleta clara', () => {
  it.each([
    ['content', 'surface', 4.5], ['muted', 'canvas', 4.5], ['placeholder', 'control', 4.5],
    ['on-action', 'action', 4.5], ['on-action', 'action-end', 4.5],
    ['on-action', 'action-hover', 4.5], ['on-action', 'action-hover-end', 4.5],
    ['control-border', 'control', 3], ['focus', 'surface', 3], ['focus', 'canvas', 3],
    ['content', 'selected', 4.5], ['on-disabled', 'disabled', 4.5],
    ['success', 'success-surface', 4.5], ['warning', 'warning-surface', 4.5],
    ['danger', 'danger-surface', 4.5], ['info', 'info-surface', 4.5],
    ['positive', 'surface', 4.5], ['negative', 'surface', 4.5],
    ...[1, 2, 3, 4, 5].map(index => [`chart-${index}`, 'surface', 3] as const),
  ] as const)('%s sobre %s alcança %s:1', (front, back, threshold) => {
    const [lighter, darker] = [luminance(colors.get(front)!), luminance(colors.get(back)!)].sort((a, b) => b - a);
    expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(threshold);
  });
});
