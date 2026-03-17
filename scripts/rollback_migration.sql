
-- ROLLBACK MIGRATION
-- Use this if you want to undo the changes and go back to the previous state.

DO $$ 
DECLARE 
    migrated_account_id UUID;
    xp_account_id UUID;
BEGIN
    -- 1. Find the Created "Cartão XP (Migrado)" Account
    SELECT id INTO migrated_account_id
    FROM contas 
    WHERE "Nome_Conta" = 'Cartão XP (Migrado)'
    LIMIT 1;

    -- 2. Find the Original "Conta XP"
    SELECT id INTO xp_account_id
    FROM contas 
    WHERE "Nome_Conta" ILIKE '%XP%' AND "Nome_Conta" != 'Cartão XP (Migrado)'
    LIMIT 1;

    IF migrated_account_id IS NULL THEN
        RAISE NOTICE 'Migration account not found. Nothing to rollback.';
        RETURN;
    END IF;

    -- 3. Move Transactions BACK to Data XP
    UPDATE transactions
    SET "ID_Conta" = xp_account_id
    WHERE "ID_Conta" = migrated_account_id;

    RAISE NOTICE 'Moved transactions back to Conta XP.';

    -- 4. Delete the Temporary Account
    DELETE FROM contas WHERE id = migrated_account_id;

    RAISE NOTICE 'Deleted temporary account.';

END $$;
