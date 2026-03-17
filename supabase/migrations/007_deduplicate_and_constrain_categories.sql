-- Migration: 007_deduplicate_and_constrain_categories.sql
-- Description: Removes duplicate categories and adds a unique constraint on (user_id, LOWER(NAME)).

-- 1. Deduplicate: Delete duplicates, keeping the one with type 'Ambos' (priority) or oldest ID.
-- Using a CTE to identify duplicates to keep.
WITH Duplicates AS (
    SELECT 
        id, 
        user_id, 
        "Nome_Categoria", 
        "Tipo",
        ROW_NUMBER() OVER (
            PARTITION BY user_id, LOWER(TRIM("Nome_Categoria")) 
            ORDER BY 
                CASE WHEN "Tipo" = 'Ambos' THEN 0 ELSE 1 END ASC, -- Prioritize Keeping 'Ambos'
                created_at ASC, -- Prioritize keeping oldest
                id ASC
        ) as rn
    FROM categories
)
DELETE FROM categories
WHERE id IN (
    SELECT id FROM Duplicates WHERE rn > 1
);

-- 2. Add Unique Index/Constraint on case-insensitive name
-- We use a unique index for flexibility with functions
CREATE UNIQUE INDEX IF NOT EXISTS unique_category_name_idx 
ON categories (user_id, LOWER(TRIM("Nome_Categoria")));

-- 3. Also add a standard constraint for exact matches just in case
ALTER TABLE categories 
ADD CONSTRAINT unique_category_name_key UNIQUE (user_id, "Nome_Categoria");
