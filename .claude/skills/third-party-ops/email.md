# Email (Resend, SMTP, the Gmail system sender)

Part of the `third-party-ops` skill: read its `SKILL.md` first. This file adds only what is specific to email, in the template's six parts plus tiers and order. Every file path is confirmed at use time; if one has moved, the catalogue names the variable and the reader finds where it is read now.

Before each use, confirm the three services are still live (`SKILL.md` §5): a code path that runs, and the names set on Vercel. Drop any that is not.

---

## 1. What must differ between environments

**Target (decided in code):** production always has Resend set (the transport refuses a keyed send in production without it). The send order is fixed by code, so which provider sends first follows from which names are set, not from a choice per environment. The **current** setup (which providers have their names set where, which Resend account each uses, which endpoints exist) is recorded in the private inventory by role, and that record is the expected state an audit compares with. Any change from it is a later decision, not a fix DO plans on its own. Preview has no webhook endpoint (SA ruling): it has no stable address and sits behind deployment protection.

| Setting | Rule per environment | Grounding |
|---|---|---|
| Which providers have their names set | As recorded; the order is fixed by code (§2); production target: Resend set | §5 "Silent fallback" |
| Which Resend account | Private inventory. One endpoint receives events for every key on its account, so environments sharing an account share events; the route answers those 200 "unknown message id". Resend has no test/live split to rely on (vendor fact, confirm at use time) | §5 "Shared account" |
| Resend API key | A separate key per environment, so each can be revoked alone. Sending-only access, limited to the sending domain if the vendor offers it (confirm at use time) | §5 "Silent fallback" |
| Sending domain and sender address | `RESEND_FROM_EMAIL` on a domain Resend shows as verified for that key's account. Never the built-in default (`RESEND_DEFAULT_FROM`) in production | §5 "Sender address" |
| Webhook endpoint and secret | One endpoint per environment that receives events, at its stable address, with its own `RESEND_WEBHOOK_SECRET`. No endpoint means no secret, and the route refuses every delivery | §5 "No secret" |
| Subscribed events | Derived per §2 at `origin/main` | §2 |
| SMTP relay | Host, port, user and pass all set, or none. Port 465 is always TLS; otherwise `SMTP_SECURE`. The relay must be allowed to send for the sender address's domain | §5 "From by provider" |
| Gmail system sender | All four `GMAIL_*` names or none. The OAuth client and its consent screen are Google Cloud (DO-6c) | §5 "Two Gmail readers" |

"Local" is guidance for whoever runs the app locally. DO reads no `.env*` file, so local is never a DO check.

## 2. Where the code reads it

| Name or fact | Read in |
|---|---|
| All Resend sending, SMTP and Gmail names; the provider order | `lib/notifications/emailTransport.ts` (`resendConfigured`, `smtpConfigured`, `gmailConfigured`, `sendEmail`) |
| `RESEND_FROM_EMAIL` as the sender gate | `platformSenderAddress()` in the same file; its callers found at use time |
| `RESEND_WEBHOOK_SECRET`; event cases; outcomes | `app/api/webhooks/resend/route.ts` (`POST`, `verify`, `toDeliveryEvent`) and `recordDeliveryEvent` in `lib/repositories/EmailAutomationRepository.ts` |
| The four `GMAIL_*` names, a second time | `app/api/contact/route.ts`: reads them itself; does not use the transport, its order, Resend or `email_sends`. Its callers are tracked as V-14 in `docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md` |
| Which provider sent a recorded mail | `email_sends.provider`, written by `lib/notifications/recordEmailSend.ts` (only mail tied to a contact is recorded; `sendgrid` is a historic column default no code writes) |
| Expected names per environment | `lib/admin/environment/catalogue.ts`, group `email` (all optional, so it cannot give "required"; the private inventory does) |

`BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` is ours, not the vendor's, and is in the catalogue's `features` group: it gates the plan-cancel emails and their reminder cron, and they need the sender address (`docs/feature_flags.md`).

**Deriving the subscribed types, at `origin/main`.** The types acted on are the `toDeliveryEvent` cases that return non-null, never the `ResendEventType` union (it holds a type that returns null). From those, drop the ones the route's header lists under "DELIBERATELY NOT SUBSCRIBED". The result is the expected list; the skill names none. Resend has one side only, so the per-side rule of `stripe.md` §2 does not apply. A case you cannot read with certainty makes the list "not read", never a guess.

