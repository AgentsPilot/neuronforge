# Workplan: Business OS Data Export — Speed at the Row Ceiling (C-10)

> **Last Updated**: 2026-10-21

## Overview

Follow-up C-10 of the [flags and spreadsheet requirement](/docs/requirements/BUSINESS_OS_DATA_EXPORT_FLAGS_AND_SPREADSHEET_REQUIREMENT.md) SA review. The SA review measured the export at about 31 s at the 100,000-row ceiling, against a 40 s budget (`EXPORT_LIMITS.BUILD_MS_CEILING`), with most of that time spent in `fflate` deflate. This workplan records a local measurement of the **real** `runZipExport` and compares the options with measured numbers. The deployed run was declined (§2). Status: **local measurement done; deployed run declined by the user (§2); SA approved with conditions; built and measured (§4); awaiting SA code review and QA. Nothing committed.**

---

## 1. Local measurement (2026-10-21)

**Setup:** the real `runZipExport` from `origin/main` (`ff4a676f`), on Node 22.19 / Windows with 8 logical CPUs. Deps were in memory: no files, and the reads return instantly, so the database read time is **not** included. The 100,000 synthetic rows use the **real** section columns (`sectionColumns(id)`), spread over the large tables: clients 20k, client_activities 30k, bookings 20k, invoices 8k, payments 8k, client_tasks 5k, newsletter_subscribers 4k, quotes 2k, consent_records 2k, and one row in every other section. Values mix Hebrew and English text, and ids are random uuids. Scripts are local only, not committed and not in CI (C-9).

### 1.1 Today's export

| Run | Result |
|---|---|
| `runZipExport` end to end, ×2 | **`timeout` at ~49.7 s and ~50.3 s.** Over the 40 s budget, so the build alone fails the export |

### 1.2 Where the time goes

| Step | Time | Output |
|---|---|---|
| CSV build (`toCsv`, all sections) | 3.6 s | 62.2 MB |
| `data.json`, indented (`JSON.stringify(…, null, 2)`) | 4.3 s | 128.3 MB |
| `data.json`, compact | 3.5 s | 90.2 MB (−30%) |
| Deflate of the CSVs and `data.json` (below) | 5–39 s | 36–51 MB zip |

### 1.3 Deflate options (same CSVs and `data.json`)

| Compressor | Level | `data.json` | Time | Zip size | Fits 45 MiB? |
|---|---|---|---|---|---|
| `fflate` `zipSync` (today) | 6 | indented | **39.2 s** | 40.6 MB | yes |
| `fflate` | 6 | compact | 35.5 s | 39.6 MB | yes |
| `fflate` | 1 | indented | 25.3 s | 51.2 MB | **no** |
| `fflate` | 1 | compact | 21.7 s | 49.1 MB | **no** |
| Node `zlib` (sync) | 6 | indented | 13.4 s | 38.0 MB | yes |
| Node `zlib` (sync) | 6 | compact | **11.0 s** | 36.8 MB | yes |
| Node `zlib` (sync) | 9 | compact | 15.2 s | 36.4 MB | yes |
| Node `zlib` (sync) | 1 | compact | 5.2 s | 45.9 MB | **no** (by a hair; and leaves no room for files) |
| Node `zlib` async, entries in parallel | 6 | compact | 7.3 s | 36.8 MB | yes (on 8 CPUs; a function has fewer) |

### 1.4 What this shows

1. **A lower deflate level is ruled out.** Level 1 makes the zip 46–51 MB at the row ceiling, which is over the 45 MiB zip ceiling (`ZIP_BYTES_CEILING`) even with no files at all. It swaps a timeout for an `over_ceiling` refusal.
2. **Node `zlib` at level 6 is the main gain.** It is about 3× faster than `fflate` on this data: 39 s → 11–13 s. That is less than the SA's ~10×, because uuids and mixed text compress worse than the SA's repeating sample.
3. **Compact `data.json` is a small, free gain:** −0.8 s to build, −3.5 s to deflate, −30% raw bytes, −1 MB in the zip.
4. **Combined (zlib L6 + compact):** about 3.6 + 3.5 + 11 = **18 s of build**, against ~50 s today. That leaves about 22 s for reads, downloads and upload.
5. **Second finding: size, not time.** At 100,000 rows the records alone deflate to ~37–41 MB, which leaves only ~4–8 MB of the 45 MiB zip for files (whose own ceiling is 40 MiB). An account near both ceilings is refused `over_ceiling` whatever the speed. The deployed run should record the real ratio, because real data may compress better than random uuids. Whether to raise or split anything is a business question, not part of C-10.

---

## 2. Deployed run: declined (2026-10-22)

**User decision 2026-10-22: local numbers only.** No rows are seeded into the shared production database, and no deployed run takes place. SA reviews the proposal on §1 alone. The plan below is kept for the record, in case a later cycle wants it.

**Accepted risk:** the database read time is not measured. The local run leaves out the **database read time**. Each section is read in 1,000-row keyset pages, one after another (`runExportSections` is sequential), so 100,000 rows take at least 100 round trips. On a real function that may cost as much as the deflate. It can only be measured on a deployed function.

