# Workplan: D12 — Agent-sent emails as multipart/alternative (HTML + plaintext)

**Developer:** Dev
**Requirement:** [V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md](/docs/requirements/V6_AI_DECLARED_TRANSFORM_SCHEMA_RECONCILIATION_REQUIREMENT.md) → item **D12**
**Related RCA:** [AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md) → "Addendum — 2026-07-13"
**Branch:** `agent-failure-troubleshooting`
**Date:** 2026-07-21
**Status:** Code Complete

## Analysis Summary

Agent-sent emails are delivered as **single-part `text/html`** with no plaintext alternative, hurting
deliverability (spam scoring), accessibility, and rendering in plaintext-only clients. Same root class as D9
(the notification transport, already fixed), but on the **agent-facing plugin path**.

Root cause (confirmed): the Gmail plugin definition already declares BOTH `body` (plaintext) and `html_body`
(HTML), but `buildEmailMessage` in `lib/server/gmail-plugin-executor.ts` (~L622-644) treats them as mutually
exclusive — when `html_body` is present it emits single-part `text/html` and silently discards `body`. V6
generation only ever wires `html_body` (never `body`), so in practice there is no plaintext part at all —
meaning the `htmlToText(html_body)` fallback is the branch that actually fires today.

Files touched: shared email util, Gmail executor (primary), Outlook executor (assessed), contact route
(secondary), V1 `sendEmailDraft` (reachability + fix). Deliberately NOT touching `lib/agentkit/v6/**`
(concurrent WP-62/63 team) or `lib/plugins/definitions/google-mail-plugin-v2.json` (concurrent edit in flight).

## Implementation Approach

1. **Extract `htmlToText` into ONE shared, dependency-free util** (`lib/email/htmlToText.ts`) — the D12
   "one shared util" architectural rec. `emailTransport.ts` re-exports it so D9 behavior + tests are unchanged.
2. **Gmail `buildEmailMessage`** — when `html_body` is present, build a real `multipart/alternative`:
   `text/plain` = `content.body` if non-empty else `htmlToText(html_body)`; `text/html` = `html_body`.
   Preserve the text-only path (single-part `text/plain`) and the base64url encoding. Correct CRLF, unique
   boundary, per-part headers, trailing `--boundary--`. Plaintext part first (RFC 2046 preference order).
3. **Outlook** — MS Graph's simple message model has no clean multipart. Decision documented below.
4. **Contact route** — add `text: htmlToText(html)` to both nodemailer sends (reuse shared util). Also convert
   this route's `console.*` to Pino (mandatory standard for a touched server file).
5. **V1 `sendEmailDraft`** — reachability verified (see finding); fix applied per the same multipart pattern.

### Root-cause phase note (V6 protocol)
This is NOT a V6-pipeline fix. The defect is entirely in the **plugin execution layer** (MIME construction
in the executor) + shared email utilities. No `lib/agentkit/v6/**` file is touched. The generation-side
`body` emission is an explicitly OPTIONAL, out-of-scope follow-up gated on the WP-62/63 team.

## Files to Create / Modify
| File | Action | Reason |
|------|--------|--------|
| `lib/email/htmlToText.ts` | create | Shared dependency-free `htmlToText` util (extracted from D9) |
| `lib/notifications/emailTransport.ts` | modify | Import + re-export shared `htmlToText` (remove duplicate) |
| `lib/server/gmail-plugin-executor.ts` | modify | `buildEmailMessage` → multipart/alternative (PRIMARY fix) |
| `lib/server/outlook-plugin-executor.ts` | modify | Code comment documenting the Graph-model limitation (no code behavior change) |
| `app/api/contact/route.ts` | modify | Add `text` part to both sends; convert `console.*` → Pino |
| `lib/plugins/google-mail/sendEmailDraft.ts` | modify | V1 reachable → multipart/alternative (plaintext = `body`) |
| `lib/email/__tests__/htmlToText.test.ts` | create | Unit tests for the shared util |
| `lib/server/__tests__/gmail-buildEmailMessage.test.ts` | create | Multipart + text-only + body-not-discarded tests |
| `lib/notifications/__tests__/emailTransport.test.ts` | (unchanged) | D9 tests still pass after extraction |

