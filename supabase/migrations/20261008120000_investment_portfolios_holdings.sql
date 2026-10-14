-- ===========================================================================
-- Investimentos V2-B1A: fundação de carteiras e holdings com administração familiar compartilhada.
-- ===========================================================================
--
-- ADITIVA. Nenhum dado existente é lido para ser reescrito, nenhuma linha de `investments` muda, nenhum saldo muda.
-- Os snapshots existentes ficam com `portfolio_id` e `holding_id` NULOS ("sem carteira atribuída").
-- NÃO há backfill, atribuição automática nem pareamento por nome/instituição/valor/data.
--
-- PROPRIETÁRIO × OPERADOR
--   `user_id`  = dono dos dados (a conta FinElo à qual a carteira, a holding e os snapshots pertencem).
--   `auth.uid()` = operador autenticado. Administração compartilhada NÃO é transferência de propriedade:
--   `user_id` é imutável; `created_by` (autor) pode ser diferente de `user_id` numa operação familiar autorizada.
--
-- AUTORIZAÇÃO FAMILIAR
--   Reutiliza `public.has_family_access(user_id)` (055_fix_family_bidirectional_access.sql), SEM redefini-la:
--   o dono, ou um vínculo de `family_members` com status 'accepted' (convite pendente/recusado/removido não vale).
--   Pelo contrato vigente o vínculo é bidirecional (convidado vê o titular; titular vê o convidado aceito).
--   A função é reavaliada a cada instrução: revogar o vínculo remove o acesso nas requisições seguintes.
--
-- `investments` possui a policy "Family Access Investments" (ALL, has_family_access), que é o que permite ao familiar
-- autorizado classificar snapshots do dono. Ela é versionada pela migration ANTERIOR
-- 20261008115900_reconcile_investments_family_policy.sql (cria se ausente, aceita se equivalente, falha se
-- divergente). Esta migration NÃO a cria, altera nem remove.
--
-- INTEGRIDADE NO POSTGRESQL (não no cliente)
--   * snapshot → carteira:  FK composta (user_id, portfolio_id) → carteiras (user_id, id), ON DELETE RESTRICT
--   * snapshot → holding:   FK composta (user_id, holding_id, portfolio_id) → holdings (user_id, id, portfolio_id),
--                           ON UPDATE CASCADE (mover a holding de carteira move seus snapshots) e
--                           ON DELETE SET NULL (holding_id) (apagar a holding só desvincula; o snapshot permanece)
--   * holding → carteira:   FK composta (user_id, portfolio_id) → carteiras (user_id, id), ON DELETE RESTRICT
--   * CHECK (holding_id IS NULL OR portfolio_id IS NOT NULL): fecha o buraco do MATCH SIMPLE (uma coluna NULL
--     desligaria a FK composta de 3 colunas)
--   * índice único parcial (holding_id, reference_month): uma posição por holding por mês
--   * `user_id` de `investments` passa a ser imutável (trigger), como o das tabelas novas.
--
-- AUDITORIA (mínima): carteiras e holdings guardam `created_by`/`created_at`/`updated_by`/`updated_at`, preenchidos
-- no banco a partir de `auth.uid()` (o cliente não os controla). `created_by`/`updated_by` NÃO têm FK para
-- auth.users: são identificação de autoria (um operador removido não deve apagar o patrimônio do dono).
-- CLASSIFICAÇÃO DE SNAPSHOTS: `investments.classified_by`/`classified_at` registram a ÚLTIMA mudança real de
-- `portfolio_id`/`holding_id` (não é um histórico de eventos), com o operador `auth.uid()` e o relógio do banco:
--   * atribuir, trocar e DESCLASSIFICAR (volta a NULL/NULL) atualizam a auditoria; desclassificar NÃO a apaga;
--   * reenviar os mesmos valores, ou editar balance/produto/etc., não toca na auditoria;
--   * o cliente não escolhe os campos: valor de auditoria enviado no INSERT, ou diferente do atual no UPDATE, é
--     REJEITADO (não há substituição silenciosa);
--   * classificar exige operador autenticado: SEM JWT a classificação direta é recusada (sem bypass por
--     `auth.uid() IS NULL`). Única exceção, explícita: efeito de FK (ON UPDATE CASCADE ao mover a holding de carteira,
--     ON DELETE SET NULL (holding_id) ao apagá-la) executado sem JWT mantém a auditoria anterior, porque não há
--     operador a atribuir; com JWT, o operador da operação que disparou o efeito é registrado.
--   * linhas existentes: NULL/NULL, sem backfill. `classified_by` não tem FK (mesma razão de created_by).
--
-- PRIVILÉGIOS: o schema `public` concede ALL a anon/authenticated em tabelas novas. As duas tabelas novas ficam só
-- com CRUD para `authenticated`. `investments` tinha TRUNCATE/TRIGGER/REFERENCES (e tudo para `anon`) abertos: o
-- hardening é INTENCIONAL e monotônico (o rollback não o desfaz). service_role e roles administrativas não mudam.

