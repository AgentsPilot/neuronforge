-- Generate user_codes for existing profiles that don't have one
-- Run this if the main migration was partially applied

DO $$
DECLARE
  profile_record RECORD;
  new_code TEXT;
  attempts INT;
  chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
BEGIN
  FOR profile_record IN
    SELECT id FROM business_profiles WHERE user_code IS NULL
  LOOP
    attempts := 0;
    LOOP
      -- Generate random 6-char code
      new_code := '';
      FOR i IN 1..6 LOOP
        new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;

      IF NOT EXISTS (SELECT 1 FROM business_profiles WHERE user_code = new_code) THEN
        UPDATE business_profiles SET user_code = new_code WHERE id = profile_record.id;
        RAISE NOTICE 'Generated user_code % for profile %', new_code, profile_record.id;
        EXIT;
      END IF;

      attempts := attempts + 1;
      IF attempts > 20 THEN
        RAISE WARNING 'Unable to generate user_code for profile %', profile_record.id;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Show results
SELECT id, user_id, company_name, user_code FROM business_profiles;
