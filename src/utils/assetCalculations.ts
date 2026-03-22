import { Asset } from '../types';

export interface AmortizationResult {
  totalPaid: number;         // Total pago até agora (parcelas pagas × valor da parcela)
  principalPaid: number;     // Quanto do total quitou de fato a dívida (principal)
  interestPaid: number;      // Quanto foi só juros (financiamento) ou taxa adm (consórcio)
  progressPct: number;       // Percentual de parcelas pagas (0-100)
  netEquity: number;         // Patrimônio líquido = value - remaining_balance
  effectiveCostRate: number; // Juros como % do total pago (custo real do financiamento)
}

/**
 * Calculates a simplified amortization breakdown for a financed or consortium asset.
 * 
 * For FINANCING: Uses a simplified Price-method approach to decompose each payment
 * into principal and interest based on the monthly interest rate.
 * 
 * For CONSORTIUM: The admin fee is spread proportionally across all payments.
 * Monthly fee portion = total_payment × (admin_rate / 100)
 * Principal portion = monthly_payment × (1 - admin_rate / 100)
 */
export function calculateAmortization(asset: Asset): AmortizationResult | null {
  if (!asset.is_financed && !asset.financing_type) return null;
  if (!asset.installment_value || !asset.paid_installments) return null;

  const paid = asset.paid_installments;
  const total = asset.total_installments || paid;
  const installment = asset.installment_value;
  const totalPaid = paid * installment;
  const progressPct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const financed = asset.financed_amount || 0;
  const remaining = asset.remaining_balance || 0;
  const netEquity = asset.value - remaining;

  if (asset.financing_type === 'consortium') {
    // For consortium: admin fee is a percentage of total contract value
    const adminRate = (asset.consortium_admin_rate || 0) / 100;
    const totalAdminFee = financed * adminRate;
    const adminFeePerInstallment = total > 0 ? totalAdminFee / total : 0;
    const interestPaid = adminFeePerInstallment * paid;
    const principalPaid = totalPaid - interestPaid;
    const effectiveCostRate = totalPaid > 0 ? (interestPaid / totalPaid) * 100 : 0;

    return { totalPaid, principalPaid, interestPaid, progressPct, netEquity, effectiveCostRate };
  }

  // For financing: use simplified decomposition
  // If we have monthly_interest_rate, we can do a precise decomposition.
  // Without it, we approximate: interest = total paid - (financed_amount - remaining_balance)
  const monthlyRate = (asset.monthly_interest_rate || 0) / 100;

  let interestPaid: number;
  let principalPaid: number;

  if (monthlyRate > 0 && financed > 0) {
    // Price method: each installment covers proportional interest on remaining balance
    // We simulate the amortization schedule for `paid` installments
    let balance = financed;
    let accumulatedInterest = 0;
    let accumulatedPrincipal = 0;

    for (let i = 0; i < paid && i < total; i++) {
      const interestThisMonth = balance * monthlyRate;
      const principalThisMonth = installment - interestThisMonth;
      accumulatedInterest += interestThisMonth;
      accumulatedPrincipal += principalThisMonth;
      balance = Math.max(0, balance - principalThisMonth);
    }

    interestPaid = accumulatedInterest;
    principalPaid = accumulatedPrincipal;
  } else {
    // Fallback: estimate from remaining balance
    const originalDebt = financed || (remaining + totalPaid);
    principalPaid = Math.max(0, originalDebt - remaining);
    interestPaid = Math.max(0, totalPaid - principalPaid);
  }

  const effectiveCostRate = totalPaid > 0 ? (interestPaid / totalPaid) * 100 : 0;

  return { totalPaid, principalPaid, interestPaid, progressPct, netEquity, effectiveCostRate };
}
