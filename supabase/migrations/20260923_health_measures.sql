-- The weekly summary starts describing the business instead of our catalogue.
--
-- ---------------------------------------------------------------------------
-- WHAT THE SCORES USED TO BE
--
-- `health_score` and the seven `*_score` columns were computed from INSIGHT
-- COUNTS, not from the business:
--
--     scores[category] = 80                    when no insights in it
--     scores[category] = 100 - Σ penalty       otherwise
--
-- So an account with no data scored 81 and was told "your business is doing
-- well"; shipping a detector lowered every affected business's score and
-- deleting one raised it. The weekly narrative then described the score back to
-- the owner — "your acquisition score is strong at 85" — which made the story
-- about our detector catalogue in the language of their trade.
--
-- WHAT REPLACES THEM
--
-- Six measured rates, each read from a module table and compared with the same
-- business's previous 28 days. No industry benchmark is involved, because the
-- platform has none: a 31% repeat rate is excellent for one trade and poor for
-- another, and inventing a curve would repeat the fabricated-figure class this
-- work exists to remove.
--
-- `health_measures` carries the whole shape — per category: the rate, the
-- previous rate, the change in points, the sample size, and why it is null when
-- it is. NULL means "not enough data to say", which is a real answer and must
-- never be rendered as zero.
--
-- WHY A JSONB COLUMN RATHER THAN MORE NUMERIC ONES
--
-- Because a rate needs its sample and its reason beside it to be readable at
-- all. `acquisition_score = 12` is indistinguishable from `acquisition_score =
-- 12` computed from three visitors, and the second one should not be shown.
-- Splitting that across three columns per category would be twenty-one columns
-- describing one object.
--
-- The legacy columns are LEFT IN PLACE and simply stop being written. Dropping
-- them would break any reader still selecting them — PostgREST rejects the
-- whole select for one unknown name — and this repository has been caught by
-- that before.
-- ---------------------------------------------------------------------------

ALTER TABLE business_health_summaries
  ADD COLUMN IF NOT EXISTS health_measures JSONB;

COMMENT ON COLUMN business_health_summaries.health_measures IS
  'Per-category measured rates against the same business''s previous period: {categories:[{category,rate,previousRate,change,sample,measureKey,unavailable}],movingUp,improved,declined,steady,measured,unavailable}. A null rate means not enough data to say and must never render as zero. Computed by lib/business-os/insight/health/resolveBusinessHealth.ts.';

COMMENT ON COLUMN business_health_summaries.health_score IS
  'DEPRECATED as a health grade. Was 100 minus severity penalties over insight COUNTS, so it moved when the detector catalogue changed rather than when the business did. Now holds `movingUp`: the share of comparable measures that improved, or NULL when fewer than two categories can be compared. Read health_measures for anything meaningful.';
