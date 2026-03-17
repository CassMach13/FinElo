
-- MIGRATE TRANSACTIONS TO NEW CREDIT CARD ACCOUNT
-- This script separates Credit Card expenses from the Checking Account to fix the Balance.

DO $$ 
DECLARE 
    new_account_id UUID;
    xp_account_id UUID;
    user_id UUID;
BEGIN
    -- 1. Identify the existing "Conta XP" (Source)
    SELECT id, user_id INTO xp_account_id, user_id
    FROM contas 
    WHERE "Nome_Conta" ILIKE '%XP%' 
    LIMIT 1;

    IF xp_account_id IS NULL THEN
        RAISE EXCEPTION 'Conta XP not found!';
    END IF;

    -- 2. Create the new Account "Cartão XP" (Target)
    -- We use the same user_id as the existing account
    INSERT INTO contas ("user_id", "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial")
    VALUES (user_id, 'Cartão XP (Migrado)', 'Cartão de Crédito', 0, '2025-12-01')
    RETURNING id INTO new_account_id;

    RAISE NOTICE 'Created new Account: Cartão XP (Migrado) with ID: %', new_account_id;

    -- 3. Move Transactions
    -- Criterion: Origem contains 'Fatura' OR Fonte contains 'Cartão'
    -- AND currently belongs to the XP Checking Account
    UPDATE transactions
    SET "ID_Conta" = new_account_id
    WHERE "ID_Conta" = xp_account_id
      AND (
          "Origem" ILIKE '%Fatura%' 
          OR "Fonte" ILIKE '%Cartão%' 
          OR "Fonte" ILIKE '%Card%'
      );

    RAISE NOTICE 'Moved transactions to new account.';

    -- 4. Clean up "Pagamento de Fatura" duplicates
    -- The user might have imported the payment withdrawal as a "Despesa" in checking account.
    -- Ideally, this should remain in Checking Account but be classified as a Transfer if possible.
    -- For now, we leave them in Checking Account (since money LEFT the checking account).
    -- But we ensure they are NOT moved to the Credit Card account.
    
    -- (The query above only moves items with 'Fatura' in ORIGIN (Filename) or 'Cartão' in Source)
    -- 'Pagamento de Fatura' usually comes from the Bank Statement (Extrato...), so it should NOT be moved.
    -- This means the Checking Account will correctly show only the Payment Withdrawal.

END $$;
