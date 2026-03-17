-- Add is_investment column to categories table
ALTER TABLE categories 
ADD COLUMN is_investment BOOLEAN DEFAULT FALSE;

-- Update existing rows to have the default value (optional, but good practice)
UPDATE categories 
SET is_investment = FALSE 
WHERE is_investment IS NULL;
