/**
 * Add services column to business_profiles table
 * This column stores the list of services extracted from user's bio
 */

-- Add services column as TEXT array
ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}';

-- Add index for services array for better query performance
CREATE INDEX IF NOT EXISTS idx_business_profiles_services
ON business_profiles USING GIN (services);

-- Add comment
COMMENT ON COLUMN business_profiles.services IS 'List of services/products offered by the business (e.g., ["therapy", "coaching"])';
