# Web Addresses

> **Last Updated**: 2026-09-22

## Overview

Every web address this system hands out — the platform, the marketing site, and a
business's public pages — is resolved in **one module**, `lib/utils/origins.ts`, from three
environment variables. This document is what to set, where, and why.

It exists because the alternative was tried. Before `origins.ts` there were **five domains
hardcoded across the codebase** for what should be two, they disagreed with one another,
and the domain that actually served a business's website matched **none** of the three the
interface displayed. Every website address shown to an owner was wrong, and the preview and
the published link were computed by different code, so they could differ from each other
too.

**The rule: an address is never written at a call site. It comes from `origins.ts`, or it is
a bug.**

## Table of Contents

- [The three variables](#the-three-variables)
- [What each environment gets](#what-each-environment-gets)
- [Why production and preview differ in shape](#why-production-and-preview-differ-in-shape)
- [Testing the subdomain shape before production](#testing-the-subdomain-shape-before-production)
- [DNS at launch](#dns-at-launch)
- [Supabase](#supabase)
- [Retired variables](#retired-variables)
- [Change History](#change-history)

---

## The three variables

**File:** `lib/utils/origins.ts`

| Variable | Resolver | What it addresses |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `platformOrigin()` | this application |
| `NEXT_PUBLIC_MARKETING_URL` | `marketingOrigin()` | the marketing site: `/login`, `/signup`, `/reset-password`, `/logout` |
| `NEXT_PUBLIC_PUBLIC_SITE_HOST` | `publicSiteUrl()` | the apex a business's pages hang off |

The marketing repo mirrors the first of these as `NEXT_PUBLIC_MAIN_APP_URL`.

> ⚠️ All three are `NEXT_PUBLIC_*`, so they are **inlined at build time**. Changing one in
> Vercel does nothing until you redeploy, and a browser tab holding an older bundle keeps
> the old value until it is hard-reloaded.

---

## What each environment gets

### Platform project (`neuronforge`)

| Variable | local | Vercel | production |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://neuronforge-kohl.vercel.app` | `https://app.agentspilot.ai` |
| `NEXT_PUBLIC_MARKETING_URL` | `http://localhost:3001` | `https://agentspilot-marketing.vercel.app` | `https://agentspilot.ai` |
| `NEXT_PUBLIC_PUBLIC_SITE_HOST` | *(empty)* | *(empty)* | `agentspilot.ai` |

### Marketing project (`agentspilot-marketing`)

| Variable | local | Vercel | production |
|---|---|---|---|
| `NEXT_PUBLIC_MAIN_APP_URL` | `http://localhost:3000` | `https://neuronforge-kohl.vercel.app` | `https://app.agentspilot.ai` |
| `NEXT_PUBLIC_APP_URL` | *(empty)* | *(empty)* | *(empty)* |

`NEXT_PUBLIC_APP_URL` stays **empty on the marketing project**. It is read only for the
sign-up confirmation link and falls back to `window.location.origin`, which is correct
everywhere. Setting it to the platform's URL sends confirmation emails to the *platform's*
`/auth/callback` instead of the marketing one — and because both apps have a route by that
name, the mistake looks like it works.

---

## Why production and preview differ in shape

A business's address has two shapes, chosen by whether `NEXT_PUBLIC_PUBLIC_SITE_HOST` is
set:

| Host set? | A business's booking page |
|---|---|
| `agentspilot.ai` | `https://joesgym.agentspilot.ai/book` |
| *(empty)* | `https://…/site/joesgym/book` |

Both are served by the **same internal route**, `app/site/[subdomain]/book`. In production
middleware rewrites the subdomain form onto it; elsewhere the path form is served directly.
Because `publicSiteUrl()` is the only thing that builds either, the preview, the copy-link
button, the dashboard and the published link cannot disagree.

**Empty is not a degraded mode.** `{prefix}.agentspilot.ai` requires wildcard DNS, and
neither `localhost` nor `*.vercel.app` has it. Setting the host on Vercel would produce
`joesgym.neuronforge-kohl.vercel.app`, which resolves nowhere.

---

## Testing the subdomain shape before production

The subdomain path would otherwise ship having never run — exactly the failure this whole
change set exists to fix.

`lvh.me` and `localtest.me` resolve **every** subdomain to `127.0.0.1`. So:

```bash
NEXT_PUBLIC_PUBLIC_SITE_HOST=lvh.me:3000
```

`joesgym.lvh.me:3000/book` then reaches your dev server through the same middleware rewrite
production uses. `origins.ts` emits `http://` for these hosts, since they have no
certificate.

---

## DNS at launch

| Record | Points at |
|---|---|
| `agentspilot.ai` (apex) | marketing project |
| `app.agentspilot.ai` | platform project |
| `*.agentspilot.ai` | platform project |

`app` and every business are served by the **same deployment**; middleware tells them apart
by prefix. An exact domain beats the wildcard in Vercel, and `app` is on the reserved list
in `lib/business-os/reservedPrefixes.ts` — **that list is the only thing standing between a
business and the platform's own hostname.** It is enforced by middleware, the availability
checker and the write path, all importing the same module.

---

## Supabase

`redirectTo` is built from `window.location.origin`, so it differs per environment. **Every
one of those origins must be in the Redirect URLs allow-list**; if it is not, Supabase
ignores it *silently* and falls back to the project's Site URL. That is why authentication
can work on localhost and break on Vercel with nothing in any log.

Add, for each environment: `/auth/callback`, `/reset-password`, `/logout` on the marketing
origin, and `/auth/callback` on the platform origin. Set **Site URL** to the marketing
origin that is actually served.

---

## Retired variables

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_WEBSITE_BASE_HOST` | Defaulted to `agentpilot.io`, a domain never served. It decided what middleware routed while the interface showed two other domains. Replaced by `NEXT_PUBLIC_PUBLIC_SITE_HOST`. |

`website_pages.custom_domain` is retained in the database but **no longer read or
writable**: businesses do not bring their own address. It is null on every row, so removing
the branch changed no behaviour.

> **Note:** `docs/TWO_REPO_DEPLOYMENT_GUIDE.md` predates this and names `agentspilot.com`
> throughout. Its Vercel and DNS mechanics still apply; its **domain values do not** — this
> document supersedes them.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-22 | Created | Consolidated five hardcoded domains into `lib/utils/origins.ts`; documented the three variables, the two address shapes, the `lvh.me` technique for testing the subdomain path, and the Supabase allow-list requirement |