## Task List
- [x] Step 1: Read requirement D12, RCA addendum, CLAUDE.md, all target files
- [x] Step 2: Verify V1 `sendEmailDraft` reachability
- [x] Step 3: Create shared `lib/email/htmlToText.ts`; re-export from `emailTransport.ts`
- [x] Step 4: Gmail `buildEmailMessage` → multipart/alternative (primary)
- [x] Step 5: Outlook — document the Graph-model limitation (comment + workplan note)
- [x] Step 6: Contact route — add `text` parts + Pino conversion
- [x] Step 7: V1 `sendEmailDraft` — apply multipart pattern (reachable)
- [x] Step 8: Tests (htmlToText extraction, gmail buildEmailMessage, contact)
- [x] Step 9: Run test suites

## Decisions & Findings

### Outlook (Item 3) — DEFERRED with reason (documented, no behavior change)
`outlook-plugin-executor.ts` `sendEmail` posts to Graph `/me/sendMail` with the simple message model
(`body: { contentType: 'HTML', content }`). Graph's simple model exposes a SINGLE body with one `contentType`
— it does not accept a parallel plaintext alternative. The only way to send a true `multipart/alternative`
via Graph is to build a full raw MIME message and POST it to `/me/sendMail` with `Content-Type: text/plain`
(base64 raw MIME) — a materially different send shape (different serialization, headers, error handling) from
the current JSON message model. Per the task's "do NOT over-engineer the Outlook path" guidance and because
Outlook is secondary to the Gmail primary, this is **deferred**: I added a clear code comment at the send site
documenting the limitation and the raw-MIME path as the future option. No behavior change to Outlook. Graph
also renders HTML clients fine; the deliverability gap is narrower than Gmail's single-part raw send.

### V1 `sendEmailDraft` (Item 5) — follow-up: broken PDF branch REMOVED
Coordinator follow-up (post-review): the PDF-attachment branch was pre-existing NON-FUNCTIONAL — it called
`generatePDF` (`lib/pdf/generatePDF.ts`), which is a `void` stub that never produces a PDF, so it built a
`multipart/mixed` message with an empty/garbage attachment (and was the source of the two pre-existing TS
errors TS2353/TS2769). Per the user's decision I REMOVED the entire PDF branch (the `generatePDF` call, the
`Uint8Array`/base64 encoding, the nested `multipart/mixed` construction, and its send) plus the now-unused
`generatePDF` import. The `includePdf` param is retained in the type signature (accepted-but-ignored, so the
existing `EmailHandler` caller still compiles) — any request that previously took the PDF path now falls
through to the working `multipart/alternative` send (strictly an improvement: a real email vs. an empty PDF).
`generatePDF.ts` is NOT deleted — it has a second live caller
(`components/dashboard/AgentSandBox/useAgentSandbox.ts:1083`), so it is not dead. Added
`lib/plugins/google-mail/__tests__/sendEmailDraft.test.ts` covering the retained multipart send (incl. the
legacy `includePdf` flag still yielding a normal email, and the not-ok error path). The two TS errors are gone.

### V1 `sendEmailDraft` (Item 5) — REACHABLE → fixed (not dead code)
Reachability chain: `lib/plugins/google-mail/sendEmailDraft.ts` ← imported/called by
`lib/intelligence/utils/EmailHandler.ts` (`handleSmartOutput`, fires when `agent.output_schema?.type ===
'EmailDraft'`) ← instantiated + invoked at `lib/utils/runAgentWithContext.ts:31,402` ← used by live routes
(`app/api/run-agent`, `app/api/agent-stream`, `app/api/cron/process-queue`,
`app/api/run-scheduled-agents-direct`, `app/api/agent-chains/run`). It is therefore **live, not dead code**
(gated behind the legacy `EmailDraft` output-schema shape). Per the D12 AC ("fixed if live; never extended as
V1"), I applied a minimal multipart/alternative fix reusing the plaintext already in hand (`body` param —
the function receives plaintext and wraps it to HTML), for BOTH the non-PDF and PDF (multipart/mixed) branches.
No V1 surface was extended (no new actions/params); only the existing send was made multipart.
Recommendation: this legacy `EmailDraft` path is a candidate for eventual removal once confirmed unused, but
deletion is out of a hotfix's scope.

## SA Review Notes

## SA Code Review

**Code Review by SA — 2026-07-21**
**Status:** ✅ Code Approved — **MUST-FIX list is EMPTY.** Approve for the user's review.

