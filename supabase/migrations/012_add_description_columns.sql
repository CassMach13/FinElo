-- Migration to add missing Description columns for Smart Import
-- Run this in your Supabase SQL Editor

ALTER TABLE import_configs 
ADD COLUMN IF NOT EXISTS "Coluna_Descricao_1" TEXT DEFAULT NULL;

ALTER TABLE import_configs 
ADD COLUMN IF NOT EXISTS "Coluna_Descricao_2" TEXT DEFAULT NULL;

-- Also ensuring Portador exists just in case
ALTER TABLE import_configs 
ADD COLUMN IF NOT EXISTS "Coluna_Portador" TEXT DEFAULT NULL;
