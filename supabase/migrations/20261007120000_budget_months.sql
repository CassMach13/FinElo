-- ===========================================================================
-- Orçamento mensal (Budget V2): a tabela `budget_months` + endurecimento de `budgets`.
-- ===========================================================================
--
-- O QUE É
--
-- Um limite por (dono, categoria, ano, mês). É PESSOAL: o gasto de uma linha é medido só contra os
-- lançamentos do dono. O orçamento anual legado (`budgets`) continua existindo como padrão
-- ("fallback") do MESMO dono quando não há linha mensal. Nada é copiado de `budgets` para cá:
-- a tabela nasce vazia e não se inventa histórico.
--
-- CONTRATO
--
-- * Família (semântica já existente de `budgets`): SELECT/UPDATE/DELETE por `has_family_access`.
--   INSERT só do próprio dono (`auth.uid() = user_id`): ninguém cria linha em nome de outro.
-- * Só `amount` é atualizável (privilégio por coluna): dono, categoria, ano e mês são imutáveis,
--   o que o WITH CHECK familiar sozinho não garantiria (ele aceitaria mover a linha para outro
--   membro acessível).
-- * `Categoria` é o NOME da categoria, como em `budgets`/`transactions` (sem FK).
-- * Aditiva: não altera colunas, dados, constraints, policies nem RLS de `budgets`.
--
-- HARDENING DE `budgets` (intencional e monotônico — o rollback desta feature NÃO o desfaz)
--
-- O Supabase concede ALL a anon/authenticated em tabelas novas; `budgets` estava com TRUNCATE,
-- TRIGGER e REFERENCES abertos (e para `anon`). A RLS não protege TRUNCATE. Aqui só se removem os
-- privilégios desnecessários e se preserva o CRUD autenticado que o app (inclusive PWA antigo) usa.

CREATE TABLE IF NOT EXISTS public.budget_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "Categoria" text NOT NULL,
  year integer NOT NULL,
  month smallint NOT NULL,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_months_month_range CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT budget_months_amount_positive CHECK (amount > 0),
  CONSTRAINT budget_months_category_not_blank CHECK (btrim("Categoria") <> ''),
  CONSTRAINT budget_months_owner_category_period_key UNIQUE (user_id, "Categoria", year, month)
);

COMMENT ON TABLE public.budget_months IS
  'Orçamento mensal pessoal por categoria (Budget V2). Prevalece sobre o orçamento anual legado (budgets) do mesmo dono. Sem backfill.';

CREATE INDEX IF NOT EXISTS budget_months_user_period_idx
  ON public.budget_months (user_id, year, month);

DROP TRIGGER IF EXISTS trg_budget_months_updated_at ON public.budget_months;
CREATE TRIGGER trg_budget_months_updated_at
  BEFORE UPDATE ON public.budget_months
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

ALTER TABLE public.budget_months ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budget_months_select_family" ON public.budget_months;
CREATE POLICY "budget_months_select_family"
  ON public.budget_months FOR SELECT TO authenticated
  USING (public.has_family_access(user_id));

DROP POLICY IF EXISTS "budget_months_insert_own" ON public.budget_months;
CREATE POLICY "budget_months_insert_own"
  ON public.budget_months FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "budget_months_update_family" ON public.budget_months;
CREATE POLICY "budget_months_update_family"
  ON public.budget_months FOR UPDATE TO authenticated
  USING (public.has_family_access(user_id))
  WITH CHECK (public.has_family_access(user_id));

DROP POLICY IF EXISTS "budget_months_delete_family" ON public.budget_months;
CREATE POLICY "budget_months_delete_family"
  ON public.budget_months FOR DELETE TO authenticated
  USING (public.has_family_access(user_id));

REVOKE ALL ON public.budget_months FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.budget_months TO authenticated;
GRANT UPDATE (amount) ON public.budget_months TO authenticated;

-- Hardening da tabela legada: sai TRUNCATE/TRIGGER/REFERENCES e tudo de anon; fica o CRUD autenticado.
REVOKE ALL ON public.budgets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
