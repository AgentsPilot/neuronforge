# AI Model Price Review Slice 2: C-2 and P-1 Capture

> **Last Updated**: 2026-10-10

## Overview

Results of blocks C-2 and P-1 from [AI_MODEL_PRICE_REVIEW_SLICE2_WORKPLAN.md](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE2_WORKPLAN.md) section 2 (Step 1), reproduced against production.

| Item | Value |
|---|---|
| Method | PostgREST read-only GET with service role, by agent, at 2026-10-10T18:53:58Z |
| Writes | None. Only GET and HEAD (`Prefer: count=exact`); no RPC |
| "Today" (UTC) used for `is_future` | 2026-10-10 |
| 90-day window start | 2026-07-12T18:53:58Z (`now - 90 days`) |
| `token_usage` columns verified | `provider`, `model_name`, `created_at` (GET `select=provider,model_name,created_at&limit=1` succeeded) |
| `token_usage` total rows | 29,629 |
| `oldest_row` (min `token_usage.created_at`) | 2025-10-22T15:58:12.856098+00:00, so the full 90 days of history exist |
| Active `ai_model_pricing` rows | 54 (count=exact matches rows fetched), 45 distinct (provider, model_name) pairs |
| Still owed | C-1 is now captured by the user (section "C-1 and view" below). C-3 is no longer run up front: the user decided the fingerprint is taken just before the retire, and the retire script re-checks it inside its own transaction. The view's owner, grants, options and comment are still owed (workplan T-2b) |

PostgREST semantics differ from the SQL in one way only: C-2 counts are one HEAD per model with `provider=eq`, `model_name=eq`, `created_at=gte` the window start, and `last_call` is `order=created_at.desc&limit=1` per model. Joined on both provider and model_name, as the SQL does.

---

## C-2: 90-day usage of every model with an active row

Ordered as the SQL orders it: `calls_last_90_days`, provider, model_name. Empty `last_call` means never called. `oldest_row` is the same for every row: 2025-10-22T15:58:12.856098+00:00.

| provider | model_name | calls_last_90_days | last_call |
|---|---|---:|---|
| anthropic | claude-3-5-haiku-20241022 | 0 | 2026-04-22T13:34:53.103851+00:00 |
| anthropic | claude-3-5-sonnet-20241022 | 0 | 2026-04-21T21:40:42.020003+00:00 |
| anthropic | claude-3-haiku | 0 | |
| anthropic | claude-3-haiku-20240307 | 0 | 2026-04-21T22:18:18.54706+00:00 |
| anthropic | claude-3-opus | 0 | |
| anthropic | claude-3-opus-20240229 | 0 | |
| anthropic | claude-3-sonnet | 0 | |
| anthropic | claude-3-sonnet-20240229 | 0 | |
| anthropic | claude-opus-4-1-20250805 | 0 | |
| anthropic | claude-opus-4-20250514 | 0 | |
| anthropic | claude-opus-4-5-20251101 | 0 | |
| anthropic | claude-sonnet-4-20250514 | 0 | 2026-01-10T19:45:21.665935+00:00 |
| google | gemini-1.0-pro | 0 | |
| google | gemini-1.5-flash | 0 | |
| google | gemini-1.5-pro | 0 | |
| kimi | kimi-k2-0711-preview | 0 | |
| kimi | kimi-k2-thinking | 0 | |
| kimi | kimi-k2-thinking-turbo | 0 | |
| kimi | kimi-k2-turbo-preview | 0 | |
| kimi | kimi-k2.5 | 0 | |
| openai | gpt-3.5-turbo | 0 | |
| openai | gpt-4-turbo | 0 | |
| openai | gpt-4.1-nano | 0 | |
| openai | gpt-5 | 0 | |
| openai | gpt-5-mini | 0 | 2025-12-31T09:01:17.260032+00:00 |
| openai | gpt-5-nano | 0 | |
| openai | gpt-5.1 | 0 | |
| openai | gpt-5.4 | 0 | 2026-04-09T19:35:48.944819+00:00 |
| openai | gpt-5.4-mini | 0 | 2026-04-08T21:49:08.085262+00:00 |
| openai | gpt-5.4-nano | 0 | |
| openai | gpt-5.4-pro | 0 | |
| openai | o3 | 0 | |
| openai | o3-pro | 0 | |
| openai | o4-mini | 0 | |
| anthropic | claude-opus-4-6 | 2 | 2026-07-19T11:18:32.184936+00:00 |
| openai | gpt-4.1-mini | 4 | 2026-09-17T23:01:28.604545+00:00 |
| openai | gpt-4 | 7 | 2026-08-12T01:47:31.789264+00:00 |
| anthropic | claude-sonnet-4-5-20250929 | 8 | 2026-07-19T11:47:16.263802+00:00 |
| openai | gpt-5.2 | 17 | 2026-07-19T11:17:16.205515+00:00 |
| openai | gpt-4.1 | 21 | 2026-09-22T17:19:36.151971+00:00 |
| kimi | kimi-k2-0905-preview | 91 | 2026-09-04T16:15:34.500398+00:00 |
| anthropic | claude-sonnet-4-6 | 93 | 2026-07-19T11:48:47.264036+00:00 |
| anthropic | claude-haiku-4-5-20251001 | 201 | 2026-09-04T16:15:42.688817+00:00 |
| openai | gpt-4o | 334 | 2026-10-08T14:07:07.270329+00:00 |
| openai | gpt-4o-mini | 8007 | 2026-10-10T18:32:53.880355+00:00 |

