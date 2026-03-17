-- Add protocol column
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS protocol TEXT UNIQUE;

-- Function to generate protocol
CREATE OR REPLACE FUNCTION generate_support_protocol()
RETURNS TRIGGER AS $$
DECLARE
  new_protocol TEXT;
  exists BOOLEAN;
BEGIN
  LOOP
    -- Generate: YYYYMMDD-XXXX (4 random hex chars)
    new_protocol := to_char(NOW(), 'YYYYMMDD') || '-' || upper(substring(md5(random()::text) from 1 for 4));
    
    -- Check uniqueness
    SELECT EXISTS(SELECT 1 FROM support_tickets WHERE protocol = new_protocol) INTO exists;
    
    -- If unique, set it and exit loop
    IF NOT exists THEN
      NEW.protocol := new_protocol;
      EXIT;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger
DROP TRIGGER IF EXISTS set_support_protocol ON support_tickets;
CREATE TRIGGER set_support_protocol
BEFORE INSERT ON support_tickets
FOR EACH ROW
EXECUTE FUNCTION generate_support_protocol();

-- Backfill existing tickets
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id, created_at FROM support_tickets WHERE protocol IS NULL LOOP
    UPDATE support_tickets 
    SET protocol = to_char(t.created_at, 'YYYYMMDD') || '-' || upper(substring(md5(t.id::text) from 1 for 4))
    WHERE id = t.id;
  END LOOP;
END;
$$;
