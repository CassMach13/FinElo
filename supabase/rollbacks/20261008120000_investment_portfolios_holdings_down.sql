-- Rollback de 20261008120000_investment_portfolios_holdings.sql (NÃO executado automaticamente).
--
-- Remove SOMENTE os objetos introduzidos pela V2-B1A: o trigger de imutabilidade de `investments.user_id`, os
-- índices e constraints novos, as colunas `investments.portfolio_id` e `investments.holding_id`, as duas tabelas
-- novas (com RLS/policies/triggers) e as funções de trigger.
-- Nenhum snapshot é apagado e nenhum valor financeiro muda: `balance`, `reference_month` etc. ficam intactos.
--
-- LIMITAÇÃO: é DESTRUTIVO para as classificações feitas depois da migration (carteiras, holdings e os vínculos
-- portfolio_id/holding_id). Depois que movimentos financeiros (V2-B2) referenciarem holdings, este rollback deixa de
-- ser seguro: reverta antes o que depende delas.
--
-- PERDA DE AUDITORIA: ao remover `classified_by`/`classified_at`, perde-se a autoria das classificações feitas depois
-- da migration. O rollback só é seguro enquanto nada depender delas (V2-B2 em diante).
--
-- NÃO remove a policy "Family Access Investments": ela é anterior a esta fase (reconciliada por
-- 20261008115900_reconcile_investments_family_policy.sql, que não tem rollback destrutivo).
--
-- NÃO reverte o hardening de privilégios de `public.investments` (anon sem acesso; authenticated sem
-- TRUNCATE/TRIGGER/REFERENCES): ele é intencional e monotônico, como o de `transactions`. Se um cliente legítimo
-- precisar de algum desses privilégios, conceda-o pontualmente e com revisão.

DROP TRIGGER IF EXISTS trg_investments_classification_audit ON public.investments;
DROP FUNCTION IF EXISTS public.investments_classification_audit();
DROP TRIGGER IF EXISTS trg_investments_user_id_immutable ON public.investments;
DROP FUNCTION IF EXISTS public.investments_user_id_immutable();

DROP INDEX IF EXISTS public.investments_holding_month_key;
DROP INDEX IF EXISTS public.investments_user_portfolio_idx;
DROP INDEX IF EXISTS public.investments_user_month_idx;

ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS investments_classification_audit_pair_check;
ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS investments_holding_requires_portfolio_check;
ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS investments_holding_owner_portfolio_fkey;
ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS investments_portfolio_owner_fkey;
ALTER TABLE public.investments DROP COLUMN IF EXISTS classified_at;
ALTER TABLE public.investments DROP COLUMN IF EXISTS classified_by;
ALTER TABLE public.investments DROP COLUMN IF EXISTS holding_id;
ALTER TABLE public.investments DROP COLUMN IF EXISTS portfolio_id;

DROP TABLE IF EXISTS public.investment_holdings;
DROP TABLE IF EXISTS public.investment_portfolios;

DROP FUNCTION IF EXISTS public.investment_holdings_guard();
DROP FUNCTION IF EXISTS public.investment_portfolios_guard();
