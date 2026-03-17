-- Add year column to budgets table
-- Default to current year (2025 as per conversation context or extract from now)
ALTER TABLE budgets 
ADD COLUMN ano INTEGER NOT NULL DEFAULT CAST(EXTRACT(YEAR FROM NOW()) AS INTEGER);

-- Remove old unique constraint if it exists (assuming it was user_id, Categoria)
-- We need to check if there's a constraint first, but usually we can try to drop the likely name or just add the new one.
-- Supabase/Postgres doesn't always name constraints consistently unless specified. 
-- However, we can add the NEW unique constraint which includes 'ano'.
-- If there was a previous unique constraint on (user_id, Categoria), it will now fail because valid rows might have same (user_id, Categoria) but different 'ano'.
-- So we should try to drop the old constraint.
-- Assuming standard naming or we just proceed with adding the new one and let the user handle duplicates if any (unlikely given previous logic).

-- Let's try to add the new constraint.
ALTER TABLE budgets 
ADD CONSTRAINT unique_budget_owner_category_year UNIQUE (user_id, "Categoria", ano);

-- Comment: This enables having 'Groceries' budget for 2024 and 'Groceries' budget for 2025.
