# Queues, AWS and small API-key providers (QStash, AWS Textract, Pexels, exchange-rate keys)

Part of the `third-party-ops` skill: read its `SKILL.md` first. This file adds only what is specific to these services, in the template's six parts plus tiers and order. Every file path is confirmed at use time; if one has moved, the catalogue names the variable and the reader finds where it is read now.

Before each use, confirm the services below are still live (`SKILL.md` §5): a code path that runs, and the names set on Vercel. Drop any that is not. At `origin/main` when this file was written, QS-R, TX and PX have a live path; QS-P and FX do not (QK-2, QK-12). T-QK-5 and T-QK-11 re-check that.

| # | Service | Names (catalogue group, `expectedIn`) | Readers |
|---|---|---|---|
| QS-R | QStash receiver: signing keys, schedules, dead-letter queue | `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` (`jobs`, optional everywhere, `consumedBy: sdk`) | `app/api/cron/process-queue/route.ts` (`POST`, wrapped in `verifySignatureAppRouter`) |
| QS-P | QStash publisher: token, URL, callback address | `QSTASH_TOKEN`, `QSTASH_URL` (`jobs`, optional everywhere) | **Not in use:** the publisher is not reached by a live path at `origin/main` (QK-2). No probe. Whether to keep these names is FU-D6f-a's decision |
| TX | AWS Textract: document text extraction | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (`external`, optional everywhere, with the catalogue's AWS caveat) | `lib/extraction/TextractClient.ts`, through `tryTextract` in `lib/extraction/DeterministicExtractor.ts`. Two entry points: `extract_structured_data` in `lib/server/document-extractor-plugin-executor.ts`, and `executeDeterministicExtraction` in `lib/pilot/StepExecutor.ts` |
| PX | Pexels: stock photographs for generated sites | `PEXELS_API_KEY` (`external`, optional everywhere) | `imageForSection`, `imagesForSection` in `lib/services/StockImageService.ts` |
| FX | Two exchange-rate providers | `EXCHANGE_RATE_API_KEY`, `FIXER_API_KEY` (`external`, optional everywhere) | **Not in use:** `updateRatesFromApi` in `lib/services/CurrencyService.ts` has no caller (QK-12). No probe |

**Boundary.** DO owns the eight names, which account each environment's QStash and AWS credentials belong to, which IAM principal holds the AWS key (by role, private), and the QStash schedules and dead-letter queue as dashboard reads. The callback address is `platformOrigin()`, owned by `domains.md` (AD-2); this file points to it for schedules only. Our own shared secrets (the cron secret, the agent-run webhook secret, the scheduler's switch) are not here. Exchange rates and the admin rate sync are app data; the sync reads a keyless public feed (`lib/admin/exchangeRates/ecbFeed.ts`).

---

## 1. What must differ between environments

The **current** setup (which QStash account each environment uses, which AWS account and IAM principal hold the Textract key, which region, which targets carry a Pexels key, any recorded QStash schedules) is recorded in the private inventory by role, checked at use time, and reported by role.

| Setting | Rule per environment |
|---|---|
| QStash account | Token, URL and both signing keys on a target come from **one** recorded account. Keys from another account fail every signed delivery (QK-3). Signing keys are per account, so every target that shares an account rolls together |
| QS-R signing keys | **Required on every Vercel target while the receiver route exists.** Without either one, the build fails (QK-3) |
| QS-P token and URL | No live path reads them (QK-2). Whether they stay set is FU-D6f-a's decision |
| QS-R schedules | None, unless recorded with their destination. A recorded schedule's destination is a stable address that serves the receiver and that QStash can reach from the public internet: a Preview host behind deployment protection refuses it unless a bypass is recorded (vendor fact, confirm at use time) |
| TX names | All three, or none. Set by the **project** on each target where OCR extraction is wanted, never left to runtime-injected values (QK-8). The region is one where the vendor offers Textract (vendor fact). Production and non-production keys come from separate IAM principals where recorded. This file states that shape, never whether it is in place |
| TX IAM principal | Recorded by role. Its policy grants only the Textract action(s) the code calls (QK-10). Never a root or administrator credential; no console sign-in; key age within the recorded rotation period |
| PX key | Optional per target. Unset means generated sites have no stock photographs (QK-11): a product choice, recorded per environment |
| FX names | Not set on any target unless recorded with a reason (QK-12) |

