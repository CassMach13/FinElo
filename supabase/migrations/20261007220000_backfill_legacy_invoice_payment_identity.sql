-- ===========================================================================
-- Identidade econômica V1 — Fase 3C: backfill das pernas legadas do "Pagar" + reserva do source de backfill.
-- ===========================================================================
--
-- A) RESERVA DO SOURCE. `source = 'backfill_funding_marker'` passa a significar "criado EXCLUSIVAMENTE por este
--    backfill". A policy de INSERT dos clientes (`authenticated`) recusa esse valor. É isso que torna seguro o
--    rollback `DELETE ... WHERE source = 'backfill_funding_marker'` (nunca apaga evento criado por um cliente).
--    Só a policy muda: SELECT/DELETE familiares, GRANTs, CHECKs e FKs ficam como estão. Sem trigger: a migration roda
--    como papel de banco (não passa pela RLS) e consegue criar os eventos; o cliente PostgREST normal não.
--
-- B) BACKFILL. Para CADA linha com o marcador `finelo_funding_account:` e `economic_event_id IS NULL`:
--      1 evento próprio → kind = credit_card_payment, source = backfill_funding_marker, counterparty NULL,
--      user_id = created_by = transactions.user_id → vínculo SÓ daquela linha.
--    * Identidade = o marcador gravado pelo fluxo "Pagar" e mais nada: nada de valor, data, categoria, nome, tipo ou
--      conta. Sem pareamento e sem agrupamento (uma linha, um evento, uma perna).
--    * O marcador vive em `Descricao_Original`: a tabela real não tem coluna `Observacoes` (só o tipo TS tem).
--    * Idempotente: só `economic_event_id IS NULL`. Reexecutar não cria nada.
--    * Nenhum valor financeiro é tocado: só a coluna `economic_event_id` das linhas elegíveis.
--
-- ROLLBACK DOS DADOS (não executado aqui): ver supabase/rollbacks/20261007220000_backfill_legacy_invoice_payment_identity_down.sql
--   DELETE FROM public.economic_events WHERE source = 'backfill_funding_marker';
--   A FK `ON DELETE SET NULL (economic_event_id)` devolve as transações a NULL.

-- A) policy de INSERT: o source de backfill é reservado
DROP POLICY IF EXISTS "economic_events_insert_own" ON public.economic_events;
CREATE POLICY "economic_events_insert_own"
  ON public.economic_events FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND created_by = auth.uid()
    AND source <> 'backfill_funding_marker'
  );

-- B) backfill: um evento por linha, sem pareamento
DO $backfill$
DECLARE
  r record;
  v_event uuid;
  v_updated integer;
  v_linked integer := 0;
BEGIN
  FOR r IN
    SELECT t."ID_Transacao", t.user_id
    FROM public.transactions t
    WHERE t.economic_event_id IS NULL
      AND strpos(lower(coalesce(t."Descricao_Original", '')), 'finelo_funding_account:') > 0
    ORDER BY t."ID_Transacao"
  LOOP
    INSERT INTO public.economic_events (user_id, kind, source, counterparty_account_id, created_by)
    VALUES (r.user_id, 'credit_card_payment', 'backfill_funding_marker', NULL, r.user_id)
    RETURNING id INTO v_event;

    UPDATE public.transactions
       SET economic_event_id = v_event
     WHERE "ID_Transacao" = r."ID_Transacao"
       AND economic_event_id IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> 1 THEN
      -- concorrência: a linha já foi classificada por outro caminho; não deixa evento órfão
      DELETE FROM public.economic_events WHERE id = v_event;
    ELSE
      v_linked := v_linked + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'economic identity backfill: % transações vinculadas', v_linked;
END
$backfill$;
