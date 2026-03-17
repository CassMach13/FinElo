-- Enable Open Finance integrations

-- 1. Create pluggy_connections table to store linked bank accounts (Items)
CREATE TABLE IF NOT EXISTS public.pluggy_connections (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    item_id text NOT NULL,
    bank_name text,
    status text DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for pluggy_connections
ALTER TABLE public.pluggy_connections ENABLE ROW LEVEL SECURITY;

-- Add RLS policies for pluggy_connections
CREATE POLICY "Users can view own pluggy connections"
    ON public.pluggy_connections FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pluggy connections"
    ON public.pluggy_connections FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own pluggy connections"
    ON public.pluggy_connections FOR DELETE
    USING (auth.uid() = user_id);

-- 2. Add deduplication ID to transacoes table
-- Avoid adding it if it already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'transactions' 
        AND column_name = 'pluggy_transaction_id'
    ) THEN
        ALTER TABLE public.transactions ADD COLUMN pluggy_transaction_id text;
        -- Create an index to speed up deduplication checks
        CREATE INDEX IF NOT EXISTS idx_transactions_pluggy_tx_id ON public.transactions(pluggy_transaction_id);
    END IF;
END $$;
