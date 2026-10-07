-- Rollback de 20261007220000_backfill_legacy_invoice_payment_identity.sql (NÃO executado automaticamente).
--
-- Desfaz SÓ os dados do backfill: apaga os eventos reservados ao backfill. A FK
-- `ON DELETE SET NULL (economic_event_id)` devolve as transações vinculadas a NULL; nenhuma transação é apagada
-- nem tem valor alterado. É seguro porque a policy de INSERT dos clientes recusa esse source: todo evento com
-- `source = 'backfill_funding_marker'` foi criado pelo backfill. NUNCA apague `pay_invoice_flow` nem `user`.
--
-- O hardening da policy de INSERT permanece (não reabre o source reservado para `authenticated`).

DELETE FROM public.economic_events WHERE source = 'backfill_funding_marker';