| # | Step | Owner | Gate |
|---|---|---|---|
| D-1 | Seed ~100,000 rows into a **test** account (never a customer), shaped like §1, through a local script using the service role. Emails `@example.invalid`; no future bookings, no active sequences or campaigns, so no cron sends anything | Dev | **User OK: Preview and production share one Supabase project, so this writes to the production DB** |
| D-2 | Export as that account on **production as-is**: the baseline. Read `durationMs`, `bytes` and `rows` from the `data_export_ready` / `data_export_timeout` log, and the job row | User (console POST, as in T-14) or TL | D-1 |
| D-3 | Push the option build to a branch and export on its **Preview** URL, same account | Dev + user | Code from §3 |
| D-4 | Remove the seeded rows (purge script by `user_id`, scoped to the seeded tables) and confirm 0 left | Dev | Same OK as D-1 |

Timing instrumentation: the option build adds one `info` log with step durations (read, downloads, build, zip, upload), ids and counts only. This is useful anyway for the 60% near-ceiling watch.

---

## 3. Proposed change (for SA review, not built)

| # | Change | Gain (local) |
|---|---|---|
| P-1 | Deflate text entries (READMEs, `data.json`, CSVs) with Node `zlib.deflateRawSync` level 6, and write the zip container with `fflate`'s streaming `Zip` using pre-deflated custom `ZipInputFile`s (CRC from `zlib.crc32`, Node ≥ 20.15 / 22.2). Files stay stored (level 0). `fflate` remains the only zip library; no new dependency | 39 s → 13 s |
| P-2 | `data.json` without indentation. Same JSON value, `format_version` stays 2. README wording to check ("open in a text editor") | −4 s, −30% raw |
| P-3 | *(Optional, needs SA)* Deflate entries in parallel with async `zlib` on the libuv pool | 11 s → 7 s on 8 CPUs; little on 1–2 vCPU |
| — | Lower deflate level | **Rejected:** over the 45 MiB zip ceiling (§1.4) |

**Open for SA:**
- Node version on Vercel. `zlib.crc32` needs Node ≥ 20.15; the fallback is a 20-line table CRC.
- Byte-for-byte zip compatibility: Windows Explorer, macOS Archive Utility and 7-Zip must open it. A Jest round trip with `fflate.unzipSync` checks CRCs.
- Coordination with the spreadsheet slices: the workbook (slice 3 of that requirement) replaces the CSVs and adds worksheet XML. That XML should go through the **same** P-1 path, which makes the SA-7 "level 1 inside the workbook" rule unnecessary. P-1 should land first, so the spreadsheet slices build on it.

---

## SA Review — 2026-10-22

**Reviewed by SA — 2026-10-22**
**Status:** ✅ Approved with conditions. P-1 and P-2 go ahead. P-3 is out. The step-timing log is in. Conditions SA-C10-1 to SA-C10-12 below apply. The review rests on the local numbers in §1 only, as the user decided (§2). The database read time is still unmeasured, and that is the accepted risk.

**Checked against:** `zipExport.ts` (step 5, `zipSync` at level 6), `zipEntries.ts`, `payload.ts`, `readme.ts`, `limits.ts`, `fflate@0.8.3` (`Zip.add` and `wzh` in `lib/node.cjs`), `.nvmrc`, `package.json` engines, `.github/workflows/*`, both export routes (`runtime = 'nodejs'`, `maxDuration = 60`), and the parent requirement's SA-7, C-9 and C-10 (read only, not edited).

### Rulings

