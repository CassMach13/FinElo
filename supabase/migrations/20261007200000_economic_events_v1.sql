-- ===========================================================================
-- Identidade econômica V1 — Fase 1: `economic_events` + `transactions.economic_event_id`.
-- ===========================================================================
--
-- Fase 1 é SÓ metadata: nenhum KPI, filtro ou helper interpreta `economic_event_id`.
-- Aditiva: sem DML, sem backfill (as linhas existentes ficam com economic_event_id = NULL).
--
-- * Um evento é criado por um fluxo do FinElo que conhece as pernas (Fase 1: o "Pagar"). A identidade
--   NUNCA é inferida por valor, data, descrição, merchant ou categoria.
-- * Mesmo dono garantido pelo BANCO: FK composta (user_id, economic_event_id) → economic_events (user_id, id).
-- * Apagar o evento NÃO apaga a transação: ON DELETE SET NULL (economic_event_id) zera só a coluna
--   (o user_id da transação é NOT NULL e permanece).
-- * `economic_events` é imutável: sem UPDATE. INSERT só do dono; SELECT/DELETE por `has_family_access`.
-- * `counterparty_account_id` é metadata auxiliar (a tabela de contas do app é `public.contas`).
--   Não prova neutralidade por si só; precisa ser conta do MESMO dono (trigger).
-- * O hardening de `public.transactions` (20261007180000) NÃO é tocado: adicionar coluna não muda o ACL.

CREATE TABLE IF NOT EXISTS public.economic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  source text NOT NULL,
  counterparty_account_id uuid NULL REFERENCES public.contas(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT economic_events_kind_check CHECK (kind IN ('own_account_transfer', 'credit_card_payment')),
  CONSTRAINT economic_events_source_check CHECK (source IN ('pay_invoice_flow', 'transfer_flow', 'user', 'backfill_funding_marker')),
  CONSTRAINT economic_events_user_id_id_key UNIQUE (user_id, id)
);

COMMENT ON TABLE public.economic_events IS
  'Evento econômico (identidade V1): criado por um fluxo do FinElo que conhece as pernas. Imutável. Sem backfill na Fase 1.';

CREATE INDEX IF NOT EXISTS economic_events_user_idx ON public.economic_events (user_id);

-- Contraparte (quando informada) deve ser conta do MESMO dono: public.contas.user_id é nullable,
-- por isso a garantia é um trigger, não uma FK composta.
CREATE OR REPLACE FUNCTION public.economic_events_check_counterparty()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.counterparty_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contas c WHERE c.id = NEW.counterparty_account_id AND c.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'A conta de contraparte precisa pertencer ao mesmo usuário do evento.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_economic_events_counterparty ON public.economic_events;
CREATE TRIGGER trg_economic_events_counterparty
  BEFORE INSERT ON public.economic_events
  FOR EACH ROW EXECUTE FUNCTION public.economic_events_check_counterparty();

ALTER TABLE public.economic_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "economic_events_select_family" ON public.economic_events;
CREATE POLICY "economic_events_select_family"
  ON public.economic_events FOR SELECT TO authenticated
  USING (public.has_family_access(user_id));

DROP POLICY IF EXISTS "economic_events_insert_own" ON public.economic_events;
CREATE POLICY "economic_events_insert_own"
  ON public.economic_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND created_by = auth.uid());

DROP POLICY IF EXISTS "economic_events_delete_family" ON public.economic_events;
CREATE POLICY "economic_events_delete_family"
  ON public.economic_events FOR DELETE TO authenticated
  USING (public.has_family_access(user_id));

REVOKE ALL ON public.economic_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.economic_events TO authenticated;

-- Coluna nova em transactions: nullable, sem default, sem backfill. Clientes antigos não a enviam.
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS economic_event_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass AND conname = 'transactions_economic_event_owner_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_economic_event_owner_fkey
      FOREIGN KEY (user_id, economic_event_id)
      REFERENCES public.economic_events (user_id, id)
      ON DELETE SET NULL (economic_event_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_transactions_economic_event
  ON public.transactions (economic_event_id) WHERE economic_event_id IS NOT NULL;
