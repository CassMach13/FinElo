-- Migration: 008_add_is_essential_to_categories.sql
-- Description: Adds 'is_essential' boolean column to categories table to support 50-30-20 rule.

ALTER TABLE categories
ADD COLUMN IF NOT EXISTS is_essential BOOLEAN DEFAULT FALSE;

-- Optional: Set default essential categories (can be done via UI later, or basic seeds here)
-- Updating common essential categories if they exist (safe update)
UPDATE categories 
SET is_essential = TRUE 
WHERE LOWER(TRIM("Nome_Categoria")) IN (
    'moradia', 'aluguel', 'condomínio', 'luz', 'água', 'internet', 
    'mercado', 'supermercado', 'saúde', 'farmácia', 'plano de saúde',
    'transporte', 'combustível', 'educação', 'escola'
);
