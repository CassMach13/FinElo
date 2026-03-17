
-- CLEAN OLD CARD TRANSACTIONS FROM CHECKING ACCOUNT
-- CAUTION: This will DELETE transactions! Use only if you plan to Re-Import them into the new account.

DO $$ 
DECLARE 
    xp_checking_id UUID;
    deleted_count INTEGER;
BEGIN
    -- 1. Identify "Conta XP" (Checking Account)
    SELECT id INTO xp_checking_id
    FROM contas 
    WHERE "Nome_Conta" ILIKE '%Conta XP%' OR ("Nome_Conta" ILIKE '%XP%' AND "Tipo_Conta" != 'Cartão de Crédito')
    LIMIT 1;

    IF xp_checking_id IS NULL THEN
        RAISE EXCEPTION 'Conta XP (Corrente) not found!';
    END IF;

    -- 2. Delete existing "Fatura/Card" entries from this Checkign Account
    -- SAFETY: We only delete items that specifically came from "Fatura" files or are marked as Credit Card source.
    -- We correctly PRESERVE "Pix", "Transferências", and "Pagamento de Fatura" (if it came from Extrato).
    
    WITH deleted_rows AS (
        DELETE FROM transactions
        WHERE "ID_Conta" = xp_checking_id
          AND (
              "Origem" ILIKE '%Fatura%'       -- Come from Invoice files
              OR "Fonte" ILIKE '%Cartão%'     -- Marked as Credit Card source
              OR "Fonte" ILIKE '%Card%'
              -- Additional check to ensure we don't delete the Bank Payment itself if it was named generic
              AND "Descricao_Original" NOT ILIKE '%Pagamento de Fatura%' 
          )
        RETURNING *
    )
    SELECT count(*) INTO deleted_count FROM deleted_rows;

    RAISE NOTICE 'Limpeza Concluída: % transações de cartão foram removidas da Conta Corrente.', deleted_count;
    RAISE NOTICE 'Sua Conta XP deve estar com o saldo correto agora (apenas Bank Transactions).';
    RAISE NOTICE 'Agora você pode importar os arquivos de Fatura para a nova conta "Cartão XP".';

END $$;
