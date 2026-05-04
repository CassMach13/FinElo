-- Migration: Add is_archived to accounts

ALTER TABLE public.contas ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
