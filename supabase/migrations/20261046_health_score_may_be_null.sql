-- The weekly health summary stops failing to save for a quiet business.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS BROKEN
--
-- `20260923_health_measures.sql` replaced the insight-penalty health score with
-- six measured rates, and repurposed `health_score` to carry `movingUp`. Its own
-- column comment, added by that migration, states the new contract:
--
--     "Now holds `movingUp`: the share of comparable measures that improved,
--      or NULL when fewer than two categories can be compared."
--
-- `healthScore()` in lib/business-os/insight/health/businessHealth.ts implements
-- exactly that: `if (comparable.length < 2) return null`.
--
-- But the column was declared `NOT NULL` by 20260805_add_correlated_insights.sql
-- and that migration never relaxed it. So the documented NULL case could not be
-- stored:
--
--     null value in column "health_score" of relation
--     "business_health_summaries" violates not-null constraint
--
-- WHO IT HIT, AND WHY NOBODY SAW IT
--
-- Every business with fewer than TWO comparable categories — which is every
-- business in its first measured period, and every business too small to clear
-- `MIN_SAMPLE` on two measures at once. For them the nightly `insight-detect`
-- run computed the rates, paid for the narrative LLM call, and then threw the
-- whole row away on insert. The failure is logged and swallowed, so the cron
-- reported success and the reports page showed six empty rates for a business
-- whose data was fine.
--
-- Found on 2026-10-08 from an account with 3 active insights, 25 invoices and
-- zero stored summaries.
--
-- WHY DROPPING THE CONSTRAINT IS THE WHOLE FIX
--
-- The CHECK stays and still holds: in SQL a CHECK passes on NULL, so
-- `health_score >= 0 AND health_score <= 100` continues to reject out-of-range
-- numbers while permitting the absent one. Readers already treat the column as
-- nullable — `BusinessHealthSummaryData.health_score` is `number | null` — so
-- nothing downstream needs changing.
--
-- NULL here means "fewer than two measures could be compared", which is a real
-- answer about a new or quiet business and must never be stored as 0: on this
-- scale 0 is the worst possible month, not an absent one.
-- ---------------------------------------------------------------------------

ALTER TABLE business_health_summaries
  ALTER COLUMN health_score DROP NOT NULL;

COMMENT ON COLUMN business_health_summaries.health_score IS
  'DEPRECATED as a health grade. Was 100 minus severity penalties over insight COUNTS, so it moved when the detector catalogue changed rather than when the business did. Now holds `movingUp`: the share of comparable measures that improved, or NULL when fewer than two categories can be compared — NULL is a real answer and is never 0, which on this scale is the worst possible month. Read health_measures for anything meaningful.';