-- ---------------------------------------------------------------------------
-- 1) Carteiras
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investment_portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  archived_at timestamptz NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_portfolios_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT investment_portfolios_name_check CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80)
);

COMMENT ON TABLE public.investment_portfolios IS
  'Carteira de investimentos dentro da conta do proprietário (user_id). Administração familiar autorizada; arquivar em vez de apagar.';

-- Nomes únicos entre as carteiras NÃO arquivadas do mesmo proprietário (sem diferenciar maiúsculas/minúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS investment_portfolios_active_name_key
  ON public.investment_portfolios (user_id, lower(name))
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Holdings (identidade persistente de um investimento)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investment_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id uuid NOT NULL,
  display_name text NOT NULL,
  institution_ref text NULL,
  product_type_ref text NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_holdings_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT investment_holdings_user_id_id_portfolio_key UNIQUE (user_id, id, portfolio_id),
  CONSTRAINT investment_holdings_portfolio_owner_fkey
    FOREIGN KEY (user_id, portfolio_id) REFERENCES public.investment_portfolios (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT investment_holdings_name_check CHECK (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT investment_holdings_institution_ref_check
    CHECK (institution_ref IS NULL OR (institution_ref = btrim(institution_ref) AND char_length(institution_ref) BETWEEN 1 AND 120)),
  CONSTRAINT investment_holdings_product_type_ref_check
    CHECK (product_type_ref IS NULL OR (product_type_ref = btrim(product_type_ref) AND char_length(product_type_ref) BETWEEN 1 AND 120))
);

COMMENT ON TABLE public.investment_holdings IS
  'Identidade persistente de um investimento (UUID). Nome, instituição e valor NÃO definem identidade; o vínculo com snapshots é sempre explícito.';

CREATE INDEX IF NOT EXISTS investment_holdings_portfolio_idx ON public.investment_holdings (user_id, portfolio_id);

-- ---------------------------------------------------------------------------
-- 3) Colunas opcionais em investments (todas as linhas existentes continuam NULL)
-- ---------------------------------------------------------------------------
ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS portfolio_id uuid NULL,
  ADD COLUMN IF NOT EXISTS holding_id uuid NULL,
  ADD COLUMN IF NOT EXISTS classified_by uuid NULL,
  ADD COLUMN IF NOT EXISTS classified_at timestamptz NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.investments'::regclass AND conname = 'investments_portfolio_owner_fkey') THEN
    ALTER TABLE public.investments
      ADD CONSTRAINT investments_portfolio_owner_fkey
      FOREIGN KEY (user_id, portfolio_id) REFERENCES public.investment_portfolios (user_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.investments'::regclass AND conname = 'investments_holding_owner_portfolio_fkey') THEN
    ALTER TABLE public.investments
      ADD CONSTRAINT investments_holding_owner_portfolio_fkey
      FOREIGN KEY (user_id, holding_id, portfolio_id) REFERENCES public.investment_holdings (user_id, id, portfolio_id)
      ON UPDATE CASCADE ON DELETE SET NULL (holding_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.investments'::regclass AND conname = 'investments_holding_requires_portfolio_check') THEN
    ALTER TABLE public.investments
      ADD CONSTRAINT investments_holding_requires_portfolio_check CHECK (holding_id IS NULL OR portfolio_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.investments'::regclass AND conname = 'investments_classification_audit_pair_check') THEN
    ALTER TABLE public.investments
      ADD CONSTRAINT investments_classification_audit_pair_check CHECK ((classified_by IS NULL) = (classified_at IS NULL));
  END IF;
END
$constraints$;

-- Uma posição por holding por mês (protege cópia e importação futuras contra fotos duplicadas da mesma holding).
CREATE UNIQUE INDEX IF NOT EXISTS investments_holding_month_key
  ON public.investments (holding_id, reference_month)
  WHERE holding_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS investments_user_month_idx ON public.investments (user_id, reference_month);
CREATE INDEX IF NOT EXISTS investments_user_portfolio_idx ON public.investments (user_id, portfolio_id, reference_month) WHERE portfolio_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) Guardas de integridade e auditoria (SECURITY INVOKER; sem bypass por ausência de JWT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.investment_portfolios_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by deve ser o operador autenticado.' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := now();
    NEW.updated_by := NEW.created_by;
    NEW.updated_at := NEW.created_at;
    NEW.archived_at := NULL;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'id e user_id (proprietário) são imutáveis.' USING ERRCODE = '42501';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_by e created_at são imutáveis.' USING ERRCODE = '42501';
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), OLD.updated_by);
    NEW.updated_at := now();
    IF NEW.archived_at IS NOT NULL THEN
      NEW.archived_at := COALESCE(OLD.archived_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.investment_holdings_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.display_name := btrim(NEW.display_name);
  NEW.institution_ref := NULLIF(btrim(NEW.institution_ref), '');
  NEW.product_type_ref := NULLIF(btrim(NEW.product_type_ref), '');
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by deve ser o operador autenticado.' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := now();
    NEW.updated_by := NEW.created_by;
    NEW.updated_at := NEW.created_at;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'id e user_id (proprietário) são imutáveis.' USING ERRCODE = '42501';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_by e created_at são imutáveis.' USING ERRCODE = '42501';
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), OLD.updated_by);
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.investments_user_id_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'O proprietário (user_id) de um investimento é imutável: administração compartilhada não transfere propriedade.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.investments_classification_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.classified_by IS NOT NULL OR NEW.classified_at IS NOT NULL THEN
      RAISE EXCEPTION 'classified_by e classified_at são definidos pelo banco.' USING ERRCODE = '42501';
    END IF;
    IF NEW.portfolio_id IS NOT NULL OR NEW.holding_id IS NOT NULL THEN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Classificar um investimento exige um operador autenticado.' USING ERRCODE = '42501';
      END IF;
      NEW.classified_by := v_actor;
      NEW.classified_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: o cliente nunca escolhe a auditoria (reenviar o valor atual é aceito).
  IF NEW.classified_by IS DISTINCT FROM OLD.classified_by OR NEW.classified_at IS DISTINCT FROM OLD.classified_at THEN
    RAISE EXCEPTION 'classified_by e classified_at são definidos pelo banco.' USING ERRCODE = '42501';
  END IF;

  IF NEW.portfolio_id IS DISTINCT FROM OLD.portfolio_id OR NEW.holding_id IS DISTINCT FROM OLD.holding_id THEN
    IF v_actor IS NOT NULL THEN
      NEW.classified_by := v_actor;
      NEW.classified_at := now();
    ELSIF pg_trigger_depth() > 1 THEN
      -- efeito de FK sem JWT (cascade de holding): não há operador a atribuir; mantém a auditoria anterior
      NULL;
    ELSE
      RAISE EXCEPTION 'Classificar um investimento exige um operador autenticado.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investment_portfolios_guard ON public.investment_portfolios;
CREATE TRIGGER trg_investment_portfolios_guard
  BEFORE INSERT OR UPDATE ON public.investment_portfolios
  FOR EACH ROW EXECUTE FUNCTION public.investment_portfolios_guard();

DROP TRIGGER IF EXISTS trg_investment_holdings_guard ON public.investment_holdings;
CREATE TRIGGER trg_investment_holdings_guard
  BEFORE INSERT OR UPDATE ON public.investment_holdings
  FOR EACH ROW EXECUTE FUNCTION public.investment_holdings_guard();

DROP TRIGGER IF EXISTS trg_investments_classification_audit ON public.investments;
CREATE TRIGGER trg_investments_classification_audit
  BEFORE INSERT OR UPDATE ON public.investments
  FOR EACH ROW EXECUTE FUNCTION public.investments_classification_audit();

DROP TRIGGER IF EXISTS trg_investments_user_id_immutable ON public.investments;
CREATE TRIGGER trg_investments_user_id_immutable
  BEFORE UPDATE OF user_id ON public.investments
  FOR EACH ROW EXECUTE FUNCTION public.investments_user_id_immutable();

-- ---------------------------------------------------------------------------
-- 5) RLS das tabelas novas: o proprietário ou o familiar com vínculo ACEITO (has_family_access)
-- ---------------------------------------------------------------------------
ALTER TABLE public.investment_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investment_portfolios_select" ON public.investment_portfolios;
CREATE POLICY "investment_portfolios_select" ON public.investment_portfolios
  FOR SELECT TO authenticated USING (public.has_family_access(user_id));
