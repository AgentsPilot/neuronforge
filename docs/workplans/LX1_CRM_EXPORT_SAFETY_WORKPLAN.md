# Workplan: LX-1 — CRM / Orders list-export safety fix

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md) §9 LX-1, §10 LX-1 acceptance, SA Review 2026-10-25 condition XC-18 (answers SA-Q16)
**Branch:** `fix/crm-export-safety-lx1`
**Date:** 2026-10-25
**Status:** Code Complete

## Analysis Summary

Client-only. No route, repository, migration or entitlement is touched, so C-11c (rule-1 move) does not apply (XC-18).

| Area | Today | Gap |
|---|---|---|
| CRM contacts export (`app/business-os/crm/page.tsx` `handleExportCSV`) | Hand-built CSV: quotes every cell but does not neutralise `=`/`+`/`-`/`@`. Names come from the unauthenticated public contact / booking forms | Formula injection (SA finding, Medium) |
| Phone column | `="…"` unquoted CSV field so Excel keeps the leading zero | The field is **unquoted**, so a comma or newline in a stored phone splits the field and the second half can start with `=` — the exception itself was an injection path |
| Contacts Export button | Says "Export"; exports `contacts`, which is only the rows loaded on screen (one page in list view, the loaded columns on the board) | Silent cut — owner thinks it is the whole list |
| Orders (MoneyList) list | Already shows the `truncated` notice the route returns | — (kept) |
| Orders export | Re-asks the route with `limit: EXPORT_CAP`; ignores `truncated` and `total` in that response | A capped export downloads silently short |
| Dates in the contacts export | `toLocaleDateString()` — browser-local | Kept as-is (SA note); recorded below as a known limitation, not changed in LX-1 |

## Implementation Approach