### Overall verdict
Approve. The primary Gmail raw-MIME construction is RFC 2046-valid and correct, the shared-util extraction is a clean no-regression consolidation, the reachable V1 sender is fixed correctly on both branches without extending its surface, and scope is clean (no `lib/agentkit/v6/**` or plugin-definition JSON touched). The tests genuinely assert MIME structure, not just that code ran.

### Explicit confirmations (as requested)
- **Finding 1 — Gmail MIME is valid/correct: CONFIRMED.** The `multipart/alternative` block is RFC-correct: a **quoted, unique boundary** (`=_alt_${Date.now(36)}_${random}` — the timestamp+random suffix makes body collision effectively impossible), **plaintext part BEFORE the HTML part** (RFC 2046 least→most-rich), each part carries its own `Content-Type: text/…; charset=utf-8` header followed by a blank line, **CRLF (`\r\n`) throughout**, the `\r\n--boundary` delimiter form is satisfied (blank line's CRLF + each part body's trailing CRLF precede every `--boundary`), the message ends with the closing `--boundary--`, and the whole thing is still **base64url-encoded** (`+→-`, `/→_`, strip `=`) as Gmail's `raw` format requires. The plaintext source is `content.body.trim()` when non-empty **else** `htmlToText(html_body)`; `body` is **no longer discarded** (the diff shows the old branch emitted single-part `text/html` and dropped `content.body`); and the **text-only path is byte-for-byte unchanged** (single-part `text/plain`, verified against the diff). The test decodes the base64url raw back to MIME and asserts both parts, body-not-discarded (verbatim), html-only→generated-plaintext, empty-body→derived, and text-only→single-part. *(Low, non-blocking: parts carry no `Content-Transfer-Encoding` so they default to 7bit while declaring `charset=utf-8` — but this matches the pre-existing working single-part behavior and Gmail's raw send tolerates it; optional future hardening, not a defect.)*
- **Finding 3 — V1 reachability + multipart correctness: CONFIRMED.** Reachable: `lib/utils/runAgentWithContext.ts` imports `EmailHandler` (L18), instantiates it (L31), and calls `handleSmartOutput` (L402), which calls `sendEmailDraft` — and `runAgentWithContext` is used by the live run routes. So it is live, not dead; fixing (not deleting) was correct. Both branches are structurally valid: the **non-PDF** branch is a well-formed `multipart/alternative` (plaintext `body` first, then `htmlBody`, closing `--boundary--`); the **PDF** branch nests a `multipart/alternative` (distinct `__pdf_alt_boundary__`) as the first part inside the `multipart/mixed` (`__boundary__`), correctly closed with `--__pdf_alt_boundary__--` before the PDF part delimiter. **No V1 surface was extended** — only the existing raw-MIME string was changed; no new action/param/function. The pre-existing `generatePDF`/`Uint8Array` TS errors (L91/92) are unchanged context in the diff (D12-introduced none), correctly left as-is.

### Findings & dispositions (decisive)

| # | Finding | Ruling | Reason |
|---|---------|--------|--------|
| 1 | Gmail raw-MIME correctness | **WON'T-FIX** (correct) | RFC 2046-valid multipart/alternative; body-not-discarded; text-only byte-identical; base64url intact; asserted by decoding tests. |
| 2 | Shared `htmlToText` extraction / D9 regression | **WON'T-FIX** (correct) | Byte-identical move to `lib/email/htmlToText.ts`, re-exported by `emailTransport` (`export { htmlToText }`); single definition; dependency-free; D9 `resolveText` + tests unaffected. |
| 3 | V1 `sendEmailDraft` reachability + multipart | **WON'T-FIX** (correct) | Reachable via `runAgentWithContext → EmailHandler`; both branches valid (nested alternative-in-mixed, distinct boundaries); surface not extended; pre-existing TS errors untouched. |
| 4 | Contact route (`text` part + Pino) | **WON'T-FIX** (correct) | `text: htmlToText(notificationHtml)` added; 5 `console.*`→Pino conversions all structured with `{ err }`/context; no behavior change beyond the text part. |
| 5 | Outlook single-part deferral | **FOLLOW-UP** (acceptable) | MS Graph's simple message model can't carry a parallel plaintext part without switching to a raw-MIME POST (materially different send shape); Graph renders HTML fine so the gap is narrower than Gmail's. Documented comment + workplan note, zero behavior change — a legitimate deferral, not over-engineering. |
| 6 | Scope + standards + tests | **WON'T-FIX** (clean) | No `lib/agentkit/v6/**` / plugin-definition JSON touched (grep-confirmed); new tests assert multipart structure; new suites 10/10 green; D12 introduces no new TS errors. |

