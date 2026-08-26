-- Add intelligent onboarding columns to business_profiles
-- Purpose: Store extracted pain points, goals, tools, and payment configuration
--          to enable smart capability activation based on user conversation
-- Last Updated: 2026-08-12

-- Add new columns for intelligent onboarding
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS pain_points TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS goals TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tools TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS online_presence_mode TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS needs_stripe_connect BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS extracted_data JSONB DEFAULT '{}';

-- Add comments for documentation
COMMENT ON COLUMN business_profiles.pain_points IS 'Business pain points extracted from onboarding chat (e.g., no_shows, manual_reminders, payment_collection)';
COMMENT ON COLUMN business_profiles.goals IS 'Business goals extracted from onboarding chat (e.g., grow_clients, save_time, automation, professional_image)';
COMMENT ON COLUMN business_profiles.tools IS 'Tools/software user currently uses (e.g., google_calendar, stripe, whatsapp, excel)';
COMMENT ON COLUMN business_profiles.payment_mode IS 'Payment configuration mode: none, upfront, invoicing, installments';
COMMENT ON COLUMN business_profiles.online_presence_mode IS 'Online presence mode: none, booking_only, website_only, full_website';
COMMENT ON COLUMN business_profiles.needs_stripe_connect IS 'Whether user needs Stripe Connect setup for payments';
COMMENT ON COLUMN business_profiles.extracted_data IS 'Full extracted data from onboarding conversation for debugging and re-evaluation';

-- Add indexes for querying by pain points/goals (useful for analytics)
CREATE INDEX IF NOT EXISTS idx_business_profiles_pain_points ON business_profiles USING GIN (pain_points);
CREATE INDEX IF NOT EXISTS idx_business_profiles_goals ON business_profiles USING GIN (goals);
CREATE INDEX IF NOT EXISTS idx_business_profiles_payment_mode ON business_profiles(payment_mode);
CREATE INDEX IF NOT EXISTS idx_business_profiles_online_presence_mode ON business_profiles(online_presence_mode);