**Existing scripts**, each a key-holder tool, never the post-change probe:

| Script | Use |
|---|---|
| `scripts/resend-webhook-smoke.ts` (`npm run resend:smoke`) | Local, or a non-production stable address, by the key holder, **default arguments only** apart from `--url` (no `--id`, no `--type`): it invents a message id, so the route writes nothing. It proves the deployed secret equals the held one, not the vendor's. **Never against production** (a synthetic event, and the production secret in hand). The npm script reads the checkout's `.env.local`: a local tool by construction |
| `scripts/validate-resend.mjs` | Pre-check of a key, **never with `--to`** (that sends straight to the vendor, past the transport). It reads `.env.local` from the working directory, so for a non-local key run it outside every checkout with the values in that shell only. Report the verdict line only. A sending-only key may be refused the domain list it reads, so a 401 there can mean "correctly scoped" (confirm at use time) |
| `scripts/validate-gmail.mjs` | Pre-check for T-EM-8: exchanges the refresh token, sends no mail. Same conditions; report the verdict and error code only |
| `scripts/generate-gmail-token.js` | Rotation tool for `GMAIL_REFRESH_TOKEN`. It prints the token: for a non-local target the value goes from the terminal straight into Vercel (`vercel-ops`, `env-change-protocol`), never into chat or a file in a checkout. It needs a loopback redirect registered on the Gmail OAuth client (DO-6c) |

## 3. Dashboard steps (the user)

By area name, because the vendor's UI moves: confirm the path at use time.

- **Resend, Domains:** add or check the sending domain. It is verified only when the SPF, DKIM and return-path records it lists are published. The records belong to DO-6e (registrar and DNS); their values go from the vendor dashboard into DNS, never into tracked text. DMARC is a domain-owner record (DO-6e). Open and click tracking stay off, so no tracking record.
- **Resend, API keys:** create, scope or delete a key; report per-key "last used" if shown.
- **Resend, Webhooks:** the endpoint's address, enabled state, subscribed events, recent deliveries, replay, rotate the signing secret.
- **Resend, Emails (sent log):** a message's status and sending domain.
- **SMTP relay console:** credentials, and whether the relay may send for the sender address's domain.
- **Gmail system sender:** a new refresh token with `generate-gmail-token.js` (§2). Google Cloud console steps: DO-6c.
- **Setting the value on Vercel:** `vercel-ops` and `env-change-protocol`.

The user reports presence, status, verified yes/no and the last-updated time. Never a key, a secret, an address, a domain or an endpoint URL.

## 4. Probes

Each fails when the setting is wrong. No probe needs DO to hold a secret. Log evidence is that deployment's runtime logs (`vercel-ops` §3, §4) in a window after the probe time: counts by level and message class, never a copied line (the send lines carry the recipient). No probe breaks Resend to reach a fallback.

**Transport failure classes** (module `EmailTransport`): "Resend API error", "Resend send failed — trying next transport", "Resend keyed send failed — no fallback for a keyed send", "SMTP send failed — trying next transport", "Gmail send failed", "No email transport delivered the message (preview only)", any line containing "not a valid Resend key", and the two lines carrying `idempotency_unsupported`. "Email sent" is counted by `provider` **for module `EmailTransport` only**: `NotificationService` logs the same class.

