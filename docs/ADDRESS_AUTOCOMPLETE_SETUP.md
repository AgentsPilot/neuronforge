# Address Autocomplete Setup

> **Last Updated**: 2026-10-05
> **Status**: optional feature — the address forms work without it.

## Overview

The business address and invoice address forms can fill themselves in: the owner
types the start of an address, picks a suggestion, and street, city, postcode,
state and country are set together. This is off until a Google Places API key is
configured; with no key the lookup field does not render and the forms behave
exactly as they did before.

This guide is the whole setup, start to finish. It takes about ten minutes.

---

## Contents

- [What you are enabling](#what-you-are-enabling)
- [Step by step](#step-by-step)
- [Restricting the key](#restricting-the-key)
- [Adding it to the app](#adding-it-to-the-app)
- [Deploying to Vercel](#deploying-to-vercel)
- [Checking it works](#checking-it-works)
- [What it costs](#what-it-costs)
- [Troubleshooting](#troubleshooting)

---

## What you are enabling

**Two** APIs, not one. Missing either produces a field that loads and never
suggests anything.

| API | Why |
|---|---|
| **Places API (New)** | The suggestions, and the address details behind the one you pick |
| **Maps JavaScript API** | The loader the browser runs to reach it |

> ⚠️ **"Places API (New)", not "Places API".** The legacy one was deprecated on
> 1 March 2025 and is closed to projects created since. The old API is what
> almost every tutorial still shows, and code written against it loads without
> error and returns nothing.

---

## Step by step

1. **Open the Google Cloud console** — <https://console.cloud.google.com>

2. **Pick or create a project.** The project selector is in the top bar, left of
   the search box. A new project is fine; call it something you will recognise,
   e.g. `agentpilot-maps`.

3. **Turn on billing.** Menu (☰) → **Billing** → *Link a billing account*.
   A card is required even though the usage here is far inside the free monthly
   allowance — Google will not serve Places requests on a project with no
   billing account attached.

4. **Enable Places API (New).** Menu → **APIs & Services** → **Library**, search
   `Places API (New)`, open it, press **Enable**.

5. **Enable Maps JavaScript API.** Same Library screen, search
   `Maps JavaScript API`, press **Enable**.

6. **Create the key.** Menu → **APIs & Services** → **Credentials** →
   **+ Create credentials** → **API key**. Copy the key it shows you.

7. **Restrict it immediately** — see below. Do not skip this.

---

## Restricting the key

The key runs in the browser and anyone can read it in devtools. That is normal
and expected for this API: it is not protected by being secret, it is protected
by only working from your own site. An unrestricted key is somebody else's Maps
bill.

On the key's page (**Credentials** → click the key):

**Application restrictions** → *Websites*, then add the sites that may use it:

```
http://localhost:3000/*
https://your-production-domain.com/*
https://*.your-production-domain.com/*
```

**API restrictions** → *Restrict key*, then tick exactly these two:

- Places API (New)
- Maps JavaScript API

Press **Save**. Restrictions can take a few minutes to take effect.

---

## Adding it to the app

Put the key in `.env.local`:

```bash
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=AIza...
```

Then **restart the dev server**. `NEXT_PUBLIC_` variables are compiled into the
browser bundle at build time, so an already-running server will not see it.

---

## Deploying to Vercel

Two separate things, and the second is the one that gets missed.

### 1. The environment variable

**Vercel → your project → Settings → Environment Variables**

| Field | Value |
|---|---|
| Key | `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` |
| Value | the key from Google Cloud |
| Environments | tick **Production**, **Preview** and **Development** |

> ⚠️ **Then redeploy.** `NEXT_PUBLIC_` variables are compiled into the browser
> bundle at BUILD time, not read at run time. Adding one to an existing
> deployment changes nothing until a new build runs — the field will simply not
> appear, with no error to explain why.
>
> Deployments → the latest one → ⋯ → **Redeploy**.

### 2. The key's website restrictions

The key is restricted by HTTP referrer, so it only works from sites on its list.
A production domain that is not on it fails with `RefererNotAllowedMapError`.

In **Google Cloud → Credentials → your key → Application restrictions →
Websites**, add:

```
http://localhost:3000/*
https://neuronforge-kohl.vercel.app/*
https://neuronforge-*.vercel.app/*
```

The third line covers **preview deployments**, which Vercel gives a fresh URL on
every branch and commit — `neuronforge-git-my-branch-team.vercel.app`,
`neuronforge-a1b2c3-team.vercel.app`. Without it autocomplete works in
production and mysteriously does not on any preview.

> ⚠️ **Do not use `https://*.vercel.app/*`.** It is the obvious shortcut and it
> authorises every project on vercel.app — anyone's — to spend against this key.
> Keep the project name in the pattern.

Add a custom domain to the same list when there is one; the Vercel URL keeps
working alongside it.

---

## Checking it works

1. Open **Settings → Business profile**, or **Settings → Invoice settings**.
2. A *Start typing your address…* field appears above the address fields. If it
   does not, the key is missing or the server was not restarted.
3. Type at least **three characters** of a real address — fewer sends no
   request, deliberately.
4. Pick a suggestion. Street, city, postcode, country and (where that country
   has one) state should all populate.

**Worth testing first in Hebrew**, because it exercises the language parameter
and the right-to-left layout at the same time: switch the interface to Hebrew
and type `דיזנגוף 50`.

---

## What it costs

Billing is per **session**, not per keystroke: everything typed plus the one
details lookup at the end counts as a single session. The app mints a session
token on the first keystroke and discards it when a place is chosen, which is
what keeps that true.

These forms are filled in roughly **once per business, ever** — this is settings,
not a checkout. Expect a handful of sessions per account in its lifetime, which
sits inside Google's free monthly allowance. Check current pricing at
<https://developers.google.com/maps/billing-and-pricing/pricing> before assuming;
it changes.

Set a budget alert while you are in the console (**Billing → Budgets & alerts**)
if you want certainty.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| No lookup field at all | Key not set, or the dev server was not restarted after setting it |
| Field appears, never suggests | Only one of the two APIs is enabled — check **Places API (New)** specifically |
| Console: `ApiNotActivatedMapError` | Maps JavaScript API is not enabled on the project |
| Console: `RefererNotAllowedMapError` | The site you are on is not in the key's website restrictions |
| Console: `BillingNotEnabledMapError` | No billing account linked to the project |
| Suggestions in the wrong country | Expected — results are biased to the country already selected in the form, and it is only a bias |

Nothing here can break the address forms: every failure path falls back to
typing the fields by hand.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Created | Setup for the optional address autocomplete on the business and invoice address forms. |
| 2026-10-05 | Added | Vercel deployment: the environment variable, the rebuild it needs, and the preview-URL pattern the key must allow. |
