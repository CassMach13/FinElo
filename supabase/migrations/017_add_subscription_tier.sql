-- Migration: Add tier to support different subscription levels (e.g., 'pro', 'wealth')

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS tier text DEFAULT 'pro';

-- Existing lifetime members are implicitly wealth, but let's be explicit
UPDATE public.subscriptions SET tier = 'wealth' WHERE status = 'lifetime';
