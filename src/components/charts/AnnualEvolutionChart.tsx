import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { computeAnnualChangePercent, type AnnualEvolutionMonth } from '../../utils/annualEvolution';
import { formatCurrency } from '../../utils/formatters';
import { formatPercentChange } from '../../utils/periodComparison';

/**
 * Quatro linhas (entradas/saídas × ano atual/anterior) em SVG nativo: o projeto não usa
 * biblioteca de gráficos. Visual "Equilíbrio" (Figma): curvas suaves, ano atual forte com brilho e
 * área sutis, ano anterior tracejado e discreto, sem pontos permanentes. Recebe o modelo agregado,
 * nunca transações: nenhuma regra financeira vive aqui.
 */

export const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MONTH_LONG = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

interface Props {
  months: AnnualEvolutionMonth[];
  currentYear: number;
  previousYear: number;
}

/** Cores locais do gráfico (não são tokens globais). */
export const CHART_COLORS = {
  incomeCurrent: '#49d2c7',
  expenseCurrent: '#ff7673',
  incomePrevious: '#6dcec8',
  expensePrevious: '#ff9794',
} as const;

export const CURVE_TENSION = 0.15;

// Largura inicial (antes da medição / SSR): desktop. O ResizeObserver corrige no cliente.
const DEFAULT_WIDTH = 800;
const PAD = { top: 16, right: 14, bottom: 26, left: 52 };
const SURFACE = '#0e1622';

const compactBRL = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/** Medidas responsivas (largura MEDIDA do gráfico): linha atual 2px até 760, tooltip 194/210 e topo 15/28. */
export function chartMetrics(width: number): {
  height: number;
  currentStroke: number;
  glowStroke: number;
  tooltipWidth: number;
  tooltipTop: number;
  tooltipPadding: number;
} {
  const mobile = width <= 760;
  const small = width < 520;
  return {
    height: small ? 245 : Math.min(310, Math.max(245, Math.round(width * 0.4))),
    currentStroke: mobile ? 2 : 2.65,
    glowStroke: mobile ? 4 : 5,
    tooltipWidth: small ? 194 : 210,
    tooltipTop: small ? 15 : 28,
    tooltipPadding: small ? 11 : 14,
  };
}

/** Teto "redondo" para o eixo Y e 4 divisões. */
export function niceAxis(max: number): { top: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, ticks: [0, 1] };
  const exponent = Math.floor(Math.log10(max));
  const base = 10 ** exponent;
  const steps = [1, 2, 2.5, 5, 10];
  const step = (steps.find((s) => s * base * 4 >= max) ?? 10) * base;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(v);
  return { top, ticks };
}

type SeriesKey = 'incomeCurrent' | 'incomePrevious' | 'expenseCurrent' | 'expensePrevious';

export const NO_DATA_LABEL = 'Sem dados';

/**
 * Ausência de dados vem SÓ da contagem de lançamentos do ano naquele mês. Valor zero com
 * lançamentos no mês é um zero verdadeiro (ex.: mês só com despesas tem entrada R$ 0,00).
 */
export function seriesHasData(month: AnnualEvolutionMonth, key: SeriesKey): boolean {
  return (key.endsWith('Current') ? month.currentCount : month.previousCount) > 0;
}

/** "R$ x" quando o ano tem dados no mês; "Sem dados" quando não tem. */
export function seriesValueLabel(month: AnnualEvolutionMonth, key: SeriesKey): string {
  return seriesHasData(month, key) ? formatCurrency(month[key]) : NO_DATA_LABEL;
}

type Pt = { x: number; y: number };

/** Segmentos separados: `null` (sem dados) encerra o trecho, e a linha não atravessa o mês ausente. */
export function buildGappedPath(points: Array<Pt | null>): string {
  let d = '';
  let open = false;
  for (const p of points) {
    if (!p) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : d ? ' M' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    open = true;
  }
  return d;
}