**Low observations (no action required, tied to the "V1 not extended" policy):** the V1 sender joins with `\n` (not CRLF) and uses **static** boundaries — both match the pre-existing V1 style and Gmail tolerates LF; the primary Gmail executor correctly uses CRLF + a random boundary. Not worth changing a legacy path that policy says not to extend.

### MUST-FIX list
**EMPTY.** Nothing must change before the user's review. Finding 5 (Outlook multipart via raw-MIME Graph POST) is the only tracked FOLLOW-UP; the Finding-1 CTE-header and V1 CRLF/static-boundary notes are optional hardening, not blockers.

### Code Approved for QA: Yes — after the user's review. No re-review needed (MUST-FIX empty).

---

### SA Delta Review — PDF branch removal — SA 2026-07-21

**Delta status:** ✅ Approve — **MUST-FIX EMPTY.** Clean removal of the broken PDF branch; the two TS errors are gone with none introduced.

**Scope:** `lib/plugins/google-mail/sendEmailDraft.ts` (removed the `generatePDF` import, the `generatePDF()`/`new Uint8Array`/base64 PDF encoding, the `multipart/mixed`+nested-alt construction and its send, and the `if (!includePdf)` conditional) + new `__tests__/sendEmailDraft.test.ts` (3 tests).

**Explicit confirmation — TS errors gone, no new ones:** `tsc --noEmit` shows **zero errors on `sendEmailDraft.ts`** — the former TS2353 (L91) and TS2769 (L92) were in the deleted PDF branch and are gone by construction. The delta introduced no new errors: the file it touched is clean, and `useAgentSandbox.ts` (the second `generatePDF` caller) only carries two **pre-existing, unrelated** `currentActivePhase` implicit-any errors (L563/L605) — its `generatePDF(result, safeOutputSchema)` call at L1083 does not error, and that file was not modified by this delta. No dead/orphaned code remains: the PDF-branch vars/boundaries/imports are fully removed; only `getPluginConnection`, `encodeBase64`, `wrapInHtml`, and the single `__np_alt_boundary__` survive, all used.

**Findings & dispositions:**

| # | Finding | Ruling | Reason |
|---|---------|--------|--------|
| 1 | TS errors resolved + no new / no dead code | **WON'T-FIX** (clean) | `sendEmailDraft.ts` tsc-clean; PDF-branch code fully removed; no orphaned vars/imports/boundaries. |
| 2 | Fall-through when `includePdf: true` | **WON'T-FIX** (correct) | Now hits the normal `multipart/alternative` send (a valid email — not an error, not a no-op; test 2 proves it). Retaining `includePdf?` in the type (accepted-but-ignored, documented) is right — removing it would TS2353 the `EmailHandler.ts:40` caller that still forwards it. |
| 3 | D12 multipart fix intact on the retained path | **WON'T-FIX** (correct) | Plaintext-before-HTML, boundaries, base64url via `encodeBase64` unchanged; it is simply now the sole unconditional path. |
| 4 | `generatePDF.ts` left alone (second live caller) | **WON'T-FIX** (correct) + **FOLLOW-UP** (observation) | Confirmed a second live caller: `components/dashboard/AgentSandBox/useAgentSandbox.ts:6,1083`; the stub is not dead, so leaving `generatePDF.ts` and removing only the `sendEmailDraft` import was correct. The observation that `generatePDF` is a `void` stub — so `useAgentSandbox.ts:1083`'s "generate PDF" is likely non-functional — is a **real latent bug but out of D12's scope**; track it as a one-line backlog item ("generatePDF is a void stub; the dashboard PDF-export at useAgentSandbox.ts:1083 is a no-op — implement or remove"), do not fix in this hotfix. |
| 5 | Tests (retained path + legacy flag + error) | **WON'T-FIX** (adequate) | Test 1 asserts both parts + plaintext-first + no `application/pdf` (decoded from base64url raw); test 2 the legacy `includePdf` fall-through (no mixed, no pdf); test 3 the not-ok throw. |