DROP POLICY IF EXISTS "investment_portfolios_insert" ON public.investment_portfolios;
CREATE POLICY "investment_portfolios_insert" ON public.investment_portfolios
  FOR INSERT TO authenticated WITH CHECK (public.has_family_access(user_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS "investment_portfolios_update" ON public.investment_portfolios;
CREATE POLICY "investment_portfolios_update" ON public.investment_portfolios
  FOR UPDATE TO authenticated USING (public.has_family_access(user_id)) WITH CHECK (public.has_family_access(user_id));
DROP POLICY IF EXISTS "investment_portfolios_delete" ON public.investment_portfolios;
CREATE POLICY "investment_portfolios_delete" ON public.investment_portfolios
  FOR DELETE TO authenticated USING (public.has_family_access(user_id));

DROP POLICY IF EXISTS "investment_holdings_select" ON public.investment_holdings;
CREATE POLICY "investment_holdings_select" ON public.investment_holdings
  FOR SELECT TO authenticated USING (public.has_family_access(user_id));
DROP POLICY IF EXISTS "investment_holdings_insert" ON public.investment_holdings;
CREATE POLICY "investment_holdings_insert" ON public.investment_holdings
  FOR INSERT TO authenticated WITH CHECK (public.has_family_access(user_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS "investment_holdings_update" ON public.investment_holdings;
CREATE POLICY "investment_holdings_update" ON public.investment_holdings
  FOR UPDATE TO authenticated USING (public.has_family_access(user_id)) WITH CHECK (public.has_family_access(user_id));
DROP POLICY IF EXISTS "investment_holdings_delete" ON public.investment_holdings;
CREATE POLICY "investment_holdings_delete" ON public.investment_holdings
  FOR DELETE TO authenticated USING (public.has_family_access(user_id));

-- ---------------------------------------------------------------------------
-- 6) Privilégios
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.investment_portfolios FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_portfolios TO authenticated;

REVOKE ALL ON public.investment_holdings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_holdings TO authenticated;

-- investments: anon perde tudo; authenticated perde TRUNCATE/TRIGGER/REFERENCES e mantém o CRUD sob RLS.
REVOKE ALL ON public.investments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investments TO authenticated;
