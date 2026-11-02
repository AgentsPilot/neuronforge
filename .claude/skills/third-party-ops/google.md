# Google Cloud (sign-in, plugin client, Places, Custom Search)

Part of the `third-party-ops` skill: read its `SKILL.md` first. This file adds only what is specific to Google, in the template's six parts plus tiers and order. Every file path is confirmed at use time; if one has moved, the catalogue names the variable and the reader finds where it is read now.

Before each use, confirm the five credentials below are still live (`SKILL.md` §5): a code path that runs, and the names set on Vercel. Drop any that is not.

**Five credentials, five failures.** Each has its own console page and its own way of breaking. A working plugin connect proves nothing about sign-in, and the reverse. Never treat them as "the Google key".

| # | Credential | Names | Kind |
|---|---|---|---|
| G1 | App sign-in ("Continue with Google" on the login page) | none in the app env | A Google OAuth client whose id and secret are entered in Supabase's Google provider |
| G2 | Invite signup with a Google ID token | `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` | Build-time app name; must name the same client as G1's Supabase provider |
| G3 | Plugin OAuth client (the Google plugins) and its redirect URIs | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, with `NEXT_PUBLIC_APP_URL` | Server names, substituted into the plugin definitions; a Google OAuth client |
| G4 | Places address autocomplete | `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | Build-time browser key |
| G5 | Custom Search (research plugin web search) | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` | Server key; a Programmable Search Engine |
| G6 | Gmail system sender | `GMAIL_*` | A separate OAuth client and refresh token, not G3: [email.md](email.md) |

---

## 1. What must differ between environments

The **current** setup (which Google Cloud projects exist, which client and key each environment uses, where each value lives) is recorded in the private inventory by role, and that record is the expected state an audit compares with. Where the value lives is found at run time and reported by name and target only.