---

## P-1: retire preview

Every active row of a model with more than one active row, plus the three alias rows. Ordered by provider, model_name, effective_date desc, created_at desc.

Price columns: "API number" is the value as returned by the API as a JSON number (not proof of storage). "Text" is the same column requested with a PostgREST `::text` cast in the select, which is the stored value as Postgres prints it. Both are shown per token.

| id | provider | model_name | effective_date | created_at | input (API number) | input (text) | output (API number) | output (text) | action | tie_stop_and_ask_sa |
|---|---|---|---|---|---|---|---|---|---|---|
| 7c1c0f51-75a2-4baa-a335-e144874058cb | anthropic | claude-3-5-sonnet-20241022 | 2026-06-29 | 2026-06-29T13:48:27.213378+00:00 | 0.000003 | 0.00000300 | 0.000015 | 0.00001500 | keep charged price | false |
| 909b8936-1c6b-4bc5-887e-7b387f615b4c | anthropic | claude-3-5-sonnet-20241022 | 2025-11-30 | 2025-11-30T00:04:43.288547+00:00 | 0.000003 | 0.00000300 | 0.000015 | 0.00001500 | retire duplicate | false |
| 48e013db-0320-4b54-bd45-261a1f181328 | anthropic | claude-3-5-sonnet-20241022 | 2025-10-30 | 2025-10-30T17:04:40.820328+00:00 | 0.000003 | 0.00000300 | 0.000015 | 0.00001500 | retire duplicate | false |
| 1253bb1d-8f50-4d09-9526-858fa77c395e | anthropic | claude-3-5-sonnet-20241022 | 2024-10-22 | 2025-11-12T23:55:31.820865+00:00 | 0.000003 | 0.00000300 | 0.000015 | 0.00001500 | retire duplicate | false |
| 9e223fff-fc18-4c2c-b335-72ed7609baa7 | anthropic | claude-3-haiku | 2024-01-01 | 2025-10-03T19:55:40.920383+00:00 | 2.5e-7 | 0.00000025 | 0.00000125 | 0.00000125 | retire alias if zero calls in C2 | false |
| e412a440-54a1-4a64-970c-ffb87d4cc0bd | anthropic | claude-3-haiku-20240307 | 2026-06-29 | 2026-06-29T13:48:27.109146+00:00 | 2.5e-7 | 0.00000025 | 0.00000125 | 0.00000125 | keep charged price | false |
| f4d788e3-d028-470d-88e0-bb4b8fc968fb | anthropic | claude-3-haiku-20240307 | 2025-11-30 | 2025-11-30T00:04:43.168755+00:00 | 2.5e-7 | 0.00000025 | 0.00000125 | 0.00000125 | retire duplicate | false |
| 9326b11a-601d-4c5c-a553-409604f98e8a | anthropic | claude-3-haiku-20240307 | 2025-10-30 | 2025-10-30T16:35:35.512548+00:00 | 2.5e-7 | 0.00000025 | 0.00000125 | 0.00000125 | retire duplicate | false |
| 2c06eb3a-4bab-435c-b838-ac3f30897ef7 | anthropic | claude-3-haiku-20240307 | 2024-03-07 | 2025-11-12T23:55:31.820865+00:00 | 2.5e-7 | 0.00000025 | 0.00000125 | 0.00000125 | retire duplicate | false |
| ad3717eb-9024-419e-857c-d2fa3e182588 | anthropic | claude-3-opus | 2024-01-01 | 2025-10-03T19:55:40.920383+00:00 | 0.000015 | 0.00001500 | 0.000075 | 0.00007500 | retire alias if zero calls in C2 | false |
| 1a69f840-d5df-4185-b85c-c11fe05bbc6a | anthropic | claude-3-sonnet | 2024-01-01 | 2025-10-03T19:55:40.920383+00:00 | 0.000003 | 0.00000300 | 0.000015 | 0.00001500 | retire alias if zero calls in C2 | false |
| 6d0bbad2-d0d6-4136-be7b-f59284de4872 | openai | gpt-4o-mini | 2026-06-29 | 2026-06-29T13:48:26.001306+00:00 | 1.5e-7 | 0.00000015 | 6e-7 | 0.00000060 | keep charged price | false |
| 296b4e13-3129-4a69-982c-db42ce345c3d | openai | gpt-4o-mini | 2025-11-30 | 2025-11-30T00:04:42.475993+00:00 | 1.5e-7 | 0.00000015 | 6e-7 | 0.00000060 | retire duplicate | false |
| e4553790-6bcf-4322-977e-e701e9333a17 | openai | gpt-4o-mini | 2025-10-30 | 2025-10-30T16:35:35.512548+00:00 | 1.5e-7 | 0.00000015 | 6e-7 | 0.00000060 | retire duplicate | false |
| f56e9b2e-4896-48c2-94de-1b1a44cec53d | openai | gpt-4o-mini | 2024-07-18 | 2025-11-12T23:55:31.820865+00:00 | 1.5e-7 | 0.00000015 | 6e-7 | 0.00000060 | retire duplicate | false |

