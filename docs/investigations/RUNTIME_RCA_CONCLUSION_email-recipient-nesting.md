# Runtime RCA Conclusion — email "Recipient address required" (nested-array recipients)

> **Created**: 2026-07-05
> **Agent**: `bb821b6b-a21b-4d13-a054-b79a97bb588c` ("High-Qualified Leads Email Summary Agent" — a fresh agent created to validate the Sheets-range fix)
> **Execution**: `36cb28ee-7fcc-42bc-97bd-111a6141aed6` (`run_mode: production`, 2026-07-05 09:35)
> **Status**: RCA concluded. **Two runtime guards APPLIED + verified in production** (`normalizeRecipients` + `countRecipients`). Root-cause (V6 generation) follow-up recommended, not yet done.
> **Scope note**: This is a **separate, unrelated defect** from the `3fc703fd` Sheets-range work — do not fold it into that cycle. In fact the Sheets fix **worked** here (calibration read `"Leads!A1:Z1000"`, no `"Sheet1"` fabrication — dev.log:5722).

---

## TL;DR

The agent created + calibrated fine, then **failed on a real run** at step6 (`google-mail.send_email`) with Gmail 400 **"Recipient address required."** The recipients weren't missing — they resolved to a **double-nested array** `to: [["meiribarak@gmail.com"]]`, which the Gmail executor's `normalizeRecipients` silently dropped (it kept only string elements, and the element was an *array*) → empty `to` → Gmail rejects. **Calibration passed because its test-email owner-redirect overwrites the recipients** with a clean value, structurally masking the bug.

---

## Evidence chain (dev.log)

1. **Failure** — `ExecutionError: Step step6 failed: Recipient address required`; Gmail API 400 (dev.log:16761, 16884). Step6 = `google-mail.send_email`.
2. **The malformed value** — step6 `paramsAfter` / `transformedParams` (dev.log:16608–16645):
   ```json
   "recipients": { "to": [ ["meiribarak@gmail.com"] ], "cc": [ ["eomer3@gmail.com","offir.omer@gmail.com"] ], "bcc": [] }
   ```
   Note the **nested** arrays.
3. **Where the nesting comes from** — the DSL step config wraps the template in an array literal:
   ```
   recipients.to = ["{{input.email_recipients_to}}"]
   ```
   and `email_recipients_to` is declared **`type: "json"` with an array default** `["meiribarak@gmail.com"]` (dev.log:3861). Array-typed input × array-literal wrap → `[[…]]`.
4. **Why it fails** — `buildEmailMessage.normalizeRecipients` ([lib/server/gmail-plugin-executor.ts:564](../../lib/server/gmail-plugin-executor.ts#L564), pre-fix) did `field.filter(e => typeof e === 'string' && e.length > 0)`. For `[["…"]]` the element is an **array**, filtered out → `toList = []` → no `To:` header → Gmail 400.
5. **Why calibration passed (the mask)** — calibration ran with `redirectTo: "meiribarak@gmail.com"` (dev.log:5629). `applyCalibrationModeToEmail` ([gmail-plugin-executor.ts:120](../../lib/server/gmail-plugin-executor.ts#L120)) **replaces** recipients: `parameters.recipients = { to: [notice.redirectTo] }` — a clean flat array. So calibration sent successfully (`message_id: 19f3199…`, dev.log:7801) **without ever exercising the malformed value.** Production (`runMode: production`, no redirect) used the real nested value → failed.
6. **Same DSL, same inputs both runs** — identical `inputKeys` and identical nested `paramsAfter` in calibration (dev.log:7578) and production (dev.log:16631). The *only* difference is the calibration redirect. Confirms the mask, not an input divergence.

---

## Root cause (layered)

| Layer | Issue | Owner |
|---|---|---|
| **V6 generation (root)** | Compiler emitted `recipients.to = ["{{input.email_recipients_to}}"]` while typing `email_recipients_to` as a `json` **array** — the array-literal wrap on an already-array input yields a nested array. Type and DSL shape disagree. | `v6-pipeline` |
| **Gmail executor (guard — FIXED)** | `normalizeRecipients` silently *dropped* the nested array instead of flattening it, turning a shape slip into a cryptic 400. | plugin executor (this fix) |
| **Calibration (blind spot)** | The owner-redirect overwrites recipients, so calibration can never catch recipient-shape bugs — it gives false green. | `calibration` (noted, not fixed) |

---

## Fix applied — two runtime guards (both verified)

**1. `normalizeRecipients` — the send path.** [lib/server/gmail-plugin-executor.ts](../../lib/server/gmail-plugin-executor.ts) (`buildEmailMessage`). Replaced the flat `.filter(typeof === 'string')` with a recursive walk that collects every string at any depth and still comma-splits strings. **Strict superset** of the old behavior; additionally flattens `[["a@b.com"]] → ["a@b.com"]`. Verified: nested `[["x"]]`→`["x"]`; nested multi→both; flat array unchanged; comma-string split; single string wrapped; `null`/`[]`→`[]`; mixed→robust. **This is what unblocked the send.**

**2. `countRecipients` — the sibling bug.** [lib/server/base-plugin-executor.ts:195](../../lib/server/base-plugin-executor.ts#L195). Had the **same** nested-array blindness (`Array.isArray(v) ? v.length` counts `[["a","b"]]` as 1) — which is why the successful run reported `recipient_count: 2` for 3 addresses. Beyond the cosmetic miscount, this feeds the `total_recipients > 10 / > 50` safety conditionals, so an undercounted nested list could **bypass a "too many recipients" guard**. Now counts recursively + comma-splits. Verified: the failing case now returns **3** (was 2); flat/comma/empty/null unchanged.

**Why fix at the executor (not only V6):** deterministic, plugin-scoped, low-risk; hardens against *any* recipient-shape slip — the platform's "runtime guard" pattern. Resolves the failure immediately.

**Recommended follow-up (root, separate `v6-pipeline` cycle):** stop wrapping an array-typed input in a DSL array literal — emit `recipients.to = "{{input.email_recipients_to}}"`, or type `email_recipients_to` as a scalar string so type and shape agree. The executor guards make it non-urgent.

---

## Verification / status

- [x] Both fixes logic-verified (normalizeRecipients: 8 shapes; countRecipients: failing case → 3, old cases unchanged). No `console.*` in either touched file.
- [x] **Live production re-run PASSED** — execution `e12b4e7c-c98c-462e-9cc1-8bbb97036473` (`run_mode: production`, 2026-07-05 12:20): all 6 steps completed, step6 sent (`message_id: 19f3238d1f241f4a`), execution "completed successfully" (dev.log:5103). The recipients arrived at the executor **still nested** (`to: [["meiribarak@gmail.com"]]`, dev.log:4324) — proving the guard, not a shape change, is what fixed it.
- [ ] (Optional) Add a `gmail-plugin-executor` / `base-plugin-executor` unit test for the recipient helpers — none exists today.
- [ ] (Optional, separate) V6-generation root fix + calibration pre-redirect shape validation.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-05 | Created + guard fix applied | RCA on agent `bb821b6b` step6 email failure: nested-array recipients from a `json`-array input wrapped in a DSL array literal; masked by the calibration owner-redirect. Fixed `normalizeRecipients` to recursively flatten. V6-root + calibration-blind-spot noted as follow-ups. |