| # | Question | Ruling |
|---|---|---|
| R-1 | **P-1 design** | **Approved.** Text entries are deflated with Node `zlib.deflateRawSync` at level 6. The container is written by `fflate`'s streaming `Zip`, using one custom `ZipInputFile` per text entry (`compression: 8`, `size` = raw length, `crc` = raw CRC-32, one `ondata(null, deflated, true)` call). Stored files go through `fflate`'s own `ZipPassThrough`, so `fflate` computes their CRC. I read `fflate`'s `Zip.add`: it writes the local header with general-purpose bit 3 set and zero sizes, then a signed data descriptor, and puts the real CRC and sizes in the central directory. Windows Explorer, macOS Archive Utility and 7-Zip read the central directory, so this is standard and readable. Every entry is far below 4 GiB, so Zip64 is not needed. **Alternatives considered and rejected:** `zipSync` at level 0 cannot take pre-deflated data, because it would store the deflate bytes as the file. `fflate`'s `ZipDeflate` is the slow path we are leaving. A hand-written zip writer would be a second container implementation to maintain. |
| R-2 | **Is this a new pattern (CLAUDE.md rule 7)?** | **Yes, a small one, and it is accepted.** This is the first direct use of `node:zlib` in app code, and the first hand-built `ZipInputFile`. Neither needs a new dependency, and `fflate` stays the only zip library. Two limits apply. (a) The code lives in **one** small server-only helper module (suggested: `lib/business-os/data-export/zipWriter.ts`, with `import 'server-only'` and `node:zlib`). It takes ordered entries, each `{ name, data, mode: 'deflate' \| 'store' }`, and returns the zip bytes. Both `zipExport.ts` and the coming workbook writer call this helper, and neither builds its own `ZipInputFile`. (b) The module's header comment cites this review (C-10, SA 2026-10-22). Both callers run on the Node runtime, never Edge, so `node:zlib` is safe there. |
| R-3 | **CRC source** | **Use a small table CRC-32 (IEEE, reflected, 0xEDB88320), not `zlib.crc32`.** `zlib.crc32` only exists from Node 20.15 / 22.2 onwards. `package.json` engines says `>=18.17.0`. The required Jest and build jobs use `.nvmrc` = `22`, but three workflows still pin `NODE_VERSION: '18'`, and nobody has recorded Vercel's Node version. On Node 18 the call would be `undefined`, which is a runtime `TypeError` that the tests on 22 would never catch. A pure table CRC runs the same on every runtime, needs no feature detection, and has only one code path to test. It costs about 150 MB of CRC in JS, roughly 0.3–0.6 s. **Dev re-measures this in the bench** and records it in §1. A cost over 1.5 s is a stop, back to SA. A feature-detected `zlib.crc32` with a fallback is **not** allowed, because it gives two paths and the fallback is the one CI never runs. |
| R-4 | **P-2 compact `data.json`** | **Approved. `format_version` stays 2.** Whitespace does not change a JSON value, and the requirement promises the value, not the layout. Neither README calls `data.json` indented or "readable in a text editor". `readme.ts` line 262 (en) says "machine-readable file", and line 361 (he) says "שמחשב יכול לקרוא". **No README text changes**, in either language. The leftover "pretty-print included" wording in `BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` §0.4.1 is about the retired 4 MB JSON body (DE-9), so it is not affected. Dev greps the tests for any assertion on the indented text (for example `'\n  "'`). Tests must `JSON.parse` the entry, never match its layout. |
| R-5 | **P-3 async parallel zlib** | **Out of this slice.** A Vercel function at the default size has 1–2 vCPUs, so the 11 → 7 s gain measured on 8 local CPUs probably will not carry over. It also adds async ordering to code whose fixed entry order (DE-8b SA C-14) and failure invariant (C-1, C-2) are currently synchronous and simple. Revisit only if the R-6 timing log shows `zipMs` still above about 15 s on production. |
| R-6 | **Instrumentation** | **In.** This is now the only way to learn the database read time on a real function, because the deployed run was declined. Do **not** add a new log line. Add a `stepMs` object `{ inventory, read, download, build, zip, upload }` (integers, ms) to the existing `data_export_ready` facts, and the steps reached so far to `data_export_timeout` and `data_export_over_ceiling`. The timeout log is the one that tells us which step used the budget. Ids, counts, bytes and durations only, as the module header already requires (§0.3.2, §0.4.1 E). Also add the raw text size in bytes (`textBytes`) next to `bytes`, so production shows the real compression ratio that §1.4 point 5 asks for. |
| R-7 | **Size finding (§1.4 point 5)** | **Yes, this is a business question, but it does not block C-10.** C-10 fixes a timeout. The size limit already behaves correctly: it refuses with a clear message and never sends a partial file. TL raises it through BA in business terms, roughly: *"A business with close to the maximum records (about 100,000) **and** close to the maximum files (about 40 MB) cannot download its data as one file today, because the records alone take up most of the space. Measured on test data, about 37–41 of the 45 MB. Such a business is told the export is too large. Is that acceptable until exports can come in several parts, or should a business near both limits be able to download its records and its files separately sooner?"* Note with it that no real account is near either limit today, and that R-6's `textBytes` and `bytes` will show the real ratio once it ships. Nothing changes in `limits.ts` in this slice. |
| R-8 | **Coordination with the spreadsheet slices** | **P-1 lands first. The workbook writer reuses the R-2 helper**, both for the worksheet parts inside `your-data.xlsx` and for the outer entry. This **supersedes part of the SA-7 / C-9 rule in the parent requirement.** Worksheet XML is deflated with `zlib` at **level 6** (not `fflate` level 1). `fflate` level 1 was only a time workaround, and it would also make the workbook larger, which matters given R-7. The rest of SA-7 stays as it is: `your-data.xlsx` is **stored** in the outer zip, there are no `r=` attributes, and slice 4 includes a measured local run at the ceiling. **I have not edited the parent requirement.** TL (or whoever owns that uncommitted worktree) records this as an SA amendment to SA-7 / C-9 there, quoting this section. |
| R-9 | **Tests** | Covered by the conditions below. Small fixtures only. No 100,000-row test in Jest (C-9). No new CI job and no added CI time: everything goes in the existing `zipExport.test.ts` plus one new co-located unit test file for the helper. |

### Conditions

