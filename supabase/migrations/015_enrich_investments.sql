-- Migration: Add rich data columns to the investments table
-- These fields are populated via spreadsheet imports (e.g., XP Investimentos)

ALTER TABLE public.investments
ADD COLUMN IF NOT EXISTS product_name text,
ADD COLUMN IF NOT EXISTS yield_rate text,
ADD COLUMN IF NOT EXISTS maturity_date date,
ADD COLUMN IF NOT EXISTS invested_principal numeric(15,2);

-- Note: No RLS changes are needed as these are just new columns on an existing table that already has RLS based on user_id.
