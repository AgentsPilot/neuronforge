-- Add process_steps to business_profiles
-- Purpose: Allow users to define their own "How It Works" workflow steps for their website
-- These steps will be used by the website builder Process section instead of auto-generated capability steps
-- Last Updated: 2026-07-28

-- Add process_steps column to business_profiles
-- Structure: Array of { title, description, icon?, number? }
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS process_steps JSONB DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN business_profiles.process_steps IS 'User-defined workflow steps for the website "How It Works" section. Array of {title, description, icon, number}';

-- Example of what process_steps looks like:
-- [
--   { "title": "Initial Consultation", "description": "Free 15-minute call to discuss your needs", "icon": "Phone", "number": 1 },
--   { "title": "Assessment", "description": "In-depth evaluation of your situation", "icon": "ClipboardCheck", "number": 2 },
--   { "title": "Treatment Plan", "description": "Personalized plan tailored to your goals", "icon": "FileText", "number": 3 },
--   { "title": "Ongoing Support", "description": "Regular sessions to support your progress", "icon": "Heart", "number": 4 }
-- ]
