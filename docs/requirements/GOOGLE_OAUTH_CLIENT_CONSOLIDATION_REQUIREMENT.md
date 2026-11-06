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
| `921980058947-mhcc99u2e8dq2bimroclqej00u5eltb6` | Role-named 2026-11-04 (was "AgentsPilot Web Client") | **Sign-in only.** Supabase Auth's Google provider. Verified live: `GET {SUPABASE_URL}/auth/v1/authorize?provider=google` returns 302 to `accounts.google.com` carrying this `client_id`, `redirect_uri=https://jgccgkyhpwirgknnceoh.supabase.co/auth/v1/callback`, scopes `email profile` | **Supabase dashboard** — not in our env |
| `921980058947-60n3cm2uso92kbn4n97a51gg4ufkc3pu` | Role-named 2026-11-04 (was "Local Dev Client") | **Production**, for every Google plugin OAuth and for the Gmail system-email transport | Vercel (`GOOGLE_CLIENT_SECRET`, `GMAIL_CLIENT_SECRET` — identical value, same client) |

The second row is the whole problem in one line: **the client named for local development is production's plugin client**, and it must already carry production redirect URIs, because all 19 active plugin connections were minted through it.

### Settled 2026-11-04 — the Console read

The redirect-URI check (Q-5) was run from screenshots of both clients. **It confirms section 1 exactly as written**, which matters because the roles had been reopened on 2026-11-03 when Barak read them the other way round. Neither of us could settle it from Vercel, whose API returns the Google variables truncated and ciphertexted.

| | `60n3cm` | `mhcc99u2` |
|---|---|---|
| **Authorised redirect URIs** | **18.** `http://localhost:3000/oauth/callback/google-{mail,drive,docs,calendar,sheets,analytics,business-profile}`, `http://localhost:8080`, **5 on production** `https://neuronforge-kohl.vercel.app/oauth/callback/google-{mail,docs,drive,sheets,calendar}`, 5 on `neuronforge-git-orchestrator-*` previews | **1.** `https://jgccgkyhpwirgknnceoh.supabase.co/auth/v1/callback` |
| **Authorised JavaScript origins** | **none** — a server-side code exchange needs none | `https://neuronforge-kohl.vercel.app` |
| **Created / last used** | 2025-07-14 / 2026-11-02 | 2025-11-05 / 2026-11-03 |
| **Client secrets** | **one**, created 2025-07-14, **never rotated** | **two, both enabled** — 2025-11-05 and 2026-11-02 |
| **Role** | **Plugins, every environment at once** | **Sign-in only** |

**The trap, written down so the next reader does not fall into it.** `60n3cm`'s list opens with seven `localhost:3000` entries, which reads as "local dev client" at a glance — and that is precisely the misreading that named it. Entries 7–16 are production and preview. **Count the non-localhost entries before concluding anything from a redirect list.**

Two consequences follow directly, and both are new:

1. **`60n3cm` serves localhost, previews and production on one client and one secret.** That single-client-for-all-environments shape is not merely untidy — it is the mechanism that let one rotation reach production on 2026-11-02. Section 6's environment split is the fix for it, and the direction matters (see Option B-reversed).
2. **`60n3cm`'s only secret dates from the day the client was created and has never been rotated**, on the client holding all 19 grants. The 2026-11-02 rotation did not touch it.

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

**The Google-side rename is the change that actually prevents the incident, and it is free.** No token, no connection and no variable is affected by a display-name change. **DONE 2026-11-04 (G-1):** Barak renamed both clients to role-based names — `60n3cm` to a plugins name and `mhcc99u2` to a sign-in name. The exact strings were not re-read from the Console afterwards, so AC-1's confirming read still owes. The names below are what this section proposed:

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

### Option B-reversed — what the Console read changes

Option B as tabled above creates a **new production** client and moves production onto it, which is what prices it at 19 reconnects. The Console read shows that is the expensive direction, and that the cheap one reaches the same end state:

| | Option B (as tabled) | **Option B-reversed** |
|---|---|---|
| New client serves | Production | **Localhost + previews** |
| Production runs on | the new client | **`60n3cm`, unchanged** |
| Reconnects | **19, across 5 accounts** | **0** |
| End state | prod and non-prod on separate clients | **identical** |
| Waits on Workstream E's verified app | yes | **no** — non-prod has no verification cap to clear |

The asymmetry is only that a refresh token binds to the `client_id` that issued it. Production already holds every grant, so **whichever environment keeps `60n3cm` pays nothing and the other pays everything**. Moving the cheap side is free; moving the expensive side costs 19 re-authorisations whenever it happens.

This does **not** make the Workstream E production client unnecessary — a verified app is still needed to clear the 100-user cap, and that is still the long pole. It makes the **blast-radius** half of the problem solvable now, independently, for nothing: once localhost and previews are off `60n3cm`, a developer's rotation can no longer reach production, which is the specific failure of 2026-11-02.

**Recommended:** take Option B-reversed as soon as Option A's cleanup lands, and leave the verified production client to Workstream E as before.

---

## 7. Recommendation

**Do Option A now. Defer Option B to Workstream E, and pay the reconnects once, there.**

Ordered, with the gate on each step:

1. ~~**Rename both Google clients** in the GCP console (section 5 table).~~ — **DONE 2026-11-04.** Zero cost, zero risk, and it was the step that would have prevented the incident.
2. **Finish S0.4 on `60n3cm` only** — add the new secret, update Vercel `GOOGLE_CLIENT_SECRET` **and** `GMAIL_CLIENT_SECRET` (identical value, same client), verify, then delete the old secret. Follow the `env-change-protocol` skill — one change at a time, with a probe that can fail.

   **Do it as disable, then delete (2026-11-06).** Google lets a secret be disabled before it is removed, and the two are not equivalent: a disable is reversible in one click, a delete is not, and the only consumer of this client is Supabase's hosted sign-in, which we cannot instrument. So disable the **2026-11-02** secret, sign in once to confirm, and delete only then — the `env-change-protocol` shape of one change at a time with a probe that can fail. <br><br>✅ **VERIFIED 2026-11-06, and the probe could have failed.** Barak disabled the **2026-11-02** secret and signed in. `auth.audit_log_entries` records, in order: `logout` at **15:40:32**, then `login` at **15:40:50** carrying `traits: {provider: "google"}`. Eighteen seconds after a logout, so it was a fresh authorization-code exchange, not a restored session — and that exchange is the one Supabase operation that presents the client secret. It succeeded while the **2026-11-02** secret was disabled, which proves Supabase holds the **2025-11-05** secret and that nothing uses the surplus secret. the **2026-11-02** secret is therefore safe to delete outright. <br><br>**A trap for the next reader: do not use `auth.identities.last_sign_in_at` for this.** It reads 2026-09-20 for `google` and 2026-10-23 for `email` on an account that signs in daily, because GoTrue does not update it per login. Taken at face value it says no Google sign-in has happened in seven weeks, which would have condemned a working credential. `auth.audit_log_entries` is the source of truth, and the provider is in `payload->'traits'->>'provider'`, not `payload->>'provider'` — that key is null on every row. The same read also closed the question of whether Vercel could be holding either value: it cannot, because the only Google secret any code reads is `GOOGLE_CLIENT_SECRET`, which pairs with the plugin client, while sign-in reads a client **id** only and Supabase keeps the matching secret itself.

   The Console read changed this step's shape. `mhcc99u2` now carries **two enabled secrets**, 2025-11-05 and 2026-11-02, because the rotation reached it. So "do not touch `mhcc99u2`" is no longer the whole instruction: it has a surplus secret to remove, and **which one is surplus is not known from the Console** — Supabase holds exactly one value in its own dashboard, and deleting the one it holds breaks sign-in for everyone. That is Q-6, and it must be answered from the Supabase side before either is deleted. Meanwhile `60n3cm`'s single 2025-07-14 secret has **never** been rotated, so S0.4 on it is still entirely owed — and Option B-reversed should land first, so that rotation is no longer a rotation that can reach production and localhost together.
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
| **AF-7** | **`fetchContext` was a third dead wiring, with no caller at all.** `pluginRegistry.ts:189` set `fetchContext: gmailDataStrategy.fetchContext`, but `gmailDataStrategy` has no such member and the deleted `gmailPluginStrategy` had none either, so the spread never supplied one. Nothing in `app/` or `lib/` calls `.fetchContext(` — the only two mentions were the interface declaration and the dead assignment. Found while implementing G-2, which removes both; it was the one real TypeScript error in a file G-2 edits | `pluginRegistry.ts:61,189` on `origin/main@4c389406`; `gmailDataStrategy.ts` | **Closed by G-2.** Recorded because it corrects this document: section 12's liveness table listed `fetchContext` as LIVE |
| **AF-8** | **Google Analytics and Google Business Profile cannot be connected in production — there is no redirect URI for them.** `60n3cm` registers exactly five production callbacks (`…/oauth/callback/google-{mail,docs,drive,sheets,calendar}`) but **seven** localhost ones: `google-analytics` and `google-business-profile` exist only on `http://localhost:3000`. Both plugins are shipped and live — `lib/plugins/definitions/google-analytics-plugin-v2.json` and `google-business-profile-plugin-v2.json` exist, and `lib/server/plugin-executer-v2.ts:78-79` dispatches to `GoogleAnalyticsPluginExecutor` and `GoogleBusinessProfilePluginExecutor`. So a production user who tries to connect either gets Google's `redirect_uri_mismatch` error page, and has since the plugins shipped. Found in the 2026-11-04 Console read, not by any code path: nothing in the repo can see a Google-side registration. <br><br>**What they are actually for, read 2026-11-06.** Neither is an agent-plugin curiosity: both are **Business OS Channel Insights** providers. `lib/business-os/channel-insights/providers.ts:63-81` maps `google_analytics` → `google-analytics` and `google_business_profile` → `google-business-profile`, and `hooks/useChannelConnect.ts:51-55` starts the OAuth by posting to **`/api/v2/plugins/connect`** — the same route whose line 73 builds `${NEXT_PUBLIC_APP_URL}/oauth/callback/<plugin_key>`. The surface is `ChannelsCard`, reached through `ChannelsOverviewCard` from `LiveDashboard`, which that component's own comment marks **unconditional** on `/business-os`. So the two weigh very differently: **`google-business-profile` is offered to every Business OS account** as the "Google listing" tile, and AF-8 breaks it outright; **`google-analytics` carries `offered: false`** in `ChannelsCard.tsx:93-107`, deliberately withdrawn and kept only so an account that connected one before can see, reconnect or disconnect it — and no production account can be in that position, because the URI has never existed there. <br><br>**Production evidence, 2026-11-06.** `plugin_connections` holds exactly one row for each of `google-analytics`, `google-business-profile` and `meta-insights`, all on the same **admin** account and all on 2026-08-26 within minutes — a developer's own test, necessarily from localhost or a preview, since production registers no URI for the two Google keys. `channel_connections` holds **only** `facebook_page`. So neither Google connection ever completed the second half (account discovery), and **no account has ever had a working Google channel connection**. AF-8 therefore blocks a *first* connection; it has not broken an existing one, and there is no data to preserve | Google Console, `60n3cm` redirect URIs 1–18; `lib/server/plugin-executer-v2.ts:78-79` | **Its own task, and not this requirement's.** The fix is two Console entries, which is a minute's work — but it is a live user-facing defect in two plugins, it needs confirming against the plugins' own `redirect_uri` construction before the URIs are guessed, and it wants a check that would have caught it. Do **not** bundle it into Option B-reversed, whose whole value is being a zero-reconnect no-op. <br><br>**Re-scoped 2026-11-06, and it is two steps rather than one.** The redirect URI is necessary but **not sufficient**: `app/api/business-os/channel-insights/connect/route.ts` documents the failure its own users hit — Google answering the account list with "My Business Account Management API has not been used in project 921980058947" — and the production evidence above says that is exactly where the 2026-08-26 test stopped, on localhost, where the redirect URI was already fine. So AF-8's task is (1) register the production callback for `google-business-profile`, then (2) confirm the My Business Account Management API is enabled **and its quota granted** on project `921980058947`, which is a separate Google-side approval. Priority follows the `offered` flag: **`google-business-profile` is the live defect**; the `google-analytics` entry is optional and may be left unregistered, matching a tile that is deliberately no longer offered |

---

## 10. Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| **AC-1** | ✅ **Substantially met 2026-11-04.** Both clients renamed to role-based names, and Console screenshots confirm the *roles* (§ 1). **Still owed:** a read of the two new name strings themselves, which were not captured | DO, read-only in the GCP console |
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
| **Q-5** | ✅ **ANSWERED 2026-11-04** (§ 1, Settled). Five: `https://neuronforge-kohl.vercel.app/oauth/callback/google-{mail,docs,drive,sheets,calendar}`. Note what is **absent** — no production URI for `google-analytics` or `google-business-profile`, though both have localhost entries, so those two plugins have never been connectable in production | Done |
| **Q-6** | ✅ **ANSWERED 2026-11-06.** Supabase's stored Google client secret matches the **2025-11-05** one — compared by its last four characters in the dashboard, which are deliberately not written down here — so that secret is the live one and the **2026-11-02** secret (the **2026-11-02** secret), created during the rotation, is the surplus. **It is safe to delete**, on two grounds: `mhcc99u2` registers exactly one redirect URI (the Supabase callback), so Supabase is its only consumer; and **no Vercel variable holds a sign-in secret at all** — the only Google secret any code reads is `GOOGLE_CLIENT_SECRET`, paired with `GOOGLE_CLIENT_ID`, and sign-in reads `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID`, a client **id**, because Supabase performs the code exchange and keeps that secret on its own side (`lib/business-os/invites/googleSignInConfig.ts`). <br><br>**The first version of this row argued it from "plugin OAuth works", which was an assumption, not a reading — Barak challenged it, and he was right to.** It is now measured. `refreshToken` in `lib/server/user-plugin-connections.ts` writes **nothing** on a failed refresh and calls `repository.upsert` on a successful one, which stamps `last_used` and `expires_at = now + expires_in`. Production shows three `google-calendar` rows and one `google-mail` row stamped on **2026-11-06** with `expires_at` exactly one hour after `last_used`. A refresh only returns a token to the `client_id` that issued the grant, presented with that client's secret — so the pair deployed in production today is `60n3cm`'s, and it is working. <br><br>**What Barak remembered, and what the Vercel metadata shows.** Two env vars were edited on **2026-11-02 at 21:55**, fourteen seconds apart, and **not touched since**; both were created in the 2025-09-19 batch and both target three environments. Their key names come back `...[truncated]` from the API, as 22 of the 70 do, so they cannot be named from here — but the shape is `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Read together with the refreshes above, the 21:55 edit was the **rollback itself**, not the breakage left in place: the incident and its revert were both on 2026-11-02, so "last edited that evening" is what a completed revert looks like. The remaining uncertainty is only the two names, which the dashboard shows and the API will not. It also confirms the 2026-11-02 **rollback reached the Supabase side**: the rotation's new value is not in use anywhere | Answered by the user from the Supabase dashboard's Google provider settings |

