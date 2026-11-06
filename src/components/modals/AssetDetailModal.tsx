import '../appearance/investments.css';

import React from 'react';
import { Asset } from '../../types';
import Modal from '../ui/Modal';
import { formatCurrency, formatCurrencySigned } from '../../utils/formatters';
import { calculateAmortization } from '../../utils/assetCalculations';

interface AssetDetailModalProps {
  asset: Asset;
  onClose: () => void;
  onEdit: () => void;
}

const AssetDetailModal: React.FC<AssetDetailModalProps> = ({ asset, onClose, onEdit }) => {
  const amort = calculateAmortization(asset);
  const isFinancing = asset.financing_type === 'financing';
  const isConsortium = asset.financing_type === 'consortium';
  const hasDebt = asset.is_financed || !!asset.financing_type;

  const typeLabel = asset.type === 'car' ? 'Veículo' : asset.type === 'property' ? 'Imóvel' : 'Outro';
  const modeLabel = isFinancing ? '🏦 Financiamento' : isConsortium ? '🔄 Consórcio' : '✅ Quitado';

  const progressPct = amort?.progressPct ?? (
    asset.total_installments && asset.paid_installments
      ? Math.round((asset.paid_installments / asset.total_installments) * 100)
      : 0
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={asset.name}
      footer={
        <div className="flex justify-between w-full">
          <button data-finance={"content secondary"}
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            Fechar
          </button>
          <button data-finance={"content action"}
            onClick={onEdit}
            className="px-5 py-2 bg-highlight hover:bg-sky-400 text-white font-bold rounded-lg text-sm transition-all"
          >
            Editar Ativo
          </button>
        </div>
      }
    >
      <div className="space-y-5">

        {/* Basic Info */}
        <div className="flex items-center justify-between">
          <span data-finance={"muted"} className="text-xs font-bold uppercase tracking-widest text-slate-500">{typeLabel}</span>
          <span data-finance={"" + " " + (hasDebt ? (isConsortium ? "investment-tone investment-panel" : "info info-panel") : "positive success-panel") + " " + ""} className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            hasDebt
              ? isConsortium
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              : 'bg-green-500/20 text-green-400 border border-green-500/30'
          }`}>
            {modeLabel}
          </span>
        </div>

        {/* Equity Summary */}
        <div data-finance={"divider inset"} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 space-y-2">
          <div className="flex justify-between items-center">
            <span data-finance={"muted"} className="text-sm text-slate-400">Valor de Mercado</span>
            <span data-finance={"content"} className="text-sm font-bold text-white">{formatCurrency(asset.value)}</span>
          </div>
          {hasDebt && asset.remaining_balance != null && (
            <div className="flex justify-between items-center">
              <span data-finance={"muted"} className="text-sm text-slate-400">(-) Saldo Devedor</span>
              <span data-finance={"negative"} className="text-sm font-bold text-danger">{formatCurrencySigned(-(asset.remaining_balance || 0))}</span>
            </div>
          )}
          <div data-finance={"inset"} className="h-px bg-slate-700 my-1" />
          <div className="flex justify-between items-center">
            <span data-finance={"muted"} className="text-sm font-bold text-slate-300">Patrimônio Líquido</span>
            <span data-finance={"" + " " + ((amort?.netEquity ?? asset.value) >= 0 ? "positive" : "negative") + " " + ""} className={`text-lg font-black ${
              (amort?.netEquity ?? asset.value) >= 0 ? 'text-accent' : 'text-danger'
            }`}>
              {formatCurrency(amort?.netEquity ?? asset.value)}
            </span>
          </div>
        </div>

        {/* Installment Progress */}
        {hasDebt && asset.total_installments && asset.paid_installments != null && (
          <div className="space-y-2">
            <div data-finance={"muted"} className="flex justify-between items-center text-xs text-slate-400">
              <span>Progresso do Pagamento</span>
              <span data-finance={"content"} className="font-bold text-white">{asset.paid_installments} / {asset.total_installments} parcelas ({progressPct}%)</span>
            </div>
            <div data-finance={"inset"} className="w-full h-2.5 bg-slate-700/50 rounded-full overflow-hidden">
              <div data-finance={"" + " " + (isConsortium ? "investment-line" : "info-line") + " " + ""}
                className={`h-full rounded-full shadow-lg transition-all ${
                  isConsortium ? 'bg-purple-500 shadow-purple-500/30' : 'bg-highlight shadow-highlight/30'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Amortization Breakdown — only when rate is given */}
        {amort && (
          <div data-finance={"" + " " + (isConsortium ? "investment-panel" : "info-panel") + " " + ""} className={`rounded-xl p-4 border space-y-3 ${
            isConsortium
              ? 'bg-purple-900/10 border-purple-700/30'
              : 'bg-blue-900/10 border-blue-700/30'
          }`}>
            <p data-finance={"muted"} className="text-xs font-bold uppercase tracking-widest text-slate-400">
              📊 Custo Real do {isConsortium ? 'Consórcio' : 'Financiamento'}
            </p>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span data-finance={"muted"} className="text-slate-400">Total já pago</span>
                <span data-finance={"content"} className="font-semibold text-white">{formatCurrency(amort.totalPaid)}</span>
              </div>
              <div className="flex justify-between items-center text-sm pl-3 border-l-2 border-accent/40">
                <span data-finance={"muted"} className="text-slate-400">├ Principal quitado</span>
                <span data-finance={"positive"} className="font-semibold text-accent">{formatCurrencySigned(amort.principalPaid, { showPlusForPositive: true })}</span>
              </div>
              <div className="flex justify-between items-center text-sm pl-3 border-l-2 border-danger/40">
                <span data-finance={"muted"} className="text-slate-400">
                  └ {isConsortium ? 'Taxa adm. paga' : 'Juros pagos'}
                </span>
                <span data-finance={"negative"} className="font-semibold text-danger">{formatCurrencySigned(-amort.interestPaid)}</span>
              </div>
            </div>

            {amort.interestPaid > 0 && (
              <div data-finance={"" + " " + (isConsortium ? "investment-tone investment-panel" : "negative danger-chip") + " " + ""} className={`text-xs rounded-lg p-3 mt-2 ${
                isConsortium ? 'bg-purple-500/10 text-purple-300' : 'bg-red-500/10 text-red-300'
              }`}>
                ⚠️ <strong>{amort.effectiveCostRate.toFixed(1)}%</strong> do que você pagou até agora foi em 
                {isConsortium ? ' taxas administrativas' : ' juros'} — dinheiro que não virou patrimônio.
                {isFinancing && asset.monthly_interest_rate
                  ? ` (Taxa: ${asset.monthly_interest_rate}% a.m., método Price)`
                  : ''}
              </div>
            )}
          </div>
        )}

        {/* Hint when no rate is set */}
        {hasDebt && !amort && (
          <div data-finance={"muted divider inset"} className="text-xs text-slate-500 bg-slate-800/30 rounded-lg p-3 border border-slate-700/30">
            💡 Adicione a <strong>taxa {isConsortium ? 'administrativa' : 'de juros'}</strong> no cadastro deste bem 
            para ver o detalhamento do custo real do {isConsortium ? 'consórcio' : 'financiamento'}.
          </div>
        )}

        {/* Additional details */}
        <div data-finance={"muted"} className="grid grid-cols-2 gap-3 text-xs text-slate-400">
          {asset.acquisition_date && (
            <div data-finance={"divider inset"} className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/30">
              <p data-finance={"muted"} className="text-slate-500 mb-0.5">Adquirido em</p>
              <p data-finance={"content"} className="font-semibold text-white">
                {new Date(asset.acquisition_date + 'T00:00:00').toLocaleDateString('pt-BR')}
              </p>
            </div>
          )}
          {asset.installment_value && (
            <div data-finance={"divider inset"} className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/30">
              <p data-finance={"muted"} className="text-slate-500 mb-0.5">Parcela Mensal</p>
              <p data-finance={"content"} className="font-semibold text-white">{formatCurrency(asset.installment_value)}</p>
            </div>
          )}
          {asset.financed_amount && (
            <div data-finance={"divider inset"} className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/30">
              <p data-finance={"muted"} className="text-slate-500 mb-0.5">Valor Financiado</p>
              <p data-finance={"content"} className="font-semibold text-white">{formatCurrency(asset.financed_amount)}</p>
            </div>
          )}
          {isFinancing && asset.monthly_interest_rate && (
            <div data-finance={"divider inset"} className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/30">
              <p data-finance={"muted"} className="text-slate-500 mb-0.5">Taxa Mensal</p>
              <p data-finance={"content"} className="font-semibold text-white">{asset.monthly_interest_rate}% a.m.</p>
            </div>
          )}
          {isConsortium && asset.consortium_admin_rate && (
            <div data-finance={"divider inset"} className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/30">
              <p data-finance={"muted"} className="text-slate-500 mb-0.5">Taxa Adm. Total</p>
              <p data-finance={"content"} className="font-semibold text-white">{asset.consortium_admin_rate}%</p>
            </div>
          )}
        </div>

        {asset.description && (
          <p data-finance={"muted divider"} className="text-sm text-slate-400 italic border-t border-slate-700/50 pt-3">{asset.description}</p>
        )}
      </div>
    </Modal>
  );
};

export default AssetDetailModal;
