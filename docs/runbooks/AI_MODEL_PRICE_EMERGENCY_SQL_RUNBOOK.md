# AI Model Price — Emergency SQL Runbook

> **Last Updated**: 2026-10-16

## Overview

Since AI model price review slice 6, nothing in the admin app can change a live AI model price: Sync and the per-row Edit were removed (MP-FR-11, user decision Q9). Until slice 8 ships the per-model **Apply**, the only way to change a price that customers are charged from is this runbook, run by hand in the Supabase SQL editor. The user decided this on 2026-10-16 (BQ-1 (a)) in [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md).

**Use it only for an emergency:** a provider raised a price and a Business OS model is undercharging (a red row on `/admin/system-config`), or a Business OS area must move to a model that has no price yet. Anything that can wait, waits for Apply.

**Every run needs the platform owner's explicit approval, in writing, for that exact change, before paste 2.** No approval, no run.

---

## Table of Contents

1. [Rules](#1-rules)
2. [Paste 1a: read-only row listing](#2-paste-1a-read-only-row-listing)
3. [Paste 1b: read-only count, ids and fingerprints](#3-paste-1b-read-only-count-ids-and-fingerprints)
4. [Paste 2: the change](#4-paste-2-the-change)
5. [Paste 3: read-only post-check](#5-paste-3-read-only-post-check)
6. [After the change](#6-after-the-change)
7. [Never use these](#7-never-use-these)
8. [Run log](#8-run-log)
9. [Change History](#change-history)

---

## 1. Rules

| Rule | Why |
|---|---|
| **Each paste is exactly one statement** (paste 2's `BEGIN; DO …; COMMIT;` is one unit). Run each paste on its own | The Supabase SQL editor shows only the last statement's result |
| The old row is **retired** (`retired_date` set), never deleted, never overwritten | Q9: no hard delete; the price history (slice 9) is built from the kept rows |
| Prices are typed **per 1M tokens**, exactly as the provider's page shows them, and converted in SQL | R-1: no float, no rounding, no per-token typing mistakes |
| A new price more than 10 times, or less than a tenth of, the old one is refused unless you deliberately confirm it | A slip such as `150` for `0.15` fails closed |
| The source must be the provider's own pricing page; write its URL and the date you checked it in the run log | MP-FR-3 |
| One model per run. Run the pastes in order: 1a, 1b, 2, then paste 3 (1a and 1b again) | Paste 2 checks what 1a and 1b showed |
| Do not change the SQL beyond the placeholders named in the text | The checks in paste 2 are what make it safe. The pastes hold no comments on purpose: every hint is in the text around them |
| Effect: each server caches prices for up to 1 hour | A change is in effect on all servers within 1 hour |
| This writes **no audit row**. The run log below is the record | The app's audit only covers app writes |

---

## 2. Paste 1a: read-only row listing

Replace `PROVIDER` and `MODEL` (one place each). It changes nothing. It lists every row of the model, active and retired, newest first.

**File:** paste in the Supabase SQL editor

```sql
SELECT id, provider, model_name,
       input_cost_per_token::text AS input_per_token,
       output_cost_per_token::text AS output_per_token,
       cached_input_cost_per_token::text AS cached_input_per_token,
       effective_date, retired_date, created_at
FROM public.ai_model_pricing
WHERE provider = 'PROVIDER' AND model_name = 'MODEL'
ORDER BY effective_date DESC, created_at DESC;
```

Write the active row's prices (`retired_date` empty) in the run log as the old price.

---

## 3. Paste 1b: read-only count, ids and fingerprints

Replace `PROVIDER` and `MODEL` (**three places each**: `active_rows_for_model`, `active_row_ids` and `fingerprint_other_models`). It changes nothing.

**File:** paste in the Supabase SQL editor

```sql
WITH ranked AS (
  SELECT pricing.provider, pricing.model_name, pricing.input_cost_per_token, pricing.output_cost_per_token,
         row_number() OVER (PARTITION BY pricing.provider, pricing.model_name
                            ORDER BY pricing.effective_date DESC, pricing.created_at DESC) AS position
  FROM public.ai_model_pricing AS pricing
  WHERE pricing.retired_date IS NULL
    AND pricing.effective_date <= (now() AT TIME ZONE 'utc')::date
)
SELECT
  (SELECT count(*) FROM public.ai_model_pricing
    WHERE provider = 'PROVIDER' AND model_name = 'MODEL' AND retired_date IS NULL) AS active_rows_for_model,
  (SELECT string_agg(id::text, ', ') FROM public.ai_model_pricing
    WHERE provider = 'PROVIDER' AND model_name = 'MODEL' AND retired_date IS NULL) AS active_row_ids,
  md5(string_agg(concat_ws(' ', provider, model_name,
                           round(input_cost_per_token::numeric, 18)::text,
                           round(output_cost_per_token::numeric, 18)::text),
                 ' ' ORDER BY provider, model_name)) AS fingerprint_all,
  md5(string_agg(concat_ws(' ', provider, model_name,
                           round(input_cost_per_token::numeric, 18)::text,
                           round(output_cost_per_token::numeric, 18)::text),
                 ' ' ORDER BY provider, model_name)
      FILTER (WHERE NOT (provider = 'PROVIDER' AND model_name = 'MODEL'))) AS fingerprint_other_models
FROM ranked
WHERE position = 1;
```

**Read the result and write it in the run log:**

- `active_rows_for_model` must be **1** (a price change) or **0** (a first price for a new model). Any other number: **stop**, and ask SA. A row dated later than today counts too.
- `active_row_ids` is the id paste 2 needs (empty for a first price).
- Copy `fingerprint_all` and `fingerprint_other_models`. This fingerprint is the slice 2 formula over **every** model (no model is left out), so it is compared only between this paste and paste 3 of the same run, never with a value logged by an earlier slice or run.

---

## 4. Paste 2: the change

Only after the owner's written approval. Fill in the six placeholders in the `DECLARE` section, and nothing else:

| Placeholder | Put in |
|---|---|
| `'PROVIDER'`, `'MODEL'` | The same provider and model as in 1a and 1b |
| `'OLD-ROW-ID'` | The id from `active_row_ids` in 1b. For a model with no price yet (count 0), replace the quoted text with `NULL`, without quotes |
| `0.00` after `v_input_per_1m` | The provider's input price per 1M tokens, in USD, as its page shows it |
| `0.00` after `v_output_per_1m` | The provider's output price per 1M tokens, in USD (`0` only for an input-only `text-embedding-*` model) |
| `'no'` after `v_confirm_large_change` | Leave it as `'no'`. Set it to `'yes'` **only** when the owner approved a change of more than 10 times or less than a tenth of the old price, and write that in the run log |

**File:** paste in the Supabase SQL editor

```sql
BEGIN;

DO $emergency_price$
DECLARE
  v_provider     text    := 'PROVIDER';
  v_model        text    := 'MODEL';
  v_old_id       uuid    := 'OLD-ROW-ID';
  v_input_per_1m numeric := 0.00;
  v_output_per_1m numeric := 0.00;
  v_confirm_large_change text := 'no';
  v_today        date    := (now() AT TIME ZONE 'utc')::date;
  v_new_input    numeric;
  v_new_output   numeric;
  v_old_input    numeric;
  v_old_output   numeric;
  v_active       integer;
  v_changed      integer;
BEGIN
  v_new_input := v_input_per_1m * 0.000001;
  v_new_output := v_output_per_1m * 0.000001;

  IF v_input_per_1m <= 0 THEN
    RAISE EXCEPTION 'refused: the input price must be above zero; nothing was changed';
  END IF;
  IF v_output_per_1m < 0
     OR (v_output_per_1m = 0 AND NOT (v_provider = 'openai' AND v_model LIKE 'text-embedding-%')) THEN
    RAISE EXCEPTION 'refused: the output price must be above zero (zero only for an input-only embedding model); nothing was changed';
  END IF;

  v_active := (SELECT count(*) FROM public.ai_model_pricing
               WHERE provider = v_provider AND model_name = v_model AND retired_date IS NULL);

  IF v_old_id IS NULL THEN
    IF v_active <> 0 THEN
      RAISE EXCEPTION 'refused: % active rows exist for this model; run paste 1b again; nothing was changed', v_active;
    END IF;
  ELSE
    IF v_active <> 1 THEN
      RAISE EXCEPTION 'refused: % active rows exist for this model, expected 1; nothing was changed', v_active;
    END IF;

    v_old_input := (SELECT input_cost_per_token FROM public.ai_model_pricing
                    WHERE id = v_old_id AND provider = v_provider AND model_name = v_model AND retired_date IS NULL);
    v_old_output := (SELECT output_cost_per_token FROM public.ai_model_pricing
                     WHERE id = v_old_id AND provider = v_provider AND model_name = v_model AND retired_date IS NULL);
    IF v_old_input IS NULL THEN
      RAISE EXCEPTION 'refused: the row id from paste 1b is not the active row of this model; nothing was changed';
    END IF;

    IF v_confirm_large_change <> 'yes' AND (
         v_new_input > v_old_input * 10 OR v_new_input < v_old_input * 0.1
         OR (v_old_output > 0 AND (v_new_output > v_old_output * 10 OR v_new_output < v_old_output * 0.1))
         OR (v_old_output = 0 AND v_new_output <> 0)
       ) THEN
      RAISE EXCEPTION 'refused: the new price is more than 10 times or less than a tenth of the old one; check for a typing slip, or confirm the large change; nothing was changed';
    END IF;

    UPDATE public.ai_model_pricing
    SET retired_date = v_today
    WHERE id = v_old_id AND provider = v_provider AND model_name = v_model AND retired_date IS NULL;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN
      RAISE EXCEPTION 'refused: the row id from paste 1b is not the active row of this model; nothing was changed';
    END IF;
  END IF;

  INSERT INTO public.ai_model_pricing
    (provider, model_name, input_cost_per_token, output_cost_per_token, cached_input_cost_per_token,
     effective_date, proposal_id, proposal_line_id)
  VALUES
    (v_provider, v_model, v_new_input, v_new_output, NULL,
     v_today, NULL, NULL);

  v_active := (SELECT count(*) FROM public.ai_model_pricing
               WHERE provider = v_provider AND model_name = v_model AND retired_date IS NULL);
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'refused: % active rows after the change, expected 1; nothing was changed', v_active;
  END IF;
END
$emergency_price$;

COMMIT;
```

**What it guarantees.**
- Any refusal raises an error, and the whole paste changes nothing.
- The per-token price is the per-1M price times `0.000001`, the same conversion the pending area uses (`20261066`), so it is stored exactly and with the provider's own digits (`0.15` gives `0.00000015`).
- The 10x check compares with the old row and is skipped for a first price (there is no old row). It refuses unless `v_confirm_large_change` is `'yes'`.
- The old row is retired by its id, so the partial unique index `(provider, model_name, effective_date) WHERE retired_date IS NULL` cannot collide, even on a second change the same day.
- `cached_input_cost_per_token` is set to NULL: no charge reads the cached-input price before slice 7, and OpenAI's cached reads keep the 50% rule.
- `proposal_id` and `proposal_line_id` are NULL together, which the `ai_model_pricing_provenance_paired` check requires. A NULL `proposal_id` is how slice 9's history will tell this was a runbook change.

---

## 5. Paste 3: read-only post-check

Run paste 1a, then paste 1b, each on its own and unchanged, and check:

- 1a shows a **new** active row with today's `effective_date`. Its `input_per_token` and `output_per_token` are **numerically equal** to the per-1M prices divided by 1,000,000 (for example `0.15` per 1M is `0.00000015`; older rows stored by division may show trailing zeros, such as `0.00000015000000000000`, which is the same value).
- 1a shows the old row (for a price change) still there, with today's `retired_date`.
- 1b shows `active_rows_for_model` = **1**, and `active_row_ids` is the new row's id.
- 1b's `fingerprint_other_models` is **identical** to the value from this run's paste 1b: no other model's charged price moved. `fingerprint_all` has changed.

If any check fails, do not run anything else: tell the owner and SA.

---

## 6. After the change

- Fill in the run log row below in the same PR or doc edit.
- Any **pending** price for this model on `/admin/system-config` was recorded against the old price. Slice 8's Apply will refuse it as stale, by design. Re-enter it, or let the next "Check provider prices" replace it.
- For an image price: this runbook does not apply. Since slice 7 images are priced from `ai_model_image_pricing` first (then the in-code `IMAGE_FALLBACK_PRICING`), but that table has no runbook paste: an image price is added through slice 8's apply, or the in-code fallback changes by PR.

---

## 7. Never use these

> ⚠️ **`supabase/SQL Scripts/20251030_add_missing_models_pricing.sql`** uses `ON CONFLICT (provider, model_name, effective_date) DO UPDATE`. It **overwrites prices in place** and targets a unique constraint that slice 2 dropped, so it either fails or rewrites history. Never run it, or any script like it (any `UPDATE` of a cost column, any `DELETE`, any `ON CONFLICT … DO UPDATE` on `ai_model_pricing`). It is deleted in slice 14.

---

## 8. Run log

| Date (UTC) | Who ran it | Owner approval (where, when) | Model | Old → new per 1M (input / output) | Large change confirmed? | Source URL and date checked | Fingerprint all, before → after | Other models unchanged |
|---|---|---|---|---|---|---|---|---|
| 2026-10-16 19:56 | TL (Claude Code) via the Supabase connector | Owner, in chat, 2026-10-16 ("Write it now", BQ-7a) | openai / text-embedding-3-small (new row `549fcc6e-3f63-4d06-b959-71c77759a12e`) | none (first price) → 0.02 / 0 | No | https://developers.openai.com/api/docs/pricing, checked 2026-10-16 | `76c7cfe8e89e2464f9fa866668682426` → `8d6bbb2344a2c9940e65fd51ca6ccf82` | Yes (`fingerprint_other_models` `76c7cfe8…` before and after) |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-16 | Created | AI model price review slice 6 (SA SC6-5; user decision BQ-1 (a)): three pastes (read-only pre-check with the slice 2 fingerprint, one self-checking `DO` block that retires by id and never deletes, read-only post-check), the `20251030` warning, and the run log |
| 2026-10-16 | SA code review and QA fixes | CR-1: paste 1 became 1a (rows) and 1b (count, `active_row_ids`, fingerprints), one statement per paste, and paste 3 runs 1a then 1b. CR-5: conversion `* 0.000001` (exact, as the pending area), "numerically equal" check, fingerprint compared only within one run. QA: no comments in any paste (hints moved to the text), "three places each". TL: a 10x / 0.1x check in paste 2 with the `v_confirm_large_change` override, skipped for a first price. Pinned by the source test `lib/ai/pricing-research/__tests__/emergencyRunbook.source.test.ts` |
| 2026-10-16 | First run logged | BQ-7a (user: "Write it now"): `openai / text-embedding-3-small` first price, 0.02 / 0 per 1M, by TL; other models unchanged. Charge unchanged (equals the in-code fallback) |
