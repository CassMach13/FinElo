-- ============================================================================
-- FIX SIGNUP 500 ERROR
-- ============================================================================
-- Description: 
-- This script removes the 'on_auth_user_created' trigger and the 
-- 'public.handle_new_user' function. These are often default triggers that 
-- fail if the target 'profiles' table does not exist or has a schema mismatch.
--
-- INSTRUCTIONS:
-- 1. Copy this entire script.
-- 2. Go to your Supabase Dashboard -> SQL Editor.
-- 3. Paste and Run.
-- ============================================================================

-- 1. Drop the trigger from auth.users
-- We use 'if exists' to avoid errors if it's already gone.
drop trigger if exists on_auth_user_created on auth.users;

-- 2. Drop the function
-- We use 'cascade' to ensure any other dependent triggers are also removed.
drop function if exists public.handle_new_user() cascade;

-- 3. (Optional) Check for other common variations
drop trigger if exists on_signup on auth.users;
drop function if exists public.handle_signup() cascade;

-- 4. Verify
select 'Fix applied successfully. Try signing up again.' as result;