/** Trechos contínuos (sem `null`); um mês sem dados SEMPRE separa os trechos. */
export function splitSegments(points: Array<Pt | null>): Pt[][] {
  const segments: Pt[][] = [];
  let current: Pt[] = [];
  for (const p of points) {
    if (p) current.push(p);
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

const fmt = (n: number) => n.toFixed(1);

function curveSegment(seg: Pt[], tension: number, yMin: number, yMax: number): string {
  const clampY = (y: number) => Math.min(Math.max(y, yMin), yMax);
  let d = `M${fmt(seg[0].x)},${fmt(seg[0].y)}`;
  for (let i = 0; i < seg.length - 1; i += 1) {
    const prev = seg[i - 1] ?? seg[i];
    const cur = seg[i];
    const point = seg[i + 1];
    const following = seg[i + 2] ?? point;
    const c1x = cur.x + (point.x - prev.x) * tension;
    const c1y = clampY(cur.y + (point.y - prev.y) * tension);
    const c2x = point.x - (following.x - cur.x) * tension;
    const c2y = clampY(point.y - (following.y - cur.y) * tension);
    d += ` C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(point.x)},${fmt(point.y)}`;
  }
  return d;
}

/**
 * Curvas cúbicas suaves por trecho contínuo. Cada trecho começa com `M` e usa `C` internamente; um mês sem dados
 * abre um novo `M` (a curva nunca atravessa o buraco). Os pontos de controle ficam dentro da área vertical do plot.
 */
export function buildSmoothGappedPath(
  points: Array<Pt | null>,
  bounds: { yMin: number; yMax: number },
  tension: number = CURVE_TENSION
): string {
  return splitSegments(points)
    .map((seg) => curveSegment(seg, tension, bounds.yMin, bounds.yMax))
    .join(' ');
}

/** Área sob cada trecho contínuo (mínimo 2 pontos), fechada na linha de base; respeita os mesmos buracos. */
export function buildSmoothGappedArea(
  points: Array<Pt | null>,
  baselineY: number,
  bounds: { yMin: number; yMax: number },
  tension: number = CURVE_TENSION
): string {
  return splitSegments(points)
    .filter((seg) => seg.length >= 2)
    .map((seg) => `${curveSegment(seg, tension, bounds.yMin, bounds.yMax)} L${fmt(seg[seg.length - 1].x)},${fmt(baselineY)} L${fmt(seg[0].x)},${fmt(baselineY)} Z`)
    .join(' ');
}

/** Índice do maior valor entre os meses COM dados; `null` sem dados ou sem valor positivo. Empate: o primeiro. */
export function findPeakIndex(months: AnnualEvolutionMonth[], key: 'incomeCurrent' | 'expenseCurrent'): number | null {
  let best: number | null = null;
  months.forEach((m, i) => {
    if (!seriesHasData(m, key) || !Number.isFinite(m[key])) return;
    if (best === null || m[key] > months[best][key]) best = i;
  });
  return best !== null && months[best][key] > 0 ? best : null;
}

/** Variação % de um mês, só com base válida nos DOIS anos (nunca transforma ausência em zero). */
export function monthChangePercent(month: AnnualEvolutionMonth, kind: 'income' | 'expense'): number | null {
  const cur = kind === 'income' ? 'incomeCurrent' : 'expenseCurrent';
  const prev = kind === 'income' ? 'incomePrevious' : 'expensePrevious';
  if (!seriesHasData(month, cur) || !seriesHasData(month, prev)) return null;
  return computeAnnualChangePercent(month[cur], month[prev]);
}

const PeriodDash: React.FC<{ dashed?: boolean }> = ({ dashed }) => (
  <svg width="14" height="4" aria-hidden="true" className="shrink-0">
    <line x1="1" y1="2" x2="13" y2="2" stroke="#cbd5e1" strokeWidth="1.4" strokeLinecap="round" strokeDasharray={dashed ? '2.5 2.5' : undefined} />
  </svg>
);

const TooltipRow: React.FC<{ label: string; color: string; month: AnnualEvolutionMonth; keyName: SeriesKey }> = ({ label, color, month, keyName }) => (
  <div className="flex items-center justify-between gap-2">
    <dt className="flex items-center gap-1.5 text-gray-400">
      <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </dt>
    <dd className={seriesHasData(month, keyName) ? 'font-semibold text-gray-100' : 'font-normal text-gray-500'}>
      {seriesValueLabel(month, keyName)}
    </dd>
  </div>
);

export const MonthTooltipBody: React.FC<{
  month: AnnualEvolutionMonth;
  currentYear: number;
  previousYear: number;
}> = ({ month: activeMonth, currentYear, previousYear }) => {
  const incomeChange = monthChangePercent(activeMonth, 'income');
  return (
    <>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] capitalize text-white">
        {MONTH_LONG[activeMonth.month - 1]}
      </p>
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-500">
        <PeriodDash />
        Ano atual · {currentYear}
      </p>
      <dl className="mb-2 mt-1 space-y-1 tabular-nums">
        <TooltipRow label="Entradas" color={CHART_COLORS.incomeCurrent} month={activeMonth} keyName="incomeCurrent" />
        <TooltipRow label="Saídas" color={CHART_COLORS.expenseCurrent} month={activeMonth} keyName="expenseCurrent" />
      </dl>
      <div style={{ opacity: 0.72 }} data-tooltip-previous="">
        <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-500">
          <PeriodDash dashed />
          Ano anterior · {previousYear}
        </p>
        <dl className="mt-1 space-y-1 tabular-nums">
          <TooltipRow label="Entradas" color={CHART_COLORS.incomePrevious} month={activeMonth} keyName="incomePrevious" />
          <TooltipRow label="Saídas" color={CHART_COLORS.expensePrevious} month={activeMonth} keyName="expensePrevious" />
        </dl>
      </div>
      {incomeChange !== null && (
        <p className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-gray-400">
          <span>Variação das entradas</span>
          <span className="font-semibold tabular-nums text-gray-200">{formatPercentChange(incomeChange)}</span>
        </p>
      )}
    </>
  );
};

const LegendLine: React.FC<{ color: string; dashed?: boolean; glow?: boolean }> = ({ color, dashed, glow }) => (
  <svg
    width="20"
    height="8"
    aria-hidden="true"
    className={`shrink-0${glow ? ' min-[761px]:[filter:drop-shadow(0_0_3px_var(--glow))]' : ''}`}
    style={glow ? ({ '--glow': `${color}33` } as React.CSSProperties) : undefined}
  >
    <line
      x1="1"
      y1="4"
      x2="19"
      y2="4"
      stroke={color}
      strokeWidth={dashed ? 1.5 : 2.6}
      strokeLinecap="round"
      strokeDasharray={dashed ? '3.5 4' : undefined}
      opacity={dashed ? 0.7 : 1}
    />
  </svg>
);

/**
 * Legenda agrupada: MÉTRICA (cor) | PERÍODO (traço). Os anos vêm do modelo. Desktop (> 760px): solta, com os
 * títulos dos grupos. Mobile: caixa compacta, sem os títulos.
 */
export const ChartLegend: React.FC<{ currentYear: number; previousYear: number }> = ({ currentYear, previousYear }) => (
  <div
    className="mt-3 flex w-full flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-lg border border-white/[0.07] bg-[rgba(12,18,29,.28)] px-2.5 py-[9px] text-[11px] text-gray-300 min-[761px]:mt-0 min-[761px]:w-auto min-[761px]:rounded-none min-[761px]:border-0 min-[761px]:bg-transparent min-[761px]:p-0"
    role="list"
    aria-label="Legenda do gráfico"
  >
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="listitem">
      <span className="hidden text-[9px] font-bold uppercase tracking-[0.14em] text-gray-500 min-[761px]:inline">Métrica</span>
      <span className="flex items-center gap-1.5">
        <LegendLine color={CHART_COLORS.incomeCurrent} glow />
        Entradas
      </span>
      <span className="flex items-center gap-1.5">
        <LegendLine color={CHART_COLORS.expenseCurrent} glow />
        Saídas
      </span>
    </div>
    <span aria-hidden="true" className="hidden h-4 w-px bg-white/10 min-[761px]:block" />
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="listitem">
      <span className="hidden text-[9px] font-bold uppercase tracking-[0.14em] text-gray-500 min-[761px]:inline">Período</span>
      <span className="flex items-center gap-1.5">
        <LegendLine color="#cbd5e1" />
        {currentYear}
      </span>
      <span className="flex items-center gap-1.5">
        <LegendLine color="#cbd5e1" dashed />
        {previousYear}
      </span>
    </div>
  </div>
);

const PEAK_LABEL_WIDTH = 92;

const AnnualEvolutionChart: React.FC<Props> = ({ months, currentYear, previousYear }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '_');
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { height, currentStroke, glowStroke, tooltipWidth, tooltipTop, tooltipPadding } = chartMetrics(width);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const TOOLTIP_WIDTH = tooltipWidth;

  const { top, ticks } = useMemo(
    () =>
      niceAxis(
        Math.max(
          0,
          ...months.flatMap((m) => [m.incomeCurrent, m.incomePrevious, m.expenseCurrent, m.expensePrevious])
        )
      ),
    [months]
  );

  const n = months.length;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH;
  const labelEvery = innerW / Math.max(1, n - 1) < 34 ? 2 : 1;
  const bounds = { yMin: PAD.top, yMax: PAD.top + innerH };
  const baselineY = PAD.top + innerH;

  const pointsOf = (key: SeriesKey) => months.map((m, i) => (seriesHasData(m, key) ? { x: x(i), y: y(m[key]) } : null));
  const path = (key: SeriesKey) => buildSmoothGappedPath(pointsOf(key), bounds);
  const area = (key: SeriesKey) => buildSmoothGappedArea(pointsOf(key), baselineY, bounds);

  const activeMonth = active !== null ? months[active] : null;
  const tooltipLeft =
    active === null ? 0 : Math.min(Math.max(x(active) - TOOLTIP_WIDTH / 2, 0), Math.max(0, width - TOOLTIP_WIDTH));

  const describe = (m: AnnualEvolutionMonth) =>
    `${MONTH_LONG[m.month - 1]}: entradas ${currentYear} ${seriesValueLabel(m, 'incomeCurrent')}, entradas ${previousYear} ${seriesValueLabel(m, 'incomePrevious')}, saídas ${currentYear} ${seriesValueLabel(m, 'expenseCurrent')}, saídas ${previousYear} ${seriesValueLabel(m, 'expensePrevious')}`;

  const hovering = active !== null;
  const glowOpacity = hovering ? 0.24 : 0.1;

  // Rótulos de pico: dinâmicos (maior valor do ano atual COM dados), presos ao plot e sem colidir entre si.
  const incomePeak = findPeakIndex(months, 'incomeCurrent');
  const expensePeak = findPeakIndex(months, 'expenseCurrent');
  const clampLeft = (cx: number) => Math.min(Math.max(cx, PAD.left + PEAK_LABEL_WIDTH / 2), width - PAD.right - PEAK_LABEL_WIDTH / 2);
  const peaks: Array<{ key: string; text: string; color: string; left: number; top: number }> = [];
  if (incomePeak !== null) {
    peaks.push({ key: 'income', text: 'Maior entrada', color: CHART_COLORS.incomeCurrent, left: clampLeft(x(incomePeak)), top: y(months[incomePeak].incomeCurrent) - 26 });
  }
  if (expensePeak !== null) {
    peaks.push({ key: 'expense', text: 'Maior saída', color: CHART_COLORS.expenseCurrent, left: clampLeft(x(expensePeak)), top: y(months[expensePeak].expenseCurrent) - 26 });
  }
  if (peaks.length === 2 && Math.abs(peaks[0].left - peaks[1].left) < PEAK_LABEL_WIDTH && Math.abs(peaks[0].top - peaks[1].top) < 22) {
    const lower = peaks[0].top > peaks[1].top ? peaks[0] : peaks[1];
    lower.top += 40; // abaixo do ponto
  }
  for (const p of peaks) p.top = Math.min(Math.max(p.top, 2), height - PAD.bottom - 16);

  const currentSeries = [
    { key: 'incomeCurrent' as const, color: CHART_COLORS.incomeCurrent, gradient: `ae-inc-${uid}`, areaOpacity: 0.18 },
    { key: 'expenseCurrent' as const, color: CHART_COLORS.expenseCurrent, gradient: `ae-exp-${uid}`, areaOpacity: 0.08 },
  ];
  const previousSeries = [
    { key: 'incomePrevious' as const, color: CHART_COLORS.incomePrevious },
    { key: 'expensePrevious' as const, color: CHART_COLORS.expensePrevious },
  ];

  return (
    <div className="mt-[19px] min-w-0 min-[761px]:mt-[22px]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-0 min-[761px]:gap-y-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Gráfico</p>
          <h4 className="text-sm font-semibold text-gray-100">Comparativo mensal</h4>
        </div>
        <ChartLegend currentYear={currentYear} previousYear={previousYear} />
      </div>

      <div ref={wrapRef} className="relative w-full min-w-0" onMouseLeave={() => setActive(null)}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Entradas e saídas registradas por mês, ${currentYear} comparado com ${previousYear}`}
          className="block max-w-full"
        >
          <defs>
            <linearGradient id={`ae-inc-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.incomeCurrent} stopOpacity="0.22" />
              <stop offset="70%" stopColor={CHART_COLORS.incomeCurrent} stopOpacity="0.025" />
              <stop offset="100%" stopColor={CHART_COLORS.incomeCurrent} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`ae-exp-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.expenseCurrent} stopOpacity="0.16" />
              <stop offset="70%" stopColor={CHART_COLORS.expenseCurrent} stopOpacity="0.02" />
              <stop offset="100%" stopColor={CHART_COLORS.expenseCurrent} stopOpacity="0" />
            </linearGradient>
            {/* userSpaceOnUse: linhas horizontais têm bbox de altura zero e o blur seria cortado */}
            <filter id={`ae-blur-${uid}`} filterUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>

          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="rgba(148, 163, 184, 0.075)"
                strokeWidth="1"
              />
              <text x={PAD.left - 8} y={y(tick) + 3.5} textAnchor="end" className="fill-gray-500 tabular-nums" fontSize="10">
                {compactBRL(tick)}
              </text>
            </g>
          ))}

          {months.map((m, i) =>
            i % labelEvery === 0 ? (
              <text key={m.month} x={x(i)} y={height - 8} textAnchor="middle" className="fill-gray-500" fontSize="10">
                {MONTH_SHORT[m.month - 1]}
              </text>
            ) : null
          )}

          {/* área sutil sob o ano atual (um polígono por trecho contínuo: nunca preenche um buraco) */}
          {currentSeries.map((s) => {
            const d = area(s.key);
            return d ? <path key={`area-${s.key}`} d={d} fill={`url(#${s.gradient})`} opacity={s.areaOpacity} stroke="none" /> : null;
          })}

          {/* brilho: cópia desfocada atrás das linhas atuais */}
          {currentSeries.map((s) => (
            <path
              key={`glow-${s.key}`}
              d={path(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={glowStroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#ae-blur-${uid})`}
              opacity={glowOpacity}
              className="transition-opacity duration-200 motion-reduce:transition-none"
              aria-hidden="true"
            />
          ))}

          {previousSeries.map((s) => (
            <path
              key={s.key}
              d={path(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth="1.3"
              strokeDasharray="3.5 5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={hovering ? 0.26 : 0.45}
              className="transition-opacity duration-200 motion-reduce:transition-none"
            />
          ))}

          {currentSeries.map((s) => (
            <path
              key={s.key}
              d={path(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={currentStroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {activeMonth && active !== null && (
            <g aria-hidden="true">
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + innerH}
                stroke="rgba(206,218,234,0.26)"
                strokeDasharray="2 4"
                strokeWidth="1"
              />
              {previousSeries.map((s) =>
                seriesHasData(activeMonth, s.key) ? (
                  <g key={`m-${s.key}`} opacity="0.66">
                    <circle cx={x(active)} cy={y(activeMonth[s.key])} r="5.5" fill={s.color} opacity="0.15" />
                    <circle cx={x(active)} cy={y(activeMonth[s.key])} r="3" fill={SURFACE} stroke={s.color} strokeWidth="1.5" />
                  </g>
                ) : null
              )}
              {currentSeries.map((s) =>
                seriesHasData(activeMonth, s.key) ? (
                  <g key={`m-${s.key}`}>
                    <circle cx={x(active)} cy={y(activeMonth[s.key])} r="9" fill={s.color} opacity="0.28" filter={`url(#ae-blur-${uid})`} />
                    <circle cx={x(active)} cy={y(activeMonth[s.key])} r="7" fill={s.color} opacity="0.15" />
                    <circle cx={x(active)} cy={y(activeMonth[s.key])} r="4" fill={SURFACE} stroke={s.color} strokeWidth="2" />
                  </g>
                ) : null
              )}
            </g>
          )}

          {months.map((m, i) => {
            const slot = n === 1 ? innerW : innerW / (n - 1);
            return (
              <rect
                key={m.month}
                x={x(i) - slot / 2}
                y={PAD.top}
                width={slot}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={describe(m)}
                className="cursor-pointer outline-none focus-visible:stroke-white/40"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive((cur) => (cur === i ? null : i))}
              />
            );
          })}
        </svg>

        {/* picos (só desktop; no mobile o espaço é do gráfico) */}
        {peaks.map((p) => (
          <span
            key={p.key}
            data-peak-label={p.key}
            className="pointer-events-none absolute hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-400/[0.14] py-1 pl-[15px] pr-[7px] text-[8px] font-semibold leading-none text-gray-200 min-[761px]:block"
            style={{
              left: p.left,
              top: p.top,
              background: 'linear-gradient(180deg, rgba(25,36,52,.94), rgba(14,22,34,.94))',
              boxShadow: '0 6px 16px rgba(0,0,0,.16)',
            }}
          >
            <span
              aria-hidden="true"
              className="absolute left-[6px] top-1/2 h-1 w-1 -translate-y-1/2 rounded-full"
              style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}` }}
            />
            {p.text}
          </span>
        ))}

        {activeMonth && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 rounded-xl border text-xs backdrop-blur-[10px]"
            style={{
              left: tooltipLeft,
              top: tooltipTop,
              width: TOOLTIP_WIDTH,
              padding: tooltipPadding,
              borderColor: 'rgba(113,137,166,0.30)',
              background: 'linear-gradient(145deg, rgba(26,38,55,.98), rgba(11,18,29,.99))',
              boxShadow: '0 18px 42px rgba(0,0,0,.44), inset 0 1px 0 rgba(255,255,255,.035)',
            }}
          >
            <MonthTooltipBody month={activeMonth} currentYear={currentYear} previousYear={previousYear} />
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>{`Entradas e saídas registradas por mês, ${currentYear} e ${previousYear}`}</caption>
        <thead>
          <tr>
            <th scope="col">Mês</th>
            <th scope="col">{`Entradas ${currentYear}`}</th>
            <th scope="col">{`Entradas ${previousYear}`}</th>
            <th scope="col">{`Saídas ${currentYear}`}</th>
            <th scope="col">{`Saídas ${previousYear}`}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{MONTH_LONG[m.month - 1]}</th>
              <td>{seriesValueLabel(m, 'incomeCurrent')}</td>
              <td>{seriesValueLabel(m, 'incomePrevious')}</td>
              <td>{seriesValueLabel(m, 'expenseCurrent')}</td>
              <td>{seriesValueLabel(m, 'expensePrevious')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AnnualEvolutionChart;
