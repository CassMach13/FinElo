-- ===========================================================================
-- Objetivos financeiros V1 — a tabela. Nada além dela.
-- ===========================================================================
--
-- O QUE É
--
-- Uma camada de PLANEJAMENTO: o usuário diz quanto quer juntar, até quando e quanto já
-- separou. `current_amount` é informado MANUALMENTE. Não há vínculo com transações, contas,
-- investimentos, patrimônio ou cartão, e alterar um objetivo não cria nem altera nada disso.
--
-- CONTRATO
--
-- * Pessoal: só o dono lê, cria, edita e exclui. NÃO usa `has_family_access` (que dá escrita
--   total à família e, no UPDATE, não confere o dono depois da mudança).
-- * O UPDATE tem WITH CHECK: não dá para trocar `user_id`.
-- * `current_amount` não é limitado ao alvo (pode-se ter mais que o objetivo).
-- * `target_date` é o último dia do mês escolhido; sem constraint de "não pode ser passado"
--   (um objetivo continua no banco depois que o prazo vence).
-- * Status não é coluna: arquivado = `archived_at IS NOT NULL`; alcançado e prazo encerrado
--   são derivados no app.
-- * Migration aditiva: só cria objetos novos. Reaplicável. Depende de `public.handle_updated_at()`
--   (já existente, criada em 023_enable_subscriptions.sql).

CREATE TABLE IF NOT EXISTS public.financial_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_amount numeric(14,2) NOT NULL,
  current_amount numeric(14,2) NOT NULL DEFAULT 0,
  target_date date,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_goals_name_length
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT financial_goals_target_positive
    CHECK (target_amount > 0),
  CONSTRAINT financial_goals_current_non_negative
    CHECK (current_amount >= 0)
);

COMMENT ON TABLE public.financial_goals IS
  'Objetivos financeiros pessoais (planejamento). current_amount é informado manualmente; sem vínculo com transações, contas ou investimentos.';

-- A view separa ativos e arquivados por usuário.
CREATE INDEX IF NOT EXISTS financial_goals_user_archived_idx
  ON public.financial_goals (user_id, archived_at);

DROP TRIGGER IF EXISTS trg_financial_goals_updated_at ON public.financial_goals;
CREATE TRIGGER trg_financial_goals_updated_at
  BEFORE UPDATE ON public.financial_goals
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

ALTER TABLE public.financial_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "financial_goals_select_own" ON public.financial_goals;
CREATE POLICY "financial_goals_select_own"
  ON public.financial_goals FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "financial_goals_insert_own" ON public.financial_goals;
CREATE POLICY "financial_goals_insert_own"
  ON public.financial_goals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "financial_goals_update_own" ON public.financial_goals;
CREATE POLICY "financial_goals_update_own"
  ON public.financial_goals FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "financial_goals_delete_own" ON public.financial_goals;
CREATE POLICY "financial_goals_delete_own"
  ON public.financial_goals FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Sem acesso anônimo. O cliente autenticado opera pela RLS acima.
-- O Supabase concede ALL a `authenticated` em tabelas novas por privilégio padrão; TRUNCATE,
-- TRIGGER e REFERENCES não passam por RLS e não fazem parte do contrato, então saem antes do GRANT.
REVOKE ALL ON public.financial_goals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_goals TO authenticated;