"Local" is guidance for whoever runs the app locally. DO reads no `.env*` file, so local is never a DO check.

## 2. Where the code reads it

| # | Fact | Read in |
|---|---|---|
| QK-1 | The run-agent queue branch would run only on a deployed target with both QS-P names set; otherwise it runs the agent inline. It is not reached (QK-2), so none of its lines is evidence | `app/api/run-agent/route.ts` ("QUEUE-BASED EXECUTION PATH") |
| QK-2 | **The publisher is not reached.** The unified execution path ("UNIFIED EXECUTION PATH") answers every request that passes the agent lookup, so a `use_queue: true` request runs inline. The publish functions in `lib/queues/qstashQueue.ts` have no live caller; the scheduler's header says it no longer dispatches through QStash | `app/api/run-agent/route.ts`; `lib/queues/qstashQueue.ts`; `app/api/run-scheduled-agents/route.ts` (header) |
| QK-3 | **A missing signing key fails the build.** The wrapper is created at module scope and throws if either key is missing; `next build` evaluates route modules while collecting page data, so the deployment never becomes Ready (CI's build sets placeholder keys for this reason). Once loaded, a request with no signature header gets 403 "`Upstash-Signature` header is missing" before the body is read (SDK text, confirm at use time). A signature that does not verify makes the SDK throw `SignatureError` out of the wrapper: a 500 before the handler runs, not a 403 (SDK behaviour, confirm at use time). The handler parses the body first; when that fails it logs "Error processing job" (unstructured, QK-6) and answers 500 | `app/api/cron/process-queue/route.ts`; `.github/workflows/build.yml`; the installed SDK |
| QK-4 | **Schedules keep their destination.** The callback is `platformOrigin()` plus the receiver path (`domains.md` AD-2). A schedule stores its destination in QStash and keeps it after the app address moves; `agents.qstash_schedule_id` records the link. Nothing at `origin/main` creates or deletes a schedule, so any schedule in the console is a leftover, and it still delivers to the receiver | `getBaseUrl` in `lib/queues/qstashQueue.ts` |
| QK-5 | The token is read at first use, and the client is built with the token only. In the installed version, the client reads `QSTASH_URL` from the environment itself (SDK fact, confirm at use time) | `getQStashClient` in `qstashQueue.ts` |
| QK-6 | Both QStash files log through `console.*`, so the receiver writes no structured line | `qstashQueue.ts`; the receiver route |
| QK-7 | **Textract is enabled only when all three TX names are present.** An unset `AWS_REGION` disables it; the region default in the client is never reached (FU-D6f-c) | `TextractClient` constructor, `analyzeDocument` |
| QK-8 | **"Set" does not prove the AWS credential.** The Vercel runtime may set these names itself, and its values are not usable AWS credentials (vendor fact). Whether a project-set value reaches the function or a runtime value shadows it is also a vendor fact, confirmed at use time. Only P-QK-5 shows a working credential | `AWS_CAVEAT` in `catalogue.ts`; `TextractClient.isAvailable` |
| QK-9 | **Textract failures degrade.** `analyzeDocument` logs "Textract analysis failed" (module `TextractClient`, `error`) and returns empty. A PDF continues without it ("DeterministicExtractor: Textract fallback failed, attempting LLM with PDF text only"). An image throws "OCR extraction failed - check AWS Textract configuration", which `extract()` catches and logs as "DeterministicExtractor: Extraction failed" (module `DeterministicExtractor`, `error`, message in `err`) and returns as a failure result. With `use_ai: true`, OCR is off and an image throws "Image extraction requires OCR - enable ocr_fallback". One extraction may call Textract twice | `TextractClient.ts`; `DeterministicExtractor.ts` (`handleImage`, `tryTextract`, `extract`) |
| QK-10 | Credentials are passed explicitly, and the only call is `AnalyzeDocument` (forms and tables). `@aws-sdk/client-textract` is the only AWS SDK dependency | `TextractClient.analyzeDocument`; `package.json` |
| QK-11 | **Pexels degrades silently.** Unset: "No PEXELS_API_KEY; section will have no image" (service `StockImageService`, `debug`). Refused single search: "Stock library refused the search" (`warn`, with `status`). Used photograph: "Adopted a photograph for a section" (`info`), copied into the business's bucket and media library. A photograph already in the library is reused without an adopt line; a refused gallery search (`findPhotos`) logs nothing | `lib/services/StockImageService.ts` (`findBySourceRef`, `findPhotos`) |
| QK-12 | **The FX keys have no live caller.** The file's header marks the fetchers "UNWIRED" and forbids wiring them again; it is also loaded in the browser (`components/settings/CurrencySelector.tsx`) | `lib/services/CurrencyService.ts` (header) |

**Derive, never list.** Callers of `addManualExecution`, `addScheduledExecution`, `cancelJobsForAgent`, `imageForSection` and `updateRatesFromApi` come from the reader search in `domains.md` §2 (`git grep -l -F` on the function name at `origin/main`, tests excluded, comment-only hits are not callers). Expected names come from the catalogue groups `jobs` and `external`. **Never a probe target:** `backups/` and `archive/` copies.

## 3. Dashboard steps (the user)

By area name, because the consoles move: confirm the path at use time.

- **Upstash console, QStash:** the signing-keys area (roll); Schedules (count, destination host matches the recorded address yes/no, delete); Logs or Events (delivery status for a message); the dead-letter queue (count, delete); usage and plan limits. The token area belongs to QS-P (not in use).
- **AWS console, IAM:** the user or role holding the key; attached policies (Textract-only yes/no); access keys (count, age, last used and its service); console sign-in off yes/no.
- **AWS Billing:** a budget and alert for Textract spend, as recorded.
- **Pexels:** the API key page; the rate limit shown.
- **Vercel:** env values per `vercel-ops` and `env-change-protocol`. The value never passes through chat or a file.

The user reports presence, "same account as recorded: yes/no", "policy Textract-only: yes/no", "last used service is Textract: yes/no", "key age within the recorded period: yes/no", "schedule count as recorded: yes/no", the dead-letter count, a delivery status code and the last-updated time. Never a token, key or key fragment, signing key, account or principal identifier, ARN, schedule or message identifier, destination URL or amount.

## 4. Probes

Each fails when the setting is wrong. None enqueues an agent run, none needs DO to hold a key, none prints a value, none runs in a loop. Each runs on the deployment named per `vercel-ops` §4, after it is Ready. A 401 from deployment protection is "not probed (protected host)". A probe that calls a paid vendor API is optional, user-approved and run once; declined is "not probed (declined)".

| ID | Change | Probe | Pass | Fails when | Who | Precondition and side effects |
|---|---|---|---|---|---|---|
| P-QK-1 | Any of the eight names | `/admin/environment` on that deployment | Set, or Not set where intended. Presence only; **for TX it proves nothing** (QK-8): use `vercel-ops` §3 | The other state | Main session or user | Admin session. None |
| P-QK-2 | QS-R keys, the receiver | POST to that deployment's `/api/cron/process-queue` with no body and no signature header | 403 with "`Upstash-Signature` header is missing" (SDK text, confirm at use time) | Any other answer: record the status and stop | Main session or user (HTTP) | Reachable without protection, else "not probed (protected host)"; a protection 401 differs from the SDK's 403 by status and body. One request log line. Nothing written: the SDK refuses before the body is read |
| P-QK-3 | QS-R keys match the account | Optional, user-approved, once. In the Upstash console, publish one message with a **zero-byte body** to that deployment's receiver address, retries 0 where offered. Never `{}` or any JSON: a body that parses as JSON is processed as a job | Delivery status 500, and the target's runtime logs show the receiver's "Error processing job" line at the delivery time: the handler ran and could not parse the empty body (QK-3) | A 500 with no "Error processing job" line and a `SignatureError` in the runtime logs (SDK text, confirm at use time): the keys on the target are not the publishing account's current or next key. Any other status, a 2xx included: stop and report to the main session | User (console); DO (runtime logs) | P-QK-2 passed, and a roll or key change was just made or a schedule is recorded; else "not probed (nothing signs to this receiver)". Billed messages: one, or up to the vendor's default retries plus one where retries cannot be set, each with one unstructured receiver error line (QK-6), and a dead-letter entry the user deletes. No row written, no agent run |
| P-QK-5 | TX names, region, key | Optional, user-approved, once. A single-page image in plain base64 (no data-URL prefix) showing one known printed word, through a surface that runs `extract_structured_data` as the signed-in user (suggested: the plugin tester on `/test-plugins-v2`, via `POST /api/plugins/execute`; `document-extractor` is a system plugin and needs no connection). One field, an explicit image `mime_type`, `use_ai` unset | "Textract analysis complete" ≥ 1 and "Textract analysis failed" = 0 (module `TextractClient`), and no "DeterministicExtractor: Extraction failed" after the probe time | "Textract analysis failed" ≥ 1; or "DeterministicExtractor: Extraction failed" whose `err` carries "OCR extraction failed - check AWS Textract configuration" while "Textract analysis complete" = 0 | User (trigger); DO (log counts) | TX names set by the project (`vercel-ops` §3), else "not probed (not set)"; no tester on the target: "not probed (no surface)". Up to two billed Textract calls (QK-9); log lines; nothing written for a self-run (never act-as) |
| P-QK-6 | TX IAM scope and key age | User reads IAM for the recorded principal | Textract-only yes; last-used service Textract yes; key age within the recorded period yes; console sign-in off yes | Any "no" | User | None |
| P-QK-7 | PX key | Traffic read: DO counts "Adopted a photograph for a section" and "Stock library refused the search" by `status` (service `StockImageService`) since Ready. Optional, user-approved, once: the user illustrates one section not yet illustrated, for a business they own, through a generation surface found at use time | ≥ 1 adopt line and 0 refused lines | A refused line with 401 or 403. A 429 is "not conclusive (rate limited)" | DO; user (optional trigger) | No traffic: "not probed (no traffic)". 0 adopt and 0 refused: "not conclusive (no new search, or gallery only)". The trigger spends LLM calls and credits on the user's account, writes page content, and copies one photograph into that business's bucket and media library |
| P-QK-8 | Rotation (QS-R keys, TX key, PX key) | The probes above on the new deployment, then retire the old credential, then repeat them | Pass after the old credential is retired | Any failure after it | User; DO | As the probes used. Where the vendor offers no overlap (vendor fact), a cut-over: probe once after Ready |

**The P-QK-5 response is not evidence:** a failure is returned as a result and the executor fills defaults. "Textract analysis complete" ≥ 1 with the OCR error is "not conclusive (no readable text)"; "Image extraction requires OCR - enable ocr_fallback" is "not conclusive (OCR off)". P-QK-4 is not used: the publisher has no live path (QK-2). QS-P and FX: "not probed (no live path)".

## 5. Gotchas

- **The publisher is not reached** (QK-2): a `use_queue: true` request runs inline. Never read it as proof that QStash ran.
- **Signing keys are a build dependency** (QK-3): without either key, `next build` fails while collecting page data, and the SDK's error names the missing key (SDK text, confirm at use time).
- **Signing keys are account-wide, and a roll is ordered** (vendor fact, confirm at use time). A roll makes the old next key current and creates a new next key. Set current = the old next and next = the new next on **every** target that shares the account, and redeploy. Roll again only after that deploy is Ready and P-QK-3 passes on it. A P-QK-3 pass before the redeploy is "not conclusive (overlap)": the old next key still verifies.
- **Leftover schedules still deliver** (QK-4): nothing in the code creates or cancels one, and moving the app address does not move them. Pointer: `domains.md` §7 step 5.
- **The receiver logs through `console.*`** (QK-6): its delivery evidence is the console's status, not a log count.
- **Unset `AWS_REGION` disables Textract** (QK-7), whatever the catalogue's role text says.
- **Runtime-injected AWS names** (QK-8): "Set", and even "set by the project", is not evidence. P-QK-5 is.
- **Textract degrades instead of failing** (QK-9): PDFs fall back without it, images return a failure result. A multi-page document can fail for a reason that is not the credential.
- **Textract costs money per page** (`DeterministicExtractor.ts` header) and can be called twice per extraction (QK-9).
- **Pexels unset or refused is silent** (QK-11): the unset line is debug level, and a refused gallery search logs nothing.
- **The FX keys do nothing** (QK-12): setting them changes nothing, and the code forbids wiring them again.

## 6. Drift checks

In the `env-drift-audit` §7 format, and under its rules. "Who reads" as there.

| ID | Check | Expected state from | Live read (pointer) | Class | Who reads |
|---|---|---|---|---|---|
| T-QK-1 | On each **Vercel target** of the web app project, the eight names match the recorded intent (catalogue `expectedIn` is optional for all eight). Local: "not read (main session / user)" | Catalogue at `origin/main`; private inventory | `vercel-ops` §3 (names only) | High | DO |
| T-QK-2 | Both signing keys present on every Vercel target, and P-QK-2 passing there | Code at `origin/main` (QK-3) | `vercel-ops` §3; P-QK-2 | High | DO; main session |
| T-QK-3 | Token, URL and both keys on one target belong to the recorded account. No SDK-implicit QStash name (derived from the installed version's docs at use time) is set unless recorded | Private inventory; SDK docs at use time | User report; `vercel-ops` §3 | High | User; DO |
| T-QK-4 | QStash schedules: count and destinations as recorded (none by default); any unrecorded schedule is High (QK-4). Dead-letter count since the last run. Count of `agents` rows with a non-null `qstash_schedule_id`, count only, no identifiers: 0 unless recorded | Private inventory; code at `origin/main` | User report (Schedules, dead-letter queue); `supabase-ops` §2 read-only SQL | High | User; main session |
| T-QK-5 | The run-agent queue branch still follows the unified path's returns, and `addManualExecution`, `addScheduledExecution` and `cancelJobsForAgent` still have no live caller (reader search). A live caller means this file needs publisher probe rows before merge | Code at `origin/main` | Repo read | Low | DO |
| T-QK-6 | TX: all three names set by the project, or none, on each target, as recorded. Names only: a working credential is shown only by P-QK-5 on that target | Private inventory | `vercel-ops` §3 (project env names) | High | DO |
| T-QK-7 | TX IAM: the key belongs to the recorded principal; Textract-only policy; last-used service Textract; key age within the recorded period; no second active key outside a recorded rotation; console sign-in off | Private inventory; code at `origin/main` (QK-10) | User report (IAM) | High | User |
| T-QK-8 | "Textract analysis failed" (module `TextractClient`) since the last run. > 0 is Medium, High if it is every call. No calls: "not read (no traffic)" | Change records | Runtime logs | Medium | DO |
| T-QK-9 | An AWS budget and alert for Textract spend, as recorded | Private inventory | User report (Billing) | Medium | User |
| T-QK-10 | "Stock library refused the search" (service `StockImageService`) by `status` since the last run. 401 or 403 > 0 is High; 429 > 0 is Medium. 0 adopt and 0 refused: "not conclusive (no new search, or gallery only)". No traffic: "not read (no traffic)" | Change records | Runtime logs | Medium | DO |
| T-QK-11 | The FX names are not set unless recorded, and `updateRatesFromApi` still has no caller (reader search). A new caller means this file needs a probe row before merge | Code at `origin/main`; private inventory | `vercel-ops` §3; repo read | Low | DO |

## 7. Tiers and order against the deploy

**Tiers** (`env-change-protocol`; nothing restated). Production tier (SA reviews the plan, the user executes): a signing-key roll or a token reset on an account production uses (both are account-wide); deleting or creating a schedule on that account; creating, rotating, deactivating or deleting the AWS key production uses; any change to its IAM policy or to production's region; a change to production's Pexels key; removing any of these names from production. A change to a credential or account used **only** by non-production environments, as recorded, is reversible: the user applies it after the approval in chat. Where one account serves several environments, every change to it is production tier.

| Change | When |
|---|---|
| Signing-key roll | Both keys on every target that shares the account → roll → set current and next on every such target → deploy Ready → P-QK-2 and P-QK-3 → only then any further roll |
| QStash token reset | No live path reads it (QK-2); production tier only because the account is shared; no probe |
| Removing a signing key from a target | Only after FU-D6f-a removes the receiver route. Before that, the target's next deploy fails (QK-3) |
| AWS key rotation | Create the second key on the recorded principal → set all three names → deploy Ready → P-QK-5 → **deactivate** the old key → P-QK-5 again → delete it after the recorded wait (two keys per principal and deactivation are vendor facts, confirm at use time) |
| IAM policy narrowed | After P-QK-5 passes on the current policy; then P-QK-5 again |
| App address moves (`domains.md` §7) | Recorded schedules recreated for the new address in step 5. The old host keeps serving the receiver until the old schedules are deleted and in-flight retries have drained |
| Removing a TX or PX name from a target | After no live path on that target needs it, as recorded |
| FX names removed | At any time (no live path). The code removal is FU-D6f-b |
