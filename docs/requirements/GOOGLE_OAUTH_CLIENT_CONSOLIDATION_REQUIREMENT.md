# Google OAuth Client Consolidation

> **Last Updated**: 2026-11-03
> **Status**: Scoping — investigation complete, target state proposed, SA has ruled on the guard. Nothing implemented: no code, Vercel or Google Console change has been made.
> **Owner**: DO (environment execution) + Dev (code retirement) + SA (ruled, section 8)
> **Motivating incident**: 2026-11-02 production outage during the S0.4 client-secret rotation (ClickUp 868mnrea2).

## Overview

AgentPilot talks to Google through **two** OAuth clients in one GCP project (number `921980058947`), and the names on those clients are the reverse of what they do: the client called **"Local Dev Client"** is what **production** uses for every Google plugin, while the one called **"AgentsPilot Web Client"** only backs Supabase Auth sign-in. Four environment variables carry client IDs between them, three of which hold the same value, and all four are scoped to **All Environments** in Vercel.

On 2026-11-02 an operator rotating the leaked client secret acted on the client whose *name* matched production, took production sign-in down, and then took Google plugin token refresh down with `invalid_client` on a five-minute cron. Both had one-click rollbacks and no data was lost. The naming and the variable sprawl are the root cause, and this document proposes the target state that removes them.

This is a requirement, not a workplan. It answers five investigation questions with evidence, states the one hard constraint any consolidation must respect, and recommends the cheapest ordering. Every code reference was read from **`origin/main` at `7c0b328b`** (fetched 2026-11-03; the local worktree was confirmed byte-identical for the paths cited).

## Table of Contents

