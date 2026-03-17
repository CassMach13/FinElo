-- Migration: 009_fix_rls_policies.sql
-- Description: Ensures RLS policies for transactions are thoroughly defined.
-- This fixes potential 403/CORS errors during updates if policies were missing or malformed.

-- Enable RLS on transactions (just in case)
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- DROP existing policies to clean up (avoids "policy already exists" errors if we name them strictly)
DROP POLICY IF EXISTS "Users can view their own transactions" ON transactions;
DROP POLICY IF EXISTS "Users can insert their own transactions" ON transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON transactions;
DROP POLICY IF EXISTS "Users can delete their own transactions" ON transactions;

-- CREATE comprehensive policies
CREATE POLICY "Users can view their own transactions"
ON transactions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions"
ON transactions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
ON transactions FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions"
ON transactions FOR DELETE
USING (auth.uid() = user_id);
