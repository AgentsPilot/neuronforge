# Domains and app addresses (the three address names, registrar and DNS)

Part of the `third-party-ops` skill: read its `SKILL.md` first. This file adds only what is specific to domains and addresses, in the template's six parts plus tiers, order and the checklist for attaching a custom domain. Every file path is confirmed at use time; if one has moved, the catalogue names the variable and the reader finds where it is read now.

Before each use, confirm the three names below are still live (`SKILL.md` §5): a code path that runs (for A3, a code path that runs **when set**), and the names set on Vercel. Drop any that is not. Registrar and DNS have no code path: their drift rows are **"not audited" until a domain is recorded** in the private inventory.

| # | Name | Catalogue group `addresses`, `expectedIn` (prod / preview / local) | Controls |
|---|---|---|---|
| A1 | `NEXT_PUBLIC_APP_URL` | required / required / required | This app's own origin: links the app sends out (emails, payment returns, plugin sign-in redirects) |
| A2 | `NEXT_PUBLIC_MARKETING_URL` | optional everywhere | The separate marketing application's origin, which holds the login and signup pages |
| A3 | `NEXT_PUBLIC_PUBLIC_SITE_HOST` | optional everywhere | The host whose one-label subdomains serve each business's public pages |

**Boundary.** DO owns the three names, which stable address each environment uses (by role, private), the domain attachments on Vercel (read through `vercel-ops`), and the checklist in §7. **DNS:** each vendor's file names the records that vendor needs and checks their verification (the sending domain: `email.md` §3). This file owns publishing every vendor's records at the zone's DNS host, recording each record's owner (T-AD-8), and DMARC as the domain-owner record. It names no record value. Redirect URIs are registered per `stripe.md` and `google.md`; the Supabase Site URL and redirect list are a `supabase-ops` §2 dashboard row. A business's chosen prefix is app data; DO never writes it.

---

## 1. What must differ between environments

The **current** setup (which stable address each environment uses, which domains are attached to which project, the registrar, the zone's DNS host and records) is recorded in the private inventory by role, checked at use time, and reported by role.

| Setting | Rule per environment |
|---|---|
| A1 | Set on every target (catalogue). Production: the recorded stable address of the web app project. Preview: the recorded stable preview address, registered with each vendor whose Preview connection is wanted; **never production's address** (a connection started on a Preview would then complete on production, with production's code and data). Never a loopback on a deployed target |
| A2 | Unset (code fallback) or the recorded stable address of the marketing project. Never a loopback on a deployed target. The names the marketing app reads itself: not derivable here |
| A3 | Production: set only once a wildcard host for it is attached to the web app project with valid config and a certificate. Preview: unset (path form) unless a stable preview wildcard is recorded. Local: optional, a loopback-resolving test host (named in `origins.ts`, never here) |
| Domain attachment | Each recorded domain attached to the project it serves (web app or marketing, by role), to the right target, with a valid certificate. The wildcard host is on the web app project |
| Sibling labels | When the platform or marketing host is a subdomain of A3, its first label is reserved (AD-6). A host at the apex itself has no label to reserve, and the rewrite already lets it through to the platform |
| System-variable exposure | Per project, as recorded (AD-8) |
| Vendor redirects, Supabase Auth URLs | Registered for each environment's stable A1 address, per `stripe.md`, `google.md` and `supabase-ops` §2 |

"Local" is guidance for whoever runs the app locally. DO reads no `.env*` file, so local is never a DO check.

## 2. Where the code reads it

