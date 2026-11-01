# Stripe (platform and Connect)

Part of the `third-party-ops` skill: read its `SKILL.md` first. This file adds only what is specific to Stripe, in the template's six parts plus tiers and order. Every file path is confirmed at use time; if one has moved, the catalogue names the variable and the reader finds where it is read now.

---

## 1. What must differ between environments

**Target (user decision):** production live; Preview and local test. The **current** setup is recorded in the private inventory by role, and that record is the expected state an audit compares with. Where it differs from the target, any change is a later decision by the user, not a fix DO plans on its own. No DO-6 slice changes Preview's Stripe setup (user decision).

| Setting | Rule per environment | Grounding |
|---|---|---|
| Secret key mode | As recorded (target above) | §5 "The mode is in the key" |
| Publishable key | Same mode **and** same account as that environment's secret key | §5 "Shape check" |
| Connect client (`STRIPE_CLIENT_ID`, `NEXT_PUBLIC_STRIPE_CLIENT_ID`) | The client of that environment's mode | §5 "Two redirects" |
| Connect OAuth redirect URIs | That environment's address plus **both** redirects exactly as the code builds them, in that mode's Connect settings. A stable address only; live mode requires HTTPS (vendor docs) | §5 "Two redirects" |
| Webhook endpoint and signing secret(s) | An endpoint at that environment's address, in its mode; one endpoint or two (platform and Connect) as the private inventory records the layout. Local uses the Stripe CLI listener and its own secret | §5 "A signature failure" |
| Endpoint subscribed events | Every type the route acts on **for that endpoint's side**, derived per §2 | §2 |
| Endpoint API version | Equal to `STRIPE_API_VERSION` at `origin/main` | §5 "API version" |
| Portal configuration | One per mode, created by `scripts/setup-bos-portal-configuration.ts` | §5 "Portal" |
| Plan prices | Present in that account under the lookup keys before `BUSINESS_OS_PLAN_PRICES_ENABLED` is on there | §5 "Plan prices" |
| Which Stripe account | Private inventory only | Public-repo rule |

"Local" in this table is guidance for whoever runs the app locally. DO reads no `.env*` file, so local is never a DO check.

## 2. Where the code reads it

