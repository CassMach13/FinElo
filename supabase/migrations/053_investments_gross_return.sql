-- Campos adicionais da planilha XP (Rendimento bruto, Valor aplicado original)

ALTER TABLE public.investments
ADD COLUMN IF NOT EXISTS gross_return_amount numeric(15,2),
ADD COLUMN IF NOT EXISTS original_applied_amount numeric(15,2);

COMMENT ON COLUMN public.investments.gross_return_amount IS 'Rendimento bruto do extrato XP no período (não é saldo nem total de aportes).';
COMMENT ON COLUMN public.investments.original_applied_amount IS 'Valor aplicado original da planilha XP, quando existir na seção.';
