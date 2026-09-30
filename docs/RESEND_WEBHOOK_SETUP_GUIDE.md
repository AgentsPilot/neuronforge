# Resend Webhook Setup - Step by Step Guide

> **Last Updated**: 2026-09-28

## Overview

This is how the platform learns what happened to an email after it handed it to
Resend: whether it arrived, bounced, or was reported as spam. Without it,
`email_sends` records that mail was sent and nothing more — which is the state
this system was in for its first 87 emails, every one of them with
`delivered_at` null.

The receiving half is already built and deployed. **The only thing missing is the
endpoint registration in the Resend dashboard, and the secret in Vercel.**

Open and click tracking are **deliberately off** — see [Part 5](#part-5-why-open-and-click-tracking-are-off), which is the
section to read before anyone decides otherwise.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Part 1: Local Development](#part-1-local-development)
- [Part 2: Production Setup (Resend Dashboard)](#part-2-production-setup-resend-dashboard)
- [Part 3: Verify Everything Is Working](#part-3-verify-everything-is-working)
- [Part 4: Troubleshooting](#part-4-troubleshooting)
- [Part 5: Why Open and Click Tracking Are OFF](#part-5-why-open-and-click-tracking-are-off)
- [Quick Reference](#quick-reference)
- [Change History](#change-history)

---

## Prerequisites

- A Resend account with a **verified sending domain**.
- `RESEND_API_KEY` set in the target environment. It must start with `re_` —
  `resendConfigured()` in `lib/notifications/emailTransport.ts` checks that
  prefix, and falls through to SMTP then Gmail when it fails.

> **`RESEND_API_KEY` is normally absent from `.env.local`, and that is fine.**
> Local sends then go over SMTP or Gmail, neither of which returns a message id.
> So `provider_message_id` is null for anything sent from a laptop, and the
> webhook can never match it. Delivery events are a production-only path.

---

## Part 1: Local Development

There is no Resend equivalent of `stripe listen`. Instead, a script posts a
correctly signed event at a running server:

### Step 1: Put a signing secret in `.env.local`

```bash
RESEND_WEBHOOK_SECRET=whsec_<any-base64-you-like>
```

Locally this value is **invented**. The route and the script read the same
variable, so they agree, and that is all the local path proves. It will never
verify a real event from Resend.

### Step 2: Run the smoke script

```bash
npm run dev
npm run resend:smoke
```

This proves the signature path, the replay window and the repository write. It
proves **nothing** about Resend's own delivery — only Part 2 does that.

> **Do not pass `--id` with a real `provider_message_id` casually.** The script
> writes to the row it names. It defaults to `email.delivered`, which records a
> timestamp; if you override `--type`, you are writing that fact to a real row.

---

## Part 2: Production Setup (Resend Dashboard)

### Step 1: Confirm the route is deployed

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://neuronforge-kohl.vercel.app/api/webhooks/resend
```

- **405** — correct. The route exports only `POST`, so a GET is rejected by the
  method, which means the route exists.
- **404** — the deployment predates the webhook route. Everything below is
  pointless until it ships.

### Step 2: Create the webhook in Resend

1. Resend dashboard → **Webhooks** → **Add Webhook**
2. **Endpoint URL:**
   ```
   https://neuronforge-kohl.vercel.app/api/webhooks/resend
   ```
3. **Select exactly these events:**

   | Event | Why |
   |---|---|
   | `email.delivered` | The recipient's mail server accepted it |
   | `email.bounced` | Permanently rejected — a broken address |
   | `email.complained` | Delivered, then reported as spam |
   | `email.failed` | Resend accepted it, then could not send it |
   | `email.delivery_delayed` | A temporary problem; acknowledged, recorded as nothing |

4. **Do NOT select `email.opened` or `email.clicked`.** Without the tracking
   subdomain they cannot fire, so ticking them documents an intention the
   platform has decided against. See Part 5.

Also consciously **not** subscribed: `email.sent` (the row is already written
`sent` at send time, so the event is pure duplication), `email.suppressed`,
`email.received`, `email.scheduled`, and all `domain.*` / `contact.*` /
`suppression.*` events.

### Step 3: Copy the signing secret

On the webhook's detail page. It is prefixed `whsec_`. **Copy it now** — the
route refuses every request until it is configured.

### Step 4: Add it to Vercel

**Settings → Environment Variables:**

| Variable | Value | Scope |
|---|---|---|
| `RESEND_WEBHOOK_SECRET` | the `whsec_…` from Step 3 | **Production** |

> **Production only.** A preview deployment shares the production database, so a
> preview receiving real events would write to live rows. Previews should 401,
> and 401 is what they will do.

### Step 5: Redeploy

Vercel injects environment variables at **deploy time**. An existing deployment
keeps reading the old (absent) value, so the endpoint stays broken until you
redeploy production.

### On the gap between Steps 2 and 5

The secret only exists once the endpoint does, so there is an unavoidable window
where events arrive and are refused with a 401. That is safe: Resend retries
with exponential backoff and only disables an endpoint after roughly **five days**
of sustained failure. Minutes are fine. Do not create the endpoint and walk away
for a week.

---

## Part 3: Verify Everything Is Working

### Production Checklist

- [ ] `GET /api/webhooks/resend` returns **405** (route deployed)
- [ ] Webhook created in Resend with the five events above, and **not** opens or clicks
- [ ] `RESEND_WEBHOOK_SECRET` set in Vercel, Production scope
- [ ] Production **redeployed** after setting it
- [ ] Signature proven — command below returns `unknown message id`
- [ ] A real event recorded — the SQL below returns a non-zero `delivered`

### Step 1: Prove the signature, without writing anything

```bash
RESEND_WEBHOOK_SECRET='whsec_…' npx tsx scripts/resend-webhook-smoke.ts \
  --url https://neuronforge-kohl.vercel.app --type email.delivered
```

Expect `200 … unknown message id`. That single response proves the URL, the
deploy, the secret and the clock — while touching no row, because the invented id
matches nothing.

### Step 2: Prove the write path

Take the newest `provider_message_id` from `email_sends` and name it explicitly:

```bash
RESEND_WEBHOOK_SECRET='whsec_…' npx tsx scripts/resend-webhook-smoke.ts \
  --url https://neuronforge-kohl.vercel.app --type email.delivered --id <message-id>
```

Expect `RECORDED`. The row should gain `delivered_at` and **keep
`status = 'sent'`** — `email.delivered` records a timestamp only.

### Step 3: The acceptance criterion

Nothing short of this number moving proves the rollout worked:

```sql
SELECT count(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
       count(*) FILTER (WHERE status = 'bounced')       AS bounced,
       count(*) FILTER (WHERE status = 'complained')    AS complained,
       count(*)                                        AS total
  FROM email_sends
 WHERE provider = 'resend'
   AND sent_at > now() - interval '1 day';
```

Before this work, `delivered` was **0 of 87**. It is done when it is non-zero and
rising.

### Step 4: Exercise the bounce path deliberately

Send one production email to Resend's simulator address:

```
bounced@resend.dev
```

That produces a genuine `email.bounced` — the only way to exercise the
status-rewrite branch and the CRM's outcome row on real data. Then check that the
dashboard's "emails sent" figure is **unchanged**: bounced mail was still sent,
and `DISPATCHED_EMAIL_STATUSES` is what keeps it counted.

---

## Part 4: Troubleshooting

The route was written so each failure gives a different answer. Match the
response to the cause:

| Response | Meaning | Fix |
|---|---|---|
| `401 Unauthorized` | Wrong secret, **or** a clock more than 300s out, **or** the secret is not set at all | Re-copy from Resend; confirm the Vercel value; redeploy |
| `200 unknown message id` | No `email_sends` row carries that id | Usually a send from before id capture, or another system on the same Resend account. A **sustained** run of these means every id is missing |
| `200 already recorded` | Duplicate or out-of-order redelivery | Nothing to do; the write is idempotent |
| `500 Failed to record` | The database write failed | The only case that asks for a retry, and Resend will |
| `404` | The deployment predates the route | Deploy |

### The failure that looks like success

A misconfiguration where **every** message id misses looks identical, from
Resend's delivery panel, to a system working perfectly: every event returns 200.
The distinguishing signal is in the logs — grep the `ResendWebhook` module for:

```
No email_sends row carries this message id
```

A steady stream of that line, with no `Email delivery event recorded`, means
matching is broken rather than quiet.

---

## Part 5: Why Open and Click Tracking Are OFF

This is a deliberate decision, not an oversight.

**What enabling them would require:**

- A **CNAME DNS record** for a tracking subdomain (e.g.
  `links.example.com → links1.resend-dns.com`). Both are disabled by default and
  neither works without it.
- **Open tracking** embeds a 1×1 transparent pixel in every email.
- **Click tracking** rewrites **every link** so the recipient goes to Resend
  first and is then forwarded.

**Why not:** this platform sends on behalf of small businesses to *their own
clients*. Rewriting those links and embedding pixels is a change to what those
businesses' clients receive, made by us rather than by them.

**What follows from that, in code:**

- `opened_at`, `clicked_at`, `open_count` and `click_count` are structurally null
  on every row.
- The `email.opened` / `email.clicked` handlers in
  `app/api/webhooks/resend/route.ts` remain — correct, and dead. Re-enabling
  tracking should be a dashboard change, not a code change.
- Those columns are **not** exposed to the Business OS chat
  (`lib/business-os/catalog/catalog.ts`). A chat that answers "0 opens" reads as
  a measurement; absence reads as what it is.
- The CRM must **never** render "not opened". It says nothing about opens at all.

**If you reverse this decision**, reverse the last two points in the same commit,
or the product will report zero engagement while tracking it.

---

## Quick Reference

| Variable | Where from | Scope |
|---|---|---|
| `RESEND_API_KEY` | Resend → API Keys. Must start with `re_` | Production (Preview optional) |
| `RESEND_WEBHOOK_SECRET` | Generated **by Resend** when the endpoint is created | Production only |

| Item | Value |
|---|---|
| Endpoint | `https://neuronforge-kohl.vercel.app/api/webhooks/resend` |
| Events | `delivered`, `bounced`, `complained`, `failed`, `delivery_delayed` |
| Signature | Svix — `svix-id`, `svix-timestamp`, `svix-signature` |
| Replay window | 300 seconds |
| Response deadline | 15 seconds, or Svix counts it a failure |
| Smoke test | `npm run resend:smoke -- --url <host> --type email.delivered` |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-28 | Created | The webhook route shipped earlier with no setup documentation, and the Resend endpoint was never registered — all 87 `email_sends` rows had a null `delivered_at`. Documents the dashboard steps, the deliberate decision against open/click tracking, and the one SQL query that proves the rollout worked. |