---

## 12. Retiring V1 and consolidating the parameters

> **Evidence ref for this section:** `origin/main@e97e40a3`. Sections 1-11 were written against `7c0b328b`; every path cited in either is byte-identical between the two, confirmed by `git diff --stat`.

The V1 layer is **not one thing**, and that is the whole reason this is a plan rather than a delete. `pluginRegistry` hangs three different kinds of member off three plugin keys — `google-mail` (`pluginRegistry.ts:73`), `google-drive` (`:195`) and `chatgpt-research` (`:318`), with the object closing at `:441` — and the three kinds have three different liveness answers.

> **There is no `slack` entry.** `slack` appears only in the unrelated `PLUGIN_VERSION_MAP` at `pluginRegistry.ts:617`, and `slackStrategy` is imported at `:16` and never used — the same dead-import shape as `universalPlugins` at `:11`.

| V1 surface | Members | Live? | Evidence |
|---|---|---|---|
| **OAuth halves** | `connect`, `handleOAuthCallback` | **Dead** | Only reachable from `app/oauth/[plugin]/start/route.ts:14` — which throws before it can redirect, because `connect()`'s Promise executor calls bare `window.addEventListener` (`gmailPluginStrategy.ts` ~98) — and from `app/oauth/token/route.ts:41`, which has **zero in-repo callers** and no session check |
| **Data halves** | `run` | **LIVE** | `PluginCoordinator.ts:34` ← `runAgentWithContext` (`lib/utils/runAgentWithContext.ts:12`) ← `/api/run-agent:967`, `/api/agent-stream:258`, `/api/cron/process-queue:276`, `/api/agent-chains/run:69` |
| **Data halves** | `refreshToken`, `fetchContext` | **WIRED TO `undefined`** | Neither resolves to a real member. See the callout below and AF-6 / AF-7 — findings, not classifications |
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

**Also required by CLAUDE.md § Logging — DECIDED 2026-11-04: CONVERT.** Three files G-2 touches and **keeps** were non-compliant: `gmailDataStrategy.ts` (**25** `console.*`), `pluginRegistry.ts` (**3** — two live calls plus a commented-out `console.log` block at `:620` before this change — `HEAD` numbering, verified — that is also dead code) and `googleDriveDataStrategy.ts` (**2**). Thirty matches, **29 live calls**. An earlier version of this paragraph said two files and five calls; that was wrong, because the static-import fix meant `gmailDataStrategy.ts` had to be touched after all. The author's proposal was to leave all three and let G-6 delete the files; **the user chose to convert them**, so the whole of each file is now on the Pino standard and the three files hold no `console.` token at all. The three deleted files (`gmailPluginStrategy.ts` 26, `googleDrivePluginStrategy.ts` 28, `app/oauth/token/route.ts` 1) need no action.

The conversion's own rules, so a reviewer can check it line by line rather than call by call:

| Rule | Why |
|---|---|
| One module logger per file — `createLogger({ module: 'plugins/<file>' })` from `@/lib/logger` | The server standard. `lib/logger/client.ts` would be wrong here: every route that reaches `pluginRegistry` is Node.js (`agent-stream`, `generate-agent-v2`, `generate-agent-v2-sdk` declare `runtime = 'nodejs'` explicitly; the rest default to it), none is `'use client'`, and **`PluginCoordinator.ts` — the direct caller — already imports `@/lib/logger`**, so Pino was in this module graph before the change. No new runtime dependency |
| Context first, message second; errors always `{ err }` | `docs/SYSTEM_LOGGING_GUIDELINES.md`. Every `console.error` became `logger.error({ err, … }, '…')`, so Pino's `err` serializer gets the stack instead of a stringified object |
| `info` for the operation's start, finish and counts; `debug` for per-item loop detail and variable dumps | The guidelines' own level table (`debug` = "Variable values, conditional branches, detailed flow") and its worked `logger.debug({ queryParams, filters }, …)` example. Message text is otherwise unchanged, so existing log searches still match |
| **User search text moved from `info` to `debug`** | `run()`'s entry log carried `inputVariables: input_variables` — the agent's own Gmail search terms — at a level production emits. It now rides only on the `processedInputs` line at `debug`, which carries the same object verbatim as `originalInputs`, and `lib/logger.ts` pins production to `info`. `searchQuery` was dropped from two `info` lines for the same reason: it is `processedInputs.query`, already on that `debug` line. **Nothing is lost at `debug`; one field stops reaching production logs** |
| `decodeBase64Url`'s invalid-input warning logs `typeof data`, not `data` | That parameter is raw attachment base64. The branch only fires when the value is falsy or not a string, so its type is the whole diagnostic and the value is pure leak surface |
| The dead commented-out block in `pluginRegistry.ts` was **deleted**, not converted | It is commented-out dead code, not a logging call. Deleting it is what makes a future `grep console\.` over these files come back empty |