| Change | Probe | Pass | Fails when | Who |
|---|---|---|---|---|
| Resend key, sender address, domain | The send probe below | "Attempting to send email" with `resendConfigured` true; "Email sent" with provider `resend`; the sent log shows it delivered from the verified domain; the received message's SPF, DKIM and DMARC pass (user reports pass/fail only) | Provider `smtp`, `gmail` or `none`; any transport failure class in the window; the invite records `sender_not_configured` | User (trigger, dashboard, mailbox); DO (logs) |
| Resend key roll | Send probe after the new deploy is Ready | As above, **and** the new key's "last used" is after the probe time | Same. While the old key still works: "pass, not conclusive (overlap)" until it is deleted and the probe repeated | User; DO |
| Webhook secret (set or rotated) | The replay probe below | Dashboard 200, and 0 "Webhook signature did not verify", 0 "RESEND_WEBHOOK_SECRET not configured" and 0 "Webhook rejected: timestamp outside the replay window" after the probe time, outside an overlap | 401 with a signature or secret line and no timestamp line (with the timestamp line it is "not probed (timestamp)", step 3) | User; DO |
| Subscribed events | DO derives per §2; the user reports the endpoint's list | All derived types present | A derived type missing | DO + user |
| SMTP / Gmail credentials | The send probe, **only where that provider is the recorded first sender** | Provider is the expected one | Provider differs, or "relay refused" inside the SMTP failure line | User; DO |
| Fallback health (any time) | DO counts module `EmailTransport` "Email sent" by provider, and the failure classes, in a window | Matches the recorded first provider; 0 failure classes | Any fallback or failure class | DO |

**The send probe.** Conditions, all four: goes through `sendEmail`; gated on `platformSenderAddress()`, so it also proves the sender address; goes to an address the user owns; moves no money and touches no customer's data. The admin invitation to the user's own address meets them, created with the send-email option on (off, nothing is sent) and a non-Paid type: its create path in `lib/business-os/invites/adminInviteOps.ts` does not check whether the address already has an account (confirm at use time). **Side effects:** an invite row and its audit entries (created, then email sent or not sent); the revoke adds one more. **Cleanup:** never open the link; revoke the invite (`app/api/admin/business-os/invites/[inviteId]/revoke/route.ts`). If no trigger meets all four at use time, the result is "not probed", never improvised. The contact route (§2) is **never** a probe.

**The replay probe.**

1. **Precondition:** an event the endpoint already delivered whose type, per `toDeliveryEvent`, carries **no `status`**, derived at use time and never named here. `recordDeliveryEvent` then either writes nothing (`duplicate`) or writes only what the first delivery failed to record (a missing timestamp, and for an open or click its count once); no status, no money. An event whose message id matches no row is also safe (200, "No email_sends row carries this message id"). **Never replay a status-carrying type:** its status and error are patched on every delivery.
2. **Replay** from that endpoint's own delivery list after the deploy is Ready (`vercel-ops` §4).
3. **Timestamp.** The route refuses a signature older than `MAX_AGE_SECONDS`. Whether the vendor re-signs a replay at send time is confirmed at use time. A 401 with the timestamp line in the window is **"not probed (timestamp)"**, never a secret failure.
4. **Overlap.** `verify` accepts any one signature in the header. While the vendor still signs with the old secret too (its docs at use time), a pass is **"pass, not conclusive (overlap)"** until the overlap ends.
5. Every 200 the route returns comes after `verify`, so outside steps 3–4 a dashboard 200 is conclusive.

Supporting SQL evidence (DO, `devops.md` rules (a)–(c)): `email_sends` counts by `provider` and by `status`, filtered on `created_at` after the change time; no other column selected or grouped (the table holds recipient and body columns). It is shared by every deployment on that database, so it only supports the per-deployment logs.

## 5. Gotchas