- [1. The two clients](#1-the-two-clients)
- [2. The four variables today](#2-the-four-variables-today)
- [3. Investigation findings](#3-investigation-findings)
  - [F-1 Which V2 plugin config system is live](#f-1-which-v2-plugin-config-system-is-live)
  - [F-2 Is NEXT_PUBLIC_GOOGLE_CLIENT_ID needed](#f-2-is-next_public_google_client_id-needed)
  - [F-3 Is GMAIL_CLIENT_ID needed separately](#f-3-is-gmail_client_id-needed-separately)
  - [F-4 Are the deprecated V1 strategies reachable](#f-4-are-the-deprecated-v1-strategies-reachable)
  - [F-5 Which client's secret leaked](#f-5-which-clients-secret-leaked)
- [4. The hard constraint: a refresh token is bound to its client_id](#4-the-hard-constraint-a-refresh-token-is-bound-to-its-client_id)
- [5. Target state](#5-target-state)
- [6. Options for the plugin client](#6-options-for-the-plugin-client)
- [7. Recommendation](#7-recommendation)
- [8. The guard — SA ruling](#8-the-guard--sa-ruling)
- [9. Adjacent findings — each needs its own task](#9-adjacent-findings--each-needs-its-own-task)
- [10. Acceptance criteria](#10-acceptance-criteria)
- [11. Open questions](#11-open-questions)
- [12. Retiring V1 and consolidating the parameters](#12-retiring-v1-and-consolidating-the-parameters)
  - [Why nothing in our own code gets renamed](#why-nothing-in-our-own-code-gets-renamed)
  - [The slices](#the-slices)
  - [G-2 the change set](#g-2--the-change-set)
  - [G-2 the four existing guard suites](#g-2--the-four-existing-guard-suites-it-must-update)
  - [G-5 one query](#g-5--one-query-and-why-g-6-waits-for-it)
  - [The environment split costs nothing the other way](#the-environment-split-costs-nothing-if-it-runs-the-other-way)
- [Change History](#change-history)

---

## 1. The two clients

Client IDs are not secrets and are written in full here. **No client secret value appears anywhere in this document**, and none may be added to it.

| Client ID | Google-side display name today | What it actually serves | Where its secret lives |
|---|---|---|---|
| `921980058947-mhcc99u2e8dq2bimroclqej00u5eltb6` | **"AgentsPilot Web Client"** | **Sign-in only.** Supabase Auth's Google provider. Verified live: `GET {SUPABASE_URL}/auth/v1/authorize?provider=google` returns 302 to `accounts.google.com` carrying this `client_id`, `redirect_uri=https://jgccgkyhpwirgknnceoh.supabase.co/auth/v1/callback`, scopes `email profile` | **Supabase dashboard** — not in our env |
| `921980058947-60n3cm2uso92kbn4n97a51gg4ufkc3pu` | **"Local Dev Client"** | **Production**, for every Google plugin OAuth and for the Gmail system-email transport | Vercel (`GOOGLE_CLIENT_SECRET`, `GMAIL_CLIENT_SECRET` — identical value, same client) |

The second row is the whole problem in one line: **the client named for local development is production's plugin client**, and it must already carry production redirect URIs, because all 19 active plugin connections were minted through it.

Someone has already tripped over this exact confusion. `lib/business-os/invites/googleSignInConfig.ts:12-13` carries a comment stating that it reads `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` "and NOTHING else" and that "in particular it never falls back to `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: that is the" plugin client. That defensive comment is evidence of the same failure mode, written down in code and then left to recur at the operator layer.

---

## 2. The four variables today

| Var | Client | Read by | Verdict |
|---|---|---|---|
| `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` | `mhcc99u2` | `lib/business-os/invites/googleSignInConfig.ts:31` — the only reader; feeds "Continue with Google" on the invite signup page (`app/invite/GoogleSignupButton.tsx`, `app/invite/page.tsx`, `app/api/public/invites/signup/google/route.ts`). Unset means the button is off | **Keep, unchanged** |
| `GOOGLE_CLIENT_ID` | `60n3cm` | Server-side. All 7 Google V2 plugin definitions as `"client_id": "${GOOGLE_CLIENT_ID}"` (`lib/plugins/definitions/google-{analytics,business-profile,calendar,docs,drive,mail,sheets}-plugin-v2.json`, line 12 or 13), interpolated by `lib/server/plugin-manager-v2.ts`. Also the V1 **authorization-code exchange** (`gmailPluginStrategy.ts:185`, `googleDrivePluginStrategy.ts:183` — both inside `handleOAuthCallback`, both deleted by G-2) and the one live V1 **refresh** read, `gmailDataStrategy.ts:566,577-578`. The two OAuth strategies have no `refreshToken` member at all — see AF-6 | **Keep** — the production plugin credential |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | `60n3cm` | Only `lib/plugins/strategies/gmailPluginStrategy.ts:42` and `googleDrivePluginStrategy.ts:42`, both inside deprecated-V1 `connect()`. Also declared as `clientIdEnvVar` in `lib/plugins/v2/configs/google-drive.json:16`, which is dead (see F-1) | **Retire** |
| `GMAIL_CLIENT_ID` | `60n3cm` | `lib/notifications/emailTransport.ts:392` (the configured-gate) and `:730` (the transport), plus `app/api/contact/route.ts:61`; tooling in `scripts/generate-gmail-token.js:7` and `scripts/validate-gmail.mjs:38` | **Keep as a separate name** — see F-3 |

Already established and not re-derived here: `GOOGLE_CLIENT_SECRET` and `GMAIL_CLIENT_SECRET` hold the identical value (same client); there is no copy of any client secret in the database (`plugin_connections` stores tokens only); both Vercel vars are scoped **All Environments**, which is precisely how a "local dev" client's credentials became production's. `lib/admin/environment/catalogue.ts` already catalogues all four, at lines ~240, ~257, ~259 and ~325.

> **What a missing variable does.** `lib/server/plugin-manager-v2.ts`, in the `replaceEnvVars` closure of `processEnvironmentVariables`: when `process.env[varName]` is falsy it logs `logger.warn({ varName }, 'Environment variable not found, keeping placeholder')` and **returns the literal `${GOOGLE_CLIENT_ID}` text**, which then ships to Google as the `client_id`. A renamed or deleted variable therefore does not fail at boot — it fails as a warn line and a rejected OAuth request. This is the single most important fact for the guard in section 8, and SA's ruling turns on it.

---

## 3. Investigation findings

### F-1 Which V2 plugin config system is live

**The `lib/plugins/definitions/` system is live. `lib/plugins/v2/configs/` plus `UniversalOAuthHandler` is dead. Drive does not use a different variable from Calendar.**

The live path: `lib/server/plugin-manager-v2.ts` loads each `lib/plugins/definitions/*-plugin-v2.json` and runs `processEnvironmentVariables`, substituting `${GOOGLE_CLIENT_ID}` from `process.env`. All 7 Google definitions use that same placeholder, so every Google plugin — Drive and Calendar alike — authorises under `GOOGLE_CLIENT_ID`.

The dead path, traced end to end:

1. `lib/plugins/v2/configs/google-drive.json:16` declares `"clientIdEnvVar": "NEXT_PUBLIC_GOOGLE_CLIENT_ID"`.
2. That field is read only by `UniversalOAuthHandler.getClientId()` — `return process.env[this.config.oauth.clientIdEnvVar] || ''` — a **private** method.
3. `getClientId()` is reachable only from the handler's `connect` / `handleCallback`, which are reachable only from `UniversalPlugin.connect` / `handleOAuthCallback` (`lib/plugins/v2/core/UniversalPlugin.ts:20-26`).
4. `UniversalPlugin` is instantiated only in `lib/plugins/v2/registry.ts:10`, as `universalPlugins['google-drive-v2']`.
5. `universalPlugins` has **exactly two references on `origin/main`**: its own definition at `registry.ts:10`, and an **unused import** at `lib/plugins/pluginRegistry.ts:11`. It is never read, never spread into `pluginRegistry`, and no route can dispatch to `google-drive-v2`.

So `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is never read through this path at runtime.

> **Correction to two existing docs.** `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md:89` and `docs/requirements/DEVOPS_AGENT_REQUIREMENT.md:3878` both justify "dead" with the claim that `plugins/v2/registry` is "imported nowhere". That premise is false — `lib/plugins/pluginRegistry.ts:11` imports it, so the module **is** evaluated in production (an unused import still runs the module, which constructs a `UniversalPlugin` and its handler at load time). The conclusion is still correct, because the constructor reads no environment variable and nothing ever calls the methods that do. The distinction matters: a future guard built on "imported nowhere" would rest on a false premise and would break the moment someone tidies that import away.

### F-2 Is `NEXT_PUBLIC_GOOGLE_CLIENT_ID` needed

**No. Retire it. It is not read in the browser at all, so the `NEXT_PUBLIC_` prefix buys nothing, and its only readers sit behind a route that cannot succeed.**

- Its only live readers are the two V1 `connect()` functions (`gmailPluginStrategy.ts:42`, `googleDrivePluginStrategy.ts:42`).
- Those `connect()` functions have exactly two call sites: `app/oauth/[plugin]/start/route.ts:43` and `lib/plugins/strategies/googleDriveDataStrategy.ts:17`.
- **No `'use client'` module imports the V1 registry.** All 8 modules that import `@/lib/plugins/pluginRegistry` were checked for a `use client` directive; none has one. So on `origin/main` the value never reaches browser code, and marking it `NEXT_PUBLIC_` only publishes it into build output for no consumer.
- `app/oauth/[plugin]/start/route.ts` cannot complete anyway. It builds a fake popup object and awaits `strategy.connect(...)`. Inside `gmailPluginStrategy.connect` the returned `new Promise(...)` executor calls bare `window.addEventListener('message', messageHandler)`. On the Node server runtime `window` is undefined, so that line throws `ReferenceError` synchronously inside the executor, the promise rejects, and the route's `catch` returns **500** — before `popup.location.href` is ever read into the 302. The authorize URL carrying `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is constructed and discarded.

*Confidence note:* the 500 is a static-analysis conclusion from reading the code, not a live probe — this task is read-only on deployed surfaces. DO should confirm with one `GET /oauth/google-mail/start` against the non-prod host (a GET that writes nothing) before the retirement lands. Recorded as Q-4.

Retiring the variable alone changes no behaviour, because the only path that reads it already fails. It should be retired **together with** the V1 route retirement in F-4, so no reader is left pointing at a name that no longer exists.

### F-3 Is `GMAIL_CLIENT_ID` needed separately

**Keep it as a separate name — but for a reason the question did not assume.** It holds the same value as `GOOGLE_CLIENT_ID` today and the Gmail transport is only third in line, so on today's facts it looks collapsible. It is not, because it carries an **independent credential lifecycle**.

The email transport's own header (`lib/notifications/emailTransport.ts:5-7`) and its gate functions (`resendConfigured()`, `smtpConfigured()`, `gmailConfigured()` at `:375-396`) give the order: **1. Resend** (if `RESEND_API_KEY` starts with `re_`), **2. SMTP**, **3. Gmail OAuth2** (needs all four of `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`), **4. console preview**.

The decisive point: **`GMAIL_REFRESH_TOKEN` is bound to `GMAIL_CLIENT_ID`'s client**, exactly as a user's plugin refresh token is bound to `GOOGLE_CLIENT_ID`'s. Collapsing `GMAIL_CLIENT_ID` onto `GOOGLE_CLIENT_ID` would couple the system email sender's blast radius to the user-plugin client — so a future plugin-client migration would silently kill platform email. That is the same category of mistake as pointing plugins at the sign-in client. One variable per *purpose* keeps the three lifecycles separable. It should be **documented as currently pointing at the same client**, not merged into the same name.

A same-value rename costs nothing. A migration to a different client requires re-minting the refresh token through `scripts/generate-gmail-token.js`, which is a named migration step, not an afterthought.

*What could and could not be read live:* from the Vercel env listing for project `prj_i9VB3Aonk092aoHYlbnU2wKisRNR`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`, `GMAIL_USER` and `GMAIL_REFRESH_TOKEN` are **present**. It was **not** possible to confirm `GOOGLE_CLIENT_ID`, `GMAIL_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` or `GMAIL_CLIENT_SECRET` either way: **22 of the 70 key names came back as `...[truncated]`**, so their absence from a search over that response proves nothing. Presence of all four is taken from the operator's own verified inventory, not from this listing. Recorded as Q-3.

### F-4 Are the deprecated V1 strategies reachable

**Yes — reachable, and one of the two routes is functional. A `@deprecated` JSDoc does not unship a Next.js route handler.**

`lib/plugins/pluginRegistry.ts` is imported by live server code at seven places: `app/oauth/[plugin]/start/route.ts:9`, `app/oauth/token/route.ts:9`, `app/api/generate-agent/route.ts:17`, `app/api/plugin-connections/disconnect/route.ts:11`, `lib/intelligence/execution/PluginCoordinator.ts:3`, `lib/outputInference.ts:2`, `lib/utils/interpolatePrompt.ts:3`. The two under `app/oauth/` are **deployed HTTP endpoints**.

| Route | Reachable | Functional | Reads |
|---|---|---|---|
| `GET /oauth/{plugin}/start` | Yes | **No** — 500, per F-2 | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (built, discarded) |
| `GET /oauth/token` | Yes | **Yes** — pure server code | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (`gmailPluginStrategy.ts:185-190`) |

A third V1 consumer the investigation brief did not list: **`lib/plugins/strategies/gmailDataStrategy.ts:577`** reads `GOOGLE_CLIENT_ID` on its token-refresh path, and is reachable through `PluginCoordinator`. Any retirement plan must include it.

`/oauth/token` additionally has an **authentication gap** that is in scope to *record* but not to fix here: it performs no session check, takes `plugin_key` and `user_id` from the caller-supplied `state` JSON, exchanges the code, and writes through `pluginConnectionRepository.upsert(connection)`. That is the same class as the repo's known `x-user-id` / body-`userId` IDOR sweep. See AF-1.

### F-5 Which client's secret leaked

**The `60n3cm` client — "Local Dev Client", the one production's plugins use. Not the sign-in client.**

GitHub secret scanning holds 17 open alerts, all created 2026-01-18. Two are the relevant pair, and they resolve the question without anyone reading a secret value:

| Alert | Type | Location |
|---|---|---|
| **#5** | Google OAuth Client **ID** | `scripts/generate-gmail-token.js:7`, blob `49c8c79f` |
| **#6** | Google OAuth Client **Secret** | `scripts/generate-gmail-token.js:8`, **same blob** |

Both sit in the same blob on consecutive lines. Line 7 of that blob is a client ID, which is not a secret, so it may be read and quoted: `const CLIENT_ID = '921980058947-60n3cm2uso92kbn4n97a51gg4ufkc3pu.apps.googleusercontent.com';`. Line 8 is `const CLIENT_SECRET = ` followed by the leaked value, which is **not** reproduced here. The secret on line 8 is therefore `60n3cm`'s.

**Consequence — the open question's conditional resolves to "no".** The sign-in client `mhcc99u2` is not implicated by alert #6, so **no Supabase-dashboard secret rotation is required by this alert**. Sign-in broke on 2026-11-02 because it was rotated unnecessarily, not because it needed rotating.

Two further facts:

- `origin/main` already reads both values from the environment (`scripts/generate-gmail-token.js:7-8`), so **no code change can close alerts #5 and #6**. The blob persists in the history of a public repo. They close only by rotating the credential and resolving the alerts as revoked.
- The other 14 Google alerts (#1-4, #8-17) are **all** in `dev.log`, which is untracked on `origin/main` but still in history. `.gitignore` on `origin/main` contains no `log` entry at all, so nothing stops the next `dev.log` being committed. See AF-3.

---

## 4. The hard constraint: a refresh token is bound to its `client_id`

**A Google refresh token is issued against a specific `client_id`. Change the client ID a connection was created under and that connection's refresh token is worthless — the user must re-authorise.** This is the constraint that prices every option below.

Measured live against `jgccgkyhpwirgknnceoh` on 2026-11-03 (read-only; no token column was selected):

| Status | Connections | **People** | With refresh token |
|---|---|---|---|
| `active` | **19** | **5** | 19 |
| `disconnected` | 1 | 1 | 1 |
| **Total Google** | **20** | **5** | 20 |

By plugin: calendar 5, mail 4, drive 3, sheets 3, docs 3, analytics 1, business-profile 1 — 20, matching the operator's count exactly.

> **The reconnect cost is 5 people, not 20 users.** The 20 connections belong to **5 distinct accounts**, of which **2 are platform admins**. One connection is already `disconnected` and costs nothing. So a client-ID change costs **5 people re-authorising 19 connections**, and at most 3 of those 5 are not internal. That is a materially smaller bill than "20 connections" suggests — but it is not zero, and the 3 non-admin accounts must be identified before any window is scheduled. Their identities were deliberately not pulled during this investigation; that is DO's call with the user (Q-1).

> **A claim in the private environment doc needs re-checking before S0.9 relies on it, and the 2026-11-02 incident is the evidence against it.**
> `docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md` (untracked, §1.3) states: "**Deleting the old secret is what invalidates every refresh token issued under it** — adding a new secret alongside it revokes nothing. Delete, do not merely add," and item S0.9 leans on that to revoke the 14 leaked user tokens.
> That is very likely wrong. A refresh token is bound to the **client ID**, while the client **secret** only authenticates the client on the token endpoint; rotating the secret and updating the app leaves the same refresh tokens working. The incident's symptoms say exactly that: the failure was **`invalid_client`**, which per RFC 6749 §5.2 is a *client authentication* failure, not the **`invalid_grant`** that a revoked or invalidated grant returns — and restoring the old secret restored service with no reconnects, which is only possible if the tokens survived.
> **Two consequences.** (a) The 19 reconnects are **not** already sunk inside S0.4, so changing a client ID genuinely costs them — which is why section 7 prefers the rename-only option. (b) **S0.9 is not covered by S0.4.** The 14 leaked user tokens must be revoked per-account at `myaccount.google.com/permissions`, which §1.3's own "finding 2" already offers as the faster method. This needs confirming against Google's documentation before S0.9 is marked done, and the claim in §1.3 corrected either way (Q-2).

---

## 5. Target state

**One row per purpose.** Each purpose owns one client, one ID variable and one secret location, and no two purposes share a credential.

| Purpose | Client | ID variable | Secret lives in | Why it is separate |
|---|---|---|---|---|
| **Browser sign-in** ("Continue with Google" on invite signup; Supabase Auth Google provider) | `mhcc99u2` | `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` | **Supabase dashboard** | Sign-in is the one credential whose loss locks everyone out. It must not share a blast radius with anything, and its secret is already held by a different system |
| **Server-side plugin OAuth** (all 7 Google plugins: Gmail, Drive, Calendar, Sheets, Docs, Analytics, Business Profile) | `60n3cm` today | `GOOGLE_CLIENT_ID` | Vercel `GOOGLE_CLIENT_SECRET` | Holds 19 live user grants. Its reconnect cost is what makes it expensive to move, so it moves only when something else already forces a move |
| **System email sending** (Gmail OAuth2 transport, 3rd fallback behind Resend and SMTP) | `60n3cm` today | `GMAIL_CLIENT_ID` | Vercel `GMAIL_CLIENT_SECRET` | Owns an independent `GMAIL_REFRESH_TOKEN`. Merging its name into `GOOGLE_CLIENT_ID` would make a plugin-client migration silently kill platform email (F-3) |

Variable disposition:

| Var | Disposition | Cost |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` | **Keep unchanged.** Already single-purpose and already defended by a comment | none |
| `GOOGLE_CLIENT_ID` | **Keep the name.** Renaming means editing 7 plugin definitions plus 3 V1 readers plus Vercel, for no gain the Google-side rename does not already deliver | none |
| `GMAIL_CLIENT_ID` | **Keep the name**, and document that it points at the same client as `GOOGLE_CLIENT_ID` today while remaining independently rotatable | none |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | **Retire**, with its two V1 readers (F-2, F-4). Delete the Vercel var last, after the readers are gone | none — its only path already 500s |

**The Google-side rename is the change that actually prevents the incident, and it is free.** No token, no connection and no variable is affected by a display-name change:

| Client | From | To (Google Console display name) |
|---|---|---|
| `921980058947-60n3cm2uso92kbn4n97a51gg4ufkc3pu` | "Local Dev Client" | **"AgentPilot — Plugin OAuth (ALL environments, incl. PRODUCTION)"** |
| `921980058947-mhcc99u2e8dq2bimroclqej00u5eltb6` | "AgentsPilot Web Client" | **"AgentPilot — Supabase Auth sign-in ONLY (secret in Supabase dashboard)"** |

> **These two names belong in the Google Console only.** Section 8 adopts SA's rule that tracked repo text may state a client's **intended role** but must **never** record which deployment or environment it serves — the same rule `lib/admin/environment/supabaseProjects.ts` already follows for Supabase project refs. The parenthetical "incl. PRODUCTION" above is exactly the fact the operator needed on 2026-11-02 and exactly what must not be mirrored into the repo.

Scoping `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` per-environment instead of All Environments is **deliberately not proposed yet**: with one Vercel project and one Supabase project, a per-environment split needs the production client that section 6 Option B defers, and splitting the variable before the client exists would only mean two names for one value.

---

## 6. Options for the plugin client

| | Option A — rename only | Option B — dedicated production client | Option C — point plugins at the sign-in client |
|---|---|---|---|
| **Change** | Rename both Google clients; retire `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; keep every client ID as-is | Create a new production-only client; move `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Production target) to it | Repoint `GOOGLE_CLIENT_ID` at `mhcc99u2` |
| **Reconnects** | **0** | **5 people, 19 connections** + re-mint `GMAIL_REFRESH_TOKEN` | **5 people, 19 connections** + re-mint `GMAIL_REFRESH_TOKEN` |
| **Prevents the 2026-11-02 mistake** | **Yes** — the names stop lying | Yes | Partly — fewer clients, but a worse shape |
| **Blast radius** | Unchanged | **Improved** — prod and non-prod separate | **Worse** — sign-in and plugins share one client |
| **Secret copies** | 1 system (Vercel) | 1 system (Vercel) | **2 systems** (Supabase + Vercel), same secret |
| **Verdict** | **Do now** | **Defer** to the production build-out | **Reject** |

**Why C is rejected** even though it prices the same as B: it puts one client secret into two systems that rotate on different schedules through different dashboards, and it couples sign-in's blast radius to the plugins'. A single bad rotation would then take out sign-in *and* plugins together — a strictly larger version of 2026-11-02 for the same reconnect bill. Equal price, worse shape.

**Why B is deferred rather than dropped.** A separate production Google client is already on the roadmap: `docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md` §8 (Workstream E) lists "Google OAuth (Gmail, Calendar, Drive, Sheets, Docs) — production OAuth client, **verified app**" as "**the longest pole: 4-8 weeks**", because unverified apps are capped at 100 users with a warning screen and verification for restricted scopes needs a privacy policy, a demo video and a security assessment (itself blocked on that doc's §10). Its §3 target topology also gives non-prod a **stable hostname** precisely because Google rejects wildcard redirect URIs. So the production client is coming, it must be a *new* client, and the reconnects are unavoidable at that point. Paying them now and again then would be paying twice.

---

## 7. Recommendation

**Do Option A now. Defer Option B to Workstream E, and pay the reconnects once, there.**

Ordered, with the gate on each step:

1. **Rename both Google clients** in the GCP console (section 5 table). Zero cost, zero risk, and it is the step that would have prevented the incident. *Do this first and independently of everything else.*
2. **Finish S0.4 on `60n3cm` only** — add the new secret, update Vercel `GOOGLE_CLIENT_SECRET` **and** `GMAIL_CLIENT_SECRET` (identical value, same client), verify, then delete the old secret. Do **not** touch `mhcc99u2`: F-5 shows it was never implicated. Follow the `env-change-protocol` skill — one change at a time, with a probe that can fail.
3. **Re-check the §1.3 refresh-token claim** against Google's documentation before S0.9 is closed, and correct the private doc either way (section 4, Q-2).
4. **Retire the V1 Google OAuth surface** — `app/oauth/[plugin]/start/route.ts`, `app/oauth/token/route.ts`, and the `connect()` / `handleOAuthCallback` paths in `gmailPluginStrategy.ts`, `googleDrivePluginStrategy.ts`, `googleDriveDataStrategy.ts` — then delete `NEXT_PUBLIC_GOOGLE_CLIENT_ID` from Vercel and from `catalogue.ts`. **Readers first, variable last.** This also closes AF-1 as a side effect, but AF-1 must be tracked on its own ticket so it is not lost if this step slips.
5. **Land the guard** (section 8). Step 4 does most of the work for it.
6. **Option B rides with Workstream E**, in the window that already has to create a verified production client. One reconnect, one comms message.

**Migration and comms for whenever a client ID does change** (step 6, or step 4 if it is ever bundled): all 5 affected accounts are known to the platform and 2 are admins, so this is a short list, not a campaign. Message each of the 5 before the window with what breaks and the one action needed; expect 19 re-authorisations across 7 plugins; re-mint `GMAIL_REFRESH_TOKEN` via `scripts/generate-gmail-token.js` in the same window; verify by confirming each connection returns to `active` with a non-null refresh token. Schedule it away from the five-minute refresh cron's busiest period so failures are not amplified while the old grants are dying.

---

## 8. The guard — SA ruling

A guard that would have caught the 2026-11-02 mistake. **SA has ruled** (2026-11-03); the rulings below are binding on implementation, and SA corrected two premises this requirement started from.

### What SA corrected

- **There is no display gap to close.** All four client-ID vars are already catalogued as `config(..., 'identifier')` (`lib/admin/environment/catalogue.ts:239`, `:257`, `:259`, `:325`), and `configDisplay`'s `identifier` branch (`lib/admin/environment/classifyEnvironment.ts:227`) shows such a value **in full**. A Google client ID passes every redaction gate, so `/admin/environment` **already prints each of the four IDs** for the deployment serving the page. A "last 8 characters beside the purpose" panel is therefore redundant — what is missing is **meaning**, not digits.
- **The cross-check already exists for a sibling problem.** `classifyEnvironment.ts:441-460` compares the two Supabase URL rows and pushes a `supabase-url-mismatch` diagnostic onto both; the code is declared in `lib/admin/environment-types.ts:73` and worded page-side at `app/admin/environment/environmentDisplay.ts:255`. The Google check belongs in that pattern, not on a new surface.

### Rulings

| # | Proposal | Ruling | Reason |
|---|---|---|---|
| 1 | **Value-agreement assertion in CI** | **Rejected — do not propose it** | CI holds no real Google values (`build.yml` Build env is placeholders, and the file is public). Such a check would either assert that CI's placeholders agree with each other — **green while production is broken, worse than no check** — or require pinning live client IDs in tracked public text, which the public-repo rule forbids |
| 1b | Feeding the IDs in as **GitHub Actions secrets** | **Rejected, flagged as a new pattern** | It would prove CI's secrets agree, never that the Vercel production deployment agrees — the only environment the incident occurred in. CI is not a place where deployment values can be observed |
| 2 | **Source-level guard test** (static shape) | **Accepted**, at genuinely zero added wall clock — **but only as a new `describe` inside the existing suite** | The Jest gate (`tests.yml`, shards 1-3 plus a verdict job) is deliberately sized to finish before `Build (next build)`, so it is not the critical path; a sub-second in-memory suite cannot extend it. A **new test file** would still cost one more Jest module-registry init, which is avoidable here |
| 3 | **Startup / module-load assertion** | **Rejected**, throwing *and* warn-only | Throwing fails **closed** on the path that serves production plugin refresh every five minutes — converting a naming mistake into an outage of the thing being protected — and Next.js evaluates module scope during `next build`, where no `GOOGLE_*` var exists, so it would turn an absent CI placeholder into a red required Build. Warn-only adds nothing: `replaceEnvVars` already logs exactly that warn and the incident proves nobody reads it |
| 4 | **Dedicated health/probe route** | **Rejected as a new route; accepted as a field on the existing one** | `GET /api/admin/environment` is already `requireAdmin`-gated, read-only and pure, so a diagnostic there inherits the gate instead of opening a new surface |

### What to build

1. **One new `EnvDiagnostic` code** — `google-oauth-client-mismatch` — declared in `lib/admin/environment-types.ts:73`, raised in `classifyEnvironment` alongside the Supabase pair check (`:441-460`) by comparing the `shown` text of `GOOGLE_CLIENT_ID` and `GMAIL_CLIENT_ID` for **equality** and both against `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` for **inequality**, and worded page-side at `app/admin/environment/environmentDisplay.ts:255`.
   **The verdict is derived from the two live values compared with each other — never from an expected client ID literal pinned in the repo.** That keeps the public-repo rule satisfied and the check immune to staleness, and it is a probe that can fail, which is what `env-change-protocol` requires.
2. **One catalogue wording pass** in `lib/admin/environment/catalogue.ts`: amend the four `role` strings so each says which GCP client it names and, for the sign-in var, that its secret is held in the **Supabase dashboard and must not be rotated with the others** — the fact that was missing on 2026-11-02. Add a `docLink` to this requirement. Keep inside the existing one-or-two-plain-sentences rule. **Do not add a fifth entry or a parallel list**, which would create exactly the drift the guard exists to catch.
   If the two clients are to be labelled in tracked text, follow `lib/admin/environment/supabaseProjects.ts`: a sibling `googleOAuthClients.ts` with its `ReadonlyMap` shape and wording rule is in-pattern — **intended role only, never which deployment a client serves**.
3. **One `describe` block** inside `lib/admin/environment/__tests__/catalogueDrift.guard.test.ts` (the existing `environment catalogue drift guard (EC-3)` suite), reusing the `tree` its `beforeAll` already builds. `scanTree()` already walks every source file and every `lib/plugins/definitions/*.json` and already extracts `${NAME}` placeholders (`scanPluginDefinition`, line 220), so the assertions are pure in-memory comparisons over data already in hand: **no new file I/O, no new worker, no added wall clock.** Assert the static shape only — the allow-list of reader files per var, all seven `google-*-plugin-v2.json` interpolating the identical placeholder name, and no reader of `NEXT_PUBLIC_GOOGLE_CLIENT_ID` outside the two deprecated V1 files. Add negative controls in the existing `G3-2 ... (fixture text only)` style.
   One supporting change: `scanTree`'s `note()` (line 379) keeps only the *first* file per name, so retain a second `Map<string, string[]>` of all readers — still in-memory, still inside the existing 15 s `beforeAll` budget. **Do not re-pin** `plugin-manager-v2.ts`: `PINNED_SITES` (line 330) and assertion `G3-1e` (line 455) already pin that file's computed read and the `${...}` regex.

### SA's preferred variant, and this requirement adopts it

> `NEXT_PUBLIC_GOOGLE_CLIENT_ID` has only two readers, both in `lib/plugins/strategies/`, which CLAUDE.md § Deprecated forbids extending. **Delete those two readers and the catalogue entry, and the existing guard enforces the rule with no new code at all** — `G3-1a` fails the moment any file reads an uncatalogued name. Guarding a variable you should be removing is the weaker of the two.

Section 7 step 4 already performs that deletion, so **item 3 above shrinks to the two remaining assertions** (identical placeholder across the seven definitions; reader allow-list for the three surviving vars) once step 4 lands. Sequencing step 4 before step 5 is therefore not just tidy — it removes guard code that would otherwise have to be written and maintained.

**Nothing in the accepted set is a new pattern.** Every rejected item above is flagged as one. No new CI check, no new route, no new panel, no startup assertion, and no added CI wall clock.

---

## 9. Adjacent findings — each needs its own task

Found while investigating, **out of scope here**, recorded so they are not lost. None is fixed by this requirement.

| # | Finding | Evidence | Why not here |
|---|---|---|---|
| **AF-1** | **`/oauth/token` is an unauthenticated connection-write.** No session check; `plugin_key` and `user_id` come from the caller-supplied `state` JSON; it exchanges the code and writes via `pluginConnectionRepository.upsert`. Same class as the known `x-user-id` / body-`userId` IDOR sweep | `app/oauth/token/route.ts`, `gmailPluginStrategy.ts` `handleOAuthCallback` | A security fix with its own blast radius. Section 7 step 4 removes the route, but the gap must be tracked independently in case that step slips |
| **AF-2** | **14 leaked Google user tokens are still live.** Alerts #1-4 and #8-17 are refresh and access tokens in `dev.log`; refresh tokens do not expire on their own. Section 4 shows S0.4 probably does **not** revoke them | GitHub secret scanning; `docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md` §1.3 | This is S0.9, which already exists. Section 7 step 3 feeds it the corrected mechanism |
| **AF-3** | **Nothing stops the next `dev.log` being committed.** `.gitignore` on `origin/main` has no `log` entry; `dev.log` was untracked after the fact but stays in public history | `.gitignore` at `origin/main` | A one-line change, but it belongs to the leak workstream, not to OAuth client naming. Cheapest guard in this whole document |
| **AF-4** | **`app/api/contact/route.ts` is an unauthenticated open mail relay** with no Zod validation and no rate limit, and no callers. It is one of `GMAIL_CLIENT_ID`'s two consumers, which is the only reason it appears here | `app/api/contact/route.ts:61` | Explicitly out of scope; has its own task. Recorded only as a consumer of the variable |
| **AF-5** | **Secrets are stored as `Config`, not `Sensitive`, in Vercel** — per the private doc only 11 of 68 are Hidden/Secret, so `GOOGLE_CLIENT_SECRET` among others is readable by anyone with team access | `docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md` §1.7 | Already noted there as a new S7 task. Relevant because section 7 step 2 rewrites two of those values |
| **AF-6** | **V1 token refresh has never worked.** `pluginRegistry.ts:192` and `:315` wire `refreshToken` to members that do not exist on `gmailPluginStrategy.ts` / `googleDrivePluginStrategy.ts` (each has only `connect` and `handleOAuthCallback`), so both fields are `undefined` and `PluginCoordinator.ts:331`'s `if (isExpired && strategy.refreshToken)` branch is unreachable. Any V1-path Google call with an expired access token fails with no refresh attempted | `pluginRegistry.ts:192,315`; `gmailPluginStrategy.ts` (ends `:299`); `PluginCoordinator.ts:331` | A silent failure class independent of this stream. G-5 uses its existence as free evidence that the V1 data path is cold; if that path were live this would be a standing production fault |

---

## 10. Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| **AC-1** | Both Google clients are renamed per section 5, and a screenshot or console read confirms the new names | DO, read-only in the GCP console |
| **AC-2** | S0.4 is complete on `60n3cm` only: new secret live in both `GOOGLE_CLIENT_SECRET` and `GMAIL_CLIENT_SECRET`, old secret deleted, `mhcc99u2` untouched | `env-change-protocol`: a probe that can fail, run against the exact deployment, after it is READY |
| **AC-3** | Google plugin token refresh succeeds after the rotation — no `invalid_client` on the five-minute cron for one full hour | Vercel runtime logs for the cron path |
| **AC-4** | Sign-in still works end to end, in a private window, after AC-2 | Manual, user or DO |
| **AC-5** | The §1.3 refresh-token claim is confirmed or corrected in writing, and S0.9's method follows the answer | DO, against Google's documentation |
| **AC-6** | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` has no readers in the tree, no catalogue entry, and no Vercel entry — in that order | `catalogueDrift.guard.test.ts` `G3-1a` goes red if a reader survives; DO confirms the Vercel deletion last |
| **AC-7** | The `google-oauth-client-mismatch` diagnostic is live on `/admin/environment` and **demonstrably fails**: shown to go red against a deliberately mismatched pair before being trusted green | Dev, with a unit case; a check that cannot fail is not a check |
| **AC-8** | The guard adds **no** measurable CI wall clock: the Jest gate's duration is unchanged within noise and `Build (next build)` remains the critical path | Compare gate job durations before and after on the same PR |
| **AC-9** | No client secret value appears in this document, in any commit message, in any log line or in any chat transcript produced by this work | Review before merge |

---

## 11. Open questions

| # | Question | Needs |
|---|---|---|
| **Q-1** | Who are the **3 non-admin accounts** among the 5 holding active Google connections — internal test accounts or real early users? Decides whether a reconnect window needs real comms | User or DO. Identities deliberately not pulled during this investigation |
| **Q-2** | Does deleting a Google client secret revoke refresh tokens issued under that client? Section 4 argues no; the private doc §1.3 asserts yes. **S0.9's method depends on the answer** | DO, against Google's own documentation |
| **Q-3** | Are `GOOGLE_CLIENT_ID`, `GMAIL_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GMAIL_CLIENT_SECRET` all present in Vercel, and on which targets? **22 of 70 key names came back truncated**, so this investigation could not confirm it | DO, from the dashboard or `vercel env ls` |
| **Q-4** | Does `GET /oauth/google-mail/start` really return 500 on the deployed non-prod host, as F-2 concludes statically? | DO, one GET that writes nothing |
| **Q-5** | Which production redirect URIs are registered on `60n3cm` today? Needed before Option B so the new client is created with the full set | DO, read-only in the GCP console |

---

## 12. Retiring V1 and consolidating the parameters

> **Evidence ref for this section:** `origin/main@e97e40a3`. Sections 1-11 were written against `7c0b328b`; every path cited in either is byte-identical between the two, confirmed by `git diff --stat`.

The V1 layer is **not one thing**, and that is the whole reason this is a plan rather than a delete. `pluginRegistry` hangs three different kinds of member off three plugin keys — `google-mail` (`pluginRegistry.ts:73`), `google-drive` (`:195`) and `chatgpt-research` (`:318`), with the object closing at `:441` — and the three kinds have three different liveness answers.

> **There is no `slack` entry.** `slack` appears only in the unrelated `PLUGIN_VERSION_MAP` at `pluginRegistry.ts:617`, and `slackStrategy` is imported at `:16` and never used — the same dead-import shape as `universalPlugins` at `:11`.

| V1 surface | Members | Live? | Evidence |
|---|---|---|---|
| **OAuth halves** | `connect`, `handleOAuthCallback` | **Dead** | Only reachable from `app/oauth/[plugin]/start/route.ts:14` — which throws before it can redirect, because `connect()`'s Promise executor calls bare `window.addEventListener` (`gmailPluginStrategy.ts` ~98) — and from `app/oauth/token/route.ts:41`, which has **zero in-repo callers** and no session check |
| **Data halves** | `run`, `fetchContext` | **LIVE** | `PluginCoordinator.ts:34` ← `runAgentWithContext` (`lib/utils/runAgentWithContext.ts:12`) ← `/api/run-agent:967`, `/api/agent-stream:258`, `/api/cron/process-queue:276`, `/api/agent-chains/run:69` |
| **Data halves** | `refreshToken` | **WIRED TO `undefined`** | See the callout below — this is a finding, not a classification |
| **Metadata** | `capabilities`, `inputTemplates`, `outputTemplates`, labels | **LIVE** | `app/api/generate-agent/route.ts:43,438,472`, `lib/outputInference.ts:2`, `lib/utils/interpolatePrompt.ts:33`, `app/api/plugin-connections/disconnect/route.ts:43` |

So the first slice is free and the last one needs a measurement before it can be sized.

> **V1 token refresh has never worked.** `pluginRegistry.ts:192` sets `refreshToken: gmailOAuthStrategy.refreshToken` and `:315` sets `refreshToken: googleDriveOAuthStrategy.refreshToken` — but **neither strategy has that member.** `gmailPluginStrategy.ts` contains exactly `connect` (`:15`) and `handleOAuthCallback` (`:135`) and ends at `:299`; `googleDrivePluginStrategy.ts` is identical in shape (`:15`, `:133`, ends `:314`). Both registry fields therefore evaluate to `undefined`, and `PluginCoordinator.ts:331` guards with `if (isExpired && strategy.refreshToken)`, so **the refresh branch is unreachable**. Any V1-path Google call with an expired access token fails and no refresh is attempted. Recorded as **AF-6**, and see G-5 — if the V1 data path were in live use this would be a standing production fault, and its absence from the incident record is free evidence that the path is cold.

> **The only live V1 read of `GOOGLE_CLIENT_ID` is `gmailDataStrategy.ts:566,577-578`.** An earlier draft of this section attributed the read to a `refreshToken` on the two OAuth strategies at `gmailPluginStrategy.ts:185` and `googleDrivePluginStrategy.ts:183`. Those lines are real but they sit **inside `handleOAuthCallback`** — the authorization-code exchange, which G-2 deletes. Section 2's "token-exchange and refresh paths" wording carries the same error.

> **`app/oauth/callback/[plugin]/route.ts` is V2 and must be kept.** It imports `PluginManagerV2` and `UserPluginConnections`, not `pluginRegistry`. It is the live callback for every V2 plugin. The V1 strategies redirect *into* it, which is why they look half-wired from the V1 side. Deleting it would break every plugin connect in the product.

### Why nothing in our own code gets renamed

**The decisive reason is that a rename buys nothing.** Once the dead `NEXT_PUBLIC_` twin is gone, `GOOGLE_*` is the plugin client, `GMAIL_*` is system email and `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` is sign-in — one reader each, all accurate. A rename would cost seven definition files, two readers, a catalogue entry and a Vercel change, and return zero clarity. It should not be done even if it were free.

It is also not free, and the hazard is why a *casual* rename is dangerous rather than merely pointless. `plugin-manager-v2.ts` substitutes an unset variable with the **literal `${GOOGLE_CLIENT_ID}` text** and only logs `logger.warn`. Land a rename before the Vercel variable exists and all seven Google plugins ship that literal to Google as the `client_id` → `invalid_client` on the five-minute refresh cron. Invisible in review, delayed past the deploy.

A safe sequence does exist (add the new variable at the same value → deploy the code in one commit → delete the old variable after a clean refresh cycle), and `/admin/environment` already prints a catalogued `identifier` in full, so the new name is verifiable before any code moves. It is documented here only so nobody re-derives it as a reason to proceed. A *fallback-during-transition* variant is **rejected**: the definition JSON has one placeholder per field and `replaceEnvVars` has no fallback syntax, so it would mean changing `plugin-manager-v2.ts` — the one file `catalogueDrift`'s `PINNED_SITES` (`:323`) and `G3-1e` (`:459`) deliberately pin.

**This also holds after the environment split.** Vercel per-environment scoping gives one *name* different *values* per target, so `GOOGLE_CLIENT_ID` remains the right name once Workstream E lands. A second name such as `GOOGLE_CLIENT_ID_PROD` is the anti-pattern.

**The general rule, and what the guard does *not* cover:** this hazard applies to any `${VAR}` placeholder rename in `lib/plugins/definitions/*.json`. `catalogueDrift`'s `G3-1a` fails on an *uncatalogued* name, but a rename where **both** old and new names are catalogued passes green while production ships a literal placeholder. The existing guard does not protect this.

**What is misnamed is on Google's side, not ours** — and renaming a client's display name in the Console costs no deploy, no reconnect and no code. That asymmetry is why G-1 comes first and why there is no rename slice at all.

`NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` is the naming precedent to copy: one accessor, a literal `process.env` read, and a comment (`googleSignInConfig.ts:13-21`) that states outright why it must **not** fall back to the plugin variable. That comment is the authoritative in-repo statement of the topology — see section 5.

### The slices

| # | Slice | Depends on | Cost | What it closes |
|---|---|---|---|---|
| **G-1** | Rename both clients in the Google Console | the client-role question being settled | No code, no deploy, no reconnect | The root cause: the names stop lying |
| **G-2** | Delete the dead V1 OAuth surface, the dead `lib/plugins/v2/` tree, and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`'s last readers | — | **One PR touching four guard suites** | AF-1, R4 for this route, F-1's dead tree, F-2's variable |
| **G-3** | Remove `NEXT_PUBLIC_GOOGLE_CLIENT_ID` from Vercel | G-2 deployed | `env-change-protocol` | The fourth variable |
| **G-4** | The `EnvDiagnostic` pair-check + catalogue wording pass | G-3 | One PR, zero added CI time | The guard the incident wanted |
| **G-5** | One read-only count of agents referencing a V1 key | — | No code | Decides G-6's size |
| **G-6** | Retire the rest of V1 | G-5's answer | Sized by G-5 | `pluginRegistry` and `lib/plugins/strategies/` |

G-1's target strings are **not** given here: section 5's wording governs, because an environment word in a client name is false while `GOOGLE_CLIENT_ID` is scoped All Environments — every environment reads the same variable and therefore the same client. The environment slot is earned when the variable is scoped, not before.

### G-2 — the change set

G-2 is **one PR by necessity, not by preference**: it reddens four guard suites, and splitting it would leave the gate red between halves.

| Action | Path | Note |
|---|---|---|
| Delete | `app/oauth/[plugin]/start/route.ts` + its `[plugin]` directory | Returns 500 today (pending Q-4) |
| Delete | `app/oauth/token/route.ts` + its `token` directory | Unauthenticated `pluginConnectionRepository.upsert` driven by a caller-supplied `state` — AF-1 |
| **Keep** | `app/oauth/callback/[plugin]/route.ts` | V2, live |
| **Delete the files** | `lib/plugins/strategies/gmailPluginStrategy.ts`, `googleDrivePluginStrategy.ts` | Each contains **only** `connect` and `handleOAuthCallback`, so removing both members empties the file. These are the only two readers of `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (`:42` in each). Do **not** try to keep a `refreshToken` — there isn't one |
| Edit | `lib/plugins/strategies/googleDriveDataStrategy.ts:14-27` | Delete its `connect` / `handleOAuthCallback` **dynamic-import delegates**. Because they are `await import(...)`, deleting the strategy files does **not** fail the build — it fails at call time. That is the same delayed-failure class this section uses against renaming, so it cannot be left out |
| Edit | `lib/plugins/pluginRegistry.ts` | Drop dead/obsolete imports at **`:11`** (`universalPlugins`), **`:14`** (`gmailOAuthStrategy`), **`:15`** (`googleDriveOAuthStrategy`) and **`:16`** (`slackStrategy`, already unused today). Drop the `connect` / `handleOAuthCallback` / `refreshToken` members from the `google-mail` (`:190-192`) and `google-drive` (`:313-315`) entries — `chatgpt-research` has only `run` (`:440`). Drop the `connect?` / `handleOAuthCallback?` interface members (`:65-66`), and decide `refreshToken?` (`:67`) explicitly: it will have no implementer, so either it goes with `PluginCoordinator.ts:331`'s branch or both stay and the dead wiring is documented |
| Edit | `lib/admin/environment/catalogue.ts:259` | Remove the `NEXT_PUBLIC_GOOGLE_CLIENT_ID` entry. Its description — "built into the browser bundle" — is wrong anyway: no `'use client'` module imports the registry, so the value never reaches the browser (F-2). **This must be in the same commit as the reader deletions** — see the `catalogueDrift` pincer below |

**`lib/plugins/v2/` has seven files, and each needs an explicit decision** — the choice changes which guard breaks and how:

| File | Reader | Decision |
|---|---|---|
| `registry.ts` | `pluginRegistry.ts:11` only (dead import) | Delete |
| `core/UniversalPlugin.ts` | `registry.ts` only | Delete |
| `core/UniversalOAuthHandler.ts` | `UniversalPlugin.ts` only | Delete — but it is pinned by two guards, below |
| `core/UniversalAPIClient.ts` | `UniversalPlugin.ts:5,37` only | Delete |
| `types.ts` | within the tree only | Delete |
| `configs/google-drive.json` | nothing (F-1) | Delete |
| `configs/dropbox.json` | nothing; declares no `*EnvVar` field | **Decide explicitly.** It is the only reason `catalogueDrift`'s `configFiles >= 1` floor passes |

**Three test files must be explicitly PRESERVED**, because the instinct on a "retire the variable" PR is to delete them: `app/api/public/invites/signup/__tests__/routes.test.ts:297,304,337`; `app/invite/__tests__/page.render.test.tsx:96,128,580`; `lib/business-os/invites/__tests__/googleIdToken.test.ts:269,273,282`. They set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to a decoy and assert sign-in never falls back to it. They are the only **executable** proof of the rule `googleSignInConfig.ts:13-21` states in prose, and the drift guard skips `__tests__` so they are unaffected by G-2. That proof must outlive the variable.

### G-2 — the four existing guard suites it must update

No new suite, so **no added CI wall clock** — confirmed: G-2 adds no Jest file and is net-deleting, so every scan floor stays satisfied. But it is **four** suites, not two, and the two easily missed ones are the ones that go red.

| Suite | Change | Why it is not optional |
|---|---|---|
| `app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts` | Move `app/oauth/token/route.ts` out of the *"the sibling routes that were NOT deleted are still present"* assertion (`:141`) and into `REMOVED_FILES` and `REMOVED_DIRS`. Same for `app/oauth/[plugin]/start`. Update the header comment: R4 is now closed **for this route**, and still open for `app/oauth/callback/[plugin]`, which keeps parsing an unsigned `state`. **Do NOT add a `FORBIDDEN_LITERALS` entry** | `:141` currently **requires** the file to exist, so G-2 turns the suite red until it is updated. It also records a deliberate 2026-09-21 decision not to delete the route — reversing that has to be written down where the decision lives. On the literals: `walk()` skips only `node_modules, .next, .git, dist, build, coverage` — **not `__tests__`** — and `app/api/plugins/available/__tests__/route.test.ts:61-62` contains `https://connect.stripe.com/oauth/token`, so a `/oauth/token` literal is an instant false positive. Both routes have zero in-repo callers, so there is no literal to defend against |
| `lib/admin/environment/__tests__/catalogueDrift.guard.test.ts` | Four separate breakages, below | **This is the suite section 8 relies on to enforce the variable's absence "with no new code".** Breaking it silently would void that ruling |
| `lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts` | Remove the `ALLOWED_FILES` entry at `:41` for `lib/plugins/v2/core/UniversalOAuthHandler.ts` | The test *"the allow-list only shrinks: every entry still makes the call"* starts `if (!files.includes(f)) return true;`, so deleting the file makes the entry **stale → red**. The suite's own comment says to remove it in the PR that removed the call. That entry's rationale also repeats the **false premise** F-1 corrected — "plugins/v2/registry imported nowhere" — so F-1's correction covers **three** places, the third being shipped test text |
| `lib/utils/__tests__/oneAddressPolicy.guard.test.ts` | Prune **all three** deleted files from `OAUTH_FILES` (`:79-80` and `:82`) | The condition an earlier draft attached ("only if deleting `connect()` removes every `oauth/callback` line") resolves to **yes unconditionally**, because the whole files go. `:82` lists `UniversalOAuthHandler.ts`, which G-2 also deletes. The list is an exemption set, used without an existence assertion, so a stale entry will not redden the suite — it will quietly let a real loopback fallback through later. Its own comment: "shrinks only on purpose" |

**The four `catalogueDrift` breakages:**

| Break | Where | What happens |
|---|---|---|
| **Suite-level crash** | `scanTree()` → `jsonIn(PLUGIN_CONFIGS_DIR)` → unguarded `fs.readdirSync` at `:395`, with `PLUGIN_CONFIGS_DIR = 'lib/plugins/v2/configs'` (`:44`) | Delete the directory and this throws ENOENT. **The entire suite errors** — not one red assertion, the whole file |
| `G3-1d` floor | `expect(tree.configFiles).toBeGreaterThanOrEqual(1)` (`:452`) | Passes today only because `dropbox.json` exists. Delete both configs → 0 → red |
| `G3-1e` | `:459` hard-asserts `readRepoFile('lib/plugins/v2/core/UniversalOAuthHandler.ts')` matches both `clientIdEnvVar` and `clientSecretEnvVar` reads | File deleted → `readRepoFile` returns `null` → asserts against `''` → red |
| `G3-1f` | `PINNED_SITES` contains that file at `:323`; the assertion fails on `vanishedSites` | Red |

Two things to state in the PR body. First, **`G3-1b`** ("every catalogue entry is read by code") versus **`G3-1a`** ("every read is catalogued") form a pincer: the `catalogue.ts:259` deletion and the reader deletions **must be one commit**, or the guard goes red from one side or the other. That is the real hard ordering constraint — stronger than the "readers first, variable last" convention, which for a build-time-inlined `NEXT_PUBLIC_` variable is discipline rather than necessity. Second, deleting `configs/google-drive.json` retires the `*EnvVar` branch of `scanPluginConfig` (`:229`) and one of the guard's two JSON read paths. That is a deliberate reduction of guard surface and belongs recorded as a decision, in the same spirit this section demands for the R4 reversal.

**Also required by CLAUDE.md § Logging.** Two files G-2 touches and **keeps** are non-compliant: `googleDriveDataStrategy.ts` (**2** `console.*`) and `pluginRegistry.ts` (**3**, including a commented-out `console.log` block at ~`:619` that is also dead code). The rule requires naming the file and the count and proposing conversion. Proposal: flag both counts and leave them non-compliant **only** on an explicit user decision tied to G-6 deleting them, recorded in the workplan. The three deleted files (`gmailPluginStrategy.ts` 26, `googleDrivePluginStrategy.ts` 28, `app/oauth/token/route.ts` 1) need no action. `gmailDataStrategy.ts` (25) is untouched by G-2.

**Pre-existing type errors G-2 must take a position on**, or the Dev is blocked at ship-drill step 1: `PluginStrategy` is imported as a type from `../pluginRegistry` by four strategy files, but `pluginRegistry.ts` exports only `InputTemplate`, `OutputTemplate` and `PluginDefinition` — **there is no `PluginStrategy` export**. G-2 deletes two of the four importers; `googleDriveDataStrategy.ts:7` and `chatgptResearchStrategy.ts:7` remain and will still error. Separately, `app/oauth/[plugin]/start/route.ts:43` calls `strategy.connect({ supabase, popup })` against a signature requiring `userId`, and `app/oauth/token/route.ts:41-46` calls the optional `handleOAuthCallback` with no guard — both deleted by G-2. State up front whether G-2 fixes the two survivors or records them as pre-existing.

### G-5 — one query, and why G-6 waits for it

`PluginCoordinator` sits on the live legacy run path, so `pluginRegistry` cannot be deleted on a code read alone. G-5 is **one read-only count: how many agents reference `google-mail`, `google-drive` or `chatgpt-research`** — the three keys the V1 registry defines.

An earlier draft also proposed counting executions by path over a recent window. **Dropped — it decides nothing.** If zero agents reference the keys, zero executions can route there, and the config count proves it without a telemetry dependency or a window to argue about. If agents do reference them, the data halves stay **regardless** of recent counts, because a dormant agent that fires next month carries the same risk as one that fired yesterday.

Two free inputs narrow it further: `pluginRegistry['slack']` does not exist, so a slack-keyed V1 agent already cannot execute; and `refreshToken` is `undefined` for every entry (AF-6), so any V1-path agent whose Google token expired already fails with no refresh attempted. Worth one extra line in G-5: check whether `/api/generate-agent` still has any caller, because if it does not — and all three live callers in the tree use `-v4` (`app/v2/agents/new/page.tsx:1416`, `app/test-plugins-v2/page.tsx:2100`, `components/agent-creation/SmartAgentBuilder/hooks/useAgentGeneration.ts:83`) — then **no new agent can be created with a V1 key** and the count is a one-shot fact rather than a recurring one. If it has no caller at all it goes with the registry in G-6 rather than being migrated.

- **Zero** → G-6 deletes `pluginRegistry.ts`, `lib/plugins/strategies/`, `PluginCoordinator.ts` and `runAgentWithContext`'s use of it in one PR, and `GOOGLE_CLIENT_ID`'s only readers become the seven V2 definitions. That is the end state this requirement is named for.
- **Non-zero** → the data halves stay. G-6 shrinks to migrating the four metadata consumers onto `PluginManagerV2`.

### The environment split costs nothing if it runs the other way

Section 6's Option B creates a **new** client for production and moves `GOOGLE_CLIENT_ID` to it — 19 reconnects across 5 people. **Run it in the opposite direction and the price is zero:** production keeps the client that already holds the 19 grants, and the **new** client serves non-production and localhost. Google allows `http://localhost:*` redirect URIs on an ordinary web client, so non-prod and localhost share one client — three environments, two plugin clients.

Three supporting facts:

- Creating the non-production client is free **and does not wait on Workstream E**, because nothing points at it until a per-environment variable exists. A client created inside an existing project inherits the project's verification state, so this is not gated on the verified-app review; section 6's "why B is deferred" conflates client creation with project verification.
- Removing the localhost redirect URIs from the production client (they are there today — it *was* built as a local-dev client) **does not invalidate refresh tokens**: a refresh token binds to the client ID, and the redirect URI only matters during the authorization-code exchange. That hygiene step is also free. Q-5's inventory of current redirect URIs is its prerequisite.
- What genuinely **is** gated on Workstream E: per-environment Vercel scoping of `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, which needs a real Preview environment with a stable hostname.

**The one remaining reason to pay the 19 reconnects** is a decision that production must run on a client whose secret was never exposed. S0.4 rotates the leaked secret regardless, after which the client is clean. That is a judgement call and it must be **put to the owner explicitly** — "19 reconnects across 5 people, 2 of them platform admins, in exchange for a clean-provenance production credential: yes or no?" — not smuggled in as a side effect of Option B's direction. So the reconnects are **avoidable**, not merely deferrable, and section 6 needs updating to say so.

### What this plan deliberately does not do

- **No fix to `app/api/contact/route.ts`.** It is the second consumer of `GMAIL_CLIENT_ID` and an unauthenticated mail relay. Recorded as AF-4; it has its own task.
- **No change to `app/oauth/callback/[plugin]/route.ts`.** Its unsigned-`state` parsing is R4 and belongs to the identity-hardening workplan, not here.
- **No service account for system email.** Domain-wide delegation requires Google Workspace, so if `GMAIL_USER` is a consumer `@gmail.com` mailbox it is unavailable. DO must confirm the mailbox domain before anyone proposes it. The better direction is retiring the Gmail transport entirely — Resend is transport #1 and Gmail only #3 — which would remove a client, two variables, a long-lived grant and the credential-minting script that **is** the leak blob of alerts #5 and #6. Note the shape of that leak: the *system-email* tooling leaked the *plugin* client's secret. Sharing one client across two purposes has already caused a cross-purpose credential leak, which is the most concrete argument in this document for keeping three roles on three credentials.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-03 | Created | Investigation of the 2026-11-02 rotation outage. Five findings (F-1..F-5) with `origin/main@7c0b328b` evidence; reconnect cost measured live at 19 connections across 5 people (not 20 users); target state as one row per purpose; three options with Option C rejected and Option B deferred to Workstream E; five adjacent findings; nine acceptance criteria; five open questions |
| 2026-11-03 | SA ruling on the guard | Section 8. CI value-check **rejected** (CI holds no Google values; a placeholder-vs-placeholder check would be green while production is broken), Actions-secrets variant rejected as a new pattern, startup assertion rejected (fails closed on the five-minute refresh path; module scope runs during `next build`), new route and new panel rejected as redundant — `/admin/environment` already prints all four IDs in full. Accepted: one `EnvDiagnostic` mirroring `supabase-url-mismatch`, one catalogue wording pass with a `docLink`, one `describe` inside the existing `catalogueDrift.guard.test.ts`. SA's preferred variant — delete `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and its two deprecated readers so the **existing** guard enforces the rule with no new code — adopted, and section 7 sequenced to deliver it |
| 2026-11-03 | V1 retirement plan | Section 12. Split the V1 layer by liveness: the OAuth halves are dead, the data halves are LIVE via `PluginCoordinator` on the legacy `runAgentWithContext` run path, and the metadata has four live consumers — so `pluginRegistry` cannot be deleted on a code read alone. Six slices G-1..G-6. **No variable is renamed in our code**: `plugin-manager-v2.ts` substitutes an unset variable with the literal `${GOOGLE_CLIENT_ID}` text, so a rename landing before the Vercel variable exists reproduces the incident; the only rename worth doing is the Google-side display name (G-1). G-2 must update two existing guard suites, one of which currently asserts `app/oauth/token/route.ts` **exists**. `app/oauth/callback/[plugin]/route.ts` is V2 and is kept |
| 2026-11-03 | SA review of section 12 — APPROVE WITH CHANGES, all 12 mandatory items applied | SA found two evidence errors that made a G-2 instruction unexecutable, both independently verified and corrected here: the two Google OAuth strategies have **no `refreshToken` member** (so G-2 deletes the files rather than editing them, the live `GOOGLE_CLIENT_ID` read is `gmailDataStrategy.ts:566,577-578`, and the registry's refresh wiring is `undefined` — now AF-6), and the registry defines **three** keys not four with no `slack` entry. Guard-suite count corrected from two to **four**: `catalogueDrift.guard.test.ts` (four breakages, including an unguarded `readdirSync` that errors the whole suite) and `pluginConnectionsBrowserAccess.guard.test.ts:41` were both missed. The `FORBIDDEN_LITERALS` instruction was **dropped** — `/oauth/token` false-positives on a `connect.stripe.com/oauth/token` literal in a scanned test. Added: `googleDriveDataStrategy.ts:14-27` dynamic-import delegates, all seven `lib/plugins/v2/` files, three sign-in negative-control tests marked KEEP, the mandatory logging flag, the pre-existing-type-error position, and the `G3-1a`/`G3-1b` same-commit pincer as the real ordering constraint. G-5's execution-count half dropped as deciding nothing. **Option B's direction reversed: production keeps the grant-bearing client and the NEW client serves non-production, making the environment split cost zero reconnects instead of 19** — so the reconnects are avoidable, not deferrable, and section 6 needs updating. No-rename ruling affirmed but re-grounded on "a rename buys nothing" rather than on the hazard |