**Ruling on the generatePDF/useAgentSandbox observation:** **FOLLOW-UP (tracked backlog), not out of scope entirely and not a D12 fix.** It is a genuine latent defect (a UI feature invoking a `void` stub), so it should not be silently dropped — but it is unrelated to D12's email-multipart scope and must not be pulled into this hotfix. A one-line backlog entry is the right disposition.

**MUST-FIX list:** **EMPTY.** Delta approved for QA — no re-review needed.

## QA Testing Report

**QA — 2026-07-21**
**Test mode:** full (D12 AC incl. the PDF-branch-removal delta + MIME-decode assertions + regression + scope/hygiene)
**Strategy used:** A (Jest unit) — the MIME builders are pure/unit-testable (no live-agent dependency); tests decode the base64url raw back to MIME and assert structure. Code-trace for scope + Pino + re-export.
**Focus:** plugin-execution layer (Gmail raw MIME) / shared email util / notifications regression.
**Skipped:** D/E — no UI, no live send needed (deterministic MIME construction, unit-covered).
**Input source:** coordinator prompt + workplan + SA Code Review (main + delta, both empty must-fix).

### What I ran
- `npx jest lib/email lib/server/__tests__/gmail-buildEmailMessage.test.ts lib/plugins/google-mail/__tests__ lib/notifications` → **4 suites / 18 tests, all passing** (htmlToText, gmail-buildEmailMessage, sendEmailDraft, emailTransport).
- `npx tsc --noEmit` → **zero errors on every touched file**: `htmlToText.ts`, `gmail-plugin-executor.ts`, `sendEmailDraft.ts`, `emailTransport.ts`, `app/api/contact/route.ts`, `outlook-plugin-executor.ts`, and the new test files are all clean. **Confirmed: the two former `sendEmailDraft.ts` errors — TS2353 (L91) + TS2769 (L92) — are GONE** (they lived in the deleted PDF branch); D12 introduced no new errors.

### Acceptance criteria
| Item | AC | Result | Evidence |
|---|---|---|---|
| **Gmail (primary)** | valid `multipart/alternative`: unique boundary, `text/plain` BEFORE `text/html`, per-part headers + blank line, CRLF, `--boundary--` close, base64url | ✅ Pass | `gmail-buildEmailMessage.test.ts` decodes the base64url raw → asserts `multipart/alternative; boundary="…"`, both `text/plain`+`text/html` parts, `indexOf('text/plain') < indexOf('text/html')`, `--${boundary}\r\n` open + `--${boundary}--` close. Code uses `\r\n` throughout + unique `=_alt_${Date.now(36)}_${random}` boundary + base64url (`+→-`,`/→_`, strip `=`). |
| **Gmail** | plaintext = `content.body` when non-empty ELSE `htmlToText(html_body)`; `body` NOT discarded | ✅ Pass | Test 1: supplied `'PLAINTEXT VERSION'` used verbatim (not derived). Test 2: html-only → derived plaintext ('Report'/'All good'). Test 3: `body:'   '` (empty-after-trim) → treated as absent → derived. `plainPart = suppliedPlain || htmlToText(html_body)`. |
| **Gmail** | text-ONLY path unchanged single-part `text/plain` | ✅ Pass | Test 4: no `html_body` → single-part `text/plain`, `not.toContain('multipart/alternative')`, `not.toContain('text/html')`. Diff confirms the else-branch is byte-identical. |
| **Shared util** | `htmlToText` behaves as D9 (no regression); single definition; dependency-free; `emailTransport` still passes | ✅ Pass | `lib/email/htmlToText.ts` is byte-identical to the D9 body; `emailTransport.ts` `import { htmlToText } from '@/lib/email/htmlToText'` + `export { htmlToText }` (re-export, no duplicate def); `resolveText` uses it; the D9 `emailTransport.test.ts` suite passes in the run. |
| **sendEmailDraft** | retained send is multipart/alternative (both parts); `includePdf:true` → normal multipart (no `multipart/mixed`, no error); no `application/pdf`/`generatePDF` remnants; error path throws | ✅ Pass | `sendEmailDraft.test.ts` (3 tests) green. Grep of `sendEmailDraft.ts`: no `application/pdf`/`generatePDF`/`multipart/mixed`/`Uint8Array` in code — only a doc comment explaining the removal. `includePdf?` retained in the type (accepted-but-ignored) so the `EmailHandler` caller still compiles. |
| **Contact route** | notification send includes a `text` part; no other behavior change; Pino conversions correct | ✅ Pass | `text: htmlToText(...)` added to both sends; **0 `console.*` remaining** (all 5 → structured Pino). |