---

## C-1 and view (user-run, SQL editor)

User-run read-only captures, production, 2026-10-10 (Supabase SQL editor). Transcribed by TL from the user's paste.

### C-1 (condensed, exact values)
- table: owner postgres; rls_on true; rls_forced false; comment: "Per-token model pricing; every credit charge is computed from it. Written only by the service role through /api/admin/system-config/pricing (admin-gated). RLS: admin_users-backed read + write for authenticated sessions; anon has no privileges beyond SELECT, which RLS then denies."
- columns (position, type, not_null, default):
  1 id uuid NOT NULL default gen_random_uuid()
  2 provider character varying(50) NOT NULL
  3 model_name character varying(100) NOT NULL
  4 input_cost_per_token numeric(10,8) NOT NULL
  5 output_cost_per_token numeric(10,8) NOT NULL
  6 effective_date date NOT NULL
  7 retired_date date NULL
  8 created_at timestamp with time zone NULL default now()
- constraints: ai_model_pricing_pkey PRIMARY KEY (id); ai_model_pricing_provider_model_name_effective_date_key UNIQUE (provider, model_name, effective_date)
- indexes: only the two backing those constraints (btree)
- referenced_by: none
- policies: ai_model_pricing_admin_select (SELECT, roles {authenticated}, permissive, using is_platform_admin()); ai_model_pricing_admin_write (ALL, roles {authenticated}, permissive, using is_platform_admin(), check is_platform_admin())
- table grants: anon SELECT, MAINTAIN; authenticated SELECT, MAINTAIN; postgres all incl MAINTAIN; service_role SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN; no column grants
- triggers: none
- dependent_view: public.pilot_cost_savings_summary (v)
- function_mentions: none
- row_count: total 54 active 54 retired 0 active_future_dated 0
- precision (stored ::text): gemini-1.0-pro 0.00000050/0.00000150; gemini-1.5-flash 0.00000008/0.00000030 (official 0.075 per 1M => stored rounded); gemini-1.5-pro 0.00000125/0.00000500; gpt-5-nano 0.00000005/0.00000040
- model counts match the agent's C-2/P-1 capture (45 pairs; 4 active rows each for gpt-4o-mini, claude-3-5-sonnet-20241022, claude-3-haiku-20240307)