| # | Fact | Read in |
|---|---|---|
| AD-1 | **All three are build-time** `NEXT_PUBLIC_` names, inlined into the server bundle, the browser bundle and middleware. One exception: `processEnvironmentVariables` reads A1 dynamically on the server for the plugin definitions' `${…}` placeholders. On Vercel either way a change needs a new deployment (`vercel-ops` §4) | `lib/utils/origins.ts` (header); `middleware.ts`; `lib/server/plugin-manager-v2.ts` |
| AD-2 | **`platformOrigin()` order:** rule 0, in a browser served from a real host, the served origin when A1 is unset or a loopback; rule 1, a loopback A1 is refused on Vercel; rule 2, **on a Preview the deployment's own host outranks A1**; then A1; then on Vercel production the project's stable production host, and on other Vercel environments the deployment host, then the stable production host; then the code fallback. Off Vercel, the development or production code fallback, chosen by `NODE_ENV`. The fallback constants are named by role only | `platformOrigin`, `platformUrl`, `vercelEnv`, `browserOrigin` in `lib/utils/origins.ts` |
| AD-3 | **Redirect builders read A1 directly, on purpose:** a redirect must match the vendor's registration. The guard test lists them as exceptions. Examples: the connect route's redirect fallback, the definition placeholders, the OAuth callback's target origin, `platformEmailLogoUrl` (shown only when A1 is set and https) | `lib/utils/__tests__/oneAddressPolicy.guard.test.ts` (`ALLOWED`, `OAUTH_FILES`); `app/api/v2/plugins/connect/route.ts`; `app/oauth/callback/[plugin]/route.ts`; `lib/email/platformBranding.ts` |
| AD-4 | **A3 decides the public address shape.** Unset: `{platform origin}/site/{prefix}`. Set: `{prefix}.{A3}`, https, and A3 **outranks the platform origin** for every address a business shows or shares. A local-only host is refused outside development | `publicSiteHost`, `isLocalOnlyHost`, `publicSiteUrl`, `publicSiteDisplayHost`, `publicSiteSuffix` in `origins.ts` |
| AD-5 | **The subdomain rewrite runs only when A3 is set**, the host ends with `.{A3}`, the prefix is one label and not reserved. The apex itself falls through to the platform | `middleware.ts` ("A BUSINESS'S PUBLIC PAGES") |
| AD-6 | **The reserved list keeps a business off the platform's own hostname.** Middleware, the availability check and the write path import the one list | `RESERVED_PREFIXES`, `isReservedPrefix`, `validatePrefix` in `lib/business-os/reservedPrefixes.ts` |
| AD-7 | **`marketingOrigin()` has no loopback or preview rule:** A2, or the code fallback chosen by `NODE_ENV`. Sign-out and every login link cross to it | `marketingOrigin`, `marketingUrl` in `origins.ts` |
| AD-8 | **Browser-side Preview detection needs a project setting:** the `NEXT_PUBLIC_` copies of Vercel's system variables exist only when the project exposes them. Without them a browser on a Preview uses A1 while the server uses the deployment host | comment on `browserOrigin` in `origins.ts` |
| AD-9 | **Sent mail pins its host:** the email logo URL is fixed at send time and must keep answering there | `lib/email/platformBranding.ts` (header) |

**Deriving the direct readers (a reader search, never a name search).** `SKILL.md` §1 still holds: DO never searches the code for names. To find who reads a name the catalogue already holds, DO runs `git grep -l -F` for A1's literal name at `origin/main` over `app/`, `lib/` (definitions included), `components/`, `hooks/` and `middleware.ts`. File names only; tests excluded; a hit only in a comment is not a reader. Cross-check the hits against the guard's `ALLOWED` and `OAUTH_FILES` lists. A reader in neither list and not on a redirect line is a finding, reported in the private docs; so is any A2 or A3 reader outside `origins.ts` and `middleware.ts`. This file holds no reader list beyond the AD-3 examples.

## 3. Dashboard steps (the user)

By area name, because the vendor's UI moves: confirm the path at use time.