| Setting | Rule per environment |
|---|---|
| Google Cloud project | As recorded. The consent screen, enabled APIs and quota are per project, so every client and key in one project shares them (vendor fact, confirm at use time) |
| G1/G2 sign-in client | One OAuth client per Supabase project that uses it. Its redirect URI is the one Supabase's Google provider page shows; its Authorised JavaScript origins are the environment's stable origins that serve the invite page. `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` equals that Supabase provider's client id |
| G2 never the plugin client | The sign-in name never holds the plugin client's id, on any target |
| G3 plugin client | Its own OAuth client, separate from the sign-in client and from the Gmail system sender. Redirect URIs: each Google plugin's callback, exactly as the definitions build it, at each environment's stable address |
| G3 names | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` all-or-none; wherever they are set, `NEXT_PUBLIC_APP_URL` is set too |
| G4 Places key | A browser key restricted by HTTP referrer (that environment's stable origins) and by API (the two the loader needs, §2) |
| G5 Search key and engine id | A server key restricted by API to Custom Search; the engine id of the recorded engine; the pair all-or-none |
| Consent screen | User type, publishing status and declared scopes as recorded. Production target: published, never relying on a test-user list. Every scope the code requests is declared, and verified where Google requires it |

"Local" is guidance for whoever runs the app locally. DO reads no `.env*` file, so local is never a DO check; a loopback origin or redirect is registered only on a non-production client.

## 2. Where the code reads it

| Credential | Read in |
|---|---|
| G1 | `signInWithGoogle` in `lib/client/auth-actions.ts` (Supabase `signInWithOAuth`, PKCE; the browser returns to `app/auth/callback/page.tsx`) |
| G2 | `lib/business-os/invites/googleSignInConfig.ts` (the only accessor; trimmed, blank means off); `app/invite/page.tsx`, `app/invite/GoogleSignupButton.tsx`, `app/invite/useGoogleIdentity.ts` (popup button); `app/api/public/invites/signup/google/route.ts`; `lib/business-os/invites/googleIdToken.ts` (verifies the ID token against this id); `signInWithGoogleIdToken` in `lib/client/auth-actions.ts` |
| G3 | `processEnvironmentVariables` in `lib/server/plugin-manager-v2.ts` fills `${…}` placeholders in the `google-*-plugin-v2.json` definitions in `lib/plugins/definitions/`; `lib/plugins/sanitize-plugin-definition.ts` and `app/api/plugins/available/route.ts` serve the client-safe `auth_config`; `connectPlugin` in `lib/client/plugin-api-client.ts` and `initiateOAuth` in `lib/client/oauth-handler.ts` build the authorisation URL in the browser and open it in a popup; `app/oauth/callback/[plugin]/route.ts` receives the code |
| G4 | `lib/geo/placesAutocomplete.ts` (falls back to an empty key: no suggestions, silently). It calls `AutocompleteSuggestion.fetchAutocompleteSuggestions` and, when a suggestion is picked, `fetchFields`. `docs/ADDRESS_AUTOCOMPLETE_SETUP.md` names the matching APIs; confirm them against the loader at use time |
| G5 | `performWebSearch` in `lib/server/chatgpt-research-plugin-executor.ts` |
| G6 | [email.md](email.md) §2 |
| Expected names | `lib/admin/environment/catalogue.ts`, groups `admin`, `plugins` and `external`; requiredness the catalogue cannot give comes from the private inventory |

**Derive, never list.** The Google plugin keys, their callback paths and their scopes are read at use time from the `google-*-plugin-v2.json` definitions at `origin/main`. This file names none.

**Never a probe target.** These readers are deprecated or unused; a pass or a failure on them says nothing about the live path:

- V1: `lib/plugins/strategies/gmailPluginStrategy.ts`, `googleDrivePluginStrategy.ts`, `gmailDataStrategy.ts`, `chatgptResearchStrategy.ts`; `lib/plugins/v2/configs/google-drive.json`; `app/oauth/[plugin]/start/route.ts` and `app/oauth/token/route.ts` (through `lib/plugins/pluginRegistry.ts`).
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: read only by the V1 strategies. It is not on the live path, and no check pairs it with `GOOGLE_CLIENT_ID`.
- `lib/plugins/v2/core/UniversalOAuthHandler.ts`, `UniversalPlugin.ts` and `lib/plugins/v2/registry.ts`: imported by nothing outside that folder except guard tests (confirm at use time).

**V2 has no start route.** The browser builds the authorisation URL itself, so there is no start response to read. The V1 start route is never a target.

## 3. Dashboard steps (the user)

By area name, because the console moves: confirm the path at use time. Newer consoles group the OAuth pages under **Google Auth Platform** (Branding, Audience, Clients, Data access, Verification centre); older ones under **APIs & Services → OAuth consent screen / Credentials**.

- **Audience / consent screen:** user type, publishing status (Testing or In production), test users. **Data access:** declared scopes. **Verification centre:** status for sensitive or restricted scopes.
- **Clients / Credentials:** per client, the Authorised JavaScript origins and Authorised redirect URIs; add or reset a client secret.
- **API keys:** per key, application restrictions (HTTP referrers for G4) and API restrictions (G4, G5); create, rotate or delete.
- **Enabled APIs and Quotas:** each API the code calls is enabled in that project; quota for Places and Custom Search.
- **Programmable Search Engine console:** the engine exists and searches what the research plugin expects (G5).
- **The Supabase half of G1 and G2** (its Google provider and its redirect allow list): `supabase-ops` and `env-change-protocol`; not restated here.
- **Setting the value on Vercel:** `vercel-ops` and `env-change-protocol`. Every `NEXT_PUBLIC_` change needs a new build (`vercel-ops` §4).

The user reports presence, status (published / testing, verified / not), "same client: yes/no", "registered: yes/no" and the last-updated time. Never a client id, a secret, a key, a project id, an origin, a redirect URI or an engine id.

## 4. Probes

Each fails when the setting is wrong. No probe needs DO to hold a secret, and none targets a §2 "never a probe target" reader. Browser and HTTP probes are the main session or the user (`vercel-ops` §4, "Who probes what"); log evidence is DO, from that deployment's runtime logs after the probe time, counts by class only. A probe that meets deployment protection is "not probed".

| Change | Probe | Pass | Fails when | Who | Side effects |
|---|---|---|---|---|---|
| G1 client, Supabase provider | On that deployment, click "Continue with Google" (the button that calls `signInWithGoogle`, found at use time); stop at Google's account chooser | The chooser loads, no error page | Supabase refuses the provider, or Google shows a client or `redirect_uri_mismatch` error (vendor messages, confirm at use time) | Main session or user, by report only: the start-failure line ("Google sign-in could not start") is browser-side, so DO has no runtime-log evidence | None. Completing sign-in is optional, by the user, on their own existing account |
| G2 name set and built (default) | POST to the invite Google signup route with no body and no cookie | 400 `invalid_request` | 404 `google_signin_not_configured`. A 429 is "not probed (throttled)"; a 503 or a protection page is "not probed" | Main session | One rate-limit counter increment for the caller. The config check runs before the body is read, and an empty body is refused before any session or redemption step. It proves the **built** value is present |
| G2 button and JavaScript origin | On the invite page, the Google button renders and opens Google's chooser; **close the popup** | Button shown and chooser opens | No button; or Google shows an origin-not-allowed error (vendor message, confirm at use time) | User | Precondition: an unredeemed invite to an address the user owns, else "not probed (no invite)". Creating one for the probe is a user-approved step: an invite row, an audit row and an invite email to the user's own address; cleanup is revoking it. Closing the popup sends nothing |
| G2 equals Supabase's client | User compares the two dashboards | "Same client: yes" | "No" | User | None |
| G3 substitution (a, preferred) | Signed in on that deployment, read `GET /api/plugins/available` for one Google plugin and test `auth_config.client_id` and `auth_config.redirect_uri` through a filter that prints yes/no only | `client_id` has no `${` (raw or URL-encoded); `redirect_uri` is the **target's recorded stable address** plus that plugin's callback path, with no `${` and no `//oauth` | Either test fails | Main session | None (session read, writes nothing). The response is never printed or pasted. Proves the substitution, not Google's acceptance |
| G3 acceptance (b) | Start a connect from the V2 connect UI on that deployment; stop at Google's consent page; close the popup | Google shows consent | Google's invalid-client page, or `redirect_uri_mismatch` (vendor messages, confirm at use time); DO counts the placeholder class (T-GO-4) > 0 | Main session or user; DO (logs) | None. Report yes/no; never paste the URL (it holds the client id and a `state` value) |
| G3 per-plugin redirect | (a) or (b), once per Google plugin whose callback changed | As above, per plugin | As above | As above | As above |
| G3 secret | Complete consent and the token exchange | The connection is recorded | The exchange fails after consent | User only, on their own Google account, if they choose; otherwise "secret not probed" | A `plugin_connections` row and its audit. Cleanup is two steps: disconnect in the app (it only marks the row disconnected and revokes nothing at Google), then remove the app's access in the user's Google account (vendor area, confirm at use time) |
| G4 key and restriction | On an allowed origin, type a partial address into an address field in Business OS settings (found at use time), on the user's own business; **stop at suggestions** | Suggestions appear | No suggestions; the browser console shows a referrer or API-not-activated error class (vendor message, confirm at use time) | Main session or user | **Costs quota** (billable Maps usage; pricing at use time). Never pick a suggestion (picking calls `fetchFields`, a second billable request) and never save the form. One short query |
| G4 restriction holds | The same field on an address of that deployment that is not on the referrer list, if the key is built there | Refused | Suggestions appear | User | One billable-or-refused request. No such address: "not probed" |
| G5 key and engine id | One research-plugin action that performs a web search, for a query certain to have results | The result carries web sources (`source_count` > 0, or sources shown), **and** 0 "Google Search API failed:" and 0 "Web search error:" from that deployment after the probe time | No sources, or either class > 0 | User (trigger); DO (logs) | **Costs one Custom Search query** from the daily quota, plus real LLM provider cost and usage records. One run, user-approved; never in a loop |
| Consent screen | User reports publishing status, user type, scope verification; DO derives the scopes from the definitions | As recorded; production published; every derived scope declared | Testing in production; a derived scope not declared | User; DO (code side) | None |

**Rotation overlap.** A client secret or API key that Google keeps valid alongside the new one (two secrets on one client, or an old key not yet deleted) makes a pass "pass, not conclusive (overlap)" until the old one is deleted and the probe repeated. Whether Google allows two active secrets on one client: vendor docs at use time.

## 5. Gotchas

- **G2 never falls back to the plugin client** (`googleSignInConfig.ts`). Copying the plugin client's id into the sign-in name is never the fix.
- **A G2 mismatch uses up the invite.** If the sign-in name and the Supabase provider's client differ, the route still claims the invite and creates the account (`completeGoogleSignup`), and the browser step then fails. The person gets a complete, password-less account and a used invite, and `GoogleSignupButton.tsx` sends them to the normal sign-in page. Hence the order row in §7.
- **`NEXT_PUBLIC_` is build-time** (`vercel-ops` §4): G2 and G4 need a new deployment; a changed value on Vercel alone changes nothing. G2 is inlined into the route too, so the route probe reads the built value.
- **Placeholder, not our error** (`plugin-manager-v2.ts`). An unset G3 name keeps the literal `${…}` text, logs "Environment variable not found, keeping placeholder" once when the definitions load (a cold start, not per request), and Google shows its own invalid-client page (vendor message, confirm at use time). Read the substituted fields (probe a) and the warn count before suspecting the console.
- **The G3 redirect is not built through `platformOrigin()`.** It is the raw `NEXT_PUBLIC_APP_URL` plus the callback path, substituted at runtime, and the token exchange uses the same value. A trailing slash, a loopback value or an unset name lands verbatim, and Google answers `redirect_uri_mismatch` (vendor message, confirm at use time; an unset name also logs the placeholder class). This is the exception to `SKILL.md` §3 "Redirect URIs come from the app address".
- **The callback answers one origin.** `app/oauth/callback/[plugin]/route.ts` posts its result to the opener at the build-time `NEXT_PUBLIC_APP_URL` origin. A connect started from any other origin (for example a Preview deployment URL) completes at Google, but the page never hears of it.
- **Redirect URIs and JavaScript origins are per environment origin**, exactly as the code builds them. Preview URLs change per deployment, so only a stable address can be registered (`SKILL.md` §3).
- **G1's Google redirect is Supabase's callback**, not an app path; the app's return path belongs to the Supabase side (`supabase-ops`).
- **Consent screen in Testing:** only listed test users can consent, and refresh tokens expire within days (vendor fact, confirm at use time; the same note grounds T-EM-8 in `scripts/validate-gmail.mjs`). It is per project, so it affects every client in that project.
- **Scopes and verification:** a sensitive or restricted scope the code adds needs declaring, and verification, before real users see consent without an unverified-app warning or a block (vendor fact). Scopes are derived from the definitions at use time.
- **A browser key's protection is its restriction** (`placesAutocomplete.ts`): the referrer list and the API list, not secrecy.
- **An unset Search key or engine id is silent** (`performWebSearch`): the research answer comes back without web sources and no `info`-or-above log line. Only the probe's source check catches it.
- **The Search key travels in the request URL.** Never log, paste or put that URL on a command line (shell history). There is no key-holder script for G5, and none is written ad hoc.
- **Custom Search availability.** Google's Custom Search JSON API documentation carries a notice about its availability. Read Google's notice at use time before any G5 rotation or new project. Rotate within the existing project; if the notice says new projects or keys are refused, plan the rotation with that risk named.
- **G6 is not G3.** The Gmail system sender's client, refresh token and loopback redirect are `email.md`'s. On that client, the loopback redirect the rotation script needs, and the consent-screen publishing status (T-GO-8), are the Google Cloud side.

## 6. Drift checks

In the `env-drift-audit` §7 format, and under its rules. "Who reads" as there.

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| T-GO-1 | On each **Vercel target**, the Google names (catalogue groups `admin`, `plugins`, `external`) match the recorded set. Local: "not read (main session / user)" | Catalogue at `origin/main`; private inventory | `vercel-ops` §3 Env vars | High | DO |
| T-GO-2 | Every `NEXT_PUBLIC_` Google name on the target is a `NEXT_PUBLIC_` name in the catalogue; neither `GOOGLE_CLIENT_SECRET` nor `GOOGLE_SEARCH_API_KEY` appears with the prefix | Catalogue at `origin/main` | `vercel-ops` §3 (names only) | Critical | DO |
| T-GO-3 | `GOOGLE_CLIENT_ID` with `GOOGLE_CLIENT_SECRET`, and wherever that pair is set, `NEXT_PUBLIC_APP_URL` too; `GOOGLE_SEARCH_API_KEY` with `GOOGLE_SEARCH_ENGINE_ID` | Code at `origin/main` | `vercel-ops` §3 (names only) | High | DO |
| T-GO-4 | 0 "Environment variable not found, keeping placeholder" for module `PluginManager` with `varName` among the Google names or `NEXT_PUBLIC_APP_URL`, on each deployment since the last run. A window with no definition load is "not read (no load in window)", never 0 | Change records | Runtime logs | High | DO |
| T-GO-5 | The sign-in name equals the Supabase provider's client, per environment; never the plugin client | `googleSignInConfig.ts`, `googleIdToken.ts`; private inventory | User report (Clients; the Supabase provider via `supabase-ops`) | High | User |
| T-GO-6 | Sign-in client: Supabase's callback registered as a redirect URI; each stable origin serving the invite page registered as a JavaScript origin | Private inventory (addresses) | User report (Clients) | High | User |
| T-GO-7 | Plugin client: every Google plugin's callback, derived from the definitions at `origin/main`, registered for each environment's stable address | Code at `origin/main`; private inventory | User report (Clients) | High | User; DO (code side) |
| T-GO-8 | Consent screen per project: publishing status and user type as recorded (production: published); every scope the code requests declared, verified where required | Code at `origin/main` (scopes derived); private inventory | User report (Audience, Data access, Verification centre) | High | User; DO (code side) |
| T-GO-9 | Places key restricted by HTTP referrer (stable origins as recorded) and by API (as the loader needs); Search key restricted by API to Custom Search | `placesAutocomplete.ts`, the research executor at `origin/main`; private inventory | User report (API keys) | High | User |
| T-GO-10 | Every API the code calls is enabled in the recorded project, with no quota-exceeded errors since the last run | Code at `origin/main` | User report (Enabled APIs, Quotas); runtime-log counts for the search path | Medium | User; DO |
| T-GO-11 | Custom Search still served for the recorded project, per Google's notice at use time | Vendor docs at use time; private inventory | User report | Medium | User |

## 7. Tiers and order against the deploy

**Tiers.** Anything on the consent screen, any scope or verification action, any API enable or disable, any client secret reset, any key create, restrict or delete, and any edit to a client or key that production uses are production tier: SA reviews the plan, the user executes. Adding an origin or redirect to a client used **only** by non-production environments, as recorded, is reversible: the user applies it after the approval in chat. Where one client serves several environments, every edit to it is production tier.

| Change | When |
|---|---|
| A new Google plugin, or a changed callback path | Its redirect registered on the plugin client for every environment's stable address before merge |
| A scope the merging code starts to request | Declared on the consent screen (and verification started where required) before merge |
| A new environment origin | Origins and redirects registered before it serves the invite page or plugin connect |
| `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` set on a target | Only after T-GO-5 reads "same client: yes" and T-GO-6 reads "registered: yes" for every stable origin that serves the invite page |
| A changed `NEXT_PUBLIC_APP_URL` | Every Google plugin's callback registered at the new address before the change, then a new build (the callback's post-message origin is build-time) |
| A `NEXT_PUBLIC_` Google value | Set → new build → deploy Ready → probe |
| Client secret or API key rotation | Create new → set → deploy Ready → probe → delete old **after deploy**; overlap per §4 |
| Tightening a key's restriction | After the probe passes on every allowed origin |
| An origin or redirect removed | Only after no deployment builds or serves it |
