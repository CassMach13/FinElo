-- Migration: Add family_slots to support per-seat "Family Plan" structure

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS family_slots integer DEFAULT 0;

-- Function to automatically assign 5 family slots to Lifetime (Founder) members
CREATE OR REPLACE FUNCTION check_lifetime_family_slots()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'lifetime' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'lifetime') THEN
    NEW.family_slots := 5;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute the function on subscription changes
DROP TRIGGER IF EXISTS trg_lifetime_family_slots ON public.subscriptions;
CREATE TRIGGER trg_lifetime_family_slots
BEFORE INSERT OR UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION check_lifetime_family_slots();

-- Initialize any existing lifetime members
UPDATE public.subscriptions SET family_slots = 5 WHERE status = 'lifetime';