### View definition: pg_get_viewdef('public.pilot_cost_savings_summary', true)
```sql
 WITH execution_costs AS (
         SELECT psrh.execution_id,
            psrh.agent_id,
            sum(psrh.tokens_used) AS total_tokens,
            sum(psrh.estimated_cost_usd) AS actual_cost,
            sum(psrh.tokens_used)::numeric * (( SELECT (ai_model_pricing.input_cost_per_token + ai_model_pricing.output_cost_per_token) / 2::numeric
                   FROM ai_model_pricing
                  WHERE ai_model_pricing.provider::text = 'openai'::text AND ai_model_pricing.model_name::text = 'gpt-4o'::text AND ai_model_pricing.retired_date IS NULL
                  ORDER BY ai_model_pricing.effective_date DESC
                 LIMIT 1)) AS tier3_cost,
            psrh.created_at
           FROM pilot_step_routing_history psrh
          WHERE psrh.routing_source = 'pilot_per_step'::text
          GROUP BY psrh.execution_id, psrh.agent_id, psrh.created_at
        )
 SELECT execution_id,
    agent_id,
    total_tokens,
    actual_cost,
    tier3_cost,
    tier3_cost - actual_cost AS cost_saved,
        CASE
            WHEN tier3_cost > 0::numeric THEN (tier3_cost - actual_cost) / tier3_cost * 100::numeric
            ELSE 0::numeric
        END AS savings_percentage,
    created_at
   FROM execution_costs
  WHERE tier3_cost > 0::numeric
  ORDER BY created_at DESC;
```
Not referenced anywhere in the repo (grep 2026-10-10). Owner, grants, security_invoker option and comment of the view are NOT yet captured.

### User decision
2026-10-10: user approved in writing retiring the 12 rows (set retired_date, never delete): 9 duplicates (3 each gpt-4o-mini, claude-3-5-sonnet-20241022, claude-3-haiku-20240307 , all except the newest row, same prices) + 3 aliases claude-3-haiku, claude-3-opus, claude-3-sonnet (zero calls ever). Ids per the P-1 table in docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE2_CAPTURE_2026-10-10.md.

---

## Summary

| Question | Answer |
|---|---|
| Rows that would be retired as duplicates | **9**: 3 each for `claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307` and `gpt-4o-mini` |
| Models with more than one active row | 3 (the three above), each with 4 active rows |
| Do the duplicates change any price? | No. In each model, every duplicate holds the same input and output price as the kept row (text values match) |
| Future-dated active rows | None (no row has `effective_date` after 2026-10-10) |
| `claude-3-haiku` alias: calls in 90 days | 0, and never called (no `token_usage` row ever) |
| `claude-3-opus` alias: calls in 90 days | 0, and never called |
| `claude-3-sonnet` alias: calls in 90 days | 0, and never called |
| Ties (`tie_stop_and_ask_sa`) | None. No two rows of one model share both `effective_date` and `created_at`. (Rows of different models share a `created_at`, for example the 2025-11-12T23:55:31.820865 seed rows, but P-1 partitions ties per model, so that is not a tie) |
| Kept row differs from what `listActive()` charges | None. For all 3 models the "keep charged price" row is the row the charging code picks today |

### Cross-check against the charging code

- `lib/repositories/AiModelPricingRepository.ts` `listActive()` (identical on `origin/main` and in this worktree): `retired_date IS NULL`, `effective_date <= today` (UTC date), ordered `effective_date` desc then `created_at` desc.
- `lib/ai/pricing.ts` `loadPricingFromDatabase()`: walks those rows and keeps the FIRST row per `provider:model_name`; later rows are counted as superseded. So "newest wins" among rows already in effect.
- Reproduced in code over the same 54 rows: the charging pick per model equals P-1 position 1 in the `is_future = false` partition for every model. Zero mismatches.
- New zero-call names in C-2 beyond the three aliases: 34 of 45 priced models have zero calls in 90 days, but most are dated model ids, not aliases. Whether any of them is an alias that no code path calls is the SA question in workplan section 2 ("A new `NOT IN` list is made only if C-2 reveals another zero-call alias"); this capture does not decide it.
