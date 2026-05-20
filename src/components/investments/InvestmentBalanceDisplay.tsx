import React from 'react';

interface InvestmentBalanceDisplayProps {
  balance: number;
  investedPrincipal?: number | null;
  originalAppliedAmount?: number | null;
  grossReturnAmount?: number | null;
  productType?: string;
  align?: 'left' | 'right';
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

/** Rótulo de bloco — contraste legível no tema escuro */
const blockLabel =
  'block text-[10px] uppercase tracking-wide text-slate-400 font-semibold leading-none mb-0.5';

function likelyIncludesUndeclaredContributions(balance: number, applied: number): boolean {
  if (applied <= 0 || balance <= applied) return false;
  return (balance - applied) / applied > 0.5;
}

const CONTRIBUTION_HEAVY_TYPES = [
  'previdência privada',
  'previdencia privada',
  'fundos de investimentos',
  'fundos imobiliários',
  'fundos imobiliarios',
];

function ValueBlock({
  label,
  value,
  valueClassName = 'text-sm text-slate-200 leading-tight',
  title,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  title?: string;
}) {
  return (
    <div className="border-l-2 border-slate-600/80 pl-2.5" title={title}>
      <span className={blockLabel}>{label}</span>
      <span className={`block ${valueClassName}`}>{value}</span>
    </div>
  );
}

const InvestmentBalanceDisplay: React.FC<InvestmentBalanceDisplayProps> = ({
  balance,
  investedPrincipal,
  originalAppliedAmount,
  grossReturnAmount,
  productType,
  align = 'right',
}) => {
  const alignClass = align === 'right' ? 'items-end text-right' : 'items-start text-left';

  const appliedFromSheet =
    originalAppliedAmount != null && originalAppliedAmount > 0
      ? originalAppliedAmount
      : investedPrincipal != null && investedPrincipal > 0
        ? investedPrincipal
        : null;

  const appliedLabel =
    originalAppliedAmount != null && originalAppliedAmount > 0 ? 'Total aplicado' : 'Valor aplicado';

  const typeNorm = (productType || '').toLowerCase();
  const isContributionHeavy = CONTRIBUTION_HEAVY_TYPES.some((t) => typeNorm.includes(t));

  const showMisleadingGain =
    appliedFromSheet != null &&
    grossReturnAmount == null &&
    !likelyIncludesUndeclaredContributions(balance, appliedFromSheet) &&
    !isContributionHeavy;

  const estimatedGain =
    showMisleadingGain && appliedFromSheet != null && balance > appliedFromSheet
      ? balance - appliedFromSheet
      : null;

  const showContributionHint =
    appliedFromSheet != null &&
    (likelyIncludesUndeclaredContributions(balance, appliedFromSheet) ||
      (isContributionHeavy && balance > (appliedFromSheet || 0) * 1.2));

  return (
    <div className={`flex flex-col gap-2.5 min-w-[8.5rem] max-w-[11rem] ${alignClass}`}>
      <ValueBlock
        label="Saldo atual"
        value={formatCurrency(balance)}
        valueClassName="font-bold text-white text-sm leading-tight"
        title="Posição de mercado na data do extrato importado"
      />

      <ValueBlock
        label={appliedLabel}
        value={appliedFromSheet != null ? formatCurrency(appliedFromSheet) : '—'}
        valueClassName={appliedFromSheet != null ? 'text-sm text-slate-200 leading-tight' : 'text-sm text-slate-500'}
        title="Valor da coluna «Valor aplicado» da planilha XP. Em fundos e previdência pode não incluir todos os aportes."
      />

      {grossReturnAmount != null && grossReturnAmount > 0 ? (
        <ValueBlock
          label="Rend. bruto"
          value={formatCurrency(grossReturnAmount)}
          valueClassName="text-sm font-medium text-emerald-300 leading-tight"
          title="Coluna Rendimento bruto do extrato XP (período da posição)"
        />
      ) : estimatedGain != null && estimatedGain > 0.01 ? (
        <div
          className="border-l-2 border-emerald-500/50 pl-2.5"
          title="Diferença entre saldo atual e valor aplicado do extrato (produtos com valor aplicado completo)"
        >
          <span className={blockLabel}>Ganho estimado</span>
          <span className="text-sm font-medium text-emerald-300 leading-tight">
            +{formatCurrency(estimatedGain)}
          </span>
        </div>
      ) : null}

      {showContributionHint ? (
        <p
          className="text-[10px] leading-snug text-amber-200/95 bg-amber-950/40 border border-amber-500/35 rounded-md px-2 py-1.5 text-left"
          title="A planilha XP não lista cada aporte; saldo menos valor aplicado não é só rendimento."
        >
          <span className="font-semibold text-amber-100">Atenção:</span> pode incluir aportes não detalhados no extrato.
        </p>
      ) : null}
    </div>
  );
};

export function InvestmentBalanceColumnHeader() {
  return (
    <div
      className="text-right pr-4 max-w-[11rem] ml-auto"
      title="Saldo atual (posição), valor aplicado na planilha e rendimento bruto quando existir"
    >
      <span className="block text-sm font-medium text-slate-300">Valores</span>
    </div>
  );
}

export default InvestmentBalanceDisplay;
