-- Add bank_id to contas table to allow displaying official bank logos
ALTER TABLE contas ADD COLUMN IF NOT EXISTS bank_id TEXT;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_contas_bank_id ON contas(bank_id);