- **Silent fallback.** A key of the wrong shape logs one warn and skips Resend; a key Resend refuses logs "Resend API error", then SMTP or Gmail sends and the caller sees `sent: true` (`emailTransport.ts`). "Mail is going out" does not prove Resend works: check the provider.
- **All-or-none, without a line.** A partial set of a provider's names skips it with no "skipped" line. "Attempting to send email" carries `resendConfigured`, `smtpConfigured` and `gmailConfigured`: read those fields.
- **Keyed sends never fall back.** After a Resend failure a keyed send stops, on every deployment. In production a keyed send without Resend is refused (`idempotency_unsupported`); elsewhere it goes out unkeyed with one warn.
- **From by provider.** `sendEmail` sets `from` before any provider runs, so `SMTP_FROM` and `SMTP_FROM_NAME` never take effect. On SMTP, fallback mail carries the Resend-domain From through another relay, which may refuse it or fail alignment. Gmail is handed that From too, and the vendor shows the authenticated account unless the address is a verified send-as alias (confirm at use time). Tracked as FU-D6b-b.
- **Sender address.** A missing or malformed `RESEND_FROM_EMAIL` stops every caller that gates on `platformSenderAddress()` (found at use time), including the invite signup code (`lib/business-os/invites/redemptionDeps.ts`), so invite-only signup stops, as well as invitations and the plan-cancel mail. It is logged and audited, never a failed request.
- **Two Gmail readers.** `app/api/contact/route.ts` builds its own Gmail transport. A working Resend proves nothing about contact-route mail, and a broken Gmail token stops it alone.
- **No secret.** The webhook route refuses with 401 on every deployment without `RESEND_WEBHOOK_SECRET` (its header says "in production"; the code checks everywhere). A missing secret and a bad signature return the same body: only the log class tells them apart.
- **Duplicates log at debug.** "Delivery event added nothing new" is a debug line, so at the default production level a pass is "200, and 0 failure classes". An unacted type returns 200 with no line.
- **Shared account.** Events for every key on one Resend account reach its endpoint; mail from another environment answers "unknown message id". That is expected, not drift.
- **Tracking stays off.** The route's header records open and click tracking as declined; turning it on rewrites every link and adds a pixel. Those events never arrive, and are not subscribed.
- **Authentication is not the inbox.** Mail with SPF, DKIM and DMARC passing has still been quarantined (the comment on `unsubscribeUrl` in `emailTransport.ts`).
- **Gmail token expiry.** `scripts/validate-gmail.mjs` notes that an OAuth app left unpublished makes the refresh token expire within days (confirm at use time; consent screen: DO-6c).
- **Preview addresses change per deployment**, and Preview is behind protection: a webhook can target only a stable address (`vercel-ops` §4).

## 6. Drift checks

In the `env-drift-audit` §7 format, and under its rules. "Who reads" as there.

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| T-EM-1 | On each **Vercel target**, the `email`-group names match the recorded provider set. Local: "not read (main session / user)" | Catalogue at `origin/main`; private inventory | `vercel-ops` §3 Env vars | High | DO |
| T-EM-2 | No `email`-group name carries `NEXT_PUBLIC_` | Catalogue at `origin/main` | `vercel-ops` §3 Env vars (names only) | Critical | DO |
| T-EM-3 | Each provider's names all present or all absent on a target; the `GMAIL_*` set also serves the contact route | `emailTransport.ts` and `app/api/contact/route.ts` at `origin/main` | `vercel-ops` §3 Env vars (names only) | High | DO |
| T-EM-4 | Mail goes out through the recorded first provider: 0 transport failure classes (§4) since the last run | Private inventory; change records | Runtime logs, module `EmailTransport`; supporting `email_sends` counts | High | DO |
| T-EM-5 | Sending domain verified, all its records verified, sender address on it, open and click tracking off | Private inventory; route header at `origin/main` | User report (Resend Domains) | High | User |
| T-EM-6 | Each recorded endpoint enabled, at the right address, subscribed to every derived type (§2), no failing deliveries | Code at `origin/main`; private inventory | User report (Resend Webhooks) | High | User; DO (code side) |
| T-EM-7 | Webhook health: 0 "Webhook signature did not verify", 0 "RESEND_WEBHOOK_SECRET not configured" where an endpoint is recorded, 0 "Could not record the delivery event" | Change records | Runtime logs | High | DO |
| T-EM-8 | Gmail system sender, and the contact route, where recorded in use: the refresh token still valid; consent-screen publishing status per DO-6c | Private inventory | `scripts/validate-gmail.mjs` verdict, run by the key holder; user report | Medium | User |

## 7. Tiers and order against the deploy

**Tiers.** A non-production webhook endpoint is reversible (`.claude/agents/devops.md` § Permission Tiers); DO holds no vendor tool, so the user applies it after the approval in chat. Any key create, scope or delete, any domain or DNS change, the production endpoint and its secret, and SMTP or Gmail credentials are production tier: SA reviews the plan, the user executes.

| Change | When |
|---|---|
| `RESEND_FROM_EMAIL` moves to a new domain | After that domain is verified |
| A type the merging code starts to act on | Subscribed before merge |
| Key, secret or token roll | Set new → deploy Ready → probe → delete old **after deploy** |
| `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` on | Only after the send probe has passed on that deployment with a sender-gated trigger; it also turns on the reminder cron |
