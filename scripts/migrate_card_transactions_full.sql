
-- MIGRATE TRANSACTIONS TO NEW CREDIT CARD ACCOUNT (SMART DATE VERSION)
-- This script moves ALL Credit Card expenses found in 'Conta XP' to 'Cartão XP',
-- and adjusts the new account's start date to accommodate the oldest transaction found.

DO $$ 
DECLARE 
    new_account_id UUID;
    xp_account_id UUID;
    user_id_val UUID;
    min_date DATE;
BEGIN
    -- 1. Identify Existing XP Account
    SELECT id, user_id INTO xp_account_id, user_id_val
    FROM contas 
    WHERE "Nome_Conta" ILIKE '%XP%' AND "Tipo_Conta" != 'Cartão de Crédito'
    LIMIT 1;

    IF xp_account_id IS NULL THEN
        RAISE EXCEPTION 'Conta XP (Corrente) not found!';
    END IF;

    -- 2. Find the earliest date of potential candidates to migrate
    -- This ensures the new account covers the full history
    SELECT MIN("Data")::DATE INTO min_date
    FROM transactions
    WHERE "ID_Conta" = xp_account_id
      AND (
          "Origem" ILIKE '%Fatura%' 
          OR "Fonte" ILIKE '%Cartão%' 
          OR "Fonte" ILIKE '%Card%'
      );
    
    -- Default to 2025-01-01 if null or newer, just to be safe
    IF min_date IS NULL OR min_date > '2025-01-01' THEN
        min_date := '2025-01-01';
    END IF;

    RAISE NOTICE 'Detected earliest transaction date: %', min_date;

    -- 3. Create the new Account "Cartão XP (Migrado)"
    INSERT INTO contas ("user_id", "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial")
    VALUES (user_id_val, 'Cartão XP (Migrado)', 'Cartão de Crédito', 0, min_date)
    RETURNING id INTO new_account_id;

    RAISE NOTICE 'Created Account: Cartão XP (Migrado) starting on %', min_date;

    -- 4. Move Transactions
    UPDATE transactions
    SET "ID_Conta" = new_account_id
    WHERE "ID_Conta" = xp_account_id
      AND (
          "Origem" ILIKE '%Fatura%' 
          OR "Fonte" ILIKE '%Cartão%' 
          OR "Fonte" ILIKE '%Card%'
          OR "Nome_Fantasia" ILIKE '%Cartão%'
      );

    RAISE NOTICE 'Migration Complete: All historical Card transactions moved.';

END $$;