- **Vercel, project Domains** (each project): attach or remove a domain or wildcard host, its target, config status, certificate. Env values per `vercel-ops` and `env-change-protocol`.
- **Vercel, project Environment Variables settings:** the system-variable exposure setting (AD-8).
- **Registrar:** nameservers, auto-renew, expiry date, transfer lock, registrant contact. **The zone's DNS host:** the records, each with its recorded owner.
- **Supabase, Authentication → URL Configuration:** Site URL and redirect list (`supabase-ops` §2), including the marketing app's entries, by role.
- **Each vendor's redirect, origin and webhook lists:** per its own file.

The user reports attached yes/no, config valid yes/no, certificate valid yes/no, "matches the recorded address: yes/no", "on/off as recorded: yes/no", auto-renew on yes/no, lock on yes/no, days to expiry above the recorded threshold yes/no, and the last-updated time. Never a domain, a host, a record value or a registrar account detail.

## 4. Probes

Each fails when the setting is wrong and moves no money. Each runs on the deployment named per `vercel-ops` §4, after it is Ready. A 401/403 from deployment protection is "not probed". No probe completes an OAuth connection.

| ID | Change | Probe | Pass | Fails when | Who | Precondition and side effects |
|---|---|---|---|---|---|---|
| P-AD-1 | Any of A1–A3 | `/admin/environment` on that deployment | Name shows Set, or Not set where intended; no `required-not-set`. Proves presence, never the value: correctness comes from P-AD-2 to P-AD-8 | The other state | Main session or user | Admin session. None |
| P-AD-2 | A1, A3 | The public booking address the dashboard shows for a business the user owns (`publicSiteDisplayHost`) | Production: `{prefix}.{A3}` when set, else `{stable A1}/site/{prefix}`. Preview: that deployment's per-deployment host, path form, not an alias the user browses | A loopback, another deployment's host, the code fallback host, or the subdomain shape where no wildcard is recorded. A1's address on Preview is the AD-8 failure (T-AD-9), not an A1 failure | User, yes/no | A business the user owns with a prefix, else "not probed (no business)". None |
| P-AD-3 | A2 | Sign out on that deployment | Lands on the recorded marketing address, valid certificate | A loopback, a certificate warning, or an unrecorded host | User | Signed in on that deployment. Ends the session |
| P-AD-4 | A1 direct readers | Plugin connect, cancelled at consent, with a control (below) | The "failed" text from the address under test | The "closed" text while the control shows "failed", or a redirect-mismatch page | User; DO (logs) | Below |
| P-AD-5 | A1 email logo | The `email.md` send probe on that deployment | The received platform email shows the logo image | Text wordmark, or a broken image, while A1 is set and https. On Preview, a broken image because protection covers A1's host is "not probed (protected host)" | User; DO per `email.md` | As `email.md` (invite row, audit entries, revoke) |
| P-AD-6 | A3, wildcard host | Open `{prefix}.{A3}` for a published business the user owns, then `{reserved label}.{A3}` | The business's page with the address bar unchanged; the reserved label serves the platform | Platform page for the business, or a site served on a reserved label | User | Wildcard host attached and A3 set, else "not probed (no wildcard host)". One page view in that business's visitor stats (`PageViewTracker`, `app/site/[subdomain]/page.tsx`) |
| P-AD-7 | Domain attach | `list_project_domains`, `get_domain_config`; production: deployment aliases (`vercel-ops` §4 step 5) | Each recorded domain on the right project and target, config valid, aliases include it | Missing, on the other project, misconfigured, or not aliased | DO | No domain recorded: "not read (no domain recorded)". None |
| P-AD-8 | Supabase Auth URLs | Sign in through an in-app surface on that deployment (`lib/client/auth-actions.ts` returns to `window.location.origin`), found at use time; the Google half is `google.md`'s G1 probe, completed on the user's own existing account | Returns to the same origin, signed in | Lands on another origin (Supabase falls back to the Site URL when the origin is not allowed: vendor fact, confirm at use time), or Supabase's redirect error | User | An in-app sign-in surface, else "not probed (no in-app sign-in surface)"; the login pages themselves are the marketing app's. A session, plus any sign-in records |