**The two Google response bodies**, recorded so G-6 does not have to re-derive them. The **list-failure** site (`gmailDataStrategy.ts:81`) was on the LIVE `run` path at `error`, which production emits, so a Google 400 whose message quoted the rejected `q` parameter would have put the user's search text into production logs by a route the demotion above does not cover. SA's review named it, and it is **fixed rather than recorded**: the alertable facts (`userId`, `statusCode`, `statusText`) stay at `error` and the body moved to its own `debug` line beneath. The **token-refresh** site (`:619`) keeps its body at `error` on purpose — Google's token endpoint returns `{error, error_description}`, never echoes the secret, carries no owner text at all, and AF-6 proves the whole method unreachable. Either way the body is at least structured, which matters because `lib/logger/config.ts` has no `body` redact path and Pino cannot redact a message string. Beyond that one split, no log line was added or removed: this is a transport change, not a change to what the V1 path reports.

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
| 2026-11-03 | G-2 implemented | 21 files: 11 deleted (both V1 OAuth routes, both Google OAuth strategies, all seven `lib/plugins/v2/` files), 9 edited. Four guard suites updated as SA required; `FORBIDDEN_LITERALS` left alone. **Three things implementation found that review did not.** (1) `gmailDataStrategy.ts:7` had a **static** `import { gmailStrategy } from './gmailPluginStrategy'` spread into the object at `:29` — a hard build break that neither section 12 nor the SA review listed; fixed by dropping the spread and declaring `pluginKey`/`name` directly. (2) `fetchContext` was a third dead wiring with no caller — now AF-7, and it corrects the liveness table above. (3) `lib/agentkit/v6/intent/plugin-spec-loader.ts:106` lists `lib/plugins/v2/configs` as a spec path. Left alone, and the decisive reason is stronger than the `fs.existsSync` guard: **`loadSpecFromFile` has zero callers** — `generate-intent.ts:216` imports `loadPluginRegistryFromSpecs`, a different export — so the stale path sits inside a dead exported function and cannot run, not merely cannot throw. Editing a `lib/agentkit/v6/` file under rule 8 and the V6 Work Protocol for zero behavioural effect would be disproportionate. The follow-up is to **delete `loadSpecFromFile` whole** (it also carries a `console.error` at `:112`), not to patch one array entry — otherwise the path goes and the dead function stays. Verification: 24 suites / 556 tests pass, including all three sign-in negative-control suites and the three guards that run on Windows; **`tsc` introduces no new error, and strictly reduces them** — an earlier wording here claimed "no error in any file G-2 edits", which was wrong: the filter that produced it omitted `googleDriveDataStrategy.ts`, which carries four. All four are pre-existing and G-2 takes that file from **ten to four** — `TS2305` leaves `PluginStrategy` unresolved, so the object literal has no contextual signature and every destructured parameter becomes an implicit `any`; deleting `connect` and `handleOAuthCallback` removed six of those bindings. Position on the survivors (a mandatory item of the SA plan review): **recorded as pre-existing, not fixed here** — `PluginStrategy` has never been exported from `pluginRegistry.ts`, there were **five** importers of it (not four, as section 12 and the plan review said) and three survive (`googleDriveDataStrategy.ts:7`, `chatgptResearchStrategy.ts:7`, `slackPluginStrategy.ts:11`); they go with the files in G-6. `oneAddressPolicy.guard.test.ts` fails **locally only** — its `relative()` helper builds a forward-slash prefix that never matches a Windows backslash path, so no exemption resolves and even the resolver it excludes unconditionally shows up as an offender; pre-existing and Linux-CI-only |
| 2026-11-03 | SA code review of G-2 — APPROVE WITH CHANGES | **No defect in the deletions.** SA independently re-ran the suites (26/580 pass; one unrelated pre-existing failure in `lib/__tests__/supabaseFetch.test.ts`) and the typecheck, swept every `*.test.ts(x)` and `.github/` for the deleted basenames and confirmed **no suite or workflow was missed**, and verified the `G3-1a`/`G3-1b` same-commit pincer is satisfied. All three implementation findings upheld. **Rulings:** removing the `refreshToken` wiring rather than repointing it at the working `gmailDataStrategy.refreshToken:559` — CONFIRMED, because that branch also writes through `pluginConnectionRepository.updateRefreshedToken` (`PluginCoordinator.ts:338-343`), so repointing would switch on a token-refresh-plus-DB-write path that has never executed, inside a deletion PR. Carry-forward for G-6: do **not** read "refreshToken is dead" off the registry alone — `gmailDataStrategy.ts:559` is a real implementation, and unwiring it is a different decision from deleting it. The guard-surface reduction (deleting `configs/dropbox.json` and the whole `*EnvVar` scanner rather than keeping an orphan JSON to hold a floor above water) — ACCEPTABLE and preferred to the plan's instruction, conditional on correcting `docs/feature_flags.md:968` and naming the residual gap in the guard header; both done. Leaving the V6 spec path — CONFIRMED. The `oneAddressPolicy` Windows diagnosis — independently verified, with the stronger finding that the offender set is **exactly** the exemption set, which is positive evidence the suite goes green on Linux CI after the pruning. **Applied from the review:** F-3 (a fourth dead import, `slackDataStrategy`, knowingly left because removing it orphans the Slack V1 pair), F-4 `docs/feature_flags.md`, F-5 `.claude/skills/third-party-ops/google.md`, F-6 a dead link in `DASHBOARD_UI_NEW_V2_COMPLETE.md`, F-8 closing `FU-D6c-b` in the DevOps register, F-9 the file count, and the two ruling conditions. **F-1 (the mandatory logging flag) is the one blocking item and is with the user:** it is three surviving files and 30 calls, not two and five — `gmailDataStrategy.ts` (25) had to be touched after all, so section 12's "untouched by G-2" sentence was wrong |
| 2026-11-04 | F-1 decided — the three surviving files converted to Pino | The user chose **convert** over leaving them for G-6. **29 live `console.*` calls** replaced across `gmailDataStrategy.ts` (25), `pluginRegistry.ts` (2) and `googleDriveDataStrategy.ts` (2), plus the commented-out dead block in `pluginRegistry.ts` deleted: the three files now hold no `console.` token. Each file gets one `createLogger({ module })`; context first, message second; every error as `{ err }`. Levels follow the guidelines' own table — `info` for start/finish/counts, `debug` for loop detail and variable dumps — and the one behavioural consequence is deliberate: **the agent's Gmail search text no longer reaches production logs**, because it rode on an `info` line and now rides only on a `debug` line that carries the same object, with production pinned to `info`. The one route that could still have carried it — the list-failure `error` at `:81`, which logged Google's verbatim response body — was closed in the same change set once SA named it. `decodeBase64Url` logs `typeof data` instead of raw attachment base64. Verification: `tsc` total **unchanged by the conversion** at **1873** errors with **0** crash markers (so the count is real, not an OOM reading as clean) — that is F-1 measured against the already-staged G-2 tree, not against `main`; QA later measured the slice as a whole and found `4def6c34` is **1911**, so G-2 + F-1 together remove **38** errors and add none and the only diagnostics in the three files are `googleDriveDataStrategy.ts`'s four pre-existing ones, line-shifted; **15 of 16 suites and 264 of 265 tests pass**, including `PluginCoordinator.repository.test.ts` (the direct caller), all three `lib/logger/__tests__` redaction suites and **three of the four** G-2 guards — the fourth is the failure named next, so "all four pass" would contradict it. The single failure is `oneAddressPolicy.guard.test.ts`, still local-only, with the same five offenders that are exactly its exemption set — the Windows path bug, untouched by this change. No guard needed pruning: no repo-wide `console.*` allow-list names these files. Line endings preserved per file (`pluginRegistry.ts` LF, the other two CRLF), so the diff is 15/15, 67/42 and 6/2 rather than whole-file churn |
| 2026-11-04 | SA code review of the F-1 conversion — APPROVE | **No defect in the conversion.** SA re-ran everything rather than taking the numbers: `grep console\.` over the three files returns nothing (`HEAD` counts 25 / 3 / 2 confirmed, so 30 matches and 29 live calls is right); logger calls are gmail `info` 6 / `debug` 6 / `warn` 9 / `error` 4 = 25, registry 2, drive 2; `tsc` is **1873** errors with **0** crash markers and the only diagnostics in the three files are `googleDriveDataStrategy.ts`'s four pre-existing ones; a 16-suite / 265-test subset covering every suite the row names passes except `oneAddressPolicy.guard.test.ts`, whose five offenders are exactly its exemption set. Server logger confirmed correct independently: the only importers are four API routes, `PluginCoordinator`, `outputInference` and `interpolatePrompt`, none `'use client'`, none Edge; `createLogger` applies `loggerConfig.redact` and Pino's default `err` serializer, and no context key collides with a reserved field or a redact path. **Rulings.** J-1 (user search text demoted from `info` to `debug`) — **in scope and required**, not optional: `docs/SYSTEM_LOGGING_GUIDELINES.md` § Sensitive Data Redaction states the owner-text rule outright ("what a user typed is never logged at any level; text a model derived from it is logged at `debug` only"), so a conversion that re-emitted it at `info` would not have been compliant. Dropping `searchQuery` from two `info` lines is sound because the value is recoverable at `debug` on the `processedInputs` line, whose `originalInputs` is a verbatim spread. J-2 (`typeof data`, not `data`) — **in scope and correct**: the branch fires only when the value is falsy or not a string, so the type is the whole diagnostic and the value is raw attachment base64 at `warn`, a level production emits. J-3 (token-refresh body) — **acceptable to leave**, structured and on a method AF-6 proves unreachable; the review's own finding is that the same pattern exists at `:81` on the LIVE path, which is why section 12 now records both. **Three doc corrections applied by SA, no code touched:** the commented-block line reference (`:620` on `HEAD`, not `~:633`, which pointed at neither tree), "the four G-2 guards" pass (three — `oneAddressPolicy` is the fourth and is the failure), and the unqualified "search text no longer reaches production logs" claim. **Carry-forward to G-6, all pre-existing and deliberately not changed here:** mailbox-derived attachment filenames still ride `warn`/`error` lines (`:447`, `:490`, `:503`, `:516`, `:527`) that production emits, while the same field was demoted to `debug` on the success path; `status` is used where the guidelines' standard field name is `statusCode`; `:81` carries no `userId`; and `refreshToken`'s two `info` lines carry no context object |
| 2026-11-04 | Three of SA's F-1 findings applied | Not left for G-6, because all three sit on the LIVE `run` path in the file the conversion had just rewritten. (1) **The list-failure body leak at `:81`** — SA's J-3 finding, and the one that mattered: it logged Google's verbatim reply to a request whose `q` is the user's search text, at `error`, which production emits. Split so `error` keeps `userId`, `statusCode` and `statusText` and the body goes to a `debug` line, which is the same treatment every other owner-text-bearing field in the file already gets — so the search-text claim now holds without a caveat. SA offered `errorText.slice(0, 500)` as the proportionate move; that bounds log volume but would not have closed the leak, since a 400 quoting the rejected parameter lands well inside the first 500 characters. (2) **`userId` added to `:81`**, which SA called the least useful line in the file — a production error on the live path with no tenant context. (3) **`status` → `statusCode`** at all three sites, the guidelines' standard field name; `statusText` has no standard counterpart and keeps its name. Left for G-6 as SA ruled: the five mailbox-derived attachment filenames on `warn`/`error` lines (Low, pre-existing, and each one's `warn` would be left saying nothing without a second `debug` line beside it), and `refreshToken`'s two context-free `info` lines, which have no `userId` in scope to add. Also corrected here: the previous row said **20 of 21 suites / 285 of 286 tests**, which double-counted five suites across two `jest` invocations that overlapped. The true figure is **15 of 16 suites and 264 of 265 tests**, which is what SA independently measured and reported. Re-verified after these three edits: same 15 of 16 suites, and `tsc` unchanged |
| 2026-11-04 | QA pass on G-2 + F-1 — PASS, no defect | Full report appended as § 13. All five checks completed. **The full suite against a real baseline: 0 net new failures.** QA built a detached worktree at `4def6c34` rather than trusting a subset — 1998 suites on the staged tree (28 failed / 49541 tests passed), 25 of those 28 also fail on the baseline, and the 3 that differ are **load-dependent timeouts**, proved by re-running them isolated on the staged tree (3 passed, 218 tests) and by the fact that none of them imports anything in this change set; the staged run carries 54 `Exceeded timeout` markers overall. The dedup trap was real: **56 raw `FAIL` lines for 28 distinct suites**, exactly 2×. **No live caller of anything deleted**, over all tracked files plus `.github/`, `middleware.ts`, `next.config.js`, `vercel.json` and every `*.json`: every surviving match is a comment, a guard string, a third-party URL (`connect.stripe.com/oauth/token`, `api.notion.com/v1/oauth/token` — which is exactly why no `FORBIDDEN_LITERALS` entry was right) or a deliberate decoy (three suites set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to prove no fallback, and `catalogueDrift` skips `__tests__`, so removing the catalogue entry does not strand them). `app/oauth/` now holds exactly one file. **The surviving V1 `run` path was exercised, not read**: a `tsx` harness with a stubbed `fetch` and `LOG_LEVEL=debug` ran 8 scenarios, so all 26 converted calls fired — `pluginKey`/`name` byte-identical to the deleted strategy's, `connect`/`handleOAuthCallback` `undefined`, every return shape and thrown error unchanged, no `ReferenceError`, no swallowed `throw`. **Not covered, and worth knowing:** no browser check (Playwright is not installed and nothing here renders), no live Google OAuth exercise (the `fetch` seam was stubbed and `tests/jest-no-network.ts` blocks the alternative), and the Linux-CI conclusion for `oneAddressPolicy` is derived by re-computing the suite's logic with a working `relative()`, not from a Linux run |
| 2026-11-04 | QA finding FU-QA-2 — **the `google-mail` V1 `run` path cannot ever have succeeded** | Pre-existing, identical on `HEAD`, nothing to fix in this slice — but it changes what G-5 is for, so it is a row of its own rather than a line in § 13. `gmailDataStrategy.ts:63` calls `this.processGenericInputs(…)`, while `pluginRegistry.ts` wires `run: gmailDataStrategy.run` — a **detached** function reference, so `this` is the registry entry, which has no such method. Invoked the way `PluginCoordinator.ts:374` invokes it, QA's harness gets `TypeError: this.processGenericInputs is not a function`, and the pre-existing `catch` swallows it into the `{ summary, error, totalEmails: 0, … }` shape — so the failure has always looked to a caller like "no emails found". `googleDriveDataStrategy.run` is an arrow function with no `this` and is unaffected. **Consequence for G-5:** its one read-only query asks whether any agent still runs on V1, and was framed as the gate G-6 waits on. For `google-mail` the question is now narrower than a usage count — a non-zero count would mean agents have been failing, not that the path works, so G-5 must read outcomes and not just presence. Also recorded: this is why the F-1 conversion cannot be verified end to end against production logs for Gmail — there are none to compare. **FU-QA-1** strengthens the `loadSpecFromFile` follow-up: **all three** of its candidate directories are absent (`lib/plugins/v2/configs`, `lib/plugins/specs`, `specs/`), so the whole `possiblePaths` array is stale and deleting the function whole is the only coherent fix. **FU-QA-3** confirms SA's J-3 premise empirically rather than by inference — `pluginRegistry['google-mail'].refreshToken` is `undefined` at runtime. **FU-QA-4 is fixed here, not carried:** `.claude/skills/third-party-ops/google.md` still listed eight files G-2 deleted as "never a probe target", which would have sent a DevOps agent hunting for things that no longer exist; the V1 bullet now names only the three survivors, the `Universal*` bullet is gone, and the start-route note says the route was deleted and points at the live V2 callback instead |
| 2026-11-04 | Console read — **roles settled, G-1 done, Option B reversed, AF-8 found** | Barak supplied Console screenshots of both clients, which answers **Q-5** and closes the question reopened on 2026-11-03. **Section 1 was right as written**: `60n3cm` is the plugin client and `mhcc99u2` is sign-in. Recorded in § 1 as "Settled 2026-11-04" with the full redirect-URI evidence, because the roles had been held open for a day and the reasoning that reopened them was plausible — `60n3cm`'s list opens with seven `localhost:3000` entries, which is exactly why it got named "Local Dev Client"; entries 7–16 are production and preview. **G-1 is done** — both clients renamed to role-based names, so AC-1 is substantially met, with only a read of the two new strings still owed. **Two new facts, neither visible from the repo.** (1) `60n3cm` serves localhost, previews and production on **one client and one secret**, which is the mechanism that let the 2026-11-02 rotation reach production — so the environment split is a fix, not tidying. (2) Its only secret dates from **2025-07-14** and has never been rotated, so S0.4 on the plugin client is entirely owed. **Option B-reversed** is added to § 6 and recommended: the tabled Option B moves *production* to a new client and so costs 19 reconnects, but moving **localhost and previews** instead reaches the identical end state for **0**, because a refresh token binds to the `client_id` that issued it and production already holds every grant. It also no longer waits on Workstream E, since non-production has no verification cap to clear. **Q-6 opened**, and it blocks cleanup: `mhcc99u2` carries two enabled secrets and the Console cannot say which one Supabase holds — deleting the live one breaks sign-in for everyone, so it must be read from the Supabase dashboard first. **AF-8 opened**: Analytics and Business Profile have no production redirect URI at all and have never been connectable in production |
| 2026-11-06 | **Q-6 answered; AF-8 re-scoped from its real surface** | Barak read the Supabase dashboard: the stored Google secret matches the **2025-11-05** one by its last four characters, so sign-in runs on that secret and the 2026-11-02 one is surplus and safe to delete — which also shows the rollback reached the Supabase side, so the rotation's value is in use nowhere. **Q-6 is closed.** Separately, AF-8 was traced to what actually calls these two plugins, because "two plugins cannot be connected" says nothing about who notices. Both are **Business OS Channel Insights** providers reached from the Channels card on `/business-os` through `/api/v2/plugins/connect`, so they are user-facing, not agent-only — but they weigh differently: `google-business-profile` is the "Google listing" tile offered to every account, while `google-analytics` is `offered: false`, deliberately withdrawn. Production holds one `plugin_connections` row for each, both on the same admin account on 2026-08-26, and `channel_connections` holds only `facebook_page` — so no account has ever completed a Google channel connection and there is no data at risk. The re-scope that matters: the redirect URI is **not sufficient**, because the connect route's own documented failure is Google's "My Business Account Management API has not been used in project 921980058947", and that is where the 2026-08-26 test stopped *on localhost, where the URI was fine*. AF-8 is now two steps, and only the Business Profile one is a live defect. **Correction within the same day:** Q-6's safety argument was first written from "plugin OAuth works", which was assumed rather than read. Barak asked whether Vercel might still hold the rotated secret, since it was changed during the incident and he did not recall changing it back. The Vercel metadata supports the premise — two vars edited 2026-11-02 21:55 and untouched since — and the answer is now measured instead of argued: successful Google token refreshes stamped 2026-11-06 prove the deployed pair is `60n3cm`'s, and no Vercel variable holds a sign-in secret in the first place. **Recommended order changed** to disable the **2026-11-02** secret in the Console, confirm sign-in, then delete — reversible, with a probe that can fail. **Probe run the same day and passed:** a `provider: google` login at 15:40:50, eighteen seconds after a logout, succeeded with the **2026-11-02** secret disabled, so Q-6's answer is confirmed from the consumer's side and the surplus secret can be deleted. Noted for next time: `auth.identities.last_sign_in_at` is not updated per login and would have said the opposite |