### Regression & scope
- **D9 intact:** `emailTransport` suite passes after the extraction; `resolveText` unchanged (caller-text honored else auto-generate).
- **Scope clean:** grep confirms **no `lib/agentkit/v6/**` and no `lib/plugins/definitions/*.json`** touched (concurrent WP-62/63 + in-flight plugin-def edit untouched). **Outlook is comment-only** (8 insertions, 0 logic change — deferred with documented Graph-model reason).

### Issues Found
#### Bugs
- **None.** No functional defect; the delta's two TS errors are resolved with none introduced.

#### Follow-ups (tracked, out of D12 scope — not blockers)
1. Outlook multipart via raw-MIME Graph POST (SA Finding 5) — deferred; documented; zero behavior change.
2. `generatePDF` is a `void` stub, so the dashboard PDF-export at `components/dashboard/AgentSandBox/useAgentSandbox.ts:1083` is a no-op — a genuine latent defect but unrelated to D12; backlog it (do not fix in this hotfix). `generatePDF.ts` correctly left in place (second live caller).

#### ⚠️ Commit-hygiene (BLOCKING for the commit, not a code defect)
The working tree carries unrelated concurrent-team changes. RM must commit **ONLY the D12 files:**
- `app/api/contact/route.ts`, `lib/notifications/emailTransport.ts`, `lib/plugins/google-mail/sendEmailDraft.ts`, `lib/server/gmail-plugin-executor.ts`, `lib/server/outlook-plugin-executor.ts`
- new: `lib/email/htmlToText.ts`, `lib/email/__tests__/htmlToText.test.ts`, `lib/server/__tests__/gmail-buildEmailMessage.test.ts`, `lib/plugins/google-mail/__tests__/sendEmailDraft.test.ts`
- `docs/workplans/d12-email-multipart-alternative-workplan.md`

**EXCLUDE (NOT D12 — do not `git add -A`):** `package.json` + `package-lock.json` (D12 is **dependency-free** — the util is hand-rolled; these are concurrent), `.claude/settings.json` / `settings.local.json`, `docs/architecture/`, `docs/requirements/ADMIN_AGENT_HEALTH_DASHBOARD_REQUIREMENT.md`.

### Test Outputs / Logs
```
lib/email + gmail-buildEmailMessage + google-mail + notifications → 4 suites / 18 tests passing
tsc: all D12-touched files clean; sendEmailDraft.ts → 0 errors (TS2353 L91 + TS2769 L92 GONE); 0 new errors.
scope grep: no lib/agentkit/v6/** and no plugin-definition JSON changed. contact route console.*: 0.
```

### Final Status
- [x] Gmail primary → RFC 2046-valid multipart/alternative (decode-asserted); body-not-discarded; text-only single-part unchanged.
- [x] Shared `htmlToText` — single dependency-free definition, re-exported; D9 no regression.
- [x] sendEmailDraft — multipart retained; PDF branch fully removed; `includePdf:true` falls through to a real email; error path throws; TS errors gone.
- [x] Contact route — `text` part added; 5 console→Pino (0 remaining).
- [x] Zero new tsc errors; scope clean (no V6 pipeline / plugin-def JSON); Outlook comment-only.

**Overall QA verdict: PASS.** The primary Gmail path now sends valid multipart/alternative (plaintext-first, `body` preserved, base64url intact), the shared-util extraction is a clean no-regression consolidation, the reachable V1 sender is multipart with the broken PDF branch cleanly removed (TS2353/TS2769 gone), and scope is clean. No blocking bugs.

**Clean to commit: YES** — for the **D12 file set ONLY** (listed above). D12 is fully unit-testable with no live-agent dependency, so nothing blocks committing those files. RM must EXCLUDE the concurrent `package.json`/`package-lock.json` + the other unrelated tree entries.

## Commit Info
_(RM will populate this section)_
