-- Migration to add support for Smart Import persistence
-- Run this in your Supabase SQL Editor

ALTER TABLE import_configs 
ADD COLUMN IF NOT EXISTS "Coluna_Parcelas" TEXT DEFAULT '-1';

ALTER TABLE import_configs
ADD COLUMN IF NOT EXISTS "Ignorar_Indices" JSONB DEFAULT '[]'::jsonb;
