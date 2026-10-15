# Workplan: F-18, Marketing permission and the saved-address picker

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §7 row F-18 (user decision 2026-10-15: a separate task, right after S-3). Inputs from the S-3 workplan ([BUSINESS_OS_SETTINGS_DRAWER_S3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S3_WORKPLAN.md)): SA workplan review ruling 3 and Q-6, condition C-3 and the "What the separate F-18 task should contain" note, C-7 / R-4 and K15, K21, SA code review finding 1, QA edge case 5
**Branch:** `fix/settings-consent-address-picker` (worktree `neuronforge-settings-drawers`), HEAD `f7495ca6` = head of `feature/settings-drawer-s3` (PR #397, open, not merged). F-18 builds on S-3 because S-3 rewrote `MarketingConsentPanel.tsx`. See R-7 for how the PR lands
**Path:** Full cycle, small. The shared `SavedAddressPicker` changes (rule 7), and the field is the legally required postal line on marketing email
**Date:** 2026-10-15
**Status:** Code Complete (2026-10-15), uncommitted per SA C-6. Awaiting SA code review and QA

## Overview

The Marketing permission panel (`MarketingConsentPanel.tsx`) calls the shared `SavedAddressPicker` with props the picker no longer has. It passes `selected` and a `type AddressSource` that were removed when the address book replaced the two fixed slots, and it omits the required `use`. These are the 2 `tsc` errors S-1 to S-3 carried. Neither `selectedId` nor `current` reaches the picker, so the picker runs its "empty form, take the default and fill it" branch. For any business with a saved address, every open replaces the stored marketing postal address in the form with the book's default, and Save writes it. S-3 made that visible: the drawer is dirty on an untouched open and asks "Discard your changes?" (QA K21).

F-18 fixes the call. The panel keeps its own seed (the stored address, or the profile address) and only changes the field when the owner clicks an entry. The picker gains a small opt-in mode for a form that stores its address as one line of text: it can recognise and mark the entry the text matches, and it never fills on its own. The two existing callers (business profile, invoice settings) do not pass the new props and behave exactly as today. F-18 also fixes SA code review finding 1: an edit typed while a save is in flight is no longer overwritten by the reload that follows.

No server, API, database, repository or translation change. One existing, currently unused key (`settings.address.reuse_other`, present in en, he and es) is reused.

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Since when, and who could be affected](#since-when-and-who-could-be-affected)
- [Implementation Approach](#implementation-approach)
- [Optional items: in or out](#optional-items-in-or-out)
- [Other callers of the picker](#other-callers-of-the-picker)
- [Exposure check for the user (read-only, not run)](#exposure-check-for-the-user-read-only-not-run)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Test Plan](#test-plan)
- [Manual QA Checklist](#manual-qa-checklist)
- [Risks](#risks)
- [Open Questions for SA](#open-questions-for-sa)
- [SA Review Notes](#sa-review-notes)
- [Implementation Notes](#implementation-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

Read in full at `f7495ca6`: `MarketingConsentPanel.tsx`, `components/ui/SavedAddressPicker.tsx`, `SavedAddressPicker.default.test.tsx`, `MarketingConsentDrawer.render.test.tsx` (the S-3 stub), `app/api/business-os/consent-settings/route.ts`, `app/api/business-os/addresses/route.ts` (GET), `BusinessAddressRepository.list`, `components/ui/dialog.tsx`, the picker blocks in `BusinessProfileSection.tsx` and `InvoiceSettingsSection.tsx`, and the z-index layering in `ConfigurationDialog.tsx`.

| Area | What the code does today | Consequence |
|---|---|---|
| Panel call | `selected={reusedAddress}` (not a prop), no `use`, no `selectedId`, no `current`. State typed `AddressSource \| null` (a type the picker no longer exports) | 2 `tsc` errors. `use` is `undefined` at runtime |
| Picker derive branch | `selectedId` defaults to `null`; `hasAddressContent(undefined)` is false, so it takes `book.find(isDefault) ?? book[0]`, calls `onSelectedChange(id, 'derived')` and `onSelect(address)` | The panel's `onSelect` replaces `postal_address` with `formatAddressOneLine(default, readerLocale)`. Runs after the panel set its baseline, so the drawer is dirty on open (K21) |
| Refetch after delete | `localVersion` bump reruns the same branch (the panel's selection is never fed back, so it is always `null`) | Text the owner typed is overwritten again |
| Selection | The panel's `reusedAddress` is set by `onSelectedChange` but never passed back as `selectedId` | No entry is ever marked; "Add a new address" is always the checked radio |
| Radio group | `name={\`saved-address-${use}\`}` | `saved-address-undefined` |
| "Used by" hint | `option.usedBy.find(u => u !== use)` | With `use` undefined every pointer use counts as "other", so it shows the first. For marketing that is the right meaning, but only one of two uses is shown |
| "Add a new address" row | Selects `null`; in this panel the textarea is always visible, and typing in it adds nothing to the book | The label promises something that does not happen here |
| Save then reload | `save()` sends `form`, sets `baseline = sent`, then `load()` does `setForm(next)` unconditionally; fields stay editable during save | Anything typed during the PUT or the reload is lost with no prompt (SA finding 1, QA edge case 5) |
| Delete confirmation | Hand-built `fixed z-[70]` overlay inside the picker, no Escape handler | R-4 / C-7: with a dirty drawer, Escape opens the discard prompt under it |

**Why the panel cannot just pass `current`.** `current` is a `StructuredAddress` and the picker compares parts field by field. `marketing_consent_settings.postal_address` is one line of free text (`TEXT`, max 500 in the route's Zod schema). There is no honest way to turn it back into parts. So a panel-only fix can stop the fill only by tricks (passing a fake `{ line1: text }`, or ignoring the `onSelect` that follows a `'derived'` report). Both rely on the picker's internal call order. A small, explicit opt-in on the picker is cleaner (see Q-1).

**What the seed already provides.** `seeded()` fills a null stored address from `defaults.postal_address`, which the consent GET computes from `business_profiles.address` (cleaned by `cleanPublicContact`). The profile save writes that column as `formatAddressOneLine(address_parts)` in English. So a business with a profile address never sees an empty postal field, and the picker's fill adds nothing the panel needs.

## Since when, and who could be affected

- The panel's picker call came in with `f0723d4d` (2026-10-05), written against an earlier picker shape. The picker was rewritten in `08a5bc26` two minutes before it. Both reached `main` with **PR #229 (`800ce17f`, 2026-10-06 04:21 UTC)**. The bug has been live since that deploy.
- The fill is client-side and the only writer of `marketing_consent_settings` is the consent route's PUT. So a stored value was changed only if an owner **opened Marketing permission, had at least one saved address, and pressed Save** after that date. Opening and leaving changed nothing.
- Before S-3 nothing on screen told the owner the field had changed. The most exposed owners are those who had stored a postal address that differs from their address-book default (a PO box, a registered office, a different branch).
- See [Exposure check](#exposure-check-for-the-user-read-only-not-run) for a read-only way to size it. Nothing here repairs data. A repair, if one is wanted, is a separate task the user approves.

---

## Implementation Approach

### A. `SavedAddressPicker` (shared; modify; SA review under rule 7)

All additions are optional props. A caller that does not pass them gets today's behaviour byte for byte, and the existing 14 tests in `SavedAddressPicker.default.test.tsx` stay unchanged.

1. **`use` value: a new form type, not a new pointer use.**
   - Keep `AddressUse = 'profile' | 'invoice'`. It describes `KnownAddress.usedBy`, which the addresses GET builds from the two pointer columns `business_profiles.address_id` and `invoice_address_id`. Marketing has no pointer column and never will appear in `usedBy`.
   - Add `export type AddressForm = AddressUse | 'marketing'` and type the prop as `use: AddressForm`.
   - Effect: radio group `saved-address-marketing`. The "used by" comparison treats both `profile` and `invoice` as other uses, which is true on the marketing screen. No new translation key is needed, because the hint keys are looked up by `usedBy` values, which stay `profile` and `invoice`.
   - Rejected: widening `AddressUse` itself (it would claim `usedBy` can contain `'marketing'`, which the server never sends); making `use` optional (two pickers would share a radio name, and the `undefined` state is the bug).
2. **`matchCurrent?: (option: KnownAddress) => boolean`, for a form that stores text, not parts.**
   - Read through a ref like `selectedId` and `current`, so it is not a fetch dependency.
   - In the derive block, when `selectedRef.current === null` and `matchCurrent` is given: `const match = book.find(matchCurrent); if (match) onSelectedChange?.(match.id, 'derived');` and **nothing else**. No `onSelect`, and no default fallback for an "empty" form.
   - Why one prop carries both meanings: the default fill exists to stop a structured form opening blank beside a list of saved addresses. A caller that cannot describe its content as parts cannot be judged "empty" by the picker, and it already owns its seed. The doc comment says this.
   - When `matchCurrent` is absent, the existing branch runs unchanged (`current` / `sameAddress`, the default fill).
   - Fallback if SA prefers less: a boolean `fillEmpty?: boolean` (default `true`). The panel passes `false` and gets no marking on open. See Q-1.
3. **Every other use in the hint** (optional item O-2, recommended in). `usedBy.filter(u => u !== use)` rendered as one line each, instead of `find`. On the profile and invoice screens there is at most one other use, so the output is identical. On the marketing screen, an entry used by both shows both lines.
4. **`otherLabel?: string`** (optional item O-4, recommended in). Text for the "not one of these" row, defaulting to `t('settings.address.add_new')`. The panel passes `t('settings.address.reuse_other')` ("Enter a different address" / "Escribir otra dirección" / "הזנת כתובת אחרת"). The key already exists in all three dictionaries and has no reader today.

The delete confirmation is **not** changed (O-3 out; see below).

### B. `MarketingConsentPanel` (modify)

1. **The picker call:**
   ```tsx
   <SavedAddressPicker
     use="marketing"
     selectedId={reusedAddress}
     onSelectedChange={(id) => setReusedAddress(id)}
     matchCurrent={recognisesPostal}
     otherLabel={t('settings.address.reuse_other')}
     onSelect={…unchanged: fills postal_address with formatAddressOneLine(address, addressLocale)…}
     locale={language}
     isRTL={isRTL}
     t={t}
   />
   ```
   - The dead `selected` prop and the `type AddressSource` import are removed. `reusedAddress` becomes `useState<string | null>(null)`.
   - The textarea's existing `setReusedAddress(null)` on typing stays. Typing ends the claim that the text is a saved entry, as on the other two screens.
2. **`recognisesPostal(option)`**, a function in the panel. It compares a normalised copy of `form.postal_address` (trimmed, inner whitespace collapsed, case-folded) with:
   - `option.label`, which the addresses GET formats in the reader's language (what a click on the entry would write), and
   - `formatAddressOneLine(option.address, 'en')`, which is how `business_profiles.address` is written, so a field seeded from the profile is recognised for a Hebrew or Spanish reader too.
   - An empty postal field matches nothing.
   - It is used for marking only. A wrong answer can only mark or not mark a radio. It can never write.
3. **Keep edits typed during a save** (SA finding 1, QA edge case 5). `load` takes an optional `sentForm`. After a successful fetch:
   - `setForm(prev => (sentForm && !sameSettings(prev, sentForm) ? prev : next))` and `setBaseline(next)`.
   - `save()` calls `load(sent)`. The first load and Try again call `load()` as today.
   - If the owner typed during the save, their text stays. The baseline becomes what the server now holds, so the form is dirty and the drawer still guards it. "Saved" is hidden, because it shows only on a clean form. If nothing was typed, the reload behaves as today.
   - Rejected: disabling the form while saving. That needs a `disabled` path through the picker (another shared prop), the Radix `Select` and both `Switch`es. A textarea disabled mid-keystroke also drops focus.

### C. Tests and docs

New real-picker render tests, picker unit tests, one source guard, and an updated comment in the S-3 stub. See [Test Plan](#test-plan). Docs: this workplan, plus the requirement's F-18 progress line and Change History row.

---

## Optional items: in or out

| # | Item | Recommendation | Reasoning |
|---|---|---|---|
| O-1 | Mark the entry the stored text matches, on open (`matchCurrent`) | **In** | SA listed "no entry is ever marked" as part of F-18. It costs one optional prop that is only read, never writes, and covers the reopen case. Fallback is `fillEmpty={false}` with no marking (Q-1) |
| O-2 | Show every "other use" in the hint (`filter` instead of `find`) | **In** | About 5 lines. Identical output on the profile and invoice screens (at most one other use there). Only the marketing screen can have two, which is the screen F-18 fixes |
| O-3 | Move the picker's delete confirmation to `components/ui/dialog` (fixes R-4 / C-7) | **Out**, recorded as a new finding | **It would break the other two screens.** `components/ui/dialog` portals to `body` at a fixed `z-[60]`, and its overlay class is not configurable (`cn` does not merge). `BusinessProfileSection` and `InvoiceSettingsSection` render inside `ConfigurationDialog`, a hand-built modal at `z-[70]` (its own comment says it was raised above every Radix dialog on purpose). The confirmation would open *under* the configuration screen. A correct fix needs either a layer option on the shared dialog primitive or a picker-local Escape handler (a window-capture listener), and both are new patterns. R-4 is safe today (nothing is deleted and no edit is lost without a prompt) and recoverable. Propose F-19, with Q-5 |
| O-4 | Wording of the "not one of these" row on the marketing screen | **In** | "Add a new address" is false here: typing in the field adds nothing to the address book. The fix reuses an existing key that is already translated in he and es, so no wording review is needed |
| SA-1 | Edits typed during a save (SA finding 1) | **In** (keep-if-changed, not disable) | Same file, same review, as SA recommended. Local to `load`/`save`, no shared-component change |

---

## Other callers of the picker

`grep SavedAddressPicker` at `f7495ca6`: 3 product callers, 2 test files. The en dictionary only holds the picker's keys. `BusinessAddressRepository` mentions the name in a comment.

| Caller | Where it renders | Props it passes | Effect of F-18 |
|---|---|---|---|
| `BusinessProfileSection.tsx` | `ConfigurationDialog` → Business tab (hand-built modal, `z-[70]`) | `use="profile"`, `current={address_parts}`, `selectedId`, `onSelectedChange`, `onSelect`, `refreshKey`, `onEdit` | **None.** No new prop is passed, so the derive branch, the default fill, the labels and the confirmation are unchanged. Hint: at most one other use (`invoice`), so `filter` renders exactly what `find` did. The `use` type widens, so `'profile'` still type-checks |
| `InvoiceSettingsSection.tsx` | `ConfigurationDialog` → invoice tab, and inline in `app/onboarding-build/page.tsx` (`expanded`, `showProcessor={false}`) | `use="invoice"`, `current={invoice_address}`, `selectedId`, `onSelectedChange`, `onSelect`, `refreshKey`, `onEdit` | **None**, for the same reasons. Its render test mocks the picker to `null` and is unaffected |
| `MarketingConsentPanel.tsx` | `MarketingConsentDrawer` (S-3 sheet) | today: `selected`, `onSelectedChange`, `onSelect`, `locale`, `isRTL`, `t` | The fix itself |
| `SavedAddressPicker.default.test.tsx` | picker unit tests, `use="profile"` | | Unchanged and must stay green: it is the pin that the profile and invoice behaviour did not move |
| `MarketingConsentDrawer.render.test.tsx` | S-3 drawer tests, picker stubbed | | Stub kept non-filling. Header and inline comments updated: F-18 is fixed, and the real-picker coverage lives in the new file |

---

## Exposure check for the user (read-only, not run)

**Not run by Dev.** Per the brief, nothing is queried against production. The block below is for the user to paste in the Supabase SQL editor on prod. It contains only `SELECT`, writes nothing, and avoids the word that trips the editor's parser.

**Schema basis:** the columns are taken from the migrations (`20260930_marketing_consent.sql`: `postal_address`, `created_at`, `updated_at`; `20261036_business_addresses_book.sql`: `parts`, `is_default`, `created_at`) and from live code paths that read them today: the consent GET reads `business_profiles.address`, and the addresses GET reads the book. If the editor reports an unknown column, nothing has been changed. Tell Dev, who will adjust it.

**How it estimates.** The bug writes `formatAddressOneLine(book default)`. Its first part is the default entry's `line1`, and it contains the entry's `city`. The country name is in the reader's language, so the query matches on `line1` and `city` only. "Book default" means the first entry the picker would have taken: `is_default` first, then the newest. That is today's book, so an entry deleted since then is missed (an estimate, not proof). The seed the owner would otherwise have seen is `business_profiles.address`, written in English, so a stored value that holds the book default but **differs** from that text came from a click on the picker or from the auto-fill.

```sql
-- F-18 exposure estimate. Read-only. Counts only, no address text is returned.
with bug as (
  select timestamptz '2026-10-06 04:21:45+00' as since
),
book as (
  select distinct on (a.user_id)
         a.user_id,
         lower(btrim(coalesce(a.parts->>'line1', ''))) as line1,
         lower(btrim(coalesce(a.parts->>'city', '')))  as city
  from public.business_addresses a
  where coalesce(btrim(a.parts->>'line1'), '') <> ''
     or coalesce(btrim(a.parts->>'city'), '') <> ''
     or coalesce(btrim(a.parts->>'country'), '') <> ''
  order by a.user_id, a.is_default desc, a.created_at desc
),
consent as (
  select s.user_id,
         s.updated_at >= bug.since as saved_since_bug,
         s.created_at <  bug.since as existed_before_bug,
         b.user_id is not null     as has_book,
         (b.line1 <> ''
           and position(b.line1 in lower(coalesce(s.postal_address, ''))) = 1
           and position(b.city  in lower(coalesce(s.postal_address, ''))) > 0) as holds_book_default,
         lower(btrim(coalesce(s.postal_address, '')))
           <> lower(btrim(coalesce(p.address, ''))) as differs_from_profile_text
  from public.marketing_consent_settings s
  cross join bug
  left join book b on b.user_id = s.user_id
  left join public.business_profiles p on p.user_id = s.user_id
)
select
  count(*)                                                         as consent_rows,
  count(*) filter (where saved_since_bug)                          as saved_since_bug,
  count(*) filter (where saved_since_bug and has_book)             as ceiling_saved_with_a_book,
  count(*) filter (where saved_since_bug and has_book
                     and holds_book_default)                       as now_holds_book_default,
  count(*) filter (where saved_since_bug and has_book
                     and holds_book_default
                     and differs_from_profile_text)                as came_from_the_picker,
  count(*) filter (where saved_since_bug and has_book
                     and holds_book_default
                     and existed_before_bug)                       as may_have_replaced_an_earlier_value
from consent;
```

**Reading it:**

| Column | Meaning |
|---|---|
| `ceiling_saved_with_a_book` | The most businesses that could have been affected |
| `now_holds_book_default` | Those whose postal address is now their book default |
| `came_from_the_picker` | Of those, the ones whose text is not the profile seed. Almost certainly written through the picker, either the auto-fill or a deliberate click. The data cannot tell which |
| `may_have_replaced_an_earlier_value` | Rows that existed before the bug and now hold the book default. These are the ones where an earlier, different address may have been lost |

If both of the last two are 0, there is no exposure. If they are not 0, the earlier value is not in the database (the consent PUT is not audited). The only source would be a Supabase backup or point-in-time restore read for those `user_id`s. Any repair is a separate, user-approved task. A per-row version (`user_id` plus the flags, still without address text) is a one-line change to the final `select` if the user wants to contact owners.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `components/ui/SavedAddressPicker.tsx` | modify | `AddressForm` type for `use`; optional `matchCurrent` (recognise, never fill); optional `otherLabel`; every other use in the hint. Header comment gains a short "a form that stores text" section |
| `components/business-os/settings/MarketingConsentPanel.tsx` | modify | Correct picker call (`use="marketing"`, `selectedId`, `matchCurrent`, `otherLabel`); drop `selected` and `AddressSource`; `recognisesPostal`; `load(sentForm?)` keeps edits typed during a save. Clears the 2 `tsc` errors |
| `components/ui/__tests__/SavedAddressPicker.textForm.test.tsx` | create | Unit tests for the new opt-in mode, `use="marketing"`, the hint and the label (P-1 to P-8). A new file so the existing default-behaviour file stays untouched as the pin for the other callers |
| `components/business-os/settings/__tests__/MarketingConsentPanel.picker.render.test.tsx` | create | The panel and the drawer with the **real** picker (R-1 to R-14) |
| `components/business-os/settings/__tests__/MarketingConsentPanel.pickerCall.guard.test.ts` | create | Source guard for the call shape. CI has no `tsc` gate outside bos-llm, so the 2 errors this fixes could come back unseen |
| `components/business-os/settings/__tests__/MarketingConsentDrawer.render.test.tsx` | modify (comments only) | Stub stays non-filling; header and inline comment say F-18 is fixed and point to the real-picker file |
| `docs/workplans/BUSINESS_OS_SETTINGS_CONSENT_ADDRESS_PICKER_F18_WORKPLAN.md` | create | This workplan |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify | F-18 progress line and Change History row (standing rule). Proposed F-19 (O-3) once SA rules |

Not touched: the consent route, the addresses routes, any repository, migration or translation file, `components/ui/dialog.tsx`, `SettingsDrawer.tsx`, `MarketingConsentDrawer.tsx`, `BusinessProfileSection.tsx`, `InvoiceSettingsSection.tsx`. No import from `lib/business-os/entitlements/`.

---

## Task List

- ✅ T0. (Reworded per SA C-6.) Confirmed branch `fix/settings-consent-address-picker` at `f7495ca6` (= PR #397 head, #397 still open). Nothing committed; the merge of `origin/main` (not a rebase) and the PR are RM's, after user approval and after #397 merges (R-7).
- ✅ T1. Picker: `AddressForm` type and `use: AddressForm`. Doc comment on why `AddressUse` stays the pointer type.
- ✅ T2. Picker: `matchCurrent` prop through `matchCurrentRef`; in the derive block the text-form branch goes ahead of the existing one, only marks and never fills; existing statements unchanged (re-indented only). Header comment section. Effect deps still `[locale, refreshKey, localVersion]`.
- ✅ T3. Picker: hint renders every other use (O-2), one bare span each with the existing class and style (C-3).
- ✅ T4. Picker: `otherLabel` with the `add_new` default (O-4, C-4). No translation file edited.
- ✅ T5. Panel: picker call per B.1; `selected` and the `AddressSource` import removed; `reusedAddress: string | null`.
- ✅ T6. Panel: `recognisesPostal` per B.2 (reader-locale label plus English one-line form; empty matches nothing; field text normalised once per render, per the SA suggestion).
- ✅ T7. Panel: `load(sentForm?)` with functional `setForm(prev => …)` and `setBaseline(next)`; `save()` calls `load(sent)`; first load and Try again unchanged (C-5).
- ✅ T8. `SavedAddressPicker.textForm.test.tsx` (P-1 to P-8, plus P-5b).
- ✅ T9. `MarketingConsentPanel.picker.render.test.tsx` (R-1 to R-15).
- ✅ T10. `MarketingConsentPanel.pickerCall.guard.test.ts` (G-1 to G-3, plus G-4: the real-picker file never mocks the picker); S-3 stub comments updated.
- ✅ T11. Mutation run (F1 to F14), each file restored and checked with SHA-1. See Implementation Notes.
- ✅ T12. Verification. See Implementation Notes.
- ✅ T13. Docs: requirement F-18 progress line and Change History; Implementation Notes and Change History here.

---

## Test Plan

### New: `components/ui/__tests__/SavedAddressPicker.textForm.test.tsx` (jsdom, `fetch` stubbed, same fixtures as the default file)

| # | Case | Asserts |
|---|---|---|
| P-1 | `matchCurrent` given, matches nothing, book has a default | `onSelect` never called; `onSelectedChange` never called (wait 50 ms, as the default file does) |
| P-2 | `matchCurrent` matches the second entry | `onSelectedChange(id2, 'derived')`; `onSelect` not called |
| P-3 | `matchCurrent` given and the form "looks empty" (predicate always false) | No default fill: the case the existing file pins as "takes the default" does **not** happen in text mode |
| P-4 | Delete an entry (confirm, Remove) with `matchCurrent` | Refetch happens (2nd GET); `onSelect` still never called |
| P-5 | `selectedId` already set and `matchCurrent` given | No re-derive over the caller's choice (mirrors "does not re-derive") |
| P-6 | `use="marketing"` | Every radio has `name="saved-address-marketing"` |
| P-7 | `use="marketing"`, entry `usedBy: ['profile','invoice']` | Both hint lines render. And `use="profile"` with the same entry renders only the invoice line (unchanged) |
| P-8 | `otherLabel="Enter a different address"` | That text labels the null row; without the prop the row still says "Add a new address" |

### New: `components/business-os/settings/__tests__/MarketingConsentPanel.picker.render.test.tsx` (jsdom, real picker)

`fetch` is routed by URL and method: consent GET and PUT, addresses GET, addresses `/:id` DELETE. `LanguageContext` is mocked as in the S-3 file. `@/components/ui/select` is mocked to a native `<select>` (render only; Radix's listbox cannot be driven in jsdom). **The picker is not mocked.**

| # | Case | Asserts |
|---|---|---|
| R-1 | Stored `postal_address` X; book default Y (≠ X) | After the book renders, the textarea still shows X; the last `onDirtyChange` is `false`; no radio except the null row is checked |
| R-2 | Stored null; `defaults.postal_address` = P (English one-line of entry Y); book default Y | Textarea shows P; clean; **Y's radio is checked** (marked through the English form) |
| R-3 | Stored null; no profile address; book has Y | Textarea empty; clean; nothing filled (the opt-in has no default fill) |
| R-4 | Stored = Y's `label` in the reader's language | Y marked; clean |
| R-5 | Hebrew reader (`language: 'he'`), stored = English one-line of Y | Y marked (cross-locale match) |
| R-6 | Click entry Z | Textarea = Z's one-line form; Z's radio checked; dirty |
| R-7 | After R-6, type in the textarea | Null row checked (unmarked); text as typed |
| R-8 | Type X′, then delete a different entry (confirm, Remove) | After the refetch the textarea still holds X′ |
| R-9 | Delete the marked entry | Null row checked; text unchanged |
| R-10 | Radio group | `name="saved-address-marketing"`; null row reads `settings.address.reuse_other` |
| R-11 | Save untouched | PUT body `postal_address` = the stored X (not the book default) |
| R-12 | SA finding 1: PUT held on a deferred promise; type "edit" in the textarea; resolve PUT and reload | Textarea keeps the typed text; dirty; "Saved" not shown |
| R-13 | Same without typing | After the reload the form equals the reloaded settings; clean; "Saved" shown (S-3 behaviour unchanged) |
| R-14 | **K21 regression, drawer level:** render `MarketingConsentDrawer` open, book with a default ≠ stored; wait for the book; press the sheet's close button | No "Discard your changes?" dialog; `onOpenChange(false)` called |

### New: `MarketingConsentPanel.pickerCall.guard.test.ts` (source, comment-stripped as in `settingsDeepLinks.guard`)

| # | Asserts |
|---|---|
| G-1 | The `<SavedAddressPicker … />` block contains `use="marketing"`, `selectedId={`, `matchCurrent={` |
| G-2 | It contains no `selected={` (the dead prop) and the file has no `AddressSource` |
| G-3 | The picker exports `AddressForm` and the `use` prop is typed with it (guards against someone "fixing" a type error by widening `AddressUse`) |

### Must stay green (run before handing over)

The S-3 set, unchanged, plus the picker's neighbours:

```bash
npx jest components/business-os/settings app/business-os/settings components/ui/__tests__ \
  components/business-os/__tests__/lazyDialogs.guard.test.ts \
  app/api/business-os/addresses \
  lib/business-os/__tests__/addressBook.test.ts \
  app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts \
  lib/business-os/entitlements/__tests__/planBadge.test.ts \
  lib/business-os/entitlements/__tests__/enforcementPoints.test.ts \
  lib/business-os/entitlements/__tests__/tierLiteral.forbidden.test.ts \
  lib/business-os/__tests__/journeyReadiness.test.ts \
  lib/email/templates/__tests__/invite-accepted.test.ts \
  lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts \
  lib/business-os/billing/__tests__/planCheckout.test.ts \
  lib/audit/__tests__/passwordChangeSeverity.guard.test.ts
```

This covers `SavedAddressPicker.default.test.tsx` (the unchanged pin for the profile and invoice callers), `InvoiceSettingsSection.render`, all S-3 suites (`SettingsDrawer.discard`, `.layers`, `.render`, `MarketingConsentDrawer.render`, `.owner`, `settingsDrawerCopy`, `settingsDeepLinks.guard`), and `darkModeTokens` / `mobileSizing` guards, which scan `components/ui`. `components/ui/__tests__` replaces the single `darkModeTokens` path from S-3. Then: `npm run typecheck:bos-llm`, full `tsc` on the touched files, eslint, `npm run lint:hooks`. `npm run test:bos-entitlements` is not required, because nothing imports the entitlements module.

### Mutation candidates (T11)

| # | Mutation | Expected to be caught by |
|---|---|---|
| F1 | Panel drops `matchCurrent` (back to the default fill) | R-1, R-11, R-14, G-1 |
| F2 | Picker calls `onSelect(match.address)` in the text-form branch | P-2, R-4 (dirty) |
| F3 | Picker falls through to the default fill when `matchCurrent` finds nothing | P-1, P-3, R-3 |
| F4 | Panel drops `selectedId` | R-2, R-6 (radio not checked) |
| F5 | Panel passes `use="profile"` | P-6 / R-10 name, G-1 |
| F6 | `load` keeps `setForm(next)` unconditionally | R-12 |
| F7 | Keep-edits path sets `baseline = sent` instead of `next` | R-12 (dirty, "Saved" hidden) |
| F8 | `recognisesPostal` drops the English comparison | R-2, R-5 |
| F9 | `recognisesPostal` lets an empty field match | R-3 (an entry marked) |
| F10 | Picker hint back to `find` | P-7 |
| F11 | Panel textarea no longer clears `reusedAddress` | R-7 |
| F12 | Picker ignores `otherLabel` | P-8, R-10 |
| F13 | Picker reads `matchCurrent` from props inside the effect without the ref, and adds it to the effect dependencies (refetch on every render) | P-4 (GET count), lint:hooks; manual note if it survives |
| F14 | Picker removes the existing default fill for all callers (over-correction) | `SavedAddressPicker.default.test.tsx` "takes the default and fills the fields when the form is empty" |

---

## Manual QA Checklist

Run on a **test account**. M6 deletes an address-book entry, and deleting one on a real business would change its book.

| # | Check | Expected |
|---|---|---|
| M1 | Account with a saved address and a stored marketing postal address that differs from it. Open Marketing permission | The stored address shows. Close untouched: **no** discard prompt (K21 now inverted) |
| M2 | Store the book default's exact line; reopen | That entry is marked |
| M3 | Hebrew UI, postal field seeded from the profile (English text) | The matching entry is marked; the null row reads "הזנת כתובת אחרת"; RTL layout of the list is unchanged |
| M4 | Click a different entry; Save; reopen | The text is that entry's line; it is marked after reopening |
| M5 | Type over the text | Mark moves to the null row |
| M6 | Type something, then delete an entry from the list | Typed text survives the delete |
| M7 | Throttle the network (DevTools, Slow 3G); press Save and type during the spinner | Typed text survives; the drawer asks "Discard your changes?" if closed |
| M8 | Account with no saved address | No list; the field and its placeholder as before |
| M9 | Business profile screen (settings → Configuration → Business) with an empty address and a saved one | Unchanged: the default fills the fields, "Add a new address" label, delete confirmation over the configuration screen |
| M10 | Invoice settings (Configuration and onboarding-build) | Unchanged, as M9 |
| M11 | K15 re-run (R-4) | Same result as S-3 recorded (not fixed here; F-19) |

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A shared picker change alters the profile or invoice screens | All new props are optional, and their absence takes the existing code path. The default test file is not edited and must stay green. F14 proves it catches an over-correction. M9 and M10 check by hand |
| R-2 | Text matching marks the wrong entry, or none | Marking only; it never writes. Normalised on whitespace and case; compares the reader-locale label and the English form. A miss shows nothing marked, which is today's state |
| R-3 | A business with saved addresses but no profile address now opens to an empty postal field, where the bug used to fill it | Intended: the owner picks the entry with one click. The bug's fill was what wrote unasked-for text. Raised as Q-6 because it is a visible change |
| R-4 | O-3 is out, so the R-4 / C-7 layering stays | Safe and recoverable (S-3 R-4). Recorded with the new reason (the shared dialog sits below `ConfigurationDialog`) as proposed F-19 |
| R-5 | The keep-edits reload leaves the form dirty after a successful save | Correct: the owner has unsaved text, and the guard should ask. "Saved" is hidden, because it shows only on a clean form |
| R-6 | Stored addresses already overwritten since 2026-10-06 are not repaired | Out of code scope. The exposure check sizes it; a repair is a separate, user-approved task |
| R-7 | Built on the unmerged PR #397 (stacking) | (Reworded per SA C-6.) Changes stay **uncommitted** until the user has seen the diff and approved it. After #397 merges, RM brings the branch up to date with `git merge origin/main` (not a rebase), commits F-18, and before opening the PR against `main` verifies `git merge-base --is-ancestor f7495ca6 origin/main` and that `git diff --stat origin/main...HEAD` lists only F-18 files. If #397 has not merged when F-18 is approved, F-18 waits; it is never opened against `feature/settings-drawer-s3` |

---

## Open Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Picker opt-in: `matchCurrent` (mark by the caller's predicate, never fill), or the smaller `fillEmpty={false}` (no marking on open)? | `matchCurrent`. One read-only prop, and it closes "no entry is ever marked" |
| Q-2 | `use` typing: the new `AddressForm = AddressUse \| 'marketing'` for the prop, with `AddressUse` left as the pointer type? | Yes. `usedBy` stays exactly what the server sends |
| Q-3 | O-4: `otherLabel` prop, with the marketing screen reusing `settings.address.reuse_other`? | In. The current label is false on this screen, and the key is already translated |
| Q-4 | O-2: render every other use in the hint? | In. Identical on the other two screens |
| Q-5 | O-3: confirm it is out, and record F-19 ("the picker's delete confirmation has no Escape handling; `components/ui/dialog` cannot host it because it sits at `z-[60]` under `ConfigurationDialog`'s `z-[70]`")? | Out of F-18; F-19 in requirement §7 |
| Q-6 | No auto-fill at all in the marketing panel, even when the postal field is empty and the business has saved addresses (R-3)? | Yes. The panel's seed is the profile address, and every other change should be the owner's click |
| Q-7 | SA finding 1: "keep if changed since `sent`", rather than disabling the form? | Keep-if-changed (B.3) |
| Q-8 | Exposure check: hand the SQL to the user as written, and treat any repair as a separate task? | Yes. TL relays it with the K21 note |

---

## SA Review Notes

*(The SA workplan review is the next section. The SA code review (2026-10-15, APPROVED) follows the Implementation Notes.)*

## SA Workplan Review (2026-10-15)

**Reviewed by SA, 2026-10-15**
**Status:** APPROVED WITH CONDITIONS (C-1 to C-10 below). Dev may proceed to implementation (T1 onward), and should meet the conditions as it goes.

### What SA verified in the code (worktree at `f7495ca6`)

| Claim in the workplan | Verified |
|---|---|
| Panel passes `selected` (not a prop), imports `type AddressSource` (not exported by the picker; the type lives in `app/api/business-os/addresses/route.ts`), omits `use` | Yes, `MarketingConsentPanel.tsx:38`, `:489-501` |
| With no `selectedId` and no `current`, the derive block takes `book.find(isDefault) ?? book[0]` and calls `onSelect` | Yes, `SavedAddressPicker.tsx:211-224`. A delete re-runs it through `localVersion` (`:165`, `:238`) |
| `save()` reloads and `load()` calls `setForm(next)` unconditionally; fields are not disabled while saving | Yes, `:243-246`, `:304-306` |
| Three product callers only; profile and invoice pass `use`, `current`, `selectedId`; onboarding-build renders `InvoiceSettingsSection` inline | Yes (`BusinessProfileSection.tsx:889`, `InvoiceSettingsSection.tsx:741`, `app/onboarding-build/page.tsx:1067`). `InvoiceSettingsSection.render.test.tsx` mocks the picker to `null` |
| `components/ui/dialog` overlay and content at `z-[60]`; `cn` does not merge classes | Yes. `cn` in `lib/utils.ts` is `filter(Boolean).join(' ')`, so a `z-[80]` override would sit beside `z-[60]` and the winner would depend on stylesheet order |
| `ConfigurationDialog` at `z-[70]`, raised above Radix dialogs on purpose | Yes, `ConfigurationDialog.tsx:636-645`, `:695`, `:745` (its own confirmations are `z-[80]`) |
| `settings.address.reuse_other` exists in en, he and es and has no reader | Yes (`en.ts:3852`, `es.ts:3628`, `he.ts:2095`); no `.tsx` reads it |
| `business_profiles.address` is written as the English one-line form | Yes, `BusinessProfileSection.tsx:610` (`formatAddressOneLine(address_parts)`, default locale `en`). The consent GET seeds from it through `cleanPublicContact` (`consent-settings/route.ts:84`, `:109`) |
| The addresses GET labels each entry in the reader's locale and skips entries with no content; the repository orders `is_default desc, created_at desc` | Yes (`addresses/route.ts:126-145`, `BusinessAddressRepository.list`) |
| The only writer of `marketing_consent_settings` is the consent PUT, and it sets `updated_at` on every save without touching `created_at` | Yes. `MarketingConsentRepository.upsertSettings` is the only writer and is called only from `consent-settings/route.ts:159`; the payload sets `updated_at` and never `created_at` |
| PR #229 merge time | `800ce17f` committed `2026-10-06T00:21:45-04:00` = `04:21:45 UTC`. Merge time, not deploy time, so the window starts a few minutes early (conservative) |
| No `console.*` in either touched source file | Yes, 0 and 0 |

### Rulings on Q-1 to Q-8

| # | Ruling |
|---|---|
| Q-1 | **`matchCurrent`, approved.** Changing the shared picker with optional props is fine under rule 7: this review is the rule-7 review. It is not a new pattern. It is a pure predicate prop, read through a ref exactly as `selectedId` and `current` already are (`:177-180`), so it adds no fetch dependency. `fillEmpty={false}` would stop the overwrite but leave a reopened panel with nothing marked, which is the "no entry is ever marked" symptom from the S-3 review. The one thing to watch is that a single prop carries two meanings (recognise by text, and never fill). That is acceptable because both follow from one fact: the caller stores text and owns its seed. It must be said in the prop's doc comment and pinned by P-1 and P-3. See C-1 |
| Q-2 | **Approved.** `AddressForm = AddressUse \| 'marketing'` for the `use` prop only. `AddressUse` stays the type of `KnownAddress.usedBy`, which mirrors the server's pointer columns. Widening `AddressUse` would claim the server can send `'marketing'`. Making `use` optional keeps the `saved-address-undefined` state that is part of the bug. G-3 pins it |
| Q-3 | **Approved.** `otherLabel?: string`, defaulting to `t('settings.address.add_new')`. "Add a new address" is false on this screen. Reusing an existing, already-translated key needs no translation change and no wording review |
| Q-4 | **Approved, with the markup held identical** (C-3). On profile and invoice screens `usedBy` holds at most `['profile','invoice']`, so filtering out the current `use` leaves at most one item, the same one `find` returns. The output is identical only if each line renders with the existing `<span className="mt-1 block text-[11px]" …>` and no new wrapper element. P-7 must assert both directions |
| Q-5 | **O-3 out, agreed. F-19 recorded** in the requirement §7 by SA. The z-index claim is verified (table above). Moving the confirmation to `components/ui/dialog` would open it under `ConfigurationDialog` on the profile and invoice screens, which is a regression on two working screens in exchange for an Escape fix on one. The fix needs a layer option on the shared dialog primitive, or an Escape handler local to the picker. Each is a decision for its own task. R-4 / C-7 stays as S-3 recorded it: safe, nothing deleted, recoverable with a second Escape |
| Q-6 | **Approved: no auto-fill in the marketing panel.** This is the legally required postal line on marketing email. The platform must not choose it without the owner's click. The seed (the stored value, else the profile address) is the only automatic source, as the S-3 review already asked ("a `'derived'` fill must never overwrite a stored or seeded non-empty postal address"). The visible change only reaches a business with saved addresses and no profile address text, which is rare: the book was backfilled from `address_parts`, and the profile save writes `address` from the same parts. For that business the field opens empty with the book listed above it. The send gate then still refuses marketing email until the owner picks or types an address, which is the correct state. **Yes, tell the user.** One line in the TL summary, as information and not as a question: "Marketing permission no longer fills the postal address by itself. If it is empty, the owner clicks one of their saved addresses" |
| Q-7 | **Keep-if-changed, approved** over disabling. Disabling needs a `disabled` path through the shared picker (another shared prop), the Radix `Select` and both `Switch`es, and it drops focus mid-keystroke. Keep-if-changed is local to `load`/`save`. It must use the functional `setForm(prev => …)` so it compares against the latest typed text and not a stale closure. Baseline = the reloaded settings, so the drawer stays dirty and the discard guard still protects the typed text. That is the correct outcome. See C-5 for the reload-fails case it must also cover |
| Q-8 | **Approved as written. It goes to the user unchanged.** SA checked it for safety and correctness. It is SELECT only (one `with … select`), with no DDL, no DML and no function call that writes. It returns six counts and no address text, `user_id` or other identifier. It contains no occurrence of the word that breaks the Supabase SQL editor (checked by grep over the block). Every table and column is verified against migrations: `marketing_consent_settings.user_id` (PK), `postal_address`, `created_at` and `updated_at` (`20260930_marketing_consent.sql:280-313`); `business_addresses.user_id`, `parts`, `is_default` and `created_at` (`20261036_business_addresses_book.sql:51-65`); `business_profiles.address` (`20260906_business_contact_details.sql:38`). `business_profiles.user_id` is unique (it is an FK target), and `book` is `distinct on (user_id)`, so neither join can duplicate a consent row and `count(*)` counts consent rows exactly. `book` copies the picker's choice (the `hasAddressContent` predicate, then `is_default desc, created_at desc`, then the first row). Known limits, all on the side of under-counting and all already stated in "Reading it": entries deleted since the bug, and a default entry with no `line1`. `may_have_replaced_an_earlier_value` also over-counts rows whose owner chose the book default on purpose, so it is an upper bound. Neither limit justifies a change. **Any repair is a separate task the user approves**, and its source can only be a backup or a point-in-time restore read, because the consent PUT is not audited. TL relays the block together with the "Reading it" table |

### Conditions

1. **C-1 (picker, text-form branch).** Add `matchCurrent` to the props with a doc comment. The comment says that passing it means the caller stores the address as text and owns its seed, that the picker then only *marks* an entry and never calls `onSelect` and never falls back to the default, and that the predicate must be pure. Read it through a `matchCurrentRef`, and keep the effect dependencies exactly `[locale, refreshKey, localVersion]`. Structure the change as a new branch *ahead of* the existing one (for example `if (matchCurrentRef.current) { … } else { existing block }`). The existing `current` / `sameAddress` / default-fill lines keep their logic. Indentation may change, but no statement in them may. If a caller passes both `current` and `matchCurrent`, `matchCurrent` wins, and the doc comment says so. The panel passes only `matchCurrent`.
2. **C-2 (types).** `export type AddressForm = AddressUse | 'marketing'`. Only the `use` prop takes it. `AddressUse` and `KnownAddress.usedBy` do not change. G-3 as planned.
3. **C-3 (hint markup).** `filter` renders one `<span>` per other use, keyed by the use, with the existing class and style and no wrapper element. P-7 asserts the marketing screen shows two lines for `['profile','invoice']` and the profile screen still shows exactly one (the invoice line).
4. **C-4 (label).** `otherLabel` defaults to `t('settings.address.add_new')`. No translation file is edited. The `Plus` icon may stay (see suggestions).
5. **C-5 (keep edits during a save).** `load(sentForm?)` uses `setForm(prev => (sentForm && !sameSettings(prev, sentForm) ? prev : next))` and `setBaseline(next)`. Only `save()` passes `sent`, while the first load and Try again pass nothing. The F-17 / SA C-2 (b) reload-failure behaviour from S-3 is unchanged. **Add R-15:** with the PUT succeeding, type during the save, then make the reload fail. Expected: the typed text stays, the drawer is dirty, "Saved" is hidden, and no load-failed screen appears, because baseline = `sent` from `save()`.
6. **C-6 (stacking: replaces T0 and R-7 wording).** Changes stay **uncommitted** in the worktree until the user has seen the diff and approved it (standing rule: no commit before review). Do not commit locally earlier. After #397 merges, RM brings the branch up to date with **`git merge origin/main`, not a rebase**. The repo merges PRs with merge commits, so S-3's commits become ancestors of `origin/main` and the merge is clean. RM then commits F-18, opens the PR against `main`, and before opening it verifies two things: `git merge-base --is-ancestor f7495ca6 origin/main` succeeds, and `git diff --stat origin/main...HEAD` lists only F-18 files. If #397 has not merged when F-18 is approved, F-18 waits. It is never opened against `feature/settings-drawer-s3`. Update T0 and R-7 to say this.
7. **C-7 (tests).** Build the plan as written (P-1 to P-8, R-1 to R-14 plus R-15, G-1 to G-3), with three tightenings:
   - P-4 asserts the exact GET count (2), so that F13 is caught by a test and not only by lint.
   - `SavedAddressPicker.default.test.tsx` gets **zero** changed lines, shown in `git diff --stat`. The workplan says 14 tests, while SA's grep finds 16 `it(`/`test(` lines. Record the real count from the Jest output in the Implementation Notes.
   - The real-picker file must not mock `@/components/ui/SavedAddressPicker` at all. G-1 or a second guard should assert that, so a later "simplification" cannot turn it back into a stub test.
8. **C-8 (verification).** Run a full-project `tsc --noEmit` and filter the output to the touched files. The target is 0 errors in `MarketingConsentPanel.tsx` (from 2) and 0 in the picker, with the before and after counts recorded. Also run the must-stay-green set, `typecheck:bos-llm`, eslint on the touched files and `lint:hooks`. Check `git diff --stat` for truncation before handover. Run mutations F1 to F14, restore each file and check its SHA-1.
9. **C-9 (manual QA).** Run M1 to M11 on a test account only (M6 deletes a book entry). For M9 and M10, compare against current behaviour: the default fill, the "Add a new address" label and the confirmation over the configuration screen must all be unchanged.
10. **C-10 (docs and relay).** Update the requirement's F-18 progress line at each stage. TL relays two things to the user. First, the Q-6 one-liner, as information. Second, the exposure SQL exactly as written with its "Reading it" table, to be run by the user on prod. Any repair waits for a separate user-approved task.

### Path

**Full cycle is correct.** The change touches a shared component under rule 7, and it changes which legal text gets written. It is not eligible for the UI short path or the Phase A fast-track.

### Optimisation suggestions (not conditions)

- On the marketing screen the null row reads "Enter a different address" next to a `Plus` icon. A `Pencil` icon would read more naturally, but that would need an icon prop. Leave it unless QA finds it confusing.
- `recognisesPostal` can build the normalised field text once per call and not once per option, since the picker calls it in a `find`.
- If the user wants to contact the affected owners, the per-row variant of the SQL (flags plus `user_id`, still no address text) is the next step, and it needs no other change.

### Approval

[x] Workplan approved with conditions C-1 to C-10. Proceed to implementation.

## Implementation Notes

**Dev, 2026-10-15.** Code complete on `fix/settings-consent-address-picker` (HEAD `f7495ca6`, PR #397 still open). **Nothing committed** (C-6).

### Files

| File | Change | `git diff --numstat` |
|---|---|---|
| `components/ui/SavedAddressPicker.tsx` | `AddressForm`; `use: AddressForm`; `matchCurrent` (+ `matchCurrentRef`); `otherLabel`; hint `filter`; header section | +83 / −16 |
| `components/business-os/settings/MarketingConsentPanel.tsx` | Picker call; `AddressSource` and `selected` gone; `reusedAddress: string \| null`; `normalisedAddressText` + `recognisesPostal`; `load(sentForm?)`, `save()` → `load(sent)` | +48 / −8 |
| `components/business-os/settings/__tests__/MarketingConsentDrawer.render.test.tsx` | Comments only (header and the stub's inline comment) | +8 / −7 |
| `components/ui/__tests__/SavedAddressPicker.textForm.test.tsx` | New, 9 tests | 258 lines |
| `components/business-os/settings/__tests__/MarketingConsentPanel.picker.render.test.tsx` | New, 15 tests | 538 lines |
| `components/business-os/settings/__tests__/MarketingConsentPanel.pickerCall.guard.test.ts` | New, 4 tests | 74 lines |
| `components/ui/__tests__/SavedAddressPicker.default.test.tsx` | **Not touched** (0 changed lines; absent from `git diff --stat`) | — |

`git diff --stat` truncation check: every modified file has insertions, no file shows deletions without insertions.

### Conditions

| # | How it was met |
|---|---|
| C-1 | `matchCurrent` doc comment states both meanings (recognise by text; never fill, no default), that it wins over `current`, and that it must be pure. Read through `matchCurrentRef`. Effect deps unchanged: `[locale, refreshKey, localVersion]`. The text branch sits inside `if (selectedRef.current === null)` and ahead of the existing code as `if (recognises) { … } else { existing }`; `git diff -w` shows the existing statements unchanged (re-indented only). The panel passes only `matchCurrent` |
| C-2 | `export type AddressForm = AddressUse \| 'marketing'`, used only by `use`. `AddressUse` and `KnownAddress.usedBy` unchanged. G-3 pins all three |
| C-3 | One `<span key={otherUse} className="mt-1 block text-[11px]" style={…}>` per other use, no wrapper. P-7 checks both screens (marketing: 2 lines, same parent, same class; profile: only the invoice line) |
| C-4 | `{otherLabel ?? t('settings.address.add_new')}`. No translation file edited. `Plus` icon kept |
| C-5 | `setForm((prev) => (sentForm && !sameSettings(prev, sentForm) ? prev : next))` and `setBaseline(next)`. Only `save()` passes `sent`. The S-3 reload-failure path is untouched (S-3's D-7b still green). R-15 added |
| C-6 | Uncommitted. T0 and R-7 reworded |
| C-7 | P-1 to P-8 (+ P-5b: a click still fills in text mode), R-1 to R-15, G-1 to G-3 (+ G-4: the real-picker file never `jest.mock`s the picker and renders the panel). P-4 asserts exactly 2 GETs with three re-renders carrying a new predicate. `SavedAddressPicker.default.test.tsx` has **16** Jest tests (from the Jest JSON output; the workplan's "14" was wrong, SA's grep of 16 is right) and 0 changed lines |
| C-8 | Below |
| C-9 | Manual QA M1 to M11 is QA's (test account only) |
| C-10 | Requirement F-18 progress line updated with Edit. The Q-6 one-liner and the exposure SQL are TL's to relay |

### Verification (C-8)

| Check | Result |
|---|---|
| Full-project `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=12288`), before (at `f7495ca6`) | 1855 errors in the project. `MarketingConsentPanel.tsx`: **2** (TS2724 `AddressSource`, TS2322 `selected`). `SavedAddressPicker.tsx`: 0 |
| Same, after | 1853 errors in the project. `MarketingConsentPanel.tsx`: **0**. `SavedAddressPicker.tsx`: **0**. Also 0 in the three new test files, the S-3 drawer test, `BusinessProfileSection.tsx`, `InvoiceSettingsSection.tsx` and `app/onboarding-build/page.tsx` |
| Must-stay-green set (Test Plan list) | **40 suites, 851 tests, all pass** (includes the 3 new files) |
| Per file | `SavedAddressPicker.default` 16/16 · `SavedAddressPicker.textForm` 9/9 · `MarketingConsentPanel.picker.render` 15/15 · `MarketingConsentPanel.pickerCall.guard` 4/4 · `MarketingConsentDrawer.render` 30/30 |
| `npm run typecheck:bos-llm` | Passed: 532 files, 28 errors, 0 new (it notes one unrelated baseline entry is now fixed in `app/api/onboarding/build/route.ts`; not touched here) |
| eslint on the 6 touched files | 0 errors, 1 warning: `react-hooks/exhaustive-deps` on the picker's fetch effect (`onSelect`, `onSelectedChange`). **Pre-existing**: the `HEAD` version gives the same warning. `matchCurrent` is not in it, because it is read through the ref |
| `npm run lint:hooks` | Pass (`--max-warnings 0`) |
| `console.*` | 0 in every touched file |

### Mutations (F1 to F14)

Run by a scratchpad script: both source files backed up, each mutation applied alone, the 4 F-18-relevant suites run (default, textForm, picker.render, pickerCall.guard; 44 tests), the file restored from memory and its SHA-1 checked. Final SHA-1: picker `10f5ea3d…`, panel `34c4c028…`, both byte-identical to the backups. **14/14 caught, 14/14 restored.**

| # | Mutation | Caught by |
|---|---|---|
| F1 | Panel drops `matchCurrent` | G-1, R-1, R-3, R-4, R-5, R-8, R-9, R-11, R-12, R-14 (10) |
| F2 | Text branch also calls `onSelect(match.address)` | P-2, R-4, R-5 |
| F3 | Text branch falls through to the default fill | P-1, P-3, P-4, R-1, R-3, R-8, R-9, R-11, R-12, R-14 (10) |
| F4 | Panel drops `selectedId` | G-1, R-2, R-4, R-5, R-6, R-9 |
| F5 | Panel passes `use="profile"` | G-1, R-10 |
| F6 | `setForm(next)` unconditionally | R-12 |
| F7 | `setBaseline(sentForm ?? next)` | R-12, R-13 |
| F8 | `recognisesPostal` drops the English form | R-5 |
| F9 | Empty field matches everything | R-3 |
| F10 | Hint back to one line (`filter(...).slice(0, 1)`, same as `find`) | P-7, R-10 |
| F11 | Textarea no longer clears `reusedAddress` | R-7 |
| F12 | Picker ignores `otherLabel` | P-8, R-1, R-3, R-7, R-9, R-10 |
| F13 | `matchCurrent` read from props in the effect and added to its deps | P-4 (GET count), so a test catches it, not only lint |
| F14 | Default fill removed for every caller | `SavedAddressPicker.default` "takes the default and fills the fields when the form is empty" |

### Deviations from the plan

1. **F8 is caught by R-5 only, not R-2.** In English the entry's label *is* the English one-line form, so R-2 cannot tell the two comparisons apart. R-5 (Hebrew reader, English stored line) is the case that needs the English form, and it catches it.
2. **R-12 has one more step than planned**, so it can catch F7. The reload returns a privacy notice the server changed. After the owner's typed text is reverted, the form must still be dirty (baseline = the reloaded settings, C-5). With baseline = `sent` it would read clean.
3. **Two extra tests:** P-5b (a click on an entry still fills in text mode) and G-4 (C-7's "the real-picker file never mocks the picker").
4. **F7 as run** was `setBaseline(sentForm ?? next)`, which also changes the nothing-typed path, so R-13 catches it as well as R-12.
5. **`normalisedAddressText` is a module-level function** and the field text is normalised once per render (SA suggestion), not once per option.
6. **The source files are CRLF in this worktree** (`core.autocrlf=true`). The three new test files are LF; git normalises both on commit. The guard's call-block search (`\n          />`) works with either.

### Questions for SA

| # | Question | Dev view |
|---|---|---|
| D-Q1 | The picker's pre-existing `exhaustive-deps` warning (`onSelect`, `onSelectedChange`) stays. Fix it here, or leave it? | Leave it. It predates F-18, and fixing it means refs for two more callbacks in a shared component. Out of scope |
| D-Q2 | `typecheck:bos-llm` reports a baseline entry that is now fixed (`app/api/onboarding/build/route.ts`). Update the baseline here? | No. It is unrelated to F-18 and should not ride in this diff |

## SA Code Review (2026-10-15)

**Reviewed by SA, 2026-10-15**, worktree `neuronforge-settings-drawers`, uncommitted diff on `f7495ca6`.
**Status:** APPROVED. No code change required. **Code approved for QA: Yes.** Manual QA M1 to M11 (C-9, test account only) and the TL relay (C-10) are still owed and are not code conditions.

### What SA checked

| Item | Result |
|---|---|
| C-1 picker branch | `git diff -w` on the picker: +75 / −8, and the −8 are only the doc lines replaced, the `find` → `filter` hint, and the label. The existing `current` / `sameAddress` / default-fill statements are unchanged apart from indentation. The text branch sits inside `if (selectedRef.current === null)`, ahead of the old block as `if (recognises) { … } else { old block }`. It calls only `onSelectedChange(match.id, 'derived')`, never `onSelect`, and has no default fallback. `matchCurrentRef` is set on render like `selectedRef` and `currentRef`. Deps are exactly `[locale, refreshKey, localVersion]` (`:301`). The doc comment says both meanings, that it wins over `current`, and that it must be pure. `recognisesPostal` is pure: it reads render-time state and writes nothing |
| C-2 types | `AddressForm = AddressUse \| 'marketing'` is used only for `use`. `AddressUse` and `usedBy: AddressUse[]` are unchanged. The hint keys still come from `usedBy`. G-3 pins all of it |
| C-3 markup | One bare `<span key className="mt-1 block text-[11px]" style>` per other use, with no wrapper. P-7 really checks both directions: on marketing, two spans with the exact class and the same parent; then a separate `use="profile"` render where only the invoice line appears and the profile line is absent |
| C-4 | `{otherLabel ?? t('settings.address.add_new')}`. No translation file is in the diff |
| C-5 | `load(sentForm?)` uses the functional `setForm`, and `setBaseline(next)` runs on both paths. `save()` is the only caller that passes `sent`. The mount effect and `retry` call `load()`. The F-17 / S-3 C-2(b) failure path is untouched (`failed()` and the early returns come before any `setForm`). R-15 covers a reload that fails after typing: the baseline stays `sent` from `save()`, so the form is dirty and nothing else shows. R-12's extra step does tell baseline = `next` apart from `sent` |
| C-7 tests | The default picker test file has 0 changed lines (absent from `git diff`). G-4 forbids `jest.mock` / `jest.doMock` of the picker in the real-picker file and requires it to render `<MarketingConsentPanel`. That file mocks only LanguageContext, supabaseClient, the logger and select. P-4 asserts `gets() === 2` across three rerenders that pass new predicates, plus a delete |
| Other callers | `BusinessProfileSection.tsx:889` and `InvoiceSettingsSection.tsx:741` (which `onboarding-build` renders inline) pass neither `matchCurrent` nor `otherLabel`, and they pass `use="profile"` / `"invoice"`. They therefore take the old branch and the default label. With `usedBy ⊆ {profile, invoice}`, `filter` gives what `find` gave. There is no runtime change for them |
| Order of loads | The picker renders only after the consent load (the `loading` and `loadFailed` early returns). So `form.postal_address` is already seeded when the book's derive runs, and R-2 marking is not racy |
| Logging / values | No `console.*` in any touched file. The picker logs nothing. The panel's new code logs nothing, and the existing log calls carry `status` / `err` only |
| Must-stay-green | Re-run by SA: 40 suites / 851 tests, 850 pass. The one failure was `AdminAreaField.search.test.tsx` "narrows 62 states…". F-18 does not touch that file and the picker does not import it. Re-run alone it passes 8/8, so SA reads it as a timeout under load, with QA running Jest in the same worktree at the same time. See finding 4 |

### Findings

1. **Keep-path keeps the whole typed form, not just the typed field** (`MarketingConsentPanel.tsx:258`). Priority: Low, informational. If the server normalises any other field on save, the kept form holds the pre-save version of that field. That is harmless, because the form is already dirty and the owner's next Save sends what they see. No change.
2. **Marking is derived only when the book is fetched** (on open, after a delete, or on locale change). Text the owner types or saves that happens to equal an entry is marked on the next open, not live. Priority: Low. This matches C-1: it marks only and never writes. No change.
3. **The `pickerCall()` guard keys on the exact closing indentation** (`'\n          />'`). Priority: Low. A reformat makes it fail loudly with `expect(end).toBeGreaterThan(start)`. It does not pass silently, so it is acceptable.
4. **`AdminAreaField.search` failed once under parallel load** (not an F-18 file). Priority: Low. It passes alone. QA should confirm it is green in their own run of the set. If it fails again when Jest is not running in parallel, raise it as a separate flake ticket, not against F-18.

### Rulings

- **D-Q1 (pre-existing `exhaustive-deps` warning on the picker's fetch effect):** **Leave it.** It predates F-18, as the HEAD version gives the same warning, and `matchCurrent` is correctly excluded through its ref. Silencing it means refs for `onSelect` and `onSelectedChange` in a shared component, which is a behaviour-neutral refactor that deserves its own small task, not this legal-text fix. `lint:hooks` (rules-of-hooks, `--max-warnings 0`) passes.
- **D-Q2 (`scripts/typecheck-bos-llm.baseline.json` entry for `app/api/onboarding/build/route.ts` now fixed):** **Do not update it in this diff.** It is unrelated, and F-18's PR must list only F-18 files (C-6 diff check). A stale entry does not fail the check. It only means that a regression in that file would be tolerated. TL should note it as a one-line chore (ratchet the baseline) for whoever next works on main.

### Code Approved for QA: Yes

### SA re-check of post-QA tweak (2026-10-15)

**Status:** APPROVED (proportionate re-check, read-only).

- **C-1 intact.** `recognisesPostal` stays a pure predicate passed as `matchCurrent`; the picker's text-form branch only calls `onSelectedChange(id, 'derived')` and never `onSelect`. The worst a wrong answer can do is flip a radio; it cannot write the field or dirty the form.
- **False positives.** Exact equality after normalisation (trim, whitespace collapse, case fold), never substring. The three `ONE_LINE_LOCALES` forms differ only in the country name, so the extra forms can only match the same structured address. `formatAddressOneLine` returns `null` for an empty address, which normalises to `''`, and the `postalText !== ''` guard means an empty field (or an empty entry) matches nothing, consistent with the recorded user decision (empty postal: no auto-fill, no pre-marking).
- **R-17 still meaningful.** It asserts the city is contained in, but not equal to, the line, and that the entry stays unmarked: it still guards against a substring match (QA Q9) across all three locale forms. The `VENUS.city as string` cast is acceptable in a fixture: the fixture is a literal, and if the city were ever missing the `toContain` precondition fails loudly, so a runtime guard would add nothing.
- **R-18 / R-19** cover the reported case in both directions (he written, en reader; es written, he reader) with "clean" and "no PUT" assertions.
- **Re-run:** `MarketingConsentPanel.picker.render` 19/19 and `SavedAddressPicker.default` 16/16 (35/35). `tsc` reports no errors in the panel or the picker. The `act(...)` warning from the picker's `setLoaded` is pre-existing.

## QA Testing Report

## QA Report (2026-10-15)

**QA, 2026-10-15**
**Test mode:** full (code level), manual checks NOT RUN
**Strategy used:** A + B (Jest unit and jsdom render with the real picker), plus a mutation run. Option D (browser) was not possible: there was no browser and no test account in this session
**Focus:** ui, the picker contract, and regression of the profile and invoice callers
**Skipped:** M1 to M11 (manual), see below
**Input source:** TL prompt

### Baseline and file safety

- Worktree `neuronforge-settings-drawers`, branch `fix/settings-consent-address-picker`, nothing committed.
- `git diff --numstat` was the same before and after QA: panel +48/−8, drawer test +8/−7, picker +83/−16, requirement +5/−0.
- SHA-1 was checked before and after every mutation and matches Dev's: picker `10f5ea3d…`, panel `34c4c028…`. Backups are in the QA scratchpad.
- `SavedAddressPicker.default.test.tsx`: `git diff --stat` is empty, the file is not in `git status`, and it passes 16/16.

### Must-stay-green set (re-run independently)

| Run | Result |
|---|---|
| Full Test Plan list | 40 suites, 851 tests. 850 passed and 1 failed: `components/ui/__tests__/AdminAreaField.search.test.tsx` |
| `AdminAreaField.search` alone | 8/8 pass. This is a timing flake under parallel load (SA was running the same set in the same worktree at the same time). F-18 does not touch that file or its component |
| Per F-18 file | `SavedAddressPicker.default` 16/16 · `textForm` 9/9 · `MarketingConsentPanel.picker.render` 15/15 · `pickerCall.guard` 4/4 · `MarketingConsentDrawer.render` 30/30 |
| eslint on the picker and the panel | 0 errors, 1 warning. The warning is the `exhaustive-deps` one on `onSelect`/`onSelectedChange`, which was there before F-18 (D-Q1). `matchCurrent` is not in it |

### Mutations beyond F1 to F14

Each mutation was applied on its own and run against the 5 F-18 suites (74 tests). After each one the file was restored and its SHA-1 checked.

| # | Mutation | Result | Caught by |
|---|---|---|---|
| Q1 | `matchCurrentRef.current` not refreshed on each render (stale predicate) | **SURVIVED** | (see Edge case 1) |
| Q2 | New branch placed after the existing one: the text branch runs only when `current` has content, so the marketing form gets the default fill | Caught (13) | P-1 to P-4, R-1, R-3 to R-5, R-8, R-9, R-11, R-12, R-14 |
| Q3 | Panel drops `use="marketing"` | Caught | G-1, R-10 |
| Q4 | Panel does not pass `otherLabel` | Caught | R-1, R-3, R-7, R-9, R-10 |
| Q5 | Hint goes back to `find`, so only the first use is shown | Caught | P-7, R-10 |
| Q6 | Keep-edits compares `prev` with `next` instead of with `sentForm` | Caught | R-13 |
| Q7 | `save()` reloads with `load()`, which loses `sentForm`, so the reload sets the form unconditionally | Caught | R-12 |
| Q8 | Normalisation drops case-folding | Caught | R-4 |
| Q9 | Match by substring (`includes`) instead of equality | **SURVIVED** | (see Edge case 2) |
| Q10 | Text branch fills `book[0]` after a delete (picker fill on delete in text mode) | Caught | P-4, R-8, R-9 |
| Q11 | Panel ignores a `'derived'` selection | Caught | R-2, R-4, R-5, R-9 |
| Q12 | `matchCurrent` re-derives over the caller's `selectedId` | Caught | P-5 |

**12 run, 10 caught, 2 survived.** The two survivors can only change which radio is marked. Neither can write the postal field or make the drawer dirty.

Other mutations from the brief already exist as Dev's F-series, all caught:
- Reading `matchCurrent` directly and adding it to the deps (the refetch storm) is F13, caught by P-4.
- `setForm(next)` with no condition is F6.
- Baseline set to `sentForm` is F7.
- Dropping the English one-line form from matching is F8, caught by R-5.
- Letting an empty field match an entry is F9, caught by R-3.
- The picker ignoring `otherLabel` is F12.

### Code-level paths

| Path | Result | Evidence |
|---|---|---|
| Stored address kept, form clean on open, no discard prompt on an untouched close (the S-3 K21 interim behaviour is gone) | ✅ Pass | R-1, R-11 (PUT sends the stored X), R-14 (drawer closes at once, no discard dialog). Q2, F1 and F3 caught |
| Matching entry marked (English) | ✅ Pass | R-2 (profile seed), R-4 (label with different case and spacing) |
| Matching entry marked (Hebrew) | ✅ Pass | R-5 (Hebrew reader, English stored line). A stored line in the Hebrew label is not tested on its own, but it goes through the same `option.label` comparison that R-4 covers |
| Clicking an entry fills the field and marks it | ✅ Pass | R-6, P-5b |
| Typing unmarks | ✅ Pass | R-7, F11 |
| Delete keeps typed text | ✅ Pass | R-8, R-9, Q10 |
| Typing during a save survives the reload | ✅ Pass | R-12, Q7, F6 |
| Reload fails after typing: text kept, still dirty, no "Saved", no load-failed screen (R-15) | ✅ Pass | R-15. In the code, `save()` sets baseline = `sent` before `load(sent)`, and `failed()` does not set `loadFailed` once a load has succeeded |
| Profile and invoice behave as before (they still get the default fill) | ✅ Pass (code level) | The default test file is byte-unchanged and passes 16/16, including "takes the default and fills the fields when the form is empty". Its branch is unchanged in `git diff -w`. P-7 shows the profile screen still has one hint line. `InvoiceSettingsSection.render` passes. The visual check is still owed (M9, M10) |

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| The picker no longer overwrites the stored postal address | ✅ | Pass | R-1, R-11, R-14 |
| Opt-in props `matchCurrent`, `otherLabel`, `use='marketing'` | ✅ | Pass | P-1 to P-8, G-1 to G-3, Q2 to Q5, Q12 |
| Edits typed during a save are kept | ✅ | Pass | R-12, R-13, R-15 |
| Other callers unchanged | ⚠️ | Pass (code) | Manual M9 and M10 not run |
| Manual M1 to M11 | ❌ | NOT RUN | No browser or test account in this session |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues

None. P-4 pins exactly 2 GETs while the predicate changes on every render.

#### Edge Cases (nice to fix: these are test gaps, not defects in the current code)

1. **Q1 survives: no test pins that `matchCurrentRef` is refreshed on every render.** With a stale predicate, the picker would match the text the panel opened with. Example: the stored line is Y's, so Y is marked. The owner types over it, so the mark moves to "other". The owner then deletes Z. The refetch would mark Y again next to text that is no longer Y. This only marks a radio and writes nothing.
   - Suggested test: the R-9 setup, type over the line, delete a different entry, and assert that only "other" is checked.
   - Severity: Low.
2. **Q9 survives: equality versus substring matching is not pinned.** If the comparison were loosened to `includes`, a short stored line that is part of an entry's label (for example only the city) would mark that entry.
   - Suggested test: store a fragment of Y's label and assert that Y is not marked.
   - Severity: Low.
3. **A line saved in a third language is not recognised.** A line clicked by a Hebrew reader and later opened by a Spanish reader shows nothing marked, because only the reader's label and the English form are compared. This affects marking only and is by design (Risk R-2). Information only.
4. `AdminAreaField.search.test.tsx` flakes under parallel load. It is unrelated to F-18 (see above). Information only.

### NOT RUN: manual checks a human must do (test account only)

| # | What to check |
|---|---|
| M1 | Account with a saved address and a different stored postal line. Open Marketing permission: the stored line shows. Close without touching anything: no "Discard your changes?" |
| M2 | Stored line is the book default's exact line. Reopen: that entry is marked |
| M3 | Hebrew UI, field seeded from the profile (English): the entry is marked, the null row reads "הזנת כתובת אחרת", and the RTL list looks as before |
| M4 | Click another entry, Save, reopen: the field holds that entry's line and the entry is marked |
| M5 | Type over the text: the mark moves to the null row |
| M6 | **Deletes an address-book entry: test account only.** Type something, then delete an entry: the typed text survives |
| M7 | Throttle to Slow 3G, press Save and type during the spinner: the text survives, and closing the drawer asks "Discard your changes?" |
| M8 | Account with no saved address: no list; the field and its placeholder are as before |
| M9 | **Must match today.** Configuration → Business, with an empty address and one saved address: the default fills the fields, the row says "Add a new address", and the delete confirmation appears over the configuration screen |
| M10 | **Must match today.** Invoice settings, in both Configuration and onboarding-build: same as M9 |
| M11 | Re-run K15: same result as S-3 recorded (not fixed here, see F-19) |

### Final Status

- [x] All automated acceptance checks pass. No High or Medium bug is open.
- [ ] Manual checks M1 to M11 are still owed on a test account before release. M9 and M10 are the regression check for the shared picker.

**Verdict: PASS WITH NOTES.** The notes: 2 surviving mutations (Low test gaps that affect marking only), 1 unrelated flake, and the manual checks NOT RUN.

### QA gap closure (2026-10-15)

Dev changed tests only. No production file changed: the picker SHA-1 is still `10f5ea3d…` and the panel's is still `34c4c028…`, and `git diff --numstat` on the source files is the same as before. Two tests were added to `MarketingConsentPanel.picker.render.test.tsx` (15 → 17):

| Test | Closes | What it does | Mutation result |
|---|---|---|---|
| R-16 | Edge case 1 (Q1) | The stored line is Y's, so Y is marked. The owner types over it, then deletes Z. Afterwards only "other" is checked, Y is not marked again, and the typed text is kept | Q1 (stale `matchCurrentRef`): **now caught**, by R-16 only (1 of 76 fail) |
| R-17 | Edge case 2 (Q9) | Only Y's city (`Closter`) is stored. Y is not marked, only "other" is checked, and the form is clean | Q9 (`includes` instead of `===`): **now caught**, by R-17 only (1 of 76 fail) |

- QA's mutation script was re-run for Q1 and Q9 only, against the 5 F-18 suites. Each file was restored after its run and its SHA-1 matched.
- Must-stay-green set (Test Plan list): **40 suites, 853 tests, all pass** (851 + 2). `AdminAreaField.search` did not flake this time.
- eslint on the test file: clean.
- While this ran, another session added untracked temporary diagnostics to this worktree: `components/business-os/settings/__tests__/zz_diag_falseDirty.test.tsx` and `components/business-os/settings/zz_diag_s3/`. They fail on their own. They were excluded with `--testPathIgnorePatterns zz_diag` and **were not touched**. They must not be committed with F-18.

### Post-QA tweak: multilingual match (2026-10-15)

**Cause (the user's manual-test bug).** A click on an entry writes `formatAddressOneLine(entry.address, <reader's language at the time>)` into the postal field. Entry labels come from the same function in the request's language, and only the country name differs between languages. `recognisesPostal` compared the field only with `option.label` (today's language) and the English form. A line written for a Hebrew or Spanish reader and opened in another language therefore fell to "Enter a different address".

**Change (panel only, mark-only as before).** `recognisesPostal` still tries `option.label` first. On a miss it also tries `formatAddressOneLine(option.address, l)` for each `l` in a module constant `ONE_LINE_LOCALES = ['en', 'he', 'es']`. This replaces the single English check. Normalisation is unchanged, the field text is still normalised once per render, an empty field matches nothing, and the predicate stays pure and never fills. `option.address` is the `StructuredAddress` that `KnownAddress` already carries.

**Tests** (`MarketingConsentPanel.picker.render.test.tsx`, 17 to 19):

| Test | What it does |
|---|---|
| R-18 | Drawer, English UI, stored line = default entry Y in Hebrew. Y is marked, the field is untouched, the drawer closes without a discard prompt, and no PUT is sent |
| R-19 | Panel, Hebrew UI, stored line = Y in Spanish. Y is marked, Z is not, the form is clean, and no PUT is sent |

- **Proof that the tests catch a regression.** The panel was restored from a scratchpad copy of its pre-tweak version (SHA-1 `34c4c028…`) and the file was re-run: R-18 and R-19 failed (2 of 19), and the other 17 passed, including R-17. The tweak was then put back and the SHA-1 checked (`2ea00571…`).
- **Fixed along the way.** R-17 (gap closure) had a pre-existing `tsc` error (TS2345, `VENUS.city` is `string | undefined`). It now reads `VENUS.city as string`.
- **Must-stay-green set** (Test Plan list, `--testPathIgnorePatterns zz_diag`): **40 suites, 855 tests, all pass** (853 + 2).
- **Full-project `tsc`:** 1853 errors, 0 in `MarketingConsentPanel.tsx`, `SavedAddressPicker.tsx` and `picker.render`. eslint is clean on both touched files, and `lint:hooks` passes.
- **SHA-1 after the change:** panel `2ea005719996b0e3981cca385f4b665716aebb48`. The picker is unchanged at `10f5ea3d…`.

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created | Dev workplan for F-18 (full cycle), verified at `f7495ca6` (PR #397 head). The bug has been live since PR #229 (`800ce17f`, 2026-10-06 04:21 UTC). Approach: the picker gains an opt-in text-form mode (`matchCurrent`: mark, never fill), the `AddressForm` type with `'marketing'`, every other use in the hint, and `otherLabel`. The panel passes `use`, `selectedId`, `matchCurrent` and `otherLabel`, drops the dead `selected` and `AddressSource` (both `tsc` errors), and keeps edits typed during a save (SA finding 1). O-3 (move the confirmation to `components/ui/dialog`) is out: that dialog sits at `z-[60]` under `ConfigurationDialog`'s `z-[70]`, so it would open behind the profile and invoice screens. Proposed F-19. Read-only exposure SQL is provided for the user and was not run. Eight questions for SA |
| 2026-10-15 | SA workplan review | APPROVED WITH CONDITIONS (C-1 to C-10). Q-1: `matchCurrent` (pure predicate through a ref; marks only, never fills; existing branch's logic untouched). Q-2: `AddressForm` for `use` only. Q-3, Q-4: in, with the hint markup held identical. Q-5: O-3 out; F-19 recorded in the requirement §7 (z-60 vs z-70 verified). Q-6: no auto-fill; tell the user as information. Q-7: keep-if-changed, plus R-15 (a reload that fails after typing). Q-8: SQL verified against migrations (SELECT only, counts only, no "into") and relayed unchanged; any repair is a separate user-approved task. Stacking: uncommitted until user approval, then merge (not rebase) `origin/main` after #397 merges, PR against `main` with the ancestry and diff checks. Full cycle confirmed |
| 2026-10-15 | Code complete | Dev, uncommitted (C-6). Picker: `AddressForm`, `matchCurrent` (ref, mark only, ahead of the unchanged branch, deps unchanged), `otherLabel`, every other use in the hint. Panel: `use="marketing"`, `selectedId`, `matchCurrent`, `otherLabel`; `AddressSource`/`selected` gone; keeps edits typed during a save. Tests: textForm 9, picker.render 15 (R-1 to R-15), guard 4; default file untouched (16 tests). `tsc`: panel 2 → 0, picker 0 (project 1855 → 1853). Must-stay-green 40 suites / 851 tests pass; bos-llm typecheck, eslint (one pre-existing warning), lint:hooks pass. Mutations 14/14 caught, SHA-1 restored. T0 and R-7 reworded per C-6. See Implementation Notes |
| 2026-10-15 | SA code review | APPROVED, code approved for QA. C-1 to C-5 and C-7 verified in the diff: `git diff -w` shows the old branch unchanged, deps unchanged, P-7 checks both directions, P-4 counts 2 GETs, G-4 keeps the real picker, and the default test file is untouched. The other callers are unaffected at runtime. No `console.*` and no values logged. 4 Low findings, none blocking. D-Q1: leave the pre-existing warning. D-Q2: do not touch the bos-llm baseline here; TL notes it as a chore. SA re-ran the must-stay-green set: 851 tests, 1 failure, an unrelated `AdminAreaField.search` timeout under parallel load (8/8 when run alone). Manual QA M1 to M11 and the C-10 relay are still owed |
| 2026-10-15 | QA report | PASS WITH NOTES. Must-stay-green set re-run: 40 suites, 851 tests, with 1 unrelated timing flake (`AdminAreaField.search` passes 8/8 when run alone). The default picker test file is byte-unchanged and passes 16/16. 12 new mutations (Q1 to Q12): 10 caught, 2 survived. The survivors are Q1 (stale `matchCurrent` ref) and Q9 (substring match); both affect marking only and are Low test gaps. No bugs. Manual M1 to M11 NOT RUN (no browser or test account; M6 on a test account only; M9 and M10 must match today) |
| 2026-10-15 | QA gap closure | Dev, tests only. R-16 (Q1: the stale `matchCurrent` ref) and R-17 (Q9: a fragment of a label must not match) were added to `picker.render` (15 → 17). Q1 and Q9 are now caught. The source SHA-1s and the numstat are unchanged. Must-stay-green: 40 suites, 853 tests, all pass. Another session's untracked `zz_diag_*` files were excluded and not touched |
| 2026-10-15 | Post-QA tweak: multilingual match | Dev, uncommitted. The user's manual test found that a line written for a Hebrew or Spanish reader was not recognised in another language. `recognisesPostal` now also compares `formatAddressOneLine(option.address, l)` for `en`, `he` and `es`, after `option.label`; it still only marks. R-18 and R-19 were added (picker.render 17 to 19), and both fail on the pre-tweak panel. R-17 `tsc` fix. Must-stay-green 40 suites / 855 tests pass. Panel SHA-1 `2ea00571…` |
| 2026-10-15 | SA re-check of post-QA tweak | APPROVED. Still mark-only (C-1): the predicate is pure and exact-equality, and an empty field matches nothing. A wrong answer can only flip a radio. R-17 still guards against substring matching, and the `as string` fixture cast is acceptable. picker.render 19/19 + default 16/16 pass, and `tsc` is clean for the panel and picker |
