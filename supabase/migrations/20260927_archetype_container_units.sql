-- The type scale must measure the PAGE, not the browser window.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- Every archetype's h1/h2 was sized in `vw`, which is 1% of the BROWSER WINDOW.
-- That is the wrong question in the one place a site is looked at most: the
-- editor previews a phone by putting the page in a 375px-wide div in its own
-- document, so on a wide screen `clamp(36px, 5.4vw, 70px)` resolved to 70px
-- inside a 375px frame and the headline broke to one word a line. The
-- breakpoints had the same defect and were media queries, which also read the
-- window — a phone preview was rendering the desktop design, badly.
--
-- `cqi` is 1% of the containing element's inline size. The public surface now
-- declares itself a container, so `cqi` and `@container` both measure the
-- page's own width — correct in the editor's device frames AND unchanged in
-- production, where the surface IS the viewport width.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A NEW MIGRATION RATHER THAN AN EDIT
--
-- `20260922` is applied. Correcting an applied file changes nothing in a
-- database that has already run it, and silently diverges the file from what
-- the rows actually hold. A later migration is the one safe way to fix a seed,
-- and `archetypeSeed.test.ts` reads the migrations in order precisely so the
-- comparison is against the state the database ends in.
--
-- `jsonb_set` rather than rewriting `tokens`: the blob also carries colours,
-- fonts, radius and spacing, and replacing all of it here would silently revert
-- any deliberate edit somebody made to a row.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h1}', '"clamp(32px, 5cqi, 64px)"'::jsonb)
  WHERE id = 'stone';
UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h2}', '"clamp(26px, 3.2cqi, 42px)"'::jsonb)
  WHERE id = 'stone';

UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h1}', '"clamp(32px, 5cqi, 58px)"'::jsonb)
  WHERE id = 'lumen';
UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h2}', '"clamp(26px, 3.4cqi, 40px)"'::jsonb)
  WHERE id = 'lumen';

UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h1}', '"clamp(29px, 4.4cqi, 50px)"'::jsonb)
  WHERE id = 'bloom';
UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h2}', '"clamp(24px, 2.8cqi, 34px)"'::jsonb)
  WHERE id = 'bloom';

UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h1}', '"clamp(31px, 5cqi, 56px)"'::jsonb)
  WHERE id = 'aster';
UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h2}', '"clamp(26px, 3.2cqi, 38px)"'::jsonb)
  WHERE id = 'aster';

UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h1}', '"clamp(34px, 4.6cqi, 62px)"'::jsonb)
  WHERE id = 'warm';
UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h2}', '"clamp(26px, 3.1cqi, 40px)"'::jsonb)
  WHERE id = 'warm';

UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h1}', '"clamp(36px, 5.4cqi, 70px)"'::jsonb)
  WHERE id = 'bold';
UPDATE website_archetypes SET tokens = jsonb_set(tokens, '{scale,h2}', '"clamp(28px, 3.6cqi, 48px)"'::jsonb)
  WHERE id = 'bold';