---

## 13. QA report — G-2 + F-1 (2026-11-04)

> Appended by QA after the two SA approvals. This section is append-only; no row above it, and no
> Change History row, was edited. QA ran read-only: no repository file was changed, nothing was
> committed, no stash was touched.

**Test mode:** full · **Strategy:** A (in-memory exercise of `run()` against a stubbed `fetch`) + B
(full Jest suite with a HEAD baseline) + C (two standalone Node/tsx scripts) · **Focus:** api,
schema, security, suite-level regression · **Skipped:** D (browser) — the change set contains no UI
surface; `/oauth/[plugin]/start` was browser-reachable but is deleted and had no in-repo caller, and
`app/oauth/callback/[plugin]/route.ts` is untouched · **Input source:** QA judgement from the task
brief.

**Verdict: PASS.** No defect. Four findings, all pre-existing or cosmetic, listed below.

### 13.1 Full Jest suite against a HEAD baseline — PASS, 0 net new failures

The baseline is a detached worktree at `4def6c34` (= `HEAD`, i.e. the tree before these staged
changes), created outside the repo with the shared `node_modules` symlinked, so neither tree sees
the other.

| Run | Command | Result |
|---|---|---|
| Staged tree, everything | `npx jest --ci --silent` | 28 failed / 8 skipped / 1962 passed of 1998 suites; 161 failed / 60 skipped / 49541 passed of 49762 tests; 1862 s |
| Baseline, the 28 that failed above | `npx jest --ci --silent <28 paths>` | 25 failed / 3 passed of 28 |
| Staged tree, the 3 that differ, isolated | `npx jest --ci <3 paths>` | **3 passed, 218 tests** |

