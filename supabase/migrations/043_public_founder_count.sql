-- Migration: Public function to get total founder count
-- This allows unauthenticated users (on the Landing Page) to see the correct count bypassing RLS

CREATE OR REPLACE FUNCTION get_founder_count()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  founders_users INT;
BEGIN
  SELECT count(*) INTO founders_users 
  FROM public.subscriptions 
  WHERE status = 'lifetime' OR plan_type = 'lifetime';
  
  RETURN founders_users;
END;
$$;
