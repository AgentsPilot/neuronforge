-- The looks a business can wear, as rows.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A TABLE AND NOT JUST THE FOUR IN CODE
--
-- An archetype splits cleanly in two, and only one half is code:
--
--   tokens   colours, fonts, type scale, radii, spacing — about thirty values,
--            every one of them read off a template's compiled stylesheet
--   layouts  the NAMES of layout variants the block components switch on
--
-- The names are a closed vocabulary owned by the blocks. So long as a new
-- design picks from it — and the four that ship do — adding a design is an
-- INSERT and nothing else: no deploy, no block changes, no release. That is the
-- whole point of the exercise, and it is why the tokens live in a jsonb column
-- rather than in four TypeScript objects nobody outside the repo can add to.
--
-- The four that ship still live in `lib/website-builder/archetypes.ts` and seed
-- this table. Code is the source of truth for those; the table is the extension
-- point. A row whose `layouts` names a variant the blocks do not have will
-- render in the default layout rather than fail — the vocabulary is validated
-- by a test at build time, not by a constraint at write time, because a
-- constraint here would have to be updated in lockstep with the components.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS website_archetypes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- Where the design came from. MIT asks one thing in return for commercial use
  -- and modification: that the notice travels with the work. This is that
  -- notice, and it is reproduced in LICENSES.md.
  source      TEXT,
  tokens      JSONB NOT NULL,
  layouts     JSONB NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE website_archetypes IS
  'Website looks. Tokens are free-form; layouts must name variants the block components implement.';
COMMENT ON COLUMN website_archetypes.layouts IS
  'e.g. {"hero":"split","services":"cards","cta":"panel","gallery":"grid","pricing":"panels"}. A name the blocks do not implement falls back to their default layout.';

-- The gallery lists these in order; nothing else reads the table often enough
-- to need an index of its own.
CREATE INDEX IF NOT EXISTS idx_website_archetypes_active
  ON website_archetypes (position)
  WHERE is_active = true;

-- Readable by anyone: these are the choices shown in the website wizard, and
-- they are the same for every business. Writes are service-role only — there is
-- no per-user ownership here, which is exactly why RLS has to say so out loud.
ALTER TABLE website_archetypes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS website_archetypes_read ON website_archetypes;
CREATE POLICY website_archetypes_read
  ON website_archetypes FOR SELECT
  TO authenticated, anon
  USING (is_active = true);

-- ─────────────────────────────────────────────────────────────────────────────
-- THE FOUR THAT SHIP
--
-- Identical to `lib/website-builder/archetypes.ts`, which stays the source of
-- truth for these four: `ArchetypeRepository.find` resolves from code first, so
-- a row that shadows one of these ids cannot change what a published page looks
-- like by accident. The rows exist so the wizard's gallery reads from one place
-- whether a design shipped with the repo or was added afterwards.
--
-- ON CONFLICT DO NOTHING, not DO UPDATE: re-running the migration must not
-- silently revert an edit somebody made to a row on purpose.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO website_archetypes (id, name, source, tokens, layouts, position) VALUES
(
  'stone', 'Stone', 'm6v3l9/astro-theme-stone · MIT',
  '{
    "colors": {
      "primary": "#0C0A09", "secondary": "#57534E", "accent": "#78716C",
      "background": "#FFFFFF", "surface": "#F5F5F4",
      "text": "#0C0A09", "textSecondary": "#57534E"
    },
    "fonts": { "heading": "Inter", "body": "Inter", "hebrewHeading": "Assistant", "hebrewBody": "Assistant" },
    "scale": {
      "h1": "clamp(32px, 5vw, 64px)", "h2": "clamp(26px, 3.2vw, 42px)",
      "h3": "21px", "body": "16.5px", "small": "13px"
    },
    "borderRadius": "24px", "spacing": "spacious"
  }'::jsonb,
  '{"hero":"stacked","services":"rows","cta":"panel","gallery":"grid","pricing":"panels"}'::jsonb,
  0
),
(
  'bloom', 'Bloom', 'ttomczak3/Milky-Way · MIT',
  '{
    "colors": {
      "primary": "#78C2AD", "secondary": "#FDEBF3", "accent": "#584966",
      "background": "#FFF9FB", "surface": "#FFFFFF",
      "text": "#3E3350", "textSecondary": "#7A6C88"
    },
    "fonts": { "heading": "Josefin Sans", "body": "Assistant", "hebrewHeading": "Varela Round", "hebrewBody": "Assistant" },
    "scale": {
      "h1": "clamp(29px, 4.4vw, 50px)", "h2": "clamp(24px, 2.8vw, 34px)",
      "h3": "19px", "body": "16.5px", "small": "13px"
    },
    "borderRadius": "26px", "spacing": "normal"
  }'::jsonb,
  '{"hero":"split","services":"cards","cta":"panel","gallery":"grid","pricing":"panels"}'::jsonb,
  1
),
(
  'lumen', 'Lumen', 'Gothsec/dark-minimal · MIT',
  '{
    "colors": {
      "primary": "#A9FF5B", "secondary": "#A476FF", "accent": "#A476FF",
      "background": "#141414", "surface": "#1C1C1C",
      "text": "#FFFFFF", "textSecondary": "#9E9E9E"
    },
    "fonts": { "heading": "Montserrat", "body": "Montserrat", "hebrewHeading": "Rubik", "hebrewBody": "Rubik" },
    "scale": {
      "h1": "clamp(32px, 5vw, 58px)", "h2": "clamp(26px, 3.4vw, 40px)",
      "h3": "20px", "body": "16.5px", "small": "13px"
    },
    "borderRadius": "30px", "spacing": "normal"
  }'::jsonb,
  '{"hero":"stacked","services":"cards","cta":"flat","gallery":"mosaic","pricing":"panels"}'::jsonb,
  2
),
(
  'aster', 'Aster', 'matt765/Tailcast · MIT',
  '{
    "colors": {
      "primary": "#6366F1", "secondary": "#C8C9F8", "accent": "#A1A3F7",
      "background": "#1A1B21", "surface": "#23242C",
      "text": "#FFFFFF", "textSecondary": "#9B9CAE"
    },
    "fonts": { "heading": "Inter", "body": "Inter", "hebrewHeading": "Heebo", "hebrewBody": "Heebo" },
    "scale": {
      "h1": "clamp(31px, 5vw, 56px)", "h2": "clamp(26px, 3.2vw, 38px)",
      "h3": "19px", "body": "16.5px", "small": "12.5px"
    },
    "borderRadius": "14px", "spacing": "normal"
  }'::jsonb,
  '{"hero":"centered","services":"cards","cta":"panel","gallery":"grid","pricing":"panels"}'::jsonb,
  3
)
ON CONFLICT (id) DO NOTHING;