1. **`lib/crm/contactsCsv.ts`** (new, pure, no imports beyond `lib/payments/csv`) — `buildContactsCsvFile(rows, headers)`. Every text cell is encoded through `toCsv` (so the BC-1 `csvCell` rule applies) and the file starts with `CSV_BOM`, i.e. the same output `toCsvFile` produces. **One documented exception:** the phone cell keeps Excel's `="…"` text form, but only when the stored value is phone-shaped (`digits + ( ) - . space`); anything else falls back to the normal neutralised cell. The `="…"` field stays **unquoted** (the form already in use and known to read back as text — the previous author recorded that a CSV-quoted `"=""…"""` showed literally), and safety comes from the whitelist: no quote, comma, tab, CR or LF can be inside it, so it can neither break out of the string literal nor split the field. `lib/payments/csv.ts` is not changed — it is shared with server code. The existing guard `lib/crm/__tests__/oneSearchStringTwoReaders.guard.test.ts` pinned the old in-page `asText` implementation; its 2 export assertions and the "escaping rule" block were repointed at the new module (same intent).
2. **`components/crm/ContactsExportButton.tsx`** (new) — the button, with label `crm.export.button_shown` = "Export {count} shown" and tooltip `crm.export.tooltip_shown` naming that only the rows on screen go into the file. The count is `contacts.length`, the same array the file is built from, so label and file cannot disagree. The full filtered export is the later scope (EX-1..3) — no server export is built. Label wording: XC-18 reads "Export this page ({n} rows)"; the board view loads per column, so "this page" would be untrue there — "Export {n} shown" says the same thing and is true in both views (flag for SA).
3. **`components/payments/MoneyCapNotice.tsx`** (new) — the amber notice extracted from MoneyList, plus pure `exportWasCut({ truncated, total }, written)`. MoneyList renders it for the list's `truncated` (unchanged copy) and, after an export whose response was `truncated` or held fewer rows than `total`, a second notice `payments.export.cut` = "This file holds the {count} most recent records only — not every order." The file still downloads.
4. Translations: 3 new keys × en/he/es.

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/crm/contactsCsv.ts` | create | Formula-safe contacts CSV with the phone exception |
| `lib/crm/__tests__/contactsCsv.test.ts` | create | `=HYPERLINK(...)`, `+972…`/`05…` phone, `-`/`@` leading cells, comma-in-phone, numbers untouched |
| `components/crm/ContactsExportButton.tsx` | create | Honest row-count label |
| `components/crm/__tests__/ContactsExportButton.test.tsx` | create | Render: label names the count; disabled at 0; click calls export |
| `components/payments/MoneyCapNotice.tsx` | create | Shared notice + `exportWasCut` |
| `components/payments/__tests__/MoneyCapNotice.test.tsx` | create | Render notice; `exportWasCut` cases; source guard that MoneyList wires both notices and the CRM page uses the builder |
| `app/business-os/crm/page.tsx` | modify | Use builder + button; drop hand-built CSV |
| `components/payments/MoneyList.tsx` | modify | Read `truncated`/`total` on export; render notices via `MoneyCapNotice` |
| `lib/business-os/translations/{en,he,es}.ts` | modify | 3 keys each |
| `lib/crm/__tests__/oneSearchStringTwoReaders.guard.test.ts` | modify | Repoint stale export assertions at the new builder |

## Task List

- ✅ Step 1: workplan
- ✅ Step 2: `contactsCsv.ts` + unit tests
- ✅ Step 3: `ContactsExportButton` + render test; wire into CRM page
- ✅ Step 4: `MoneyCapNotice` + `exportWasCut`; wire into MoneyList export; tests
- ✅ Step 5: translations en/he/es
- ✅ Step 6: run touched suites, `dictionariesStayInStep`, `exportMatchesTheScreen`, `csv.test`, `lint:hooks`, `tsc` on touched files

## Known limitations (not changed in LX-1)

- Contacts `created_at` is formatted with the browser's locale/timezone (`toLocaleDateString()`), not `user_preferences.timezone`. Behaviour kept per SA; belongs with the later per-list export scope.
- The Contacts export is still only what is on screen; the label now says so. Full filtered export = EX-1..3 (later).

## Logging compliance

`app/business-os/crm/page.tsx`: 0 `console.*`. `components/payments/MoneyList.tsx`: 0 `console.*` (one comment mentions "console"). Nothing to convert.

## SA Review Notes

## SA Code Review — 2026-10-25

**Code Review by SA — 2026-10-25** (short path, UI-only)
**Status:** ⚠️ Approved with conditions. Fix items 1 and 2, then go to QA. No re-review needed if the fixes are as described.

### What was checked

| Area | Result |
|---|---|
| `lib/crm/contactsCsv.ts`: every non-phone cell, and the headers, go through `toCsv`, so `csvCell` (BC-1) applies. BOM + CRLF match what `toCsvFile` writes | ✅ Equivalent to XC-18's "`toCsvFile`" (`toCsv` + `CSV_BOM` is the same bytes). `lib/payments/csv.ts` unchanged |
| Phone exception: `PHONE_SHAPE = /^\+?[\d ().-]+$/` plus at least one digit, tested after `trim()` | ✅ Stronger than XC-18 asked for ("inner quotes doubled"). Nothing in the class can end the string literal or the CSV field. Probed with node: `1,=HYPERLINK("x")`, Arabic-Indic digits `٠٥٤`, full-width `０５４` / `＋972`, a tab inside, NBSP inside, `\n=1`, `\r`, `-1+1` and `=054` all **fall back** to the neutralised quoted cell. `\d` without the `u` flag is ASCII-only. `-` is literal (last in the class). A trimmed leading tab/NBSP is just removed, and the remainder is classified again |
| Comma-split attack `1,=HYPERLINK("x")` | ✅ Closed. Becomes `"1,=HYPERLINK(""x"")"`: one quoted field whose value starts with `1` |
| Unquoted `="…"` field | ✅ Accepted as before. With the allow-list, the field can only hold `=`, `"`, digits, `+`, space, `( ) - .`, `"` |
| `ContactsExportButton`: count = `contacts.length`, the same array the file is built from. Disabled at 0. `aria-label` carries the count when the text is hidden on a phone. V2 tokens, no Radix needed (plain button, as before), `type="button"` | ✅ |
| **Label deviation** "Export {count} shown" vs XC-18 "Export this page ({n} rows)" | ✅ **Ruled: accepted.** The board loads its rows per column, so "this page" is false there. XC-18's intent is an honest count, and "shown" plus the tooltip ("…not your whole list") meets it. **XC-18's wording is amended to "Export {n} shown"** for this slice. Subject to fix 2 below |
| `MoneyCapNotice` + `exportWasCut`: `truncated` or `total > written`. Cleared on the next load. A picked set never shows the notice. The file still downloads. `EXPORT_CAP = 2000` unchanged. `role="status"` | ✅ Logic correct (`total` is `filtered.length` in the route, the pre-slice count). Copy: see fix 1 |
| Translations: 3 keys in en/he/es, `{count}` matches `LanguageContext.t`'s `{var}` replacement | ✅ In step. RTL fine (no direction-sensitive glyphs in the strings) |
| `oneSearchStringTwoReaders.guard.test.ts` repoint | ✅ Same intent. The "quote in a phone" case now correctly pins the fallback |
| CLAUDE.md: no `console.*` in touched files (MoneyList:371 is a comment), no `use…` flag readers, no new pattern, no route/repo/entitlements import | ✅ |
| Tests: `lib/crm`, `lib/payments`, both new component suites | ✅ 61 suites / 1150 tests pass locally |

### Code Review Comments

1. `lib/business-os/translations/{en,he,es}.ts` `payments.export.cut`, Priority **Medium (required)**. The copy says "the {count} **most recent** records only". That is false for 3 of the 4 sorts. When the cut comes from `EXPORT_CAP`, the route slices `sorted`, so with sort = amount / client / status the file holds the top 2000 *of that sort*, not the most recent. A money notice must not state something wrong. Use neutral copy with no claim about which rows are in the file, e.g. en "This file holds only {count} records — not every order." (he/es to match). Don't reuse the `payments.truncated` "most recent" phrasing here.
2. `app/business-os/crm/page.tsx` (`<ContactsExportButton …>` render), Priority **Medium (required)**. The button renders in **every** view. In the Subscribers and Tasks views `fetchContacts()` still fills `contacts` (20 rows) but no contacts are on screen, so the new label reads "Export 20 shown" while showing subscribers or tasks. That makes the honest label untrue in exactly the views where the owner is least likely to expect a contacts file. Render the button only when `viewMode === 'pipeline' || viewMode === 'contacts'`. Add a source-guard line to the existing guard or render test.

### Optimisation Suggestions (non-blocking)

- `page.tsx`: `new Blob([csvContent],{ type` is missing a space after the comma.
- `PHONE_COLUMN = 3` is tied to the order of `headers` by a comment only. You could keep a column-key array and derive the index (`indexOf('phone')`) so a reordered header cannot silently put the formula exception on the wrong column. If not, the existing guard regex at least pins the constant.
- Singular count: es "Exportar 1 mostrados" and he "את 1 אנשי הקשר" read awkwardly at 1. Acceptable. Fix only if the translation layer gains plurals.

### Code Approved for QA: Yes, conditional on fixes 1 and 2 (TL to confirm the diff, no SA re-review needed)

## QA Testing Report

## QA Report — 2026-10-25

**QA — 2026-10-25**
**Test mode:** full
**Strategy used:** A (Jest unit + rendered component), C (scratch script: adversarial CSV written to a real file, read back with Python `csv` and SheetJS), source guards for the CRM page wiring. Option D (manual browser check) not run: the worktree has no dev server of its own, and the download path is covered by the rendered MoneyList test and the source guards.
**Focus:** security (CSV injection), ui (label, count, notice)
**Skipped:** manual browser click-through (reason above)
**Input source:** prompt keywords from TL
**Code state tested:** the SA-fixed diff (`EXPORT_COLUMNS` / `PHONE_COLUMN = indexOf('phone')`, `EXPORTABLE_VIEWS`, neutral `payments.export.cut` copy). The files changed while QA was running; every result below was re-run against the final state.

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Every contacts text cell neutralised (`=` `+` `-` `@` TAB CR), headers too | ✅ | Pass | 32 hostile values × 6 text columns, incl. DDE `=cmd\|' /C calc'!A0`, `@SUM(1+1)`, `=HYPERLINK(...)`, `-Infinity`, `+0x1A` |
| Phone keeps `="…"` only when phone-shaped; anything else falls back | ✅ | Pass | `+972-54-123-4567`, `054 123 4567`, `(054) 1234567`, `+972 (54) 123-4567` keep the text form. `1,=HYPERLINK("x")`, `+1 =1`, `=054`, `054"),HYPERLINK("x`, `054\r\n=1+1`, tab, NBSP, Arabic-Indic and full-width digits all fall back to a quoted, neutralised cell |
| Field count right, no cell would evaluate | ✅ | Pass | Scratch file: 141 lines × 8 fields in Python `csv` and SheetJS (0 formula cells). The in-repo RFC 4180 reader agrees for every case, including quoted CRLF and doubled quotes |
| Button label en/he/es names the count; aria-label carries it; tooltip says "not your whole list" | ✅ | Pass | Rendered in all three languages, he inside `dir="rtl"`. No `{count}` left unreplaced. Icon is `aria-hidden` |
| Disabled at 0 | ✅ | Pass | Plain "Export" label and tooltip at 0, in all three languages |
| Count = exported rows, list and board | ✅ | Pass (source) | Guard: the button reads `contacts.length`; the handler maps `contacts` with no filter or slice; the board gets `contacts`, the list gets `paginatedContacts = contacts`. Shown only in pipeline and contacts views (SA fix 2) |
| MoneyCapNotice when the export response is `truncated` | ✅ | Pass | Rendered MoneyList: notice shows with the count, and the file still downloads |
| …or when `total` > rows returned | ✅ | Pass | `total: 2400`, 5 returned → notice |
| Not shown for a hand-picked selection | ✅ | Pass | Selection export never calls the route and shows no notice, even when a full export would be cut. It also clears a notice left by an earlier cut export |
| Clears on next list load | ✅ | Pass | A `refreshKey` bump reloads and the notice goes |
| List `truncated` notice unchanged | ✅ | Pass | Independent of the export notice |
| No `console.*`; no new lint errors; lint:hooks | ✅ | Pass | 0 `console.*` calls in touched files. ESLint on touched + new files: 0 errors. Its 13 warnings were already in these files (unused imports, `any`, exhaustive-deps). `lint:hooks` clean. `tsc` reports no errors in touched files |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **Stale count on the board after the list view** — `app/business-os/crm/page.tsx` — Low. `fetchBoard` returns early when there are no stages, and on a fetch error it does not reset `contacts`. So if the owner opens List and then switches back to Pipeline, and the stages are empty, failed, or the board fetch throws, the button reads "Export 20 shown" and exports the list's rows while the screen shows the no-stages or failed message. This is rare and needs an account without stages.
2. **Leading space or NBSP before `=` is not neutralised** — `lib/payments/csv.ts` (shared BC-1 rule, out of LX-1 scope) — Low. `csvCell` checks only the first character. Excel and Sheets do not evaluate ` =1+1` on CSV open. LibreOffice can if the importer's "Trim spaces" option is on. Full-width `＝`/`＋` are informational only: no spreadsheet tested evaluates them on import.
3. **A failed export leaves an earlier cut notice up** — `components/payments/MoneyList.tsx` — Low. The catch path returns before `setExportCutAt`, so the old "only N records" line can sit next to "Could not build the export". The next list load clears it.
4. **Comment drift** — `lib/crm/__tests__/contactsCsv.test.ts` header — Low. It says the phone is "CSV-quoted so a comma cannot split it", but the field is written unquoted and the whitelist is what makes it safe (as `contactsCsv.ts` says).
5. Singular count in es/he at 1 (SA already noted). Acceptable.

### Tests added by QA (tests only, no production code)
| File | Tests |
|---|---|
| `lib/crm/__tests__/contactsCsv.adversarial.test.ts` | 221: RFC 4180 read-back of every hostile value in every text column and the phone column |
| `components/payments/__tests__/MoneyList.exportCut.test.tsx` | 7: rendered MoneyList export-cut notice (truncated, total > returned, whole, hand-picked, picked-after-cut, clears on reload, list notice independent) |
| `components/crm/__tests__/ContactsExportButton.i18n.test.tsx` | 9: en/he/es label, aria-label, tooltip, disabled at 0, icon hidden |
| `components/crm/__tests__/exportCountIsTheFile.guard.test.ts` | 3: button count = file rows = rendered rows in both views |

### Test Outputs / Logs
```text
Touched + new suites (lib/crm, components/crm/__tests__, components/payments, lib/payments csv,
dictionariesStayInStep, exportMatchesTheScreen, ConsentSection.unknownState):
Test Suites: 35 passed, 35 total
Tests:       682 passed, 682 total

Wider components/crm run: 3 suites / 4 tests fail in contact-drawer
(bookingsSearchAndPaging, jobOverAfterHeldMeeting, noIntakeToSendOnADeadJob).
These files are not touched by LX-1. They fail the same way on the main checkout (CRLF working copy,
source scans for multi-line strings). This is the known local Windows pattern, not this slice.

Scratch read-back: 141 lines parsed, 8 fields each, 0 live cells (Python csv); SheetJS 0.18.5: 141×8, 0 formula cells.
lint:hooks: clean (--max-warnings 0). eslint touched/new files: 0 errors.
```

### Final Status
- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

## Commit Info
