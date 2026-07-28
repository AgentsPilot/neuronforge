-- Website Content Table
-- Purpose: Central storage for website section content that persists across template changes
-- Templates define WHICH sections to show; this table stores the CONTENT for each section
-- Last Updated: 2026-07-26

CREATE TABLE IF NOT EXISTS website_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) UNIQUE NOT NULL,

  -- Hero Section
  hero JSONB DEFAULT '{
    "headline": "",
    "subheadline": "",
    "cta_text": "Get Started",
    "cta_url": "/booking",
    "background_image": "",
    "alignment": "center"
  }'::jsonb,

  -- About Section
  about JSONB DEFAULT '{
    "title": "About",
    "about_text": "",
    "image": "",
    "mission": "",
    "years_experience": null
  }'::jsonb,

  -- Services Section (synced from Scheduling capability, user can customize visibility)
  services JSONB DEFAULT '{
    "title": "Services",
    "subtitle": "",
    "layout": "grid",
    "items": []
  }'::jsonb,

  -- Testimonials Section
  testimonials JSONB DEFAULT '{
    "title": "What Clients Say",
    "subtitle": "",
    "items": []
  }'::jsonb,

  -- FAQ Section
  faq JSONB DEFAULT '{
    "title": "Frequently Asked Questions",
    "subtitle": "",
    "items": []
  }'::jsonb,

  -- Team Section
  team JSONB DEFAULT '{
    "title": "Our Team",
    "subtitle": "",
    "members": []
  }'::jsonb,

  -- Contact Section
  contact JSONB DEFAULT '{
    "title": "Get in Touch",
    "subtitle": "",
    "email": "",
    "phone": "",
    "address": "",
    "show_map": false
  }'::jsonb,

  -- Process/How It Works Section
  process JSONB DEFAULT '{
    "title": "How It Works",
    "subtitle": "",
    "steps": []
  }'::jsonb,

  -- Features Section
  features JSONB DEFAULT '{
    "title": "Features",
    "subtitle": "",
    "items": []
  }'::jsonb,

  -- Stats Section
  stats JSONB DEFAULT '{
    "items": []
  }'::jsonb,

  -- Pricing Section (can be synced from services or custom)
  pricing JSONB DEFAULT '{
    "title": "Pricing",
    "subtitle": "",
    "plans": []
  }'::jsonb,

  -- Gallery Section
  gallery JSONB DEFAULT '{
    "title": "Gallery",
    "images": []
  }'::jsonb,

  -- CTA Section
  cta JSONB DEFAULT '{
    "title": "",
    "description": "",
    "button_text": "Book Now",
    "button_url": "/booking"
  }'::jsonb,

  -- Newsletter Section
  newsletter JSONB DEFAULT '{
    "title": "Stay Updated",
    "subtitle": "",
    "placeholder": "Enter your email"
  }'::jsonb,

  -- Logo Cloud Section (partner/client logos)
  logo_cloud JSONB DEFAULT '{
    "title": "Trusted By",
    "logos": []
  }'::jsonb,

  -- Video Section
  video JSONB DEFAULT '{
    "title": "",
    "video_url": "",
    "thumbnail": ""
  }'::jsonb,

  -- Booking Widget Section
  booking_widget JSONB DEFAULT '{
    "title": "Book an Appointment",
    "subtitle": "",
    "service_ids": []
  }'::jsonb,

  -- Payment Button Section
  payment_button JSONB DEFAULT '{
    "title": "",
    "description": "",
    "amount": null,
    "currency": "USD"
  }'::jsonb,

  -- Intake Form Section
  intake_form JSONB DEFAULT '{
    "title": "Tell Us About Yourself",
    "subtitle": "",
    "fields": []
  }'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Row-Level Security
ALTER TABLE website_content ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own content
CREATE POLICY "Users can view own website content"
  ON website_content FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own website content"
  ON website_content FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own website content"
  ON website_content FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for performance
CREATE INDEX idx_website_content_user_id ON website_content(user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_website_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_website_content_timestamp
  BEFORE UPDATE ON website_content
  FOR EACH ROW
  EXECUTE FUNCTION update_website_content_updated_at();

-- Comments for documentation
COMMENT ON TABLE website_content IS 'Central storage for website section content - shared across all templates';
COMMENT ON COLUMN website_content.hero IS 'Hero section content (headline, CTA, background)';
COMMENT ON COLUMN website_content.services IS 'Services list with visibility flags - synced from Scheduling';
COMMENT ON COLUMN website_content.testimonials IS 'Client testimonials with optional images';
COMMENT ON COLUMN website_content.faq IS 'FAQ items (question/answer pairs)';
