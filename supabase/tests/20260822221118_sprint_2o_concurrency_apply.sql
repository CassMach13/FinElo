\set ON_ERROR_STOP on

select set_config(
  'request.jwt.claim.sub',
  '1a000000-0000-0000-0000-000000000001',
  false
);

select public.conserve_credit_card_statement_duplicates_atomic_v1(
  '2a000000-0000-0000-0000-000000000001',
  :'expected_revision',
  'shadow-v1-11111111',
  '2026-09',
  array[
    '6a000000-0000-0000-0000-000000000001'::uuid,
    '6a000000-0000-0000-0000-000000000002'::uuid
  ],
  0,
  0,
  '{
    "statementKey":"2026-09",
    "purchaseReferenceMonth":"2026-09",
    "dueDate":"2026-09-28",
    "dueYear":2026,
    "dueMonth":9,
    "status":"open",
    "entryCount":0,
    "totalPurchasesCents":0,
    "totalFeesCents":0,
    "totalInterestCents":0,
    "totalRefundsCents":0,
    "statementTotalCents":0,
    "totalPaymentsCents":0,
    "openBalanceCents":0,
    "manualTotalsJson":null,
    "statementTotalFromFileCents":null,
    "totalPaymentsFromFileCents":null,
    "linesComputedTotalCents":null
  }'::jsonb
);