The dedup trap was real and worth restating: the staged run printed **56** `FAIL` lines for **28**
distinct suites — exactly 2×. A `comm` over raw `FAIL` lines would have reported all 28 as new.
Both sides were `sort -u`'d on the suite path (and the baseline's Windows backslashes normalised)
before comparing.

The three suites that failed in the full staged run but passed in the baseline subset are
`app/admin/business-os-llm/__tests__/leakPanel.render.test.tsx`,
`app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx` and
`components/business-os/settings/__tests__/PlanUpgrade.render.test.tsx`. All three are
load-dependent timeouts, not regressions:

- two fail with the bare `thrown: "Exceeded timeout of 5000 ms for a test."`, the third with a
  `findByTestId` `waitFor` timeout;
- the full run clocked them at 209 s and 204 s wall (vs 82 s and 105 s unloaded), and the staged
  run contains 54 `Exceeded timeout` markers across the suite;
- **re-run isolated on the staged tree they all pass** (218 tests, 0 failures);
- none of the three imports anything in this change set — no plugin, OAuth or logging surface.

So the suite-level answer is: **28 failing suites on the staged tree, 28 failing or flaking on
`HEAD`, 0 attributable to G-2 or F-1.** (The brief's "roughly 30 on clean main" is accurate; the
exact figure here is 25 hard failures plus 3 load-flakes among the suites this change set could not
touch.)

Of the four guard suites G-2 edited, three pass on Windows and the fourth is §13.5:

