-- Compositions, and the two archetypes that exist to carry them.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- `website_archetypes` stored tokens and layout names. Both describe how a
-- section is COLOURED and which variant it picks; neither describes how it is
-- BUILT. So every archetype rendered the same card-and-shadow markup, and an
-- owner switching template saw a recolour — which is the whole complaint the
-- archetypes were introduced to answer.
--
-- A composition is the missing half: whether services are ruled rows or cards,
-- whether the closing block inverts to solid ink, whether the small print is set
-- in mono. It is the expensive half to design and the cheap half to share, so it
-- is a column rather than a per-archetype asset — three compositions dress six
-- archetypes. Bloom wears Warm's bones in blush; Lumen and Aster wear Bold's in
-- lime and indigo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE COLUMN IS NULLABLE WITH A DEFAULT RATHER THAN NOT NULL
--
-- Every row that existed before this migration was rendered by blocks whose
-- markup is what the Stone composition now describes. Defaulting to 'stone'
-- means those rows keep rendering exactly as they did rather than merely
-- similarly, and a row added by a newer deploy than the one reading it degrades
-- to the old rendering instead of to an unstyled page.
--
-- No CHECK constraint, for the same reason `layouts` has none (see
-- 20260922_website_archetypes.sql): the valid set is defined by which
-- stylesheets `components/public/compositions.ts` implements, and a constraint
-- here would have to be updated in lockstep with a component. The resolver
-- falls back rather than failing.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE website_archetypes
  ADD COLUMN IF NOT EXISTS composition TEXT NOT NULL DEFAULT 'stone';

COMMENT ON COLUMN website_archetypes.composition IS
  'Which set of section bones this look is built on: stone | warm | bold. Implemented by components/public/compositions.ts; an unknown value falls back to stone rather than rendering unstyled.';

-- The existing four, mapped onto the bones they were already closest to.
-- Stone keeps its own; Bloom is soft and editorial; Lumen and Aster are both
-- dark with a single bright accent, which is what Bold was drawn for.
UPDATE website_archetypes SET composition = 'warm' WHERE id = 'bloom';
UPDATE website_archetypes SET composition = 'bold' WHERE id IN ('lumen', 'aster');

-- ─────────────────────────────────────────────────────────────────────────────
-- Aster's heading face, reconciled.
--
-- `lib/website-builder/archetypes.ts` says Fraunces; this table said Inter.
-- `ArchetypeRepository.find` resolves code-first, so a PUBLISHED Aster page
-- rendered in Fraunces while the wizard gallery — which draws from
-- `listActive()`, and so from this table — drew the Aster card in Inter. The
-- owner picked one typeface and got another. Code is the source of truth for
-- what actually renders, so the row moves to match it.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE website_archetypes
SET tokens = jsonb_set(tokens, '{fonts,heading}', '"Fraunces"'::jsonb)
WHERE id = 'aster'
  AND tokens #>> '{fonts,heading}' = 'Inter';

-- ─────────────────────────────────────────────────────────────────────────────
-- The two new archetypes.
--
-- Unlike the original four these are not adapted from an MIT template: they were
-- drawn for this platform. `source` says so plainly rather than borrowing a
-- notice they have no right to, and nothing is added to LICENSES.md for them.
--
-- Positions 1 and 3 interleave them with the originals so the gallery alternates
-- light and dark rather than showing three pale cards and then three dark ones.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO website_archetypes (id, name, source, tokens, layouts, composition, position) VALUES
(
  'warm', 'Warm', 'AgentPilot original',
  '{
    "colors": {
      "primary": "#6D28D9", "secondary": "#5B5147", "accent": "#6D28D9",
      "background": "#FBF7F1", "surface": "#FFFFFF",
      "text": "#17130F", "textSecondary": "#5B5147"
    },
    "fonts": {
      "heading": "Frank Ruhl Libre", "body": "Assistant",
      "hebrewHeading": "Frank Ruhl Libre", "hebrewBody": "Assistant"
    },
    "scale": {
      "h1": "clamp(34px, 4.6vw, 62px)", "h2": "clamp(26px, 3.1vw, 40px)",
      "h3": "20px", "body": "16.5px", "small": "13px"
    },
    "borderRadius": "18px", "spacing": "spacious"
  }'::jsonb,
  '{"hero":"split","services":"rows","cta":"panel","gallery":"grid","pricing":"panels"}'::jsonb,
  'warm',
  1
),
(
  'bold', 'Bold', 'AgentPilot original',
  '{
    "colors": {
      "primary": "#FC5F2B", "secondary": "#A1A1AA", "accent": "#FC5F2B",
      "background": "#141416", "surface": "#1D1D20",
      "text": "#F7F5F0", "textSecondary": "#A1A1AA"
    },
    "fonts": {
      "heading": "Assistant", "body": "Assistant",
      "hebrewHeading": "Assistant", "hebrewBody": "Assistant"
    },
    "scale": {
      "h1": "clamp(36px, 5.4vw, 70px)", "h2": "clamp(28px, 3.6vw, 48px)",
      "h3": "19px", "body": "16.5px", "small": "12.5px"
    },
    "borderRadius": "14px", "spacing": "normal"
  }'::jsonb,
  '{"hero":"split","services":"cards","cta":"panel","gallery":"mosaic","pricing":"panels"}'::jsonb,
  'bold',
  3
)
ON CONFLICT (id) DO NOTHING;

-- Re-space the originals around the two insertions. Written as explicit values
-- rather than an arithmetic bump so re-running it is idempotent.
UPDATE website_archetypes SET position = 0 WHERE id = 'stone';
UPDATE website_archetypes SET position = 2 WHERE id = 'bloom';
UPDATE website_archetypes SET position = 4 WHERE id = 'lumen';
UPDATE website_archetypes SET position = 5 WHERE id = 'aster';
