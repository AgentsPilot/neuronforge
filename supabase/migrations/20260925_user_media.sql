-- The pictures a business has, wherever they came from.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- Generated sites carried no images at all. Every content field expected one —
-- `hero.background_image`, `about.image`, a gallery's `images[]` — and the
-- generator set none of them, so every business launched with a mesh gradient
-- where its photograph should be. Worse, `HeroBlock` switches its split layout
-- off when there is no image, so the two archetypes whose design IS a split hero
-- silently rendered a stacked one on every site ever generated.
--
-- Images are now chosen when the copy is written. This table is what makes them
-- the OWNER'S rather than a URL that happened to be pasted into a block: it
-- records every picture a business has, so the editor can offer them all back
-- and a photo used on the landing page can be reused on the website without
-- being found again.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A TABLE WHEN THE BUCKET ALREADY EXISTS
--
-- `website-images` already stores uploads under a per-user folder with RLS, and
-- listing a storage prefix would technically enumerate them. But a storage
-- object knows only its path and size — not which section it was chosen for,
-- what it depicts, what aspect it was cropped to, or where it came from. Without
-- those the editor cannot say "your images" in any useful order, a rebuild
-- cannot tell it already has a hero, and nothing can answer whether a picture is
-- the owner's own photograph or one we found for them.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY `source` MATTERS AND IS NOT COSMETIC
--
-- A photograph from a stock library, a picture generated for this business, and
-- one the owner took are three different things legally and editorially. An
-- owner replacing a stock hero with their own photograph is the single most
-- valuable edit they can make, and the editor can only encourage it if it knows
-- which is which.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Where it lives in the `website-images` bucket, and the URL a page renders.
  -- The path is kept alongside the URL so the object can be removed when the
  -- row is: a public URL cannot be turned back into a path reliably.
  storage_path  TEXT NOT NULL,
  public_url    TEXT NOT NULL,

  -- 'stock'     — found in a stock library and copied here, so it cannot vanish
  -- 'generated' — made for this business on request
  -- 'upload'    — the owner's own photograph
  source        TEXT NOT NULL DEFAULT 'stock',
  -- The stock library's own id, or the prompt an image was generated from.
  -- Also what makes a rebuild reuse rather than fetch the same picture twice.
  source_ref    TEXT,

  -- What it was chosen FOR. A hero crop is not a team portrait, and an editor
  -- offering every picture for every slot offers mostly wrong answers.
  section       TEXT,
  aspect        TEXT,
  -- The query or subject, so the owner recognises it in a list of thumbnails.
  description   TEXT,

  width         INTEGER,
  height        INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_media IS
  'Every picture a business has: stock we found, images generated for it, and its own uploads. Backs the "your images" picker and lets a rebuild reuse what it already chose.';
COMMENT ON COLUMN user_media.source_ref IS
  'The stock library id or the generation prompt. Used with user_id to avoid fetching or paying for the same picture twice.';
COMMENT ON COLUMN user_media.aspect IS
  'The crop it was chosen at: wide | portrait | square. The archetypes want different ones — a 4:5 hero and a wide band are not interchangeable.';

-- The picker lists a business's newest first; nothing else reads this table
-- across users.
CREATE INDEX IF NOT EXISTS idx_user_media_user_created
  ON user_media (user_id, created_at DESC);

-- Reuse lookup: "do we already have this picture for this business?"
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_media_user_source_ref
  ON user_media (user_id, source_ref)
  WHERE source_ref IS NOT NULL;

-- Offering the right pictures for a slot.
CREATE INDEX IF NOT EXISTS idx_user_media_user_section
  ON user_media (user_id, section)
  WHERE section IS NOT NULL;

ALTER TABLE user_media ENABLE ROW LEVEL SECURITY;

-- A business sees only its own pictures. Writes go through the server on the
-- user's behalf; there is no path by which one business reads another's.
DROP POLICY IF EXISTS user_media_select_own ON user_media;
CREATE POLICY user_media_select_own ON user_media
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_media_insert_own ON user_media;
CREATE POLICY user_media_insert_own ON user_media
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_media_delete_own ON user_media;
CREATE POLICY user_media_delete_own ON user_media
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
