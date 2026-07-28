-- Website Builder Tables
-- Purpose: Store website pages, blocks, and templates for the no-code website builder
-- Last Updated: 2026-07-21

-- =============================================
-- WEBSITE PAGES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS website_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,

  -- Page metadata
  page_type TEXT NOT NULL, -- 'homepage', 'landing', 'about', 'services', 'blog_post'
  slug TEXT NOT NULL, -- '/adhd-course', '/about', etc.
  title TEXT NOT NULL,
  meta_description TEXT,
  seo_keywords TEXT[] DEFAULT '{}',

  -- Publishing
  published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,

  -- Template and theme
  template_id UUID REFERENCES website_templates(id),
  theme JSONB, -- { colors, fonts, spacing }

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  UNIQUE(user_id, slug)
);

-- =============================================
-- WEBSITE BLOCKS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS website_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID REFERENCES website_pages(id) ON DELETE CASCADE NOT NULL,

  -- Block type and position
  block_type TEXT NOT NULL, -- 'headline', 'text', 'image', 'video', 'form', 'button', 'payment', 'booking'
  position INT NOT NULL, -- Order on page (0, 1, 2, ...)

  -- Content (block-specific data)
  content JSONB NOT NULL,

  -- Styling
  styles JSONB, -- { alignment, padding, backgroundColor, etc. }

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  UNIQUE(page_id, position)
);

-- =============================================
-- WEBSITE TEMPLATES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS website_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Template metadata
  name TEXT NOT NULL,
  vertical TEXT NOT NULL, -- 'therapist', 'coach', 'consultant', etc.
  template_type TEXT NOT NULL, -- 'homepage', 'landing', 'service'

  -- Preview
  thumbnail_url TEXT,
  description TEXT,

  -- Template blueprint
  blocks_blueprint JSONB NOT NULL, -- Pre-configured blocks structure
  theme_preset JSONB NOT NULL, -- Default colors, fonts, spacing

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- ROW-LEVEL SECURITY
-- =============================================
ALTER TABLE website_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_templates ENABLE ROW LEVEL SECURITY;

-- Policies for website_pages
CREATE POLICY "Users can view own pages"
  ON website_pages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pages"
  ON website_pages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pages"
  ON website_pages FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own pages"
  ON website_pages FOR DELETE
  USING (auth.uid() = user_id);

-- Policies for website_blocks
CREATE POLICY "Users can view own blocks"
  ON website_blocks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM website_pages
      WHERE website_pages.id = website_blocks.page_id
      AND website_pages.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own blocks"
  ON website_blocks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM website_pages
      WHERE website_pages.id = website_blocks.page_id
      AND website_pages.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own blocks"
  ON website_blocks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM website_pages
      WHERE website_pages.id = website_blocks.page_id
      AND website_pages.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own blocks"
  ON website_blocks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM website_pages
      WHERE website_pages.id = website_blocks.page_id
      AND website_pages.user_id = auth.uid()
    )
  );

-- Policies for website_templates (read-only for users)
CREATE POLICY "Anyone can view templates"
  ON website_templates FOR SELECT
  USING (true);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_website_pages_user_id ON website_pages(user_id);
CREATE INDEX idx_website_pages_slug ON website_pages(user_id, slug);
CREATE INDEX idx_website_pages_published ON website_pages(published);

CREATE INDEX idx_website_blocks_page_id ON website_blocks(page_id);
CREATE INDEX idx_website_blocks_position ON website_blocks(page_id, position);

CREATE INDEX idx_website_templates_vertical ON website_templates(vertical);
CREATE INDEX idx_website_templates_type ON website_templates(template_type);

-- =============================================
-- TRIGGERS
-- =============================================
CREATE OR REPLACE FUNCTION update_website_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_website_pages_timestamp
  BEFORE UPDATE ON website_pages
  FOR EACH ROW
  EXECUTE FUNCTION update_website_pages_updated_at();

-- =============================================
-- COMMENTS
-- =============================================
COMMENT ON TABLE website_pages IS 'User-created website pages (homepage, landing pages, etc.)';
COMMENT ON TABLE website_blocks IS 'Block-based content for website pages (headline, text, image, form, etc.)';
COMMENT ON TABLE website_templates IS 'Pre-built website templates by vertical and type';

COMMENT ON COLUMN website_pages.slug IS 'URL path for the page (e.g., /adhd-course)';
COMMENT ON COLUMN website_pages.theme IS 'Page-specific color scheme, fonts, and styling overrides';
COMMENT ON COLUMN website_blocks.content IS 'Block-specific data (text, image URL, form fields, etc.)';
COMMENT ON COLUMN website_blocks.position IS 'Display order on page (0, 1, 2, ...)';
COMMENT ON COLUMN website_templates.blocks_blueprint IS 'Pre-configured block structure for this template';
