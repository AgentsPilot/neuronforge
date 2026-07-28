-- Add website_language column to website_pages
-- Allows users to select the language for their website content (separate from UI language)
-- Values: 'en' (English), 'es' (Spanish), 'he' (Hebrew)

ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS website_language TEXT DEFAULT 'en';

-- Add a check constraint for valid language values
ALTER TABLE website_pages ADD CONSTRAINT website_pages_language_check
  CHECK (website_language IN ('en', 'es', 'he'));

-- Comment for documentation
COMMENT ON COLUMN website_pages.website_language IS 'Language for website content generation (en, es, he)';