| Name or fact | Read in |
|---|---|
| `STRIPE_SECRET_KEY` | `lib/stripe/StripeService.ts`, `lib/business-os/billing/stripeClient.ts`, `lib/business-os/billing/stripeMode.ts` (and many callers through them) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `lib/client/stripeJs.ts` (build-inlined) |
| `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | `app/api/stripe/webhook/route.ts` (`POST`, the secrets loop) |
| `STRIPE_CLIENT_ID` | `app/api/payments/stripe-connect/oauth-link/route.ts` |
| `NEXT_PUBLIC_STRIPE_CLIENT_ID` | `lib/plugins/definitions/stripe-plugin-v2.json` (placeholder; redirect to `app/oauth/callback/[plugin]/route.ts`) |
| `STRIPE_BOS_PORTAL_CONFIGURATION_ID` | `lib/business-os/billing/portalConfiguration.ts` |
| API version pin | `STRIPE_API_VERSION` in `lib/business-os/billing/stripeClient.ts`; a guard test keeps `lib/stripe/StripeService.ts` equal to it |
| Expected names per environment | `lib/admin/environment/catalogue.ts`, group `payments` |
| Event types acted on | Derived per side, below. Never copied from a setup guide |

`BUSINESS_OS_PLAN_PRICES_ENABLED`, `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` and `BUSINESS_OS_CREDITS_BOOST_ENABLED` are ours, not Stripe's: they depend on the Stripe state above (`docs/feature_flags.md`).

**Deriving the event types, per side, at `origin/main`.** A **platform** event has no `event.account`; a **Connect** event has one.

1. **Platform, router.** Open `DEFAULT_RESOLVERS` in `lib/business-os/billing/webhookDispatcher.ts`. For each resolver, every type its `resolve` reads is acted on: the plan resolver's `switch` in `lib/business-os/billing/planInvoiceResolver.ts`, and the boost resolver's type lists (`lib/business-os/boost/boostChargeEvents.ts`, `lib/business-os/boost/boostWebhookSession.ts`). A type read only behind a flag counts: the flag can turn on without the endpoint changing.
2. **Platform, switch.** In the route's `switch (event.type)`, each case whose platform branch calls a handler.
3. **Connect.** The dispatcher returns before any resolver for a Connect event, so only the `switch`: each case whose Connect branch (`isConnectEvent`, `connectAccountId`) calls a handler.
4. **Not acted on:** a case that only logs, a branch that `break`s for that side, and the `default` ("Unhandled event type"). Subscribing to such a type is harmless but writes a claim row per delivery.
5. A case whose branch you cannot read with certainty makes that side **"not read (side)"**, never a guess. The expected list for an endpoint is the union of the sides the recorded layout sends to it.

## 3. Dashboard steps (the user)

By area name, because the vendor's UI moves: confirm the path in the dashboard at use time. Click-paths are in `docs/STRIPE_WEBHOOK_SETUP_GUIDE.md`, `docs/STRIPE_CONNECT_SETUP_GUIDE.md` and `docs/STRIPE_ENV_SETUP.md`, **but their event lists lag the code**: use §2.

- **API keys**, in the right mode: create, roll or restrict a key.
- **Webhooks**: the endpoint's address, mode, whether it listens to events on your account or on connected accounts, subscribed events, API version, recent deliveries, roll secret, resend an event.
- **Connect settings, OAuth**: the client ID of that mode, and the redirect URI list.
- **Customer portal configuration**: created and checked by `scripts/setup-bos-portal-configuration.ts` (its header holds the flags), never edited by hand.
- **Setting the value on Vercel**: `vercel-ops` and `env-change-protocol`.

The user reports presence, mode, status, the API version "equals the pin: yes/no", and the last-updated time. Never a key, a secret, an ID or an endpoint URL.

## 4. Probes

Each fails when the setting is wrong. No probe needs DO to hold a secret. Log evidence is that deployment's runtime logs (`vercel-ops` §3, §4) in a window after the probe time: counts by level and message class, never a copied line.

| Change | Probe | Fails when | Who | Evidence |
|---|---|---|---|---|
| Webhook signing secret (set, rolled, layout changed) | The resend probe below, steps 1–7 | 400 "Invalid signature" (log "Signature verification failed"), or 500 "Webhook secret not configured" (log "No Stripe webhook secret configured") | User (dashboard); DO (count, logs) | Delivery status the user reports; DO's precondition count and log classes |
| Endpoint subscribed events | DO derives the types per side (§2); the user reads the endpoint's list | A type acted on for that side is not subscribed | DO + user | "All N present" per side, or the missing type names (public code facts) |
| Endpoint API version | The user reports the endpoint's version; DO reads the pin at `origin/main` | They differ | DO + user | "Equals the pin: yes/no", by role |
| Secret key mode / account | The checkout probe below: the vendor marks test mode in the checkout | Production shows test mode, or a non-production deployment does not | Main session or user | "Test-mode marker shown: yes/no", the deployment by role, the time |
| Publishable key | Same checkout: the payment frame loads | The app shows its "not configured" line, or the frame fails to load (wrong mode or account) | Main session or user | Loaded: yes/no, error class only |
| Connect client and redirect URIs | Start "connect an existing Stripe account", and the Stripe plugin's connect, on that deployment; **stop at the vendor's authorise page** | The vendor shows an error for an unknown client or a redirect not registered (its OAuth reference names `invalid_redirect_uri`; confirm at use time) | Main session or user | Page loaded without error: yes/no, per flow; mode shown |
| Portal configuration | The user opens Settings → Plan → Update card on that deployment | Refused ("not available right now"), with a `bos_billing_portal_configuration_` line carrying `alert: true` | User; DO (logs) | Count of `bos_billing_portal_configuration_` events after the probe time = 0 |
| Plan prices, before the flag | `npm run check-bos-plan-prices`, key file outside every checkout, expected account named | Any FAIL row, or a refusal | User (key holder) | VERDICT row only. A pre-check, never the post-change probe |
| Plan prices, after the flag | Once that deployment is Ready with the flag on, start the plan checkout (the checkout probe) and open Settings → Plan's invoice list | A configured lookup key resolves to no price | Main session or user; DO (logs) | Count of `bos_billing_lookup_key_missing` (logged with `alert: true` by `lib/business-os/billing/planPriceCatalog.ts` and `lib/business-os/billing/planCheckoutPrice.ts`) and of `bos_billing_checkout_price_mismatch` after the probe time = 0 |

**The resend probe** (production-safe only under every step):

1. **Which endpoint.** Probe each endpoint whose secret changed, from **that endpoint's own** delivery list. The route tries both secrets on every delivery, so a resend from the other endpoint passes on the unchanged secret and proves nothing.
2. **Which event.** One that endpoint already delivered with a 2xx. Prefer a type that, on that side, reaches no money handler (§2 step 4), derived at use time; the skill names none.
3. **Precondition, before the resend.** The user gives the event ID in chat. It is not a secret, but it never goes into tracked text; the change record holds it only in the private docs. DO counts, on **the database that deployment uses** (`supabase-ops` §1, `devops.md` rules (a)–(c)), the `processed_webhook_events` rows with that `event_id` and `status = 'completed'`. The count must be **exactly 1**. On 0, an error, or doubt about which database: **do not resend**; the result is "not probed". A 2xx in the dashboard does not prove the row exists: rows can be deleted by account cleanup, a claim write can fail while the handler still answers 2xx, and a row can be left at `processing` (`lib/repositories/ProcessedWebhookEventRepository.ts`, `STALE_CLAIM_AGE_MS`).
4. **Resend** after the deploy is Ready (`vercel-ops` §4). The user reports the delivery's status.
5. **Pass:** for that event, "Received event" then "Event already processed, skipping duplicate" (200, `duplicate: true`).
6. **Stop:** "Event recorded, processing", "Retrying previously failed event" or a `bos_webhook_stale_claim_reclaimed` line for the resent event means a handler was reached. DO stops and escalates to the user and SA. Any other class is reported, not judged a pass.
7. **Overlap.** While the vendor still signs with the old secret too (check its docs at use time), a pass does not prove the new value is deployed: record "pass, not conclusive (overlap)". Repeat after the old secret has expired, or leave it not conclusive.

**The checkout probe** (secret key mode, publishable key, plan prices):

- **Preconditions:** `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` is on for that deployment (the route `app/api/business-os/billing/plan/checkout/route.ts` answers 404 otherwise), and an internal account exists that may start a checkout (`lib/business-os/billing/planCheckoutEligibility.ts` and the purchase offer it points to). Either missing: "not probed". The invoice-list and portal probes also need `BUSINESS_OS_PLAN_PRICES_ENABLED` on and a billing row of that mode for the account (`lib/business-os/billing/planBillingDocuments.ts`).
- **Side effects, expected and not money:** a vendor customer for that account in that mode may be created; an open checkout session that later expires, whose expiry event the webhook handles; an audit row for the checkout start. **Never enter payment details.**

Supporting SQL evidence (DO, rules (a)–(c), counts only): `processed_webhook_events` rows after the change time, by `status` and by the `livemode` in `metadata`. The table is shared by every deployment that uses that database, so it only supports the per-deployment logs, which are primary.

## 5. Gotchas

- **The mode is in the key.** `lib/business-os/billing/stripeMode.ts` takes test or live from the secret (or restricted) key's prefix and fails closed on anything else. Test and live billing rows share one database, so a test key on production does not fail loudly: the app reads test-mode rows.
- **Shape check.** `lib/client/stripeJs.ts` checks only the publishable key's shape, so a key from the wrong mode or account passes. It is build-inlined: a change needs a new build (`vercel-ops` §4).
- **A signature failure writes nothing.** No secret or no match returns before any claim row. An empty `processed_webhook_events` window does not prove "no events"; read the logs and the dashboard's delivery status too.
- **A resend can run a handler.** Only a `completed` claim stops it (the resend probe, step 3). A resend of a `failed` event reprocesses it, which can move money.
- **Never send a synthetic test event to production.** It runs the handlers with fabricated objects. Synthetic events are for a test-mode endpoint.
- **API version.** Webhook payloads follow the **endpoint's** API version, set in the dashboard. `lib/payments/invoiceSubscription.ts` records a field that moved between versions and left plan periods charged but not recorded. A version change is a code change first (Dev moves the pin, SA reviews); the endpoint follows **after** the deploy with the new pin is Ready. Whether the vendor allows a parallel endpoint for the overlap: its docs at use time.
- **Stale event lists.** The setup guides lag the route. Derive per §2. `charge.refunded` is ignored by the `switch` on both sides, yet on the platform side the boost resolver reads it before the `switch`; Connect refunds are recorded from `refund.*` (`docs/retrospectives/STRIPE_CONNECT_REFUND_WEBHOOK_RETROSPECTIVE.md`).
- **Two redirects, two client-ID names.** The Connect flow (`app/api/payments/stripe-connect/oauth-link/route.ts`) builds its redirect from `platformOrigin()` plus a path **and a query string**; the plugin flow uses its own callback path. The vendor's OAuth reference says a requested redirect must exactly match a registered one. Register each exactly as the code builds it, read at use time, and let the probe confirm. Registering one leaves the other flow broken. `platformOrigin()` refuses a loopback address on Vercel.
- **Portal.** `lib/business-os/billing/portalConfiguration.ts` never falls back to the vendor's default: a missing, unreadable, other-mode, inactive or too-permissive configuration closes Update card on purpose. Create it per mode with the script; never hand-edit it.
- **Plan prices.** `lib/business-os/billing/planPriceCatalog.ts` finds prices by lookup keys that are the same in both modes, and caches them per instance for a few minutes; `lib/business-os/billing/planCheckoutPrice.ts` checks the current tier's key on each checkout. A cached load logs nothing, so the after-flag probe runs on the new deployment.
- **Key files stay outside every checkout.** `scripts/lib/stripe-script-guards.ts` refuses otherwise. Older Stripe scripts in `scripts/` (for example `scripts/check-stripe-webhook-status.ts`) pin an older version and print identifiers: not used here.
- **Preview addresses change per deployment**, and Preview is behind deployment protection. A webhook or OAuth redirect can only target a stable address. A probe that meets the protection page is "not probed" (`vercel-ops` §4).

## 6. Drift checks

In the `env-drift-audit` §7 format, and under its rules: §2 expected state, §4 comparison, §5 severity, §6 output. "Who reads" as there.

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| T-ST-1 | On each **Vercel target**: every `payments`-group name the catalogue marks required is present; none it marks forbidden is. Local is not a Vercel target: "not read (main session / user)" | `lib/admin/environment/catalogue.ts` at `origin/main`; private inventory (project per role) | `vercel-ops` §3 Env vars | High | DO |
| T-ST-2 | No Stripe name other than `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_STRIPE_CLIENT_ID` carries the `NEXT_PUBLIC_` prefix | Catalogue at `origin/main` | `vercel-ops` §3 Env vars (names only) | Critical | DO |
| T-ST-3 | Mode and account per environment: secret key, publishable key, Connect client and portal configuration all in the recorded mode and account | Private inventory | User report (dashboard); the checkout probe; portal-refusal log count | Critical | User; DO (log count) |
| T-ST-4 | Each recorded endpoint: enabled, right address and mode, account or connected-accounts side as recorded, subscribed to every type acted on for its side(s), API version equal to the pin | Code at `origin/main` (§2 derivation, pin); private inventory (layout) | User report (dashboard) | High | User; DO (code side; "not read (side)" per §2 step 5) |
| T-ST-5 | Webhook delivery health: no signature failures and no handler failures on the webhook path since the last recorded run | Change records | That deployment's runtime logs (`vercel-ops` §3); supporting `processed_webhook_events` counts by status (`supabase-ops` §2, rule (c)) | High | DO |
| T-ST-6 | Connect OAuth redirects: each redirect, exactly as the code builds it (read at use time), registered for each environment's stable address in the matching mode | Code at `origin/main`; private inventory (addresses) | User report (dashboard) | High | User |
| T-ST-7 | Portal configuration passes the setup script's check; plan prices pass where the plan-price flag is on | Scripts at `origin/main`; private inventory (where the flag is on) | `scripts/setup-bos-portal-configuration.ts`, `scripts/check-bos-plan-prices.ts`, run by the key holder | High | User |

## 7. Tiers and order against the deploy

**Tiers.** Adding or changing a **test-mode** webhook endpoint is reversible (`.claude/agents/devops.md` § Permission Tiers); DO holds no Stripe tool, so the user applies it after the approval in chat. Anything in live mode, any key creation, roll or revoke (test mode included: a key action is a key rotation), Connect OAuth settings, and a live portal configuration are production tier: SA reviews the plan, the user executes.

| Change | When |
|---|---|
| A new Stripe name the merging code requires | Before merge, on every target the catalogue marks required |
| A webhook endpoint or event type the merging code starts to act on | Before merge (an unsubscribed type is never delivered) |
| Key or secret roll | Set new → deploy Ready → probe → revoke old **after deploy** |
| API version change | After the deploy that moves the pin |
| `BUSINESS_OS_PLAN_PRICES_ENABLED` on | After `check-bos-plan-prices` passes for that environment's account |