**P-AD-4, plugin connect with a control.** Surface chosen at use time; suggested: the Inbox channel mailbox connect (a Google plugin through the connect route, client per `google.md`). Its texts, code defaults of translated strings in `components/business-os/leads/InboxChannelSetupDialog.tsx`, each checked with `grep -cF` ≥ 1 before use: "failed" is "That mailbox could not be connected. Try again." and "closed" is "The sign-in window closed before it finished." Cancel at the vendor's consent screen; the callback returns before storing anything on a vendor error (that a cancel returns `access_denied` rather than closing the popup is a vendor fact, confirm at use time).

- **Control:** the same probe run from A1's address. "Failed" there shows the message mechanism works.
- **Pass:** "failed" from the address under test. **Fail:** "closed" from it while the control shows "failed", or a redirect-mismatch page.
- **Not conclusive:** the control also shows "closed" (the popup lost its opener, or the vendor behaves differently).
- **Not probed:** no client registered for this address (`google.md`); no stable preview address recorded ("not probed (no stable preview address)"); the popup closed by hand; no cancel offered.
- **By design:** run from a per-deployment Preview host, it fails, because the callback answers one origin (`google.md` §5). That is a code fact, not drift.
- **Side effects:** "Initiating plugin OAuth connection" (module `PluginConnectAPI`) and "OAuth error from provider" (module `OAuthCallbackAPI`, carrying the vendor's error description). If the user consents by mistake, a plugin connection is written, and the user disconnects it.

## 5. Gotchas

- **Build-time, all three** (AD-1): saving is not deploying, and older Previews keep their old value. An unset A1 keeps the definitions' placeholder and logs "Environment variable not found, keeping placeholder" (module `PluginManager`).
- **Preview A1 and the direct readers** (AD-2, AD-3): `platformOrigin()` ignores A1 on a Preview, the redirect builders do not. See `google.md` §5 "The callback answers one origin". Preview's A1 is never production's address (§1).
- **A3 outranks a correct A1** (AD-4): set A3 before its wildcard host is valid and every shared address resolves nowhere.
- **Path-form links keep working** after A3 is set, as long as the platform host serves `/site/{prefix}`. Retire nothing businesses may already have printed.
- **The reserved list guards the platform's hostname** (AD-6); the apex needs no label.
- **A2 has no loopback refusal** (AD-7): a loopback A2 on a deployed target sends users to an address only the builder's machine reaches.
- **System-variable exposure changes browser behaviour** (AD-8), and it is project-wide.
- **Sent mail pins the old host** (AD-9): moving A1 never retires the old host while sent mail may still be read.
- **A certificate on an unserved host can lapse unseen.** `origins.ts` records a past sign-out that landed on an expired-certificate warning. A host the code falls back to must actually be served.
- **A DNS record left pointing at a removed target is a takeover risk.** Remove the record in the same change as the attachment (vendor fact, confirm at use time).
- **Moving the nameservers moves every record in the zone,** email records included (§7 step 0).

## 6. Drift checks

In the `env-drift-audit` §7 format, and under its rules. "Who reads" as there.

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| T-AD-1 | On each **Vercel target** of the web app project, the `addresses` names match `expectedIn` (A1 on all three). Local: "not read (main session / user)" | Catalogue at `origin/main` | `vercel-ops` §3 Env vars (names only); runtime logs: 0 "Environment variable not found, keeping placeholder" (module `PluginManager`) with `varName` A1, on that deployment after Ready; no definition load in the window is "not read" | High | DO |
| T-AD-2 | No deployed target hands out a loopback or local-only address (P-AD-2, P-AD-3) | `origins.ts` rules | User report | High | User / main session |
| T-AD-3 | A3 is set on a target only where a wildcard host for it is attached and valid | Private inventory | `vercel-ops` §3 + P-AD-7; user "matches the recorded address: yes/no" | High | DO; user |
| T-AD-4 | The recorded first labels of the platform and marketing hosts, where they are subdomains, are in `RESERVED_PREFIXES` at `origin/main` | Code at `origin/main`; private inventory | Repo read | Medium | DO |
| T-AD-5 | Each recorded domain on the right project and target, config valid, certificate valid, production aliases include it | Private inventory | P-AD-7 | High | DO |
| T-AD-6 | Vendor redirect lists and the Supabase Auth URLs (the marketing app's entries included, by role) name each environment's stable A1 address. Vendor side: the T- rows of `stripe.md` and `google.md`; the Supabase row is here | Private inventory | User report | High | User |
| T-AD-7 | Registrar: auto-renew on, expiry beyond the recorded threshold, transfer lock on, registrant contact reachable. "Not audited" until a domain is recorded | Private inventory | User report | High | User |
| T-AD-8 | Every record in the zone has a recorded owner (web app, marketing, email per `email.md`, DMARC as domain owner), and none points at a removed target. "Not audited" until a domain is recorded | Private inventory | User report | High | User |
| T-AD-9 | Each project's system-variable exposure is on/off as recorded | Private inventory | User report (project Environment Variables settings) | Medium | User |

## 7. Tiers, order against the deploy, and attaching a custom domain

**Tiers** (`env-change-protocol`; nothing restated). Production tier (SA reviews the plan, the user executes): any change to production's A1, A2 or A3; any domain attach or detach on either project; any DNS record; any nameserver change; any registrar setting; the system-variable exposure setting on either project (it is project-wide); the Supabase Site URL or redirect list; any vendor redirect registration production uses. A Preview-only A1 or A3 change is reversible, and the user applies it after the approval in chat.

**Attaching a custom domain** (each step gates the next):

0. **Zone move, when the plan includes a wildcard host.** Whether the wildcard needs the zone's nameservers moved to Vercel is a vendor fact, confirmed at use time. If it does: recreate every existing record in the zone (email included) at the new DNS host and check it against the private inventory **before** the nameservers change; afterwards re-run the email vendor's domain verification and P-AD-5. Production tier. Its undo (switching back) is slow because of DNS propagation: plan it as slow.
1. Attach the domain, and the wildcard host if business subdomains are wanted, to the right project in Vercel (`vercel-ops`; the user executes).
2. Publish at the zone's DNS host the records Vercel shows for each attached host and, on a zone move, carry every recorded record, email included. Their contents come from each vendor's file. Record each record's owner (T-AD-8).
3. Config valid and certificate issued (P-AD-7). Production: the aliases include it.
4. Confirm the platform and marketing first labels are reserved (T-AD-4). If not, a code change merges first.
5. **Add** every inbound address for the new address, keeping the old ones until step 8: redirect URIs (`stripe.md`, `google.md`, `messaging.md`, `oauth-apps.md`), webhook endpoints (`stripe.md`, `email.md`), `google.md`'s JavaScript origins and authorised domains, the Supabase Auth URLs, and queue schedules and callback targets (`queues-and-keys.md`).
6. Set A1 (and A2, A3 as planned) on the target, then rebuild (AD-1).
7. Run P-AD-1 to P-AD-8 on the new deployment.
8. Only then remove old registrations. Keep the old host answering while sent mail and shared links may still use it (AD-9).
9. Registrar: auto-renew on, transfer lock on, contact checked (T-AD-7). Record the domain in the private inventory, and change T-AD-7 and T-AD-8 from "not audited".

| Change | When |
|---|---|
| A3 set | After the wildcard host is valid (step 3), never before |
| A1 moves | New inbound addresses registered (step 5) before the rebuild; old ones removed after the probes |
| Nameservers move | After every existing record is recreated and checked (step 0) |
| A domain removed | After no address name, vendor registration or sent link needs it; DNS record removed in the same change |
