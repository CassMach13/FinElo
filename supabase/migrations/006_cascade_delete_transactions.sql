-- Drop existing constraint if it exists (we need to know the name, usually transactions_ID_Conta_fkey or similar)
-- We will try to drop loosely or use a do block. For Supabase, standard naming is often table_column_fkey.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'transactions_ID_Conta_fkey' 
        AND table_name = 'transactions'
    ) THEN
        ALTER TABLE transactions DROP CONSTRAINT transactions_ID_Conta_fkey;
    END IF;
END $$;

-- Add the constraint back with ON DELETE CASCADE
ALTER TABLE transactions
ADD CONSTRAINT transactions_ID_Conta_fkey
FOREIGN KEY ("ID_Conta")
REFERENCES contas(id)
ON DELETE CASCADE;

-- Ensure RLS allows deletion of transactions
-- (We assume the policy logic check is done by the user's ID on the transaction itself, but let's be safe and explicitly add a delete policy if not exists)
create policy "Users can delete their own transactions"
  on public.transactions for delete
  using (auth.uid() = user_id);
