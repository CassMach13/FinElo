-- Migration: 013_fix_function_search_paths.sql
-- Description: Sets search_path = public for security on reported functions.
-- Uses dynamic SQL to handle potential variations in function signatures (arguments).

DO $$
DECLARE
    func_record RECORD;
BEGIN
    -- Loop through all functions with these names in the public schema
    FOR func_record IN 
        SELECT oid::regprocedure::text as func_signature 
        FROM pg_proc 
        WHERE proname IN ('has_family_access', 'is_premium', 'generate_support_protocol')
        AND prokind = 'f' -- ensure it is a function
        AND pronamespace = 'public'::regnamespace
    LOOP
        -- Execute ALTER FUNCTION for each found signature
        RAISE NOTICE 'Securing function: %', func_record.func_signature;
        EXECUTE 'ALTER FUNCTION ' || func_record.func_signature || ' SET search_path = public';
    END LOOP;
END
$$;