| # | Condition |
|---|---|
| SA-C10-1 | One server-only helper module (R-2) holds the `zlib` deflate, the table CRC and the `fflate` `Zip` assembly. `zipExport.ts` only calls it. The allow-list check (SA C-4) and the duplicate-name check stay in `zipExport.ts`, before an entry reaches the helper, as they work today. |
| SA-C10-2 | Entry order is still fixed (SA C-14). The helper adds entries in exactly the order it receives them. `mtime` is still `startedAtDate` on every entry. |
| SA-C10-3 | Table CRC-32 as in R-3. `zlib.crc32` is not used anywhere, not even behind feature detection. The table is built once per module load. |
| SA-C10-4 | The text deflate is `deflateRawSync(data, { level: 6 })`. Level 6 is a named constant in the helper, with a comment pointing to §1.3/§1.4 point 1 (a lower level goes over `ZIP_BYTES_CEILING`). Files keep `store`. |
| SA-C10-5 | The helper must deliver the finished zip, or throw, **synchronously** within the call. Dev confirms that `Zip`'s `ondata` emits the final chunk synchronously when every input is pushed synchronously, and a test proves it (the result is defined straight after the call). If any `fflate` error comes through `ondata(err, …)`, the helper throws, so the existing `catch` → `settle('failed', 'error')` path handles it. No error is ever swallowed. |
| SA-C10-6 | Keep the `overTime()` check before the zip. Also add one check **between text entries** inside the build loop (cheap, and it returns `timeout`), so a slow function stops early and does not run 10 s of deflate it will throw away. The final size and time checks before upload stay unchanged. |
| SA-C10-7 | P-2: `JSON.stringify(payload)` with no indent. No README change, either language (R-4). Remove the module-header line that says "zipSync" so the comment matches the code. |
| SA-C10-8 | Timing as R-6: `stepMs` and `textBytes` on the existing events. No new event name and no content. |
| SA-C10-9 | **Helper unit tests (new co-located file):** (a) CRC of `"123456789"` is `0xCBF43926`, and the empty input gives `0`. (b) Round trip: a mix of deflated text entries (one with Hebrew text, one empty, one over 64 KiB) and stored binary entries goes through `fflate.unzipSync`. Every entry comes back byte-identical, which also checks each CRC, and the names come back in order. (c) The central directory records compression method 8 for text entries and 0 for stored ones. Read this from the bytes, or from `fflate`'s `Unzip` `compression` field. (d) **Failure path:** a forced error makes the helper throw. For example, inject a deflate that throws, or feed it an `ondata` error. The test checks that it throws, and that it does not return a truncated zip. |
| SA-C10-10 | **`zipExport.test.ts`:** the existing happy-path, order (line ~274) and `data.json` parse tests pass unchanged, except for assertions on the indented layout, if any. Add: (a) `data.json` contains no `"\n  "` indentation, and `JSON.parse` gives the same value as `buildExportPayload`. (b) Failure path: with `ZIP_BYTES_CEILING` lowered through `EXPORT_LIMITS`, the new writer still refuses `over_ceiling` and uploads nothing. (c) Timeout path: the clock moves past the budget during the text build, and the export returns `timeout` without uploading (SA-C10-6). (d) `stepMs` and `textBytes` are on the `data_export_ready` log, and the log has no content fields. |
| SA-C10-11 | **Bench and manual check (local, not CI):** re-run `e2e.ts` on the built code and record in §1 the end-to-end time at 100,000 rows, the CRC cost (R-3) and the zip size. Acceptance: end to end ≤ about 20 s locally, and zip ≤ `ZIP_BYTES_CEILING`. QA opens one zip produced by the new code, with Hebrew file names in `files/` if the allow-list permits them, in **Windows Explorer and 7-Zip**, plus **macOS Archive Utility** if a Mac is available (otherwise named as not checked). QA records the result in the QA report. |
| SA-C10-12 | Housekeeping: Dev flags any `console.*` found in touched files (none expected in `data-export/`). Ship-drill step 1: the typecheck is clean for the touched files. TL opens the R-7 business question through BA and records the R-8 amendment in the parent requirement. Neither of these blocks this PR. |

### Approval

[x] Workplan approved with conditions SA-C10-1 to SA-C10-12. Proceed to implementation of P-1 and P-2, plus the R-6 timing. P-3 is not in scope.

---

## 4. Implementation and measured result (2026-10-22)

### 4.1 What changed

| File | Change | Condition |
|---|---|---|
| `lib/business-os/data-export/zipWriter.ts` (new) | `buildZip(entries, { mtime, beforeEntry })`: text through `zlib.deflateRawSync` level 6 (`TEXT_DEFLATE_LEVEL`), handed to `fflate`'s streaming `Zip` as a pre-deflated `ZipInputFile` (method 8); files through `ZipPassThrough` (method 0). Slicing-by-8 table CRC-32. Returns the zip or throws | SA-C10-1…5 |
| `lib/business-os/data-export/zipExport.ts` | Entries go into an ordered list (same fixed order, same allow-list and duplicate checks) and through `buildZip`. `data.json` compact. Time checked before each entry (a `BuildBudgetSpent` thrown from the hook becomes `timeout`; any other throw stays `error`). `stepMs` on the ready, timeout and over-ceiling events; `textBytes` on ready. Header comment updated | SA-C10-2, 6, 7, 8 |
| `__tests__/zipWriter.test.ts` (new) | CRC check value and empty input; 8-byte path vs byte-at-a-time; round trip (Hebrew name, empty, > 64 KiB, stored binary) byte-identical and in order; methods 8 / 0 and the UTF-8 flag; deterministic; `beforeEntry` order and a thrown hook propagating; a zip error throws; import pin (no `zlib.crc32`) and level 6 | SA-C10-9 |
| `__tests__/zipExport.test.ts` | Compact `data.json` parses (format 2); budget spent between entries → `timeout`, no upload, `markFailed` once; a non-budget zip error → `error`; `stepMs` / `textBytes` on ready with no content; steps on the refusal event. The existing zip-ceiling refusal test still passes | SA-C10-10 |

