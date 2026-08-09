drop function if exists public.rollback_credit_card_payment_repair_atomic_v1(uuid);
drop function if exists public.repair_credit_card_payment_duplicates_atomic_v1(uuid, text, uuid[]);
drop table if exists public.credit_card_atomic_repair_snapshots;
