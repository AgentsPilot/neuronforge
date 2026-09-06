-- The central content store should hold what a person wrote, and nothing else.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- `website_content` has one JSONB column per section, and each was created with
-- an English placeholder default — contact "Get in Touch", services "Services",
-- faq "Frequently Asked Questions", cta "Book Now", hero cta_text "Get Started".
--
-- Those defaults were never meant to be content. But the block merge treats any
-- NON-EMPTY central value as authoritative over the block's own — that is the
-- point of the store, so a template swap cannot wipe what a business typed — and
-- a column default is indistinguishable from a typed value once it is in the
-- row. The row itself was materialised by a plain READ: the editor and, worse,
-- the public page view both called `getOrCreate`.
--
-- So a Hebrew business whose homepage had been generated in Hebrew turned
-- English the first time anyone looked at it, including an anonymous visitor,
-- and the generated text stayed in `website_blocks` where nobody could see it.
--
-- Two changes, and deliberately not a third:
--
--   * new rows carry '{}' per section, so there is nothing to outrank a block;
--   * existing sections that STILL BYTE-MATCH their default are reset to '{}'.
--
-- What is NOT done: nothing is deleted, no row is blanked wholesale, and no
-- section that differs from its default by a single character is touched. A
-- business that edited only its hero keeps that hero and loses six untouched
-- skeletons. The merge direction is left alone — central still wins — because
-- the editor writes authored text to THIS table and only layout hints to the
-- block, so making blocks win would erase every edit ever made.
--
-- The defaults are read out of the catalogue rather than transcribed here. A
-- hand-copied JSON literal that differs by one space silently matches nothing,
-- and the failure would look exactly like success.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  section_columns CONSTANT text[] := ARRAY[
    'hero', 'about', 'services', 'testimonials', 'faq', 'team', 'contact',
    'process', 'features', 'stats', 'pricing', 'gallery', 'cta', 'newsletter',
    'logo_cloud', 'video', 'booking_widget', 'payment_button', 'intake_form'
  ];
  section_column text;
  current_default text;
  rows_reset bigint;
  rows_total bigint := 0;
BEGIN
  FOREACH section_column IN ARRAY section_columns LOOP
    SELECT column_default
      INTO current_default
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'website_content'
       AND column_name = section_column;

    -- Already '{}', or the column is gone: nothing to reset, nothing to alter.
    IF current_default IS NULL OR current_default LIKE '''{}''%' THEN
      CONTINUE;
    END IF;

    -- `current_default` is the default EXPRESSION as Postgres stores it, e.g.
    -- '{"title": "Services", ...}'::jsonb — so it can be compared directly, and
    -- jsonb equality ignores key order and whitespace.
    EXECUTE format(
      'UPDATE website_content SET %I = ''{}''::jsonb WHERE %I = %s',
      section_column, section_column, current_default
    );
    GET DIAGNOSTICS rows_reset = ROW_COUNT;
    rows_total := rows_total + rows_reset;

    IF rows_reset > 0 THEN
      RAISE NOTICE 'website_content.%: % untouched section(s) reset to {}', section_column, rows_reset;
    END IF;

    EXECUTE format(
      'ALTER TABLE website_content ALTER COLUMN %I SET DEFAULT ''{}''::jsonb',
      section_column
    );
  END LOOP;

  RAISE NOTICE 'website_content: % section(s) reset in total', rows_total;
END $$;

COMMENT ON TABLE website_content IS
  'Per-user website copy, one JSONB column per section. Holds only what the business actually authored: a section it has never edited is {}. Block content is the base and this is merged over it, so a value here always wins — which is why a placeholder must never be stored. Created only by a save, never by a read.';