No `console.*` in the touched files. The typecheck is clean for them; a full `tsc` run finished with 1,852 errors, all in files this change does not touch (SA-C10-12). Data-export Jest suites: 14 suites, 463 tests passing. README unchanged in both languages.

### 4.2 Measured at the ceiling (same setup as §1, plus one 2 KB stored file)

The generator makes **99,030 rows** (the listed shares come to 99,000, plus one row in each of the other 30 sections). §1 used the same data, so before and after compare like for like. QA re-ran the final code at 16.5 s.

| | Before (§1.1) | After, 3 runs |
|---|---|---|
| Result | `timeout` (~50 s) | **`ready`, 16.2 / 16.2 / 16.3 s** |
| `stepMs.build` (CSVs, compact `data.json`, READMEs) | — | 6.3 s |
| `stepMs.zip` (zlib deflate, CRC, assembly) | ~39 s | 9.8 s |
| Text before compression (`textBytes`) | 190 MB (indented) | 152 MB |
| Zip | 40.6 MB | **36.8 MB** (under 45 MiB) |
| CRC-32 alone over the text | — | 1.25 s with slicing-by-8 (the byte table took 1.6 s, over the SA's 1.5 s line) |

The run logs `data_export_near_ceiling`, as it should: 36.8 MB is over 60% of the zip ceiling. That is the size finding from §1.4.

### 4.3 Zip compatibility (SA-C10-11)

The 100,000-row zip (37 MB, 44 entries, one Hebrew-named file):

| Reader | Result |
|---|---|
| Windows Explorer (Shell "Extract all", scripted) | ✅ 44 files, Hebrew name correct |
| .NET `System.IO.Compression` (`Expand-Archive`) | ✅ 44 files |
| Windows `tar` (libarchive) | ⚠️ 43 files: skips the Hebrew-named entry. **Not a regression:** it does the same to a zip built the old way with `fflate` `zipSync` (checked) |
| 7-Zip, macOS Archive Utility | ⬜ Not checked: 7-Zip is not installed on this machine and no Mac is available. QA to note |

`data.json`, `README-he.txt` and two CSVs are byte-identical across all three extractions.

---

## SA Code Review — 2026-10-22

**Code Review by SA — 2026-10-22**
**Status:** ⚠️ Code approved with one required fix (CR-1). No re-review needed: the fix is test-only, and QA confirms it.

**Checked:** the `zipExport.ts` and `zipExport.test.ts` diffs, the new `zipWriter.ts` and `__tests__/zipWriter.test.ts`, §4, and `fflate@0.8.3` (`Zip.add`, `Zip.end`, `Zip.e`, `ZipPassThrough.push`, `unzipSync` in `esm/index.mjs`, and the `AsyncFlateStreamHandler` type in `lib/index.d.ts`). SA ran `npx jest lib/business-os/data-export`, with this result: 14 suites, 463 tests, all passing. SA also ran a scoped `tsc` over the four touched files and their imports, with this result: 0 errors. There is no `console.*` in the touched files.

### Rulings on the two deviations

| # | Deviation | Ruling |
|---|---|---|
| D-a | **Slicing-by-8 CRC instead of the byte table** | **Accepted.** The intent of SA-C10-3 still holds. It is a pure table CRC with one code path and no `zlib.crc32` anywhere, and the tables are built once per module load. I checked the code. `T[k][n]` is built correctly. The low byte of the 32-bit word goes through `T[7]` and byte `i+7` goes through `T[0]`, which is the standard order. The `<< 24` sign bit is harmless because the code uses `>>> 24`, `& 0xff` and a final `>>> 0`. The tail loop covers lengths that are not a multiple of 8. The Jest check value and the byte-at-a-time comparison (lengths 1, 7, 8, 9, 15, 16, 17, 64, 1001) cover both paths. 1.25 s is under the 1.5 s line. The scratch cross-check against `zlib.crc32` is fine as evidence and must not move into the repo, because Jest must not depend on Node ≥ 20.15. |
| D-b | **`new Uint8Array(deflateRawSync(...))` copy** | **Keep the copy.** In 0.8.3, fflate's handler wants `Uint8Array<ArrayBuffer>`, but `deflateRawSync` returns `Buffer<ArrayBufferLike>`. A typed view (`new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)`) is still `Uint8Array<ArrayBufferLike>`, so it would need a cast anyway. A cast is sound at runtime (zlib never returns shared memory), but it is a type escape with no real gain. The copy is one memcpy per text entry: about 37 MB in total, tens of ms, against a 9.8 s zip step. The extra memory lasts only for the largest single compressed entry, because each Buffer is garbage straight after. Optional: name the type reason in the comment (see O-4). |

### The other points asked about

| Point | Finding |
|---|---|
| **`BuildBudgetSpent` vs other throws** | Correct. The class is module-private, so nothing else can throw it, and the `instanceof` test is exact. Every other error is rethrown, so the existing outer `catch` settles it as `error`. Both paths are tested: timeout with `markFailed` called once and no upload, and an fflate failure settling as `error`. `timeout()` → `settle()` keeps the C-1 settle-once guard. |
| **Is `Zip` truly synchronous?** | **Yes, for both entry types.** I traced it in the source. `add()` runs `wzh` straight away. For a pre-deflated entry, our one `ondata(null, deflated, true)` call reaches the `final` branch. `tr_1` is 1, because the previous entry has already finished, so `uf.r()` → `pAll` emits the header, data and descriptor in the same call stack. For `ZipPassThrough`, `push(data, true)` → `process` → the same `ondata` path, synchronously. `end()` with `d === 1` calls `e()` straight away, which emits the central directory with `final = true`. So `done` is set before `end()` returns, and the `!done` throw can only trigger if fflate changes. An fflate error (for example a name over 65,535 bytes) comes back through the callback as a returned error, not a thrown one, and the helper turns it into a throw. That is tested. |
| **`stepMs` on a timeout** | It does not mislead, but the semantics are uneven. A `zip` key on a timeout is the time spent in the zip step **before it stopped**. That is the most useful number for finding where the budget went, and `elapsedMs` sits next to it. On a **download** timeout, though, the code returns before `step('download')`, so that key is simply absent. The rule is therefore "the completed steps, plus a partial `zip`". This does not block, but write it down (O-1). |
| **One long deflate cannot be interrupted** | **Accepted.** The overrun is limited to one entry's deflate. The largest entry is `data.json` (a few seconds at the ceiling, within the 9.8 s zip step). After the last entry, the unchanged step-6 elapsed check refuses the upload. Budget 40 s + one entry + settle stays inside `maxDuration = 60`. This is the trade-off SA-C10-6 meant when it asked for checks between entries, not inside them. |

### Code Review Comments

1. **`__tests__/zipWriter.test.ts` (round-trip test)** — **Required (CR-1).** The comment "fflate checks each CRC" is **wrong**. `fflate`'s `unzipSync` reads the central directory and inflates, but it never checks the CRC (see `unzipSync` in `esm/index.mjs`). So no test in CI checks that the zip records the CRC of the **raw** data. If someone changed `crc: crc32(entry.data)` to `crc32(deflated)`, or got the size fields wrong, every current test would still pass, and Explorer or 7-Zip would report the file as corrupt. **Fix:** walk the central directory (signature `0x02014b50`) and, for every entry, check four things: (a) the name, in order; (b) the method, 8 for text and 0 for stored; this also meets SA-C10-9(c) as written, which today reads the local headers; (c) the CRC-32, against the test's own byte-at-a-time reference CRC of the source bytes (not the code under test, and not `zlib.crc32`); (d) the uncompressed size against `data.length`. Cover both stored and deflated entries, including the empty one. Correct the comment. — Priority: **High**
2. `zipWriter.ts`, the entry loop — `opts.beforeEntry?.(entry)` runs before `if (failure) break`. So if an fflate error and a spent budget happen together, the export reports `timeout` rather than `error`. Swap the two lines. — Priority: Low
3. `zipWriter.ts`, the failure throw — pass `{ cause: failure }` so the fflate error keeps its stack and code in the logged `err`. No content can leak through it, because fflate's messages are fixed strings. — Priority: Low

### Optimisation Suggestions

- **O-1.** Add one line to the `stepMs` note in the `zipExport.ts` header: "the keys are the completed steps; on a timeout during the zip, `zip` is the time spent in it before stopping". This saves the person reading the first production timeout log from guessing.
- **O-2.** The `overTime()` check just before `buildZip` is now covered by the hook on the first entry. Keep it anyway: SA-C10-6 asked for it, and it costs nothing.
- **O-3.** For the spreadsheet slices that reuse the helper (R-8): a worksheet entry passes through the same `beforeEntry` hook, so the workbook writer gets the budget check for free if it passes the caller's hook through.
- **O-4.** Optional: the D-b comment could say *why* the copy is there ("fflate wants `Uint8Array<ArrayBuffer>`; `Buffer` is `ArrayBufferLike`"), so nobody later "optimises" it into a cast.

### Still owed (not code)

- SA-C10-11: 7-Zip and macOS Archive Utility are still not checked (§4.3). QA records them, or names them as not checked, in the QA report. The Windows `tar` result for the Hebrew name is not a regression, and that is accepted.
- SA-C10-12: TL still has to raise the R-7 business question through BA and record the R-8 amendment in the parent requirement. Neither blocks the PR.

### Code Approved for QA: Yes, on condition that CR-1 is fixed first (test-only). Items 2–3 and O-1 are recommended in the same pass but do not block.

---

### SA code review fixes applied (2026-10-22, Dev)

| Item | Done |
|---|---|
| CR-1 | `zipWriter.test.ts` walks the central directory: name order, method 8 / 0, CRC of the raw bytes against an in-test byte-at-a-time reference, uncompressed size; stored, deflated and empty entries. Mutation check: `crc32(entry.data)` → `crc32(deflated)` fails this test (1 failed), restored → 10/10 |
| 2 | `if (failure) break` before `beforeEntry`: a zip error wins over a spent budget |
| 3 | `{ cause: failure }` on the thrown error |
| 4 | `zipExport.ts` header: `stepMs` = completed steps, plus `zip` = time spent before a timeout during the zip; comment on the Buffer copy (ruling b) |

## QA Report — 2026-10-22

**QA — 2026-10-22**
**Test mode:** full
**Strategy used:** A (Jest unit, the helper) + B (Jest with mocked deps, `runZipExport` and the routes) + C (local scripts: the 100k-row bench and edge-case probes, scratchpad only) + independent zip readers (Python `zipfile`, .NET `Expand-Archive`)
**Focus:** api, performance
**Skipped:** deployed run (user declined, §2); 7-Zip and macOS Archive Utility (not installed / no Mac); Windows Explorer not re-run by QA (Dev's §4.3 result stands). No DB, no deployed environment, nothing committed.
**Input source:** prompt from TL
**Code state tested:** the working tree after the SA code review fixes (CR-1 test, review items 2 and 3, comments). The first QA pass ran before those edits landed. Everything below was **re-run** on the final files.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Data-export Jest suites green | ✅ | Pass | `npx jest lib/business-os/data-export`: 14 suites, 464 tests (463 + the CR-1 test) |
| Suites that import the export green | ✅ | Pass | Both export route trees (owner and admin, incl. part download), cron `data-export`, the four export repositories, `userDataExportReads`, client `businessOsDataExport`, `lib/cron`, admin `dataExportBlock`, settings `downloadMyData`, `adminGate.writes`, and the source guards that name the module. One combined run with data-export: 37 suites, 1,535 tests, 0 failures |
| 100k rows: `ready`, under 40 s | ✅ | Pass | `ready` in **16.5 s** on the final code (17.6 s on the pre-review code; Dev: 16.2 s). `stepMs` build 6.5 s, zip 9.8 s, upload 0.2 s. Node 22.19, 8 CPUs. Within SA-C10-11's ≤ ~20 s |
| Zip under 45 MiB | ✅ | Pass | about 38,565,067 B = **36.8 MiB** (`ZIP_BYTES_CEILING` 47,185,920). `data_export_near_ceiling` logged, as expected |
| Every CRC valid (independent reader) | ✅ | Pass | Python `zipfile.testzip()` = `None` on the 100k zip: 44 entries, 43 method 8, 1 method 0, read from the **central directory**. `Expand-Archive`: 44 files |
| `data.json` compact and parses | ✅ | Pass | 94.6 MB, no newline at all, `json.loads` OK, `format_version` 2, equal byte for byte to Python's compact re-serialisation |
| Fixed order, mtime, UTF-8 flag | ✅ | Pass | README.txt, README-he.txt, data.json, records…, files-index.csv, then files. One mtime on all entries. UTF-8 flag set on the Hebrew name `files/client-documents/c1/חוזה לקוח.pdf` |
| Edge: export with zero rows | ✅ | Pass | `ready`, 43 entries, header-only CSVs, `testzip` None, `Expand-Archive` 43 files |
| Edge: 0-byte stored file (+ Hebrew-named file) | ✅ | Pass | `ready`, 45 entries; the 0-byte file is listed `included` in files-index.csv and extracts as 0 bytes |
| Edge: many files (150 = `FILE_COUNT_CEILING`, 22 of them 0 bytes) | ✅ | Pass | `ready`, 193 entries, `testzip` None, `Expand-Archive` 193 files |
| Edge, helper direct: empty list; 0-byte deflate entry; 0-byte store entry; mixed 0-byte; 3,000 entries; 1 MiB incompressible deflate | ✅ | Pass | All six pass `testzip` and `Expand-Archive` |
| SA-C10-9 helper tests | ✅ | Pass | (a) check value and empty input; (b) round trip incl. Hebrew, empty, > 64 KiB, stored binary; (c) methods, now read from the **central directory**; (d) a thrown hook and a fflate error both throw |
| **CR-1 (SA code review)** | ✅ | Pass, **confirmed** | The new test walks the central directory (`0x02014b50`) and, per entry in order, checks the name, the method (8/0), the CRC against a test-local byte-at-a-time reference CRC of the **raw** bytes (no `zlib.crc32`, not the code under test) and the uncompressed size against `data.length`. The fixture covers stored, deflated and an empty deflated entry. The comment that wrongly said "fflate checks each CRC" is corrected. Review items 2 (`if (failure) break` now before the hook) and 3 (`{ cause: failure }`) are also in |
| SA-C10-10 builder tests | ✅ | Pass, minor gaps | See Edge Cases 1–2 |
| Happy path + one failure path (CLAUDE.md) | ✅ | Pass | Helper: round trip; failure = thrown hook and a fflate error (name over 65,535 bytes) both throw, no zip returned. Builder: ready path; failures = budget spent between entries → `timeout` with no upload, non-budget zip error → `error`, lowered `ZIP_BYTES_CEILING` → `over_ceiling` with no upload |
| SA-C10-11 readers | ⚠️ | Partial | Windows Explorer (Dev), .NET, Python: OK. 7-Zip and macOS Archive Utility **not checked** (not available) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. 16.5 s locally leaves about 22 s of the 40 s budget for reads, which are still unmeasured (§2 accepted risk).

#### Edge Cases (nice to fix)
1. **SA-C10-10 (a): the value is not compared with `buildExportPayload`.** The test checks no newline, `format_version` 2, and that it re-serialises to itself. It does not compare with `buildExportPayload(...)`. Low: the code change is only the `JSON.stringify` indent.
2. **SA-C10-10 (c): the timeout test drives the real hook through a mocked `buildZip`.** It proves the `zipExport` side (hook → `BuildBudgetSpent` → `timeout`, no upload, `stepMs` up to `zip`). `zipWriter.test.ts` separately proves that a throwing hook propagates. No single test runs both for real. Acceptable as it is.
3. **Bench is 99,030 rows, not 100,000.** The generator's shares come to 99,000 plus one row in each of the other 30 sections. §4.2 says "100,000 rows". The difference is under 1%, so the conclusion holds. Wording only.
4. **The CR-1 test checks the uncompressed size, not the compressed size.** The compressed size is not compared with the deflate output. Python's `testzip` on every QA zip covers it end to end, so this is Low.
5. **Windows long paths.** Extracting under a very deep folder fails in `Expand-Archive` because of MAX_PATH (260), not because of the zip. The same zips extract cleanly to a short path. Not a code issue.

### Test Outputs / Logs

```text
npx jest lib/business-os/data-export        -> Test Suites: 14 passed; Tests: 464 passed
data-export + all dependent suites (1 run)  -> Test Suites: 37 passed; Tests: 1535 passed

bench e2e.ts (QA re-run on the final code):
rows=99030 sections=39
stepMs {"inventory":0,"read":1,"download":0,"build":6472,"zip":9803,"upload":168} textMB 152.4
runZipExport kind=ready ms=16450 zipMB=36.8

python zipfile on qa-100k.zip:
testzip: None | entries: 44 methods: {8: 43, 0: 1} | dupes: 0
data.json bytes: 94594383 has newline: False | format_version: 2 compact-equal: True

edge probes (runZipExport):  zero-rows ready 19,511 B | zero-byte-file ready 21,042 B | 150-files ready 121,915 B
all 9 edge zips + qa-100k.zip: testzip None; Expand-Archive OK (43 / 45 / 193 / 3000 / 0 / 1 / 4 / 1 / 1 / 44 files)
```

### Final Status
- [x] All acceptance criteria pass, and CR-1 is confirmed: ready for commit. The open items are low-severity test-precision gaps and the reader checks (7-Zip, macOS) that could not be run here
- [ ] Issues found: Dev must address before commit

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-22 | QA | PASS on the final code (CR-1 confirmed): 464 data-export tests, 37 suites / 1,535 tests incl. dependents; local 100k bench `ready` in 16.5 s, 36.8 MiB; Python `testzip` + .NET `Expand-Archive` clean on the bench zip and 9 edge zips (zero rows, 0-byte entries, 150 files, 3,000 entries); 5 low notes; 7-Zip/macOS not checked |
| 2026-10-22 | SA code review | ⚠️ Approved for QA on condition of CR-1, a test-only fix: fflate's `unzipSync` does not check CRCs, so a test must check each central-directory CRC, size and method against a reference CRC. Slicing-by-8 CRC accepted (D-a). The deflate-output copy stays (D-b). Zip synchronicity, the budget sentinel and the one-entry overrun confirmed. Jest: 14 suites, 463 tests passing. Scoped tsc clean |
| 2026-10-22 | SA review | Approved with conditions SA-C10-1…12: P-1 (zlib L6 + fflate `Zip`, table CRC, one helper module) and P-2 (compact `data.json`, no README change) in; P-3 out; `stepMs`/`textBytes` on existing events; size limit raised as a business question; SA-7 "level 1 inside workbook" superseded by zlib L6 (to be recorded in the parent requirement by TL) |
| 2026-10-22 | Built | P-1 + P-2 + step timings built per SA-C10-1…12; 100k rows: ~50 s timeout → 16.2 s ready, 36.8 MB zip; compatibility checks (§4) |
| 2026-10-22 | Deployed run declined | User: local numbers only; read time stays unmeasured (§2) |
| 2026-10-21 | Created | Local measurement of the real `runZipExport` at 100,000 rows (timeout at ~50 s), options table, deployed-run plan, proposal P-1…P-3 |