```
PASS app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts (16.663 s)
PASS lib/admin/environment/__tests__/catalogueDrift.guard.test.ts (11.137 s)
PASS lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts (11.91 s)
FAIL lib/utils/__tests__/oneAddressPolicy.guard.test.ts (27.299 s)   <- §13.5, Windows-only
```

### 13.2 No live caller of anything deleted — PASS

Swept every deleted export, basename and route path across all tracked files (`app/`, `lib/`,
`components/`, `hooks/`, `scripts/`, `tests/`, `.github/`, `supabase/`, `types/`, `simulators/`,
`__mocks__/`, `middleware.ts`, `next.config.js`, `vercel.json`, `jest*.config.js`, `package.json`
and every `*.json`), excluding only `archive/`, `docs/` and `backups/`:

`gmailStrategy`, `googleDriveStrategy`, `universalPlugins`, `UniversalPlugin`,
`UniversalOAuthHandler`, `UniversalAPIClient`, `createUniversalPlugin`, `UniversalPluginConfig`,
`EndpointConfig`, `gmailPluginStrategy`, `googleDrivePluginStrategy`, `plugins/v2`, `oauth/token`,
`/oauth/<x>/start`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and `.connect(` / `.handleOAuthCallback(` /
`.fetchContext(` as call sites.

**Every surviving match is a comment, a guard-test string, an unrelated third-party URL or a
deliberate decoy.** Specifically:

- `oauth/token` survives only as `connect.stripe.com/oauth/token` and
  `api.notion.com/v1/oauth/token` in plugin definitions and one Stripe test — which is exactly why
  G-2 was right not to add a `FORBIDDEN_LITERALS` entry for it.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` survives in three suites that **set it as a decoy** to prove the
  invite sign-in path does not fall back to it. Those are negative controls and all three pass. The
  `catalogueDrift` guard skips `__tests__`, so removing the catalogue entry does not strand them —
  confirmed by that guard passing.
- `.handleOAuthCallback(` survives at `app/oauth/callback/[plugin]/route.ts:117`, which is
  `UserPluginConnections.handleOAuthCallback` — the V2 path, unrelated to the deleted V1 member.
  That route's only imports are `next/server`, `@/lib/logger`, `pino`, `PluginManagerV2` and
  `UserPluginConnections`; it touched nothing deleted.
- `middleware.ts:156` matches `pathname.startsWith('/oauth')`, a prefix that still correctly covers
  the surviving callback.
- `app/oauth/` now contains exactly one file: `callback/[plugin]/route.ts`. Kept, as intended.

**The one live code reference to a deleted path**, already recorded by implementation and confirmed
here as harmless: `lib/agentkit/v6/intent/plugin-spec-loader.ts:106` lists
`lib/plugins/v2/configs/<key>.json` as the first of three candidate spec paths. It cannot run —
`loadSpecFromFile` has **zero callers** anywhere (`generate-intent.ts:216` imports
`loadPluginRegistryFromSpecs`, a different export, and `specLoader` is an optional parameter that
**no call site in the repo passes**, confirmed by sweeping `specLoader`; the production branch goes
to `loadPluginRegistryFromDatabase`). The other two candidate directories, `lib/plugins/specs` and
`specs/`, **do not exist either**, which is independent evidence the function was already dead.
Non-defect; see §13.6 FU-QA-1.

### 13.3 Behavioural check on the surviving V1 `run` path — PASS

Exercised in memory with `tsx`, importing the real `lib/plugins/strategies/gmailDataStrategy.ts`
and the real `lib/plugins/pluginRegistry.ts` against a stubbed `globalThis.fetch`, with
`LOG_LEVEL=debug` so every converted call actually executed. Eight scenarios.

Object shape after the `...gmailStrategy` spread was dropped:

```
pluginKey = "google-mail"          name = "Gmail"
typeof run = function              typeof refreshToken = function
typeof connect = undefined         typeof handleOAuthCallback = undefined
own keys: cleanExtractedText, decodeBase64Url, extractEmailBody, extractTextFromAttachment,
          generateGenericSummary, identifyContentType, name, pluginKey, processAllAttachments,
          processGenericInputs, refreshToken, run
```

`pluginKey: 'google-mail'` and `name: 'Gmail'` are byte-identical to what the deleted
`gmailPluginStrategy` supplied (`gmailPluginStrategy.ts:11-12` on `HEAD`), and that object had
**exactly four** own members — `pluginKey`, `name`, `connect`, `handleOAuthCallback` — so the spread
supplied nothing else that could now be missing. `connect` and `handleOAuthCallback` are the only
losses and §13.2 shows nothing calls them.

| # | Scenario | Result |
|---|---|---|
| A | happy path, 2 messages + 1 attachment each | 3 fetches; returns `{summary, totalEmails:2, totalAvailable:2, emails, searchQuery, searchCriteria, userEmail, fetchedAt}`; attachment text extracted; never throws |
| B | list returns `messages: []` | 1 fetch; early return `{summary, totalEmails:0, emails:[], searchQuery, searchCriteria}` |
| C | list returns 400 | `error` line carries `userId`/`statusCode`/`statusText`, body goes to `debug`, then the `Error` is thrown and the outer `catch` returns `{summary, error:'Gmail API error: 400 Bad Request', totalEmails:0, emails:[], errorType:'Error', troubleshooting[3]}` |
| D | every detail fetch 404s | 3 fetches; two `warn` lines; returns `totalEmails:0` with `totalAvailable:2` — loop-level failure still yields a success shape, as before |
| E | `expires_at` in the past | 0 fetches; `info` then the `error` catch; returns `error:'Access token expired, refresh needed'` |
| F | invoked through `pluginRegistry['google-mail'].run(...)`, i.e. the way `PluginCoordinator.ts:374` calls it | `TypeError: this.processGenericInputs is not a function`, swallowed into the error shape — **pre-existing, see §13.6 FU-QA-2** |
| G | `refreshToken({refresh_token:null})` | **throws** `Error: No refresh token available for Gmail connection` |
| H | `refreshToken({refresh_token:'rt'})` | **throws** `Error: Google OAuth credentials not configured` |

Conclusions on the three things the brief asked about:

- **Control flow and return shape unchanged.** Every hunk inside `run()` is a `console.*` → `logger.*`
  substitution; the only non-logging edits in the whole function are the dropped
  `searchQuery: processedInputs.query` / `inputVariables` log fields. `run()` never throws — it
  catches everything and returns the error shape — and scenarios C and E confirm the thrown
  `Error`s still reach that catch with their original messages.
- **No `logger.*` call references an out-of-scope variable.** All 26 fired under
  `LOG_LEVEL=debug` across the eight scenarios with no `ReferenceError`. A read confirms the same:
  `userId` is a destructured parameter of `run`, `processedInputs`/`errorText`/`message.id`/
  `part.filename` are all declared above their use, and `logger` is module-scoped.
- **No `throw` is swallowed.** The three `throw`s inside `run()` reach the pre-existing catch
  (C, E); `refreshToken`'s throws propagate (G, H); `googleDriveDataStrategy.run` still
  `logger.error(...)` **then** `throw error`.

Supporting facts verified separately: zero `console.` tokens remain in the three files; 26 + 2 + 2 =
30 `logger.*` calls replace 29 live `console.*` ones (the extra is the deliberate error/`debug` split
at `:81`); `lib/logger.ts:26` pins production to `info`, which is what makes the "search text no
longer reaches production logs" claim true; and the only importers of `pluginRegistry` are four API
routes plus `PluginCoordinator`, `outputInference` and `interpolatePrompt`, whose own importers are
all API routes — **no `'use client'` module can reach the new Pino import**, so the conversion
cannot pull a server logger into a browser bundle.

### 13.4 Typecheck — PASS, the stated numbers are correct

```
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json
```

**1873** `error TS####` diagnostics. **0** crash markers — grepped for
`JavaScript heap out of memory`, `FATAL ERROR`, `Allocation failed`, `<--- Last few GCs`,
`v8::internal`. The run is positively proven to have produced diagnostics rather than died early,
because 1873 of them are present.

QA also ran the same command on the baseline worktree, which the brief did not ask for and which
turns "1873" from a number into a comparison: **`HEAD` is 1911 errors, 0 crash markers, so the change
set removes 38 and adds none.** Compared per file, **no file's error count rose and no file appears
in the staged list that was absent from the baseline list.** Within `lib/plugins/` the drop is 42 →
**8**, and `googleDriveDataStrategy.ts` alone goes 10 → 4 — deleting `connect` and
`handleOAuthCallback` removed six implicit-`any` bindings, which matches the figure implementation
recorded.

The only diagnostics in any file this change set edits are four in
`lib/plugins/strategies/googleDriveDataStrategy.ts` — one `TS2305` (`PluginStrategy` has never been
exported from `pluginRegistry.ts`) and three `TS7031` implicit-`any` bindings that follow from it,
since the broken annotation leaves the object literal without a contextual signature. All
pre-existing; the same `TS2305` also sits on `chatgptResearchStrategy.ts:7` and
`slackPluginStrategy.ts:11`, neither touched here.

### 13.5 `oneAddressPolicy.guard.test.ts` — CONFIRMED Windows-only, exactly five offenders, no sixth

Confirmed, not fixed. One `it` fails (`only the resolver and the documented exceptions read the
variable`); the other three pass.

The cause is as described: `relative()` at `:104` is `file.replace(ROOT + '/', '')`, and `ROOT` is
built with `path.join`, so on Windows the haystack is `…\determined-tu-5450e6\lib\…` while the
needle ends in a forward slash. Nothing matches, `relative()` returns the full absolute path, and no
entry in `ALLOWED` / `OAUTH_FILES` / `NAME_ONLY_LISTINGS` can resolve.

Observed offenders on the staged tree — **five, and exactly the five-entry exemption set**:

| Offender (absolute path elided) | Exemption list it belongs to |
|---|---|
| `lib/utils/origins.ts` | `ALLOWED` (`RESOLVER`) |
| `lib/email/platformBranding.ts` | `ALLOWED` |
| `lib/admin/environment/catalogue.ts` | `NAME_ONLY_LISTINGS` |
| `lib/plugins/strategies/slackPluginStrategy.ts` | `OAUTH_FILES` |
| `app/oauth/callback/[plugin]/route.ts` | `OAUTH_FILES` |

**No sixth offender.** Verified two independent ways:

1. A standalone Node script re-implementing the suite's own walker and regexes with a
   platform-normalised `relative()` — i.e. what Linux CI effectively computes. It reports
   `FILES.length = 2364` (the suite needs > 300), the loopback test's offenders as `[]` **with and
   without** the resolver exemption, test 3's readers as exactly the five files above, **readers not
   in the exemption set: `[]`**, and **exemptions with no matching reader: `[]`** — a clean 1:1, so
   the list is neither short nor stale.
2. The same suite on the baseline tree fails identically with **eight** offenders — exactly `HEAD`'s
   eight-entry exemption set, including the three entries G-2 pruned
   (`gmailPluginStrategy.ts`, `googleDrivePluginStrategy.ts`,
   `lib/plugins/v2/core/UniversalOAuthHandler.ts`). So the 1:1 property holds before and after, and
   the pruning shrank the offender list by exactly the three files it deleted.

That is positive evidence the suite goes green on Linux CI.

### 13.6 Findings — none blocking

No bug. No performance issue. Four items, for the record:

| ID | Severity | Finding |
|---|---|---|
| **FU-QA-1** | Low | `lib/agentkit/v6/intent/plugin-spec-loader.ts:106` still names the deleted `lib/plugins/v2/configs`. Unreachable (§13.2) and correctly left alone under rule 8; the recorded G-6 follow-up — delete `loadSpecFromFile` whole, with its `console.error` at `:112` — remains the right fix. QA adds one fact that strengthens it: **neither of the other two candidate directories exists either**, so the whole `possiblePaths` array is stale, not just one entry. |
| **FU-QA-2** | Low, pre-existing | `run()` uses `this.processGenericInputs`, but the registry wires `run: gmailDataStrategy.run` as a detached function, so `this` is the registry entry and the call is a `TypeError` swallowed into the error shape (§13.3 scenario F). Identical on `HEAD` — not introduced here. It means the V1 Gmail `run` path **cannot have been succeeding in production**, which is worth knowing for G-5's "is anything still on V1" count: the data halves are reachable but, for `google-mail`, already broken. QA did not verify the same for `google-drive`, whose `run` is an arrow function and uses no `this`. |
| **FU-QA-3** | Low, pre-existing | `refreshToken` at `gmailDataStrategy.ts:618` logs Google's verbatim token-endpoint error `body` at `error`. SA ruled this acceptable because AF-6 makes the method unreachable; QA confirms the premise empirically — `pluginRegistry['google-mail'].refreshToken` is `undefined` at runtime. Already a G-6 carry-forward. |
| **FU-QA-4** | Cosmetic | `.claude/skills/third-party-ops/google.md:53-55` still lists `gmailPluginStrategy.ts`, `googleDrivePluginStrategy.ts`, `lib/plugins/v2/configs/google-drive.json`, `app/oauth/[plugin]/start/route.ts`, `app/oauth/token/route.ts`, `UniversalOAuthHandler.ts`, `UniversalPlugin.ts` and `lib/plugins/v2/registry.ts` as "never a probe target". The advice is still sound (never probe them), but a DevOps agent reading it will look for files that no longer exist. The same file's `NEXT_PUBLIC_GOOGLE_CLIENT_ID` bullet **was** updated in this change set, so only the two bullets around it are stale. |

### 13.7 What QA could not check

- **No browser check.** Playwright is not installed and adding it needs SA review. Nothing in the
  change set renders.
- **No live Google OAuth exercise.** `tests/jest-no-network.ts` refuses non-loopback connections and
  the brief was read-only on external platforms, so the `fetch` seam was stubbed instead. A real
  plugin reconnect through `app/oauth/callback/[plugin]/route.ts` — the route G-2 deliberately keeps
  — is **not** covered by anything here and is worth one manual click before or after merge, even
  though the file is untouched.
- **Linux CI not executed.** §13.5's conclusion that `oneAddressPolicy` goes green there is derived
  from re-computing the suite's logic with a working `relative()`, not from a Linux run.
- **`npm run test:bos-entitlements` not run** — correctly not applicable: the diff imports nothing
  from `lib/business-os/entitlements/` and touches neither `catalog.ts` nor `tierMatrix.ts`.
