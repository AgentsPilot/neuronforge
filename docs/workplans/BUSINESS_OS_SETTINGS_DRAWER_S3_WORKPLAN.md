# Workplan: Business OS Settings Drawer, S-3 (Marketing permission drawer)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §3 row 9, §4.3, §4.4, §5 S-3, Q-2 (a), F-2, F-3; SA conditions C-1, C-4, C-5, C-8, C-9, C-10, C-12, C-13 (and C-24 as amended); S-1 workplan SA rulings Q-3 / W-4 and code-review finding 3; S-2 workplan (pattern and tests)
**Branch:** `feature/settings-drawer-s3`, HEAD `5d7a0586` = `origin/main` after S-1 (#388) and S-2 (#389) merged. No rebase needed (SA C-1: T0 already done). RM still confirms the branch is an ancestor of `origin/main` before the PR (C-24: no stacking)
**Path:** Full cycle (SA-5: new pattern, the discard guard; legal content; fixes F-2). Workplan first, SA workplan review, then code
**Date:** 2026-10-15
**Status:** Code Complete (2026-10-15). SA workplan review APPROVED WITH CONDITIONS C-1 to C-9, all applied. Uncommitted; awaiting SA code review and QA

## Overview

S-3 moves **Marketing permission** from an expand-in-place row into the settings drawer that S-1 built. The row stays on the page as a dialog opener. The panel opens in a drawer with a fixed Save bar at the bottom (the existing `TabFooter` portal, reused, not copied). S-3 also adds the **unsaved-changes guard** that SA approved under C-5. It is an opt-in `isDirty` prop on `SettingsDrawer`. When the form has unsaved edits, every way of closing the drawer (X, Escape, overlay) asks "Discard your changes?" in a `components/ui/dialog` rendered inside the sheet, with **Keep editing** and **Discard** (Q-2 (a)). While a save is in flight the drawer refuses to close (`isBusy`, C-4). Both the save result and a failed save are shown inside the drawer, which fixes F-2 (a failed save shows nothing today) and F-3 (collapsing the row drops edits silently).

No server, API, database or repository change. The consent route (`/api/business-os/consent-settings`) and its payload are unchanged.

**Code verified against:** `app/business-os/settings/page.tsx` at commit `e9f0d103` (S-2, the last commit touching the file). Worktree HEAD `5d7a0586` (updated per SA C-1; the plan was first written at HEAD `8fc75443` against `origin/main` `e668a7a6`). `git diff e9f0d103 5d7a0586` is empty for `app/business-os/settings/`, `components/business-os/settings/`, `components/ui/dialog.tsx`, `components/ui/sheet.tsx` and `lib/business-os/translations/`. All locations below are given by **symbol or anchor** (C-13), not line number.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Deep links to consent (C-2 check)](#deep-links-to-consent-c-2-check)
3. [Implementation Approach](#implementation-approach)
4. [Guard Design (C-5)](#guard-design-c-5)
5. [Files to Create / Modify](#files-to-create--modify)
6. [Task List](#task-list)
7. [Test Plan](#test-plan)
8. [Manual QA Checklist (C-10)](#manual-qa-checklist-c-10)
9. [Risks](#risks)
10. [Open Questions for SA](#open-questions-for-sa)
11. [Condition Traceability](#condition-traceability)
12. [SA Review Notes](#sa-review-notes)
13. [Implementation Notes](#implementation-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)
16. [Change History](#change-history)

---

## Analysis Summary

| Area | As found on `e9f0d103` |
|---|---|
| Consent row (`page.tsx`) | `<div id="settings-section-consent">` in the right-hand account card: a `<button>` (no `type`, no `aria-haspopup`) that toggles `setExpandedSection(expandedSection === 'consent' ? null : 'consent')`, a `MailCheck` icon, `t('consent.title')` and a rotating `ChevronRight`. When expanded it renders `<div className="px-4 pb-4"><MarketingConsentPanel /></div>` |
| `expandedSection` | `useState<string \| null>(null)`. After S-1 and S-2, the consent row is its **only** remaining user. The timezone branch's comment still names `setExpandedSection('timezone')`. That comment is frozen by C-2 |
| `MarketingConsentPanel` | Self-contained. `load()` runs `GET /api/business-os/consent-settings?locale=…` on mount, then `setPayload` and `setForm(seeded(…))`. `save()` sends `PUT` with the whole `form`. On `json.success` it sets `saved` and reloads. **Not success, and no message** when `json.success` is false (400 "Invalid settings", 401, 500), which is F-2. A thrown error is logged with `logger.error({ err })` and shows nothing. `saved` is never cleared once set |
| Load failure | If the GET fails or returns `success: false`, `loading` clears with `payload = null` and `form = EMPTY`, and the form and Save **still render**. Saving then would write `EMPTY` (null wording, null postal address, mode `hosted`) over the owner's stored settings. This is **F-17 (new)**, see Q-1 |
| Save button | An inline row at the foot of the panel, `type="button"`, the shared primary classes, `disabled={saving}`, `Loader2` while saving, then `t('consent.saved')` |
| Switches | Two `Switch`es (`consent-capture-enabled`, `consent-label-as-advertisement`), each inside `<div dir="ltr" className="mt-0.5 shrink-0">` (§4.3, C-5 last bullet) |
| Popovers | Privacy-notice `Select` (Radix, `SelectContent` portalled, `z-[100]`). `SavedAddressPicker` is rendered in-tree; its delete confirmation is a hand-built `fixed inset-0 z-[70]` overlay **inside** the panel's DOM, with no Escape handler of its own |
| `SavedAddressPicker` call | Passes `selected` and `type AddressSource` (neither exists on the picker any more) and omits the required `use` prop. These are the **2 pre-existing `tsc` errors** S-1 and S-2 recorded in this file. At runtime, `use` is `undefined`. This is **F-18 (new)**, see Q-6 |
| Language read | `languageRef`, deliberately not a dependency, so a language switch does not reseed mid-edit. Its comment says "the panel is mounted when its section is expanded", which stays true for "when its drawer opens" |
| `SettingsDrawer` (S-1/S-2) | Props only: `open`, `onOpenChange`, `title`, `meta`, `isBusy`, `isRTL`, `closeLabel`, `returnFocusRef`, `testId`, `children`. One `handleOpenChange` gate, plus Escape and outside `preventDefault` and a disabled X while busy. No footer slot, no `isDirty` |
| `TabFooter.tsx` | `TabFooterSlotContext` (holds an `HTMLElement`), the exported `TabFooterSlotProvider`, `TabFooterSlot({ hostRef })` (`shrink-0 border-t … empty:hidden`), and `TabFooter({ message, children })`, which portals into the slot or falls back inline when there is none. The precedent is `ConfigurationDialog.tsx`, which holds the slot node as **state** (`footerSlot`), wraps the body in `TabFooterSlotProvider value={footerSlot}`, and puts `<TabFooterSlot hostRef={setFooterSlot} />` after the scroll area |
| Layering (`components/ui`) | Sheet overlay and content `z-50`; `DialogOverlay` and `DialogContent` `z-[60]`, portalled; `SelectContent` `z-[100]`; `SavedAddressPicker` confirmation `fixed z-[70]` in-tree. `DialogContent` carries its own built-in X (sr-only "Close", English, pre-existing) |
| Page dialogs | Log out and Delete use `DialogContent className="sm:max-w-md" dir=…` with the page's button classes (secondary: `bg-[var(--v2-bg)] border …`; primary: `bg-[var(--v2-primary)] text-white`). The discard prompt reuses these classes |
| Consent route | Zod `SettingsSchema` (statement ≤ 2000, body ≤ 50000, postal ≤ 500). Errors are English and generic (`'Invalid settings'`, `'Internal server error'`), so the drawer shows a **translated** message, not the server text |
| i18n | `consent.*` has 20 keys in each of en, he and es. `common.save`, `common.close` and `common.try_again` exist in all three. **No** "discard" or "keep editing" key exists for settings (`preview.discard` belongs to another screen). New keys are needed, see Implementation Approach §E |
| Tests touching consent | None. No test renders `MarketingConsentPanel` or pins the consent row. `settingsDeepLinks.guard.test.ts` pins `not.toContain("expandedSection === 'plan'")` and `'password'`, and both still hold |
| Logging | `MarketingConsentPanel` and `page.tsx`: Pino via `createLogger`, 0 `console.*`. `TabFooter.tsx`, `dialog.tsx`, `sheet.tsx` and `SavedAddressPicker.tsx`: 0 `console.*`, nothing to log |
| Entitlements | Nothing in this slice imports from `lib/business-os/entitlements/` |

---

## Deep links to consent (C-2 check)

Searched `app/`, `components/`, `lib/` and the email templates for `section=consent`, `#settings-section-consent`, `settings-section-consent` and any `/business-os/settings…` URL near "consent" or "marketing":

| Sender | Found |
|---|---|
| `?section=consent` | **None.** The deep-link effect has no `consent` branch, so today such a link would land on the page with nothing expanded |
| `#settings-section-consent` | **None.** The only occurrence is the row's own `id` |
| Every `/business-os/settings?…` / `#…` sender | `?section=timezone` (`journeyGapFix.ts`), `?section=plan` (`planBadge.ts`, `planCheckout.ts`, `planPurchaseCopy.ts`), `#settings-section-invite-friends` (`inviterNotification.ts`), and `?tab=…` links (other surfaces, unaffected). None of them targets consent |

**Result: no deep link targets consent.** So S-3 adds **no** `consent` branch to the deep-link effect and does not use `useLinkOpenedDrawer` (SA-3 (b): build nothing for a link nobody sends). The deep-link effect stays byte-for-byte. `id="settings-section-consent"` stays on the row wrapper, as S-1 did for the plan row (W-5): it costs nothing, an old hash still lands on the row, and S-5 re-checks every anchor.

---

## Implementation Approach

### A. `SettingsDrawer`: footer slot and discard guard (modify)

1. **Fixed footer slot (W-4, C-1 "reused, not copied").** The wrapper holds `const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null)`, kept as state for the same reason `ConfigurationDialog` gives. It wraps the scroll body **and** the slot in `<TabFooterSlotProvider value={footerSlot}>`, and renders `<TabFooterSlot hostRef={setFooterSlot} />` as a sibling **after** the scroll body, inside `SheetContent`. Any `TabFooter` rendered by the drawer's children portals into the bar, outside the scroll area, so it never moves. `TabFooter.tsx` is **not** modified. The slot is always present. Its `empty:hidden` keeps the plan and password drawers looking exactly as they do now (Q-3).
2. **`isDirty` (C-5).** It is opt-in, and it arrives together with the prompt's translated copy, so the wrapper still reads no context. See [Guard Design](#guard-design-c-5).
3. The header comment block is updated so that "designed but arrive with S-3" becomes a description of what is now built. The busy section is unchanged.

### B. `MarketingConsentDrawer` (new, `components/business-os/settings/MarketingConsentDrawer.tsx`)

This follows the `ChangePasswordDrawer` shape from S-2.

- Props: `open`, `onOpenChange`, `returnFocusRef`. It reads `t` and `isRTL` from `useLanguage()`.
- It holds only `isDirty` and `isSaving`, because those two must sit above `SettingsDrawer` to drive `isDirty` and `isBusy`. It renders `SettingsDrawer` with `title={t('consent.title')}`, `closeLabel={t('common.close')}`, `isBusy={isSaving}`, `isDirty={isDirty}`, `discardCopy={{ title, description, keep, discard }}` from the new `settings.drawer.*` keys, and `testId="settings-consent-drawer"`.
- Children: `<MarketingConsentPanel onDirtyChange={setIsDirty} onBusyChange={setIsSaving} />`. The form state stays in the panel, which is a child of `SheetContent` with no `forceMount`. Closing therefore unmounts it, and **closing clears the draft**. Reopening refetches and reseeds, which is today's behaviour on re-expand.
- On every close it reaches (`onOpenChange(false)`, which the wrapper passes only after the guard), it resets `isDirty` and `isSaving` to `false` before forwarding. Without this, a reopened drawer would inherit "dirty" from the discarded draft until the new panel reported in. Pinned by test G-9.

### C. `MarketingConsentPanel` (modify)

The changes are bounded. The field markup, `seeded()`, the `dir="ltr"` switch wrappers, the `Select`, the `SavedAddressPicker` call, the route calls and the payload are unchanged.

1. **New optional props:** `onDirtyChange?: (dirty: boolean) => void` and `onBusyChange?: (busy: boolean) => void`. Both are reported from effects. The panel still works with neither prop.
2. **Dirty = differs from what was loaded.** `baseline` state is set to the same `seeded(…)` value as `form` in `load()`, both on first load and on the reload after a save. `isDirty` is a field-by-field comparison of the nine `Settings` keys between `form` and `baseline`. It is not reference equality, so typing a character and deleting it again leaves the form clean. `reusedAddress` is display-only, is not saved, and is not part of the comparison. The seeded default wording counts as **clean**: closing without saving loses nothing, because the same seed comes back on reopen.
3. **Save bar.** The inline button row becomes `<TabFooter message={…}>` with the same button (same classes, `type="button"`, `disabled={saving}`, `Loader2` while saving). Inside the drawer it portals into the fixed bar. Save stays **enabled when clean**, because pressing Save on untouched seeded wording is how an owner adopts and stores it (the "SEEDED AS REAL TEXT" comment). See Q-7.
4. **Save result inside the drawer (F-2).**
   - The message is shown in the bar's `message` slot.
   - Success: `<span role="status">{t('consent.saved')}</span>`, shown only while `saved && !isDirty`. The next edit hides it, so "Saved" never sits next to unsaved text. There is no timer.
   - Refused (`!response.ok` or `json.success !== true`) or thrown (network error, non-JSON body): `<span role="alert">{t('consent.save_failed')}</span>`. The form is **kept** as typed and stays dirty, so the guard still protects it.
   - The error clears at the start of the next save. A refusal is logged as `logger.warn({ status: response.status }, 'Consent settings save refused')`. A throw stays `logger.error({ err }, …)`. **No form value is ever logged**: the wording, the notice and the postal address are personal or legal text.
5. **Busy.** `saving` covers the PUT and the reload after it (unchanged: `setSaving(false)` is in `finally` after `await load()`), and it is reported through `onBusyChange`.
6. **Load failure (F-17, if SA agrees, Q-1).** `load()` records `loadFailed` when the GET throws, is not ok, or returns `success: false`. Then, instead of the form, the panel renders `<p role="alert">{t('consent.load_failed')}</p>` and a `common.try_again` button that calls `load()` again. **No form and no Save bar** are rendered, so `EMPTY` can never be written over stored settings. A failed load is clean, so closing never prompts.
7. The `languageRef` comment gets one word changed ("expanded" becomes "its drawer opens"). The logic is unchanged.

### D. Page (`app/business-os/settings/page.tsx`)

1. **Imports:** add `MarketingConsentDrawer`. Remove the direct `MarketingConsentPanel` import, which is now rendered by the drawer.
2. **State:** remove `expandedSection` / `setExpandedSection`, whose last user was the consent row (Q-2). Add `const [consentDrawerOpen, setConsentDrawerOpen] = useState(false)` and `const consentRowRef = useRef<HTMLButtonElement>(null)`. This is plain state, not `useLinkOpenedDrawer`, because no link opens this drawer ([Deep links](#deep-links-to-consent-c-2-check)).
3. **Consent row:** keep the `id="settings-section-consent"` wrapper, with a one-line comment as for the plan row. The button gets `ref={consentRowRef}`, `type="button"`, `aria-haspopup="dialog"`, `aria-expanded={consentDrawerOpen}` and `onClick={() => setConsentDrawerOpen(true)}`. It shows the **title only** (C-8: the "N of M" row value is S-5's, through its own request). The `ChevronRight` is static, with no rotation, like the plan and password rows. The row's class string is unchanged and is not the guarded dropdown string (C-9).
4. **Drawer:** `<MarketingConsentDrawer open={consentDrawerOpen} onOpenChange={setConsentDrawerOpen} returnFocusRef={consentRowRef} />` next to the row. The old `{expandedSection === 'consent' && …}` block is removed.
5. **Untouched (C-9, C-13):** `loadData`, `persistTimezone`, `saveProfile`, the export handler, the profile card, the Language / Currency / Timezone rows (including `id="settings-section-timezone"` and the three guarded option rows), the **whole deep-link effect and its comments** (including the timezone comment that names `setExpandedSection`, which is frozen by C-2, see Q-2), the plan and password rows and drawers, Invite friends, Export, Log out, Delete, both dialogs, and the page banner.

### E. Translations (en / he / es, same keys in all three)

| Key | en | he | es |
|---|---|---|---|
| `settings.drawer.discard_title` | Discard your changes? | למחוק את השינויים? *(was לבטל, SA C-9)* | ¿Descartar los cambios? |
| `settings.drawer.discard_desc` | You have changes here that are not saved. If you close now, they will be lost. | יש כאן שינויים שלא נשמרו. אם תסגור עכשיו, הם יאבדו. | Tienes cambios sin guardar. Si cierras ahora, se perderán. |
| `settings.drawer.keep_editing` | Keep editing | המשך לערוך | Seguir editando |
| `settings.drawer.discard` | Discard changes | מחק את השינויים *(was בטל שינויים, SA C-9)* | Descartar cambios |
| `consent.save_failed` | Not saved. Your changes are still here. Please try again. | לא נשמר. השינויים שלך עדיין כאן, נסה שוב. | No se ha guardado. Tus cambios siguen aquí. Inténtalo de nuevo. |
| `consent.load_failed` | Could not load your marketing permission settings. | לא ניתן לטעון את הגדרות הרשאת השיווק. | No se pudo cargar la configuración del permiso de marketing. |

The `settings.drawer.*` keys are generic, so S-4 or a later drawer can reuse the prompt. `consent.load_failed` exists only if Q-1 is accepted. The Hebrew uses the masculine imperative, as the existing `common.try_again` ("נסה שוב") does. The user may want to check the he and es wording.

---

## Guard Design (C-5)

**Shape.** The guard is opt-in and lives inside `SettingsDrawer`. There is no hook, no provider, no `window.confirm`, no `beforeunload` and no router interception (C-5). The wrapper still reads no context and defines none (C-1).

```typescript
interface DiscardCopy {
  title: string;       // "Discard your changes?"
  description: string;
  keep: string;        // "Keep editing"
  discard: string;     // "Discard changes"
}

// Either no guard at all, or a guard with its copy: a dirty drawer with no words
// to ask in cannot compile.
type DiscardGuardProps =
  | { isDirty?: undefined; discardCopy?: undefined }
  | { isDirty: boolean; discardCopy: DiscardCopy };

export type SettingsDrawerProps = BaseProps & DiscardGuardProps;
```

**State:** `const [confirmOpen, setConfirmOpen] = useState(false)`. It is reset to `false` whenever `open` becomes `false`, through an effect on `[open]`. That way, if a parent closes the drawer by some other route while the prompt is up, a reopened drawer never shows a stale prompt.

**One gate, extended in order (busy, then dirty, then close):**

```typescript
const handleOpenChange = useCallback((next: boolean) => {
  if (next) { onOpenChange(true); return; }   // opening is never guarded
  if (isBusy) return;                         // C-4: busy beats dirty, no prompt
  if (isDirty) { setConfirmOpen(true); return; } // C-5: ask, do not close
  onOpenChange(false);
}, [isBusy, isDirty, onOpenChange]);
```

Every close route already goes through this gate. Radix's dismiss (Escape, overlay press, focus outside) calls `onOpenChange(false)` on the `Sheet` root, and the wrapper's own X calls `handleOpenChange(false)`. So Escape, X and overlay all prompt when the drawer is dirty, with no extra handler. The busy layers (Escape and outside `preventDefault`, disabled X) are unchanged, and the dirty case adds **no** `preventDefault`: the prompt *is* the response to the close request.

**The prompt.** It is rendered **inside `SheetContent`'s React tree**, after the footer slot (SA-2: a nested Radix layer, so it does not dismiss the sheet):

```tsx
<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
  <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'} data-testid="settings-drawer-discard">
    <DialogHeader>
      <DialogTitle>{discardCopy.title}</DialogTitle>
      <DialogDescription>{discardCopy.description}</DialogDescription>
    </DialogHeader>
    <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
      <button type="button" onClick={() => setConfirmOpen(false)} /* page's secondary classes */>{discardCopy.keep}</button>
      <button type="button" onClick={handleDiscard}               /* page's primary classes */>{discardCopy.discard}</button>
    </div>
  </DialogContent>
</Dialog>
```

| Action in the prompt | Result |
|---|---|
| **Keep editing** | `setConfirmOpen(false)`. The sheet stays open, the content stays mounted, and the edits are intact. Radix returns focus to the element that had it inside the sheet |
| Escape, the prompt's overlay, or the prompt's built-in X | Same as Keep editing. Radix's layer stack sends Escape and outside presses to the **topmost** layer only, so the sheet never sees them. A dismissive gesture keeps the work, which is the safe default |
| **Discard** | `handleDiscard`: `if (isBusy) return; setConfirmOpen(false); onOpenChange(false);`. This calls the **parent's** `onOpenChange` directly, bypassing the gate, because the question has been answered. The sheet closes, `SheetContent` unmounts and the draft goes with it. Focus returns to `returnFocusRef` (the consent row) |

Keep editing comes first in the DOM, so Radix's initial focus lands on the safe choice.

**Why the copy is a prop:** the wrapper reads no context (C-1, S-1 Q-3), so the words come in already translated, just as `closeLabel` does.

**Why `isDirty` is not computed by the wrapper:** only the content knows what "unsaved" means. For consent, "unsaved" means "differs from the last load", and the seeded wording counts as clean. The wrapper only enforces the consequence.

**Busy and dirty together:** while a save is in flight the form is usually dirty. Busy is checked first, so a close attempt during a save is refused silently (X disabled, Escape and overlay prevented), with no prompt. After a successful save the panel reloads, the baseline resets, and the drawer is clean. After a failed save it is still dirty, and a close prompts.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `components/business-os/settings/SettingsDrawer.tsx` | modify | Footer slot (W-4) and `isDirty` + `discardCopy` + nested discard `Dialog` (C-5) |
| `components/business-os/settings/MarketingConsentDrawer.tsx` | create | Drawer owner: `isDirty` / `isSaving`, reset on close, translated prompt copy |
| `components/business-os/settings/MarketingConsentPanel.tsx` | modify | `onDirtyChange` / `onBusyChange`, baseline + dirty, `TabFooter` Save bar, success / failure messages (F-2), load-failure state (F-17, Q-1) |
| `app/business-os/settings/page.tsx` | modify | Consent row becomes a drawer opener; render `MarketingConsentDrawer`; remove `expandedSection` (Q-2) |
| `lib/business-os/translations/en.ts`, `he.ts`, `es.ts` | modify | Six keys each (§E) |
| `components/business-os/settings/__tests__/SettingsDrawer.discard.render.test.tsx` | create | Guard behaviour with the real Radix sheet and dialog (G-1 to G-14) |
| `components/business-os/settings/__tests__/SettingsDrawer.layers.test.tsx` | modify | Add the dirty layer alone (layer 5) and "busy beats dirty" on the mocked sheet |
| `components/business-os/settings/__tests__/SettingsDrawer.render.test.tsx` | modify | Source guard: allow exactly `TabFooterSlotProvider` (W-4); new C-5 bans; prompt is inside `SheetContent`; footer slot is a sibling after the scroll body |
| `components/business-os/settings/__tests__/MarketingConsentDrawer.render.test.tsx` | create | Panel in the drawer with `fetch` stubbed: dirty, discard, keep, save success and failure, busy, load failure, LTR switches, logging |
| `components/business-os/settings/__tests__/MarketingConsentDrawer.owner.test.tsx` | create | *(added in implementation)* The owner's reset on close, with a panel stand-in that does not report on mount (M12 survived without it) |
| `components/business-os/settings/__tests__/settingsDrawerCopy.test.ts` | create | The six new keys exist, are non-empty, and match across en, he and es (no parity check exists for the dictionaries) |
| `app/business-os/settings/__tests__/settingsDeepLinks.guard.test.ts` | modify | Consent row pins; no `expandedSection`; no `consent` branch in the effect; existing pins unchanged |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify | S-3 progress line, Change History, findings F-17 and F-18 (standing rule) |

**Not modified (C-9, C-12):** `TabFooter.tsx`, `components/ui/dialog.tsx`, `components/ui/sheet.tsx`, `components/ui/switch.tsx`, `components/ui/SavedAddressPicker.tsx`, `useLinkOpenedDrawer.ts`, `ChangePasswordDrawer.tsx`, `PlanSection.tsx`, `InviteFriendsSection.tsx`, `ConfigurationDialog.tsx`, `CRMContactDrawerV2.tsx`, the consent API route and `MarketingConsentRepository`, `greetingUsesTheEditedName.guard.test.ts`, `darkModeTokens.guard.test.ts`, `planBadge.test.ts`, `journeyReadiness.test.ts`.

---

## Task List

- ✅ T0. Already done (SA C-1): HEAD `5d7a0586` = `origin/main` after #388 and #389. No rebase.
- ✅ T1. Translations: six keys in en, he and es (Hebrew Discard reworded per SA C-9), plus `settingsDrawerCopy.test.ts`.
- ✅ T2. `SettingsDrawer.tsx`: footer slot (provider + slot after the body), `DiscardGuardProps`, `confirmOpen` with its reset on `open`, gate order busy then dirty then close, nested `Dialog` inside `SheetContent`, `handleDiscard`, focus return after Keep editing, header comment.
- ✅ T3. `SettingsDrawer.discard.render.test.tsx` (G-1 to G-14, G-12b); `SettingsDrawer.layers.test.tsx` layers 5 to 7; `SettingsDrawer.render.test.tsx` source guard (W-4 relaxation, C-5 bans, prompt and slot position pins), footer behaviour, and the folder-wide `use…Dirty/Unsaved/Discard` ban with negative controls (SA C-8).
- ✅ T4. `MarketingConsentPanel.tsx`: props, baseline / dirty with `''`=`null` (SA C-4), `TabFooter` bar, success and failure messages, warn on refusal, F-17 load-failure state (SA C-2), comment fix. `SavedAddressPicker` call byte-for-byte (SA C-3).
- ✅ T5. `MarketingConsentDrawer.tsx`.
- ✅ T6. `MarketingConsentDrawer.render.test.tsx` (D-1 to D-14, D-7b, C-4 test; picker stub does not auto-fill, header comment points at F-18).
- ✅ T7. `page.tsx`: import swap, `expandedSection` removed, consent row as opener, drawer rendered.
- ✅ T8. `settingsDeepLinks.guard.test.ts`: consent pins with negative controls.
- ✅ T9. Verification (see Implementation Notes).
- ✅ T10. Mutation run M1 to M20 (see Implementation Notes).
- ✅ T11. Requirement S-3 progress line and Change History; Implementation Notes here. Everything uncommitted.

---

## Test Plan

### New: `SettingsDrawer.discard.render.test.tsx` (jsdom, real Radix sheet and dialog)

The harness plays the owner: an opener row (the return target), and an input inside the drawer whose value the harness turns into `isDirty`. The input lives in the content, so "cleared on discard" is observable.

| # | Asserts |
|---|---|
| G-1 | **Dirty + X prompts:** typing makes it dirty; X opens a dialog named "Discard your changes?"; `onOpenChange(false)` is **not** called; the sheet is still open |
| G-2 | **Dirty + Escape prompts** (same assertions) |
| G-3 | **Dirty + outside press prompts** (same, after `letRadixSettle()`, paired with G-8's clean outside press, which closes) |
| G-4 | **Keep editing keeps the edits:** the prompt closes, the sheet stays open, the typed value is still in the input, and `onOpenChange` is not called |
| G-5 | Escape **on the prompt** acts as Keep editing: the prompt closes, the sheet stays open, the value is kept (Radix layer stack) |
| G-6 | A press on the prompt's overlay acts as Keep editing (same) |
| G-7 | **Discard closes and clears:** `onOpenChange(false)` is called exactly once; the sheet closes; reopening shows an empty input, no prompt, and a clean state |
| G-8 | **A clean close needs no prompt:** with `isDirty` false, X, Escape and an outside press each call `onOpenChange(false)` at once, and no prompt is in the DOM |
| G-9 | No stale prompt: after Discard and reopen, a clean X closes at once. If the parent forces `open=false` while the prompt is up, reopening shows no prompt |
| G-10 | **Busy refuses, and busy beats dirty:** with `isBusy` and `isDirty` both true, X (disabled), Escape and an outside press neither close nor prompt |
| G-11 | Opening is never guarded: `onOpenChange(true)` passes even when `isDirty` |
| G-12 | Focus: after Keep editing, focus is inside the sheet. After Discard, focus is on the return target |
| G-13 | Hebrew (`isRTL`): the prompt's content has `dir="rtl"` |
| G-14 | No guard props (`isDirty` absent) behaves exactly as S-2: X closes at once, and no `Dialog` is rendered for the prompt (`queryByTestId('settings-drawer-discard')` is null) |

### Extended: `SettingsDrawer.layers.test.tsx` (mocked sheet)

| # | Asserts |
|---|---|
| L-5 | The dirty gate alone: `root-close` while dirty does not call `onOpenChange` and opens the prompt; while clean it calls `onOpenChange(false)`; `root-open` is never blocked |
| L-6 | Busy beats dirty: `root-close` while busy and dirty neither calls `onOpenChange` nor opens the prompt (catches a gate reordered to dirty-then-busy) |
| L-7 | `handleDiscard` alone: the Discard button calls the parent's `onOpenChange(false)` once and closes the prompt |

### Edited: `SettingsDrawer.render.test.tsx` source guard (C-1, C-5, W-4)

- The `not.toContain('Provider')` ban becomes: every `\w*Provider\b` token in the comment-stripped source is exactly `TabFooterSlotProvider`, and it is imported from `@/components/business-os/settings/TabFooter`. `createContext` and `useContext` stay banned (W-4).
- New C-5 bans: no `window.confirm`, no bare `confirm(`, no `beforeunload`, no `next/navigation`, no `useRouter`, no `history.`, no `forceMount` (kept), and no exported function whose name starts with `use` (the guard is not a shared hook).
- New C-5 pin: the prompt is imported from `@/components/ui/dialog`, and `<Dialog` appears between `<SheetContent` and `</SheetContent>` in the source (inside the sheet's tree).
- New W-4 pin: `<TabFooterSlot` appears after the scroll body's `overflow-y-auto` element and before `</SheetContent>`, and not inside the body.
- Behaviour (added to the shell block): a child `TabFooter` renders its buttons **outside** the `overflow-y-auto` body and inside the dialog; a drawer with no `TabFooter` has an empty slot element.
- Repo-level C-5 pin: `components/business-os/settings/` contains no file matching `/use\w*(Dirty|Unsaved|Discard)/i`.

### New: `MarketingConsentDrawer.render.test.tsx` (jsdom, `fetch` stubbed)

This uses the same `useLanguage` / logger / `supabaseClient` mocks as `ChangePasswordDrawer.render.test.tsx`. `SavedAddressPicker` is replaced by a stub button that calls `onSelect` with a fixed address (its own fetch is outside this test).

| # | Asserts |
|---|---|
| D-1 | Opening calls `GET /api/business-os/consent-settings?locale=en` once; the count line and the seeded statement show; the Save button is **outside** the scroll body (the fixed bar) |
| D-2 | Untouched seeded form: X closes at once, with no prompt (the seed is clean) |
| D-3 | Typing in the statement and then pressing X prompts. **Discard** closes, and on reopen there is a fresh GET and the typed text is gone (seed shown) |
| D-4 | Typing, then X, then **Keep editing**: the typed text is still there, and Save sends it |
| D-5 | Typing a character and deleting it is clean again (no prompt) |
| D-6 | Each kind of edit makes it dirty: the capture switch, the privacy `Select` mode, the postal address through the picker stub, and the ad-label switch |
| D-7 | **Save success:** the PUT body equals the edited form; `role="status"` shows `consent.saved` in the bar; the reload GET runs; X then closes with no prompt; the next edit hides "Saved" |
| D-8 | **Save refused** (`{ success: false }` with status 400, and separately 500): `role="alert"` shows `consent.save_failed` in the bar; the typed text is kept; X still prompts; `logger.warn` is called with `{ status }` only |
| D-9 | **Save throws** (network error, non-JSON body): same alert; `logger.error` gets `{ err }`; **no logged argument contains** the typed statement, the notice body or the postal address |
| D-10 | **Busy:** while the PUT is held pending, Save is disabled, X is disabled, and Escape and an outside press neither close nor prompt. After it resolves, the drawer can close |
| D-11 | Save is **enabled on a clean, seeded form**, and pressing it sends the seeded wording (Q-7) |
| D-12 | **Load failure** (GET throws / 500 / `success: false`): `role="alert"` shows `consent.load_failed`; there is no Save button and no form field; X closes with no prompt; **Try again** refetches and then shows the form (if Q-1 is accepted) |
| D-13 | Hebrew: both `Switch`es sit inside an element with `dir="ltr"` (C-5 last bullet, §4.3); the drawer has `dir="rtl"` and `data-side="left"` |
| D-14 | A reopen after a discard has a clean state: X closes at once (the owner reset its `isDirty`) |

### New: `settingsDrawerCopy.test.ts`

For each of the six keys: present in `translations.en`, `.he` and `.es`; a non-empty string; the he value differs from en (it is translated); no `{placeholder}` in one language that is missing in another.

### Edited: `settingsDeepLinks.guard.test.ts` (comment-stripped source, W-6 style)

- The consent row wrapper keeps `id="settings-section-consent"` (raw source). The row button carries `aria-haspopup="dialog"`, `ref={consentRowRef}` and `onClick={() => setConsentDrawerOpen(true)}`.
- `<MarketingConsentDrawer` is rendered with `returnFocusRef={consentRowRef}`. `page.tsx` no longer renders `<MarketingConsentPanel` directly.
- `page.tsx` contains no `expandedSection` and no `setExpandedSection` in code. There is a negative control: the matcher on a synthetic snippet with `setExpandedSection('consent')` fails.
- The deep-link effect has no `'consent'` branch. Every existing pin (timezone with its three negative controls, business / invoice, plan, password, hook) is unchanged.

### Mutation candidates (T10)

| # | Mutation | Expected to be caught by |
|---|---|---|
| M1 | Drop the `isDirty` check from the gate (dirty X closes) | G-1, G-2, G-3, L-5, D-3 |
| M2 | Reorder the gate to dirty-then-busy | G-10, L-6, D-10 |
| M3 | `handleDiscard` forgets `onOpenChange(false)` | G-7, L-7, D-3 |
| M4 | Keep editing calls `onOpenChange(false)` | G-4, D-4 |
| M5 | Remove the `confirmOpen` reset on `open=false` | G-9 |
| M6 | Move the prompt `<Dialog>` outside `<SheetContent>` | source pin; G-6 (if the sheet then dismisses) |
| M7 | Replace the prompt with `window.confirm` | source ban; G-1 |
| M8 | Dirty comparison by reference (`form !== baseline`) | D-5 (and D-2 if the reload breaks it) |
| M9 | Remove the failure message (F-2 regression) | D-8, D-9 |
| M10 | Clear the form on save failure | D-8 |
| M11 | Do not report `saving` through `onBusyChange` | D-10 |
| M12 | The drawer owner does not reset `isDirty` on close | D-14, G-9 |
| M13 | Remove one `dir="ltr"` switch wrapper | D-13 |
| M14 | Log the form (`logger.error({ err, form })`) | D-9 |
| M15 | Drop the `TabFooterSlotProvider` (Save goes back inline into the scroll body) | D-1, shell behaviour test |
| M16 | Disable Save when clean | D-11 |
| M17 | Render the form and Save after a failed load | D-12 |
| M18 | Give the consent row back `setExpandedSection` | deep-link guard |

### Must stay green (run before handing over)

```bash
npx jest components/business-os/settings app/business-os/settings \
  app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts \
  lib/business-os/entitlements/__tests__/planBadge.test.ts \
  lib/business-os/entitlements/__tests__/enforcementPoints.test.ts \
  lib/business-os/entitlements/__tests__/tierLiteral.forbidden.test.ts \
  lib/business-os/__tests__/journeyReadiness.test.ts \
  lib/email/templates/__tests__/invite-accepted.test.ts \
  components/ui/__tests__/darkModeTokens.guard.test.ts \
  lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts \
  lib/business-os/billing/__tests__/planCheckout.test.ts \
  lib/audit/__tests__/passwordChangeSeverity.guard.test.ts
```

This is the S-2 set unchanged. It covers the seven C-12 tests, S-1's and S-2's suites (`SettingsDrawer.render`, `SettingsDrawer.layers`, `settingsSectionUrl`, `useLinkOpenedDrawer`, `ChangePasswordDrawer.render`, `settingsDeepLinks.guard`), `PlanSection`, `PlanPurchase` and `PlanUpgrade` render, `InvoiceSettingsSection.render`, and the new S-3 suites (all picked up through the folder paths). After that: `npm run typecheck:bos-llm`, full `tsc` on touched files, eslint, and `npm run lint:hooks`. `npm run test:bos-entitlements` is not required, because nothing imports from the entitlements module. `tierLiteral.forbidden` and `enforcementPoints` are in the set, and the new files contain no tier literal.

---

## Manual QA Checklist (C-10)

Run each check on **desktop and phone width (≤ 640 px)**, in **English and Hebrew**. Record the side observed in Hebrew and compare it with the plan and password drawers (S-1 W-8).

| # | Check | Expected |
|---|---|---|
| K1 | Consent row | "Marketing permission" with a static chevron; announced as opening a dialog; no expand-in-place |
| K2 | Open | Drawer on the same side as the plan drawer; title "Marketing permission"; count line; the Save bar is fixed at the bottom and stays visible while the 10-line notice is scrolled; URL unchanged |
| K3 | Open and close without editing (X, Escape, overlay) | Closes at once, no prompt; focus back on the consent row |
| K4 | Edit the statement, then X | "Discard your changes?" appears **above** the drawer (the drawer is dimmed behind it, the drawer does not close) |
| K5 | K4, then **Keep editing** | Prompt gone, drawer open, the edit still there, cursor or focus inside the drawer |
| K6 | K4 with Escape instead of X; then Escape again on the prompt | The first Escape prompts; the second closes **only** the prompt; the drawer stays open with the edit |
| K7 | K4 with an overlay click instead of X; then click the prompt's backdrop. **Run with a mouse AND with touch** (DevTools touch emulation or a phone; SA C-6, R-2) | The first prompts; the backdrop click closes **only** the prompt; the prompt does not flash open and shut |
| K8 | K4, then **Discard changes**, on desktop and phone (SA C-5) | The drawer closes; focus is **on the Marketing permission row** (not just outside the drawer); reopening shows the stored wording (the edit is gone), with no prompt on a clean close |
| K9 | Type a letter, delete it, then close | No prompt |
| K10 | Edit, then **Save** | Spinner on Save; X greyed; Escape and overlay refuse; then "Saved" in the bar; close needs no prompt. Reopen to confirm the change stuck |
| K11 | Save failure (DevTools: block `consent-settings` or go offline, then Save) | The red "Not saved…" message in the bar; the edits kept; closing prompts |
| K12 | Load failure (block the GET, then open) | The "Could not load…" message and Try again; **no Save button**; X closes with no prompt; Try again (unblocked) shows the form (if Q-1 is accepted) |
| K13 | Untouched first-time owner, Save | Seeded wording is saved (Q-7) |
| K14 | **Layering: privacy-notice `Select`** | The dropdown opens above the drawer and is clickable; choosing an option does not close the drawer; Escape on the open dropdown closes only the dropdown |
| K15 | **Layering: `SavedAddressPicker`** | The list and "use this address" work inside the sliding sheet; the **delete confirmation** (fixed, z-70) is positioned correctly and is clickable. Record whether it covers the screen or only the sheet. Escape while it is open: record what happens (see Risks R-4). **Also (SA C-7): dirty drawer, picker delete confirmation open, then Escape.** Record the result. Expected: the discard prompt opens *under* the picker overlay, and Escape again recovers. Not fixed in S-3 (listed for F-18) |
| K16 | **Layering: prompt over sheet** | The prompt and its backdrop sit above the sheet and its overlay, never behind; nothing from the page header shows through, on phone too |
| K17 | Hebrew switches | Both switch thumbs move inside their tracks (the `dir="ltr"` wrappers), on and off |
| K18 | Hebrew prompt | Title and buttons right-aligned; the button order mirrors (as the Log out dialog does) |
| K19 | Regression | Plan drawer (row and `?section=plan` close removes only `section`), password drawer, `?section=timezone` scroll, `?section=business` / `invoice`, Language / Currency / Timezone rows, Invite friends, Export, Log out, Delete: all as before |
| K20 | `?section=consent` and `#settings-section-consent` | Page loads unchanged (no drawer opens); the hash lands on the row |
| K21 | *(SA C-3, F-18)* With **at least one saved address** in the address book, open the drawer and close it untouched | Record whether the discard prompt appears and whether the postal field shows the book's default instead of the stored address. **Expected today: yes to both (F-18).** Not a S-3 defect; F-18 fixes it. TL tells the user before S-3 ships |

C-10's invite native `<select>` check has no subject in this drawer and stays with S-4.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A nested Radix `Dialog` inside a modal `Sheet`: focus or pointer handling dismisses the sheet, or the prompt opens behind it | Rendered inside `SheetContent`'s tree as SA ruled (nested layer, not the `useConfigurationDialogOpen` workaround). `z-[60]` is above `z-50`. G-5, G-6 and K6, K7 and K16 test it |
| R-2 | An overlay `pointerdown` opens the prompt and the following `click` lands on the new prompt backdrop and closes it at once | Radix Dialog dismisses on `pointerdown` outside, not on `click`. K7 checks this live. If it happens, the fix is in the wrapper (defer `setConfirmOpen(true)` one frame) and SA is told |
| R-3 | `SavedAddressPicker`'s `fixed z-[70]` confirmation sits inside a sheet that has a transform while it slides in | After the slide animation ends there is no transform. During it, the confirmation cannot be open. K15 records the result. `SavedAddressPicker` is not modified |
| R-4 | Escape while the picker's hand-built delete confirmation is open goes to the sheet (the picker has no Escape handler). Clean: the drawer closes and the confirmation vanishes with **nothing deleted**. Dirty: the discard prompt opens over it | Safe in both cases (no deletion, no lost edits without a prompt). Recorded in K15, not fixed here. The picker is shared and outside this slice |
| R-5 | `saved` / `baseline` race: the reload after a save returns wording that differs from what was sent (the server normalises it), so the form looks clean while showing different text | The baseline **and** the form are both set from the reload, so what shows is what is stored. D-7 checks it |
| R-6 | The privacy notice is up to 50,000 characters, so a field-by-field compare on every keystroke could cost something | It is nine string or boolean equality checks per render, which is negligible |
| R-7 | Removing `expandedSection` leaves the frozen timezone comment naming `setExpandedSection` | It is a comment, and C-2 freezes it byte-for-byte. Q-2 |
| R-8 | `Dialog`'s built-in X has an untranslated sr-only "Close" | Pre-existing in `components/ui/dialog.tsx` (also on Log out and Delete). Not modified here (C-9 spirit: shared primitive) |
| R-9 | Branch stacked on an already-merged S-2 | T0: RM rebases onto `main`. The touched files are identical, so no conflict |
| R-10 | Two PRs editing `page.tsx` | Open PRs checked 2026-10-15 (#391, #392): neither touches the settings page or folder |

---

## Open Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | **F-17 (new):** when the consent GET fails, the panel still renders the form seeded with `EMPTY` and an enabled Save. With a fixed, always-visible Save bar, one press would write null wording and a null postal address over the stored legal settings. Fix it in S-3? | **Yes, in S-3.** It is the same file and the same state, it is a few lines, and the fixed Save bar makes the hazard more likely than before. On a failed load: an alert, Try again, and no form or Save. Tests D-12, M17 |
| Q-2 | `expandedSection` has no user after S-3. Remove it now, or leave it for S-5 ("remove the now-unused expand state")? | **Remove now.** Leaving it would be dead state and an unused-variable lint finding. S-5's item becomes a no-op. The timezone comment that names `setExpandedSection` stays byte-for-byte (C-2). S-5 may reword it if SA lifts the freeze for that comment |
| Q-3 | Footer slot always present (empty and `empty:hidden` for plan and password), or behind a new opt-in prop? | **Always present.** No new prop, the same as `ConfigurationDialog`. The empty host adds one hidden `div` to the plan and password drawers |
| Q-4 | Prompt copy as a `discardCopy` prop that the type system requires whenever `isDirty` is passed (a union type). Is this extra prop acceptable under C-1? | Accept. It mirrors `closeLabel`: the wrapper reads no context, so the words come in translated |
| Q-5 | Failed save message: a translated generic `consent.save_failed`, not the server's `error` | Accept. The route's errors are English and generic ("Invalid settings", "Internal server error"), unlike the password route's, which are written for the owner |
| Q-6 | **F-18 (new):** `MarketingConsentPanel` passes `selected` and `type AddressSource` (gone from `SavedAddressPicker`) and omits the required `use` prop. These are the 2 pre-existing `tsc` errors, and `use` is `undefined` at runtime (radio `name="saved-address-undefined"`, and the "used by" hint compares against `undefined`). Fix in S-3? | **No, a separate small task.** Fixing it changes how the picker behaves in the consent form, which is a behaviour change with its own review. `consent` is neither `'profile'` nor `'invoice'`, so it needs a decision about the picker's `AddressUse`. Record it in the requirement §7. S-3 does not touch the picker call |
| Q-7 | Save stays enabled on a clean form | Accept. Pressing Save on the seeded wording is how an owner adopts it (`seeded()` comment). Disabling it would remove that |
| Q-8 | "Saved" lifetime: shown while clean after a save, hidden by the next edit, no timer | Accept. It matches S-2's in-drawer message and never sits next to unsaved text |

---

## Condition Traceability

| Condition | Where met |
|---|---|
| C-1 wrapper scope (no context, no provider, props only) | §A; Guard Design; source guard (W-4 relaxation exactly `TabFooterSlotProvider`); Q-3, Q-4 |
| C-2 deep-link handler | Deep-link effect untouched; no consent branch, since no sender exists ([Deep links](#deep-links-to-consent-c-2-check)); guard pins |
| C-4 busy refusal | Busy before dirty in the gate; G-10, L-6, D-10, M2, M11 |
| C-5 discard guard | Guard Design; G-1 to G-14; L-5 to L-7; D-2 to D-5, D-14; source bans (no `window.confirm`, `beforeunload`, router, shared hook or provider); prompt inside `SheetContent`; F-2 inside the drawer (D-8, D-9); `dir="ltr"` switches (D-13, K17) |
| C-8 row values | Title only; counts stay inside the drawer; the row value is S-5's |
| C-9 / C-13 untouchables | Files not modified; §D.5; QA K19; `page.tsx` verified at `e9f0d103` |
| C-10 QA layering | K14 to K18 (Select, SavedAddressPicker, prompt over sheet, focus return, `aria-haspopup`) |
| C-12 test edits planned | Edited tests listed (`SettingsDrawer.render` source guard, `SettingsDrawer.layers`, `settingsDeepLinks.guard`); the C-12 list is in the must-stay-green set |
| W-4 (S-1) | The source guard relaxed for exactly one import; `createContext` and `useContext` stay banned |
| SA S-1 finding 3 | The dirty gate is pinned alone (L-5) and busy-over-dirty separately (L-6), not only through behaviour |

---

## SA Review Notes

See [SA Workplan Review (2026-10-15)](#sa-workplan-review-2026-10-15) below.

## SA Workplan Review (2026-10-15)

**Reviewed by SA, 2026-10-15**
**Status:** APPROVED WITH CONDITIONS. Dev may start T1 once the conditions below are read; no second workplan review needed. The conditions are checked at code review.

**Verified against code.** Branch `feature/settings-drawer-s3` HEAD is `5d7a0586` (S-1 #388 and S-2 #389 merged). `git diff e9f0d103 5d7a0586` and `git diff 5d7a0586 origin/main` (`9afaf17b`, docs and price commits only) are both empty for `app/business-os/settings/`, `components/business-os/settings/`, `components/ui/{dialog,sheet,SavedAddressPicker}.tsx`, `lib/business-os/translations/` and the consent route. Read in full: `SettingsDrawer.tsx`, `MarketingConsentPanel.tsx`, `TabFooter.tsx`, `SavedAddressPicker.tsx` (and its `default` test), `sheet.tsx`, `dialog.tsx`, the consent route's PUT, the `ConfigurationDialog` slot wiring, the page's consent row and `expandedSection` uses, and `@radix-ui/react-dismissable-layer` in the shared `node_modules`. The Analysis Summary is accurate, with one understatement (F-18 runtime impact, ruling 3).

### User decisions (2026-10-15, relayed by TL; settled, not for SA to reopen)

- **F-17 is fixed inside S-3.**
- **F-18 is a separate task, not S-3.** S-3 does not touch the `SavedAddressPicker` call.

### Rulings on Q-1 to Q-8

| # | Ruling |
|---|---|
| Q-1 / F-17 | **In S-3 (user decision).** It does **not** make S-3 more than a client change: no route, schema, repository or migration moves, and the path is already full cycle, so no extra gate. It is a data-safety fix in a form that writes legal text, so it gets the conditions in C-2 and is tested as such. No server-side defence: the route legitimately accepts nulls ("clearing means use the platform default"), so it cannot tell a deliberate clear from an empty form. |
| Q-2 | **Approved: remove `expandedSection` now.** Verified: after S-3 its only remaining occurrence is the C-2-frozen comment at the timezone branch. The comment stays byte-for-byte; S-5's "remove the expand state" item becomes a no-op and S-5 records that. |
| Q-3 | **Approved: slot always present.** Same as `ConfigurationDialog`; `empty:hidden` keeps the plan and password drawers visually unchanged. No opt-in prop. |
| Q-4 | **Approved: union-typed `discardCopy`.** Within C-1: it is a prop, already translated, exactly like `closeLabel`. The wrapper still reads no context. |
| Q-5 | **Approved: translated generic `consent.save_failed`.** The route's errors are English and generic. Never show `json.error` or `details`. |
| Q-6 / F-18 | **Separate task (user decision).** The runtime impact today is larger than the workplan states, and it reaches S-3's guard. See ruling 3 and C-3. |
| Q-7 | **Approved: Save enabled on a clean form.** It is how an owner adopts the seeded wording. |
| Q-8 | **Approved: "Saved" shown while `saved && !isDirty`, no timer.** Same as S-2's in-drawer message. |

### Ruling 1: guard design vs C-5 (approved)

The design meets C-5: opt-in, no hook, no provider, no `window.confirm`, no `beforeunload`, no router interception. There is one gate, ordered busy, then dirty, then close. Discard bypasses the gate, and the prompt is reset on close. Radix behaviour, checked in `react-dismissable-layer`:

- **Escape on the prompt does not reach the sheet.** The document-level Escape handler returns early unless its layer is the highest (`isHighestLayer`), so only the prompt dismisses. G-5 and K6 confirm it.
- **Pointer and focus.** The modal prompt disables outside pointer events, and lower layers get `pointer-events: none` with their outside-press handling suppressed. Independently, the sheet's pointer-down-outside and focus-outside checks use **React-tree capture** (`onPointerDownCapture` / `onFocusCapture`). A prompt rendered inside `SheetContent`'s React tree is therefore "inside" the sheet even though it is portalled. That is why the "`<Dialog` between `<SheetContent` and `</SheetContent>`" source pin matters. Keep it.
- **Focus scopes.** The nested modal `FocusScope` pauses the sheet's and resumes it on close. Keep editing returns focus inside the sheet. On Discard, two scopes unmount in the same tick, and the sheet's `onCloseAutoFocus` → `returnFocusRef` must win. G-12 and K8 must assert focus **on the consent row**, not just "outside the drawer".
- **R-2 (overlay press re-closing) is low risk.** With a mouse, the new prompt registers its outside-press listener on the next tick, so the opening `pointerdown` cannot dismiss it. Radix dismisses on `pointerdown`, not on `click`. On **touch**, Radix defers the sheet's outside-dismiss to the `click`, so the prompt opens after the gesture has ended. Do not add the pre-emptive one-frame defer. K7 must be run with touch (DevTools touch emulation or a phone) as well as with a mouse.
- **R-4 is wider than written.** Clean drawer: as stated, it is safe. **Dirty drawer with the picker's delete confirmation open, then Escape:** the sheet gets the Escape, because the picker's overlay is not a Radix layer, and the discard prompt opens at `z-[60]` **underneath** the picker's `fixed z-[70] bg-black/50` overlay. The picker overlay is a descendant of the now pointer-disabled sheet, so clicks pass through it to the prompt. The state is recoverable (Escape again acts as Keep editing) but it looks wrong. Not fixed in S-3 (the picker is shared and the user has put the picker call out of scope). QA records it in K15. It is listed for the F-18 task.

### Ruling 2: dirty definition (approved, with one normalisation)

Field-by-field over the nine `Settings` keys, `reusedAddress` excluded, seeded default counts as clean: **approved.** One hole: every text handler writes `e.target.value || null`. If the server ever returns `''` for a stored field, the baseline holds `''`, and type-then-delete yields `null`, so the drawer is dirty forever. The comparison must treat `''` and `null` as equal for the string fields (C-4).

### Ruling 3: F-18 runtime impact today (for the separate task)

The panel passes neither `selectedId` nor `current`, so inside the picker `selectedRef.current === null` and `hasAddressContent(undefined)` is false. That is the picker's "**empty form takes the default and fills the fields**" branch (pinned by `SavedAddressPicker.default.test.tsx`, "takes the default and fills the fields when the form is empty"). Consequences on `main` today, for any business with **at least one saved address**:

1. **On every open, the stored marketing postal address is replaced in the form** by the default book entry, flattened through `formatAddressOneLine`. Save, which is enabled on a clean form (Q-7), writes it. The postal address is the legally required line on marketing email, so an owner who chose a different one loses it silently on their next save.
2. **After deleting a book entry inside the panel** (`localVersion` bump, refetch), the derive branch runs again and overwrites whatever the owner had typed in the postal field.
3. No entry is ever marked as selected (the `selected` prop is ignored), so "Add a new address" is always the checked radio. The radio group is named `saved-address-undefined`, and the "used by" hint shows the first `usedBy` entry, because nothing equals `undefined`.
4. `type AddressSource` no longer exists. It is erased at runtime and is only a `tsc` error.

**Interaction with S-3's guard.** The fill in point 1 lands **after** the panel sets its baseline (the picker only mounts once the panel has loaded, and its own fetch resolves later). So for such a business, the consent drawer is **dirty on an untouched open**, and closing it untouched shows "Discard your changes?". **S-3 must not work around this** (no re-basing the baseline on picker fills, no "how"-aware handling, no edit to the picker call). The prompt is truthful: the form really has changed, and Save would write the change. It is safer than today, where nothing tells the owner at all. The proper fix is F-18. See C-3 for the test and QA handling and the F-18 scope.

### Conditions

1. **C-1 (T0).** T0 is **already done**. The branch was fast-forwarded to `origin/main` `5d7a0586`, and every touched file is identical to `origin/main` `9afaf17b`. No rebase is needed. In Implementation Notes, update the header's "verified at `e668a7a6`, HEAD `8fc75443`" to `5d7a0586`. RM still confirms ancestry of `origin/main` before the PR (C-24).
2. **C-2 (F-17, how it is fixed).**
   a. `loadFailed` applies only to a load **with no payload yet** (the first load and Try again). It is set on a thrown fetch, `!response.ok`, a non-JSON body, `json.success !== true`, or malformed `data`. Keep `seeded(…)` inside the `try`, so missing `defaults` is a failed load and not an uncaught render error.
   b. **A failed reload after a successful save is not a load failure.** On PUT success, set `baseline` to the form that was sent, and set `saved`, *before* the reload. If the reload then fails, keep the form, keep "Saved", stay clean, and `logger.warn`. Otherwise a successful save would end on a "Could not load" screen, or stay dirty and prompt.
   c. Try again clears `loadFailed`, shows the spinner, and cannot double-fire. While the failure shows, no field and no `TabFooter` render (the slot is empty and hidden). A failed load is clean.
   d. Logging: a refused load is `logger.warn({ status })`, a throw is `logger.error({ err })`. No payload or form value is ever logged.
   e. Tests: D-12 covers each failure kind (throw, 500, 200 with `success: false`, non-JSON, missing `defaults`). New **D-7b**: PUT ok, then the reload fails, gives form kept, "Saved" shown, X closes with no prompt. New mutations **M19** (post-save reload failure shows the load-failed screen) and **M20** (baseline not set from the sent form, so it is dirty after a successful save with a failed reload). K12 stays in manual QA.
3. **C-3 (F-18 boundary).** S-3 leaves the `SavedAddressPicker` call byte-for-byte, the 2 pre-existing `tsc` errors stay, and T9's "0 new errors" applies. The `MarketingConsentDrawer.render` picker stub must **not** auto-fill on mount (as planned). Its header comment states that the real picker auto-fills today (F-18) and that this is deliberately out of S-3. Do not pin the auto-fill behaviour in Jest. Add **K21** to manual QA: "With at least one saved address, open the drawer and close it untouched. Record whether the discard prompt appears and whether the postal field shows the book's default instead of the stored address (expected today: yes, F-18)." TL tells the user this business consequence before S-3 ships, and the F-18 task is scheduled **immediately after S-3** (or before it, if the user prefers no interim prompt).
4. **C-4 (dirty normalisation).** For the string fields, the dirty comparison treats `''` and `null` as equal. Add a test: a stored `''` field, typed into and then cleared, is clean.
5. **C-5 (focus on Discard).** G-12 asserts `document.activeElement` is the return target after Discard. K8 checks it on desktop and phone.
6. **C-6 (K7 touch).** K7 is run with touch (DevTools touch emulation or a device) as well as with a mouse, for R-2.
7. **C-7 (K15 extended).** K15 adds "dirty drawer, picker delete confirmation open, then Escape". Record the result. Expected: the prompt opens under the picker overlay and Escape again recovers. It is not fixed in S-3.
8. **C-8 (source guard precision).** The `/use\w*(Dirty|Unsaved|Discard)/i` ban runs on the **comment-stripped contents** of every file in `components/business-os/settings/` (not file names). Show a negative control (a synthetic `useDiscardGuard(` must fail). The `Provider` relaxation allows exactly `TabFooterSlotProvider`, imported from the `TabFooter` module. `createContext` and `useContext` stay banned.
9. **C-9 (Hebrew copy).** `settings.drawer.discard` "בטל שינויים" can be read as "cancel" (the opposite intent, next to Keep editing). Prefer "מחק את השינויים" (or similar unambiguous wording), and flag he and es to the user for a wording check as planned.

### Optimisation suggestions (non-blocking)

- Discard is a destructive choice. Consider the page's danger styling (as on the Delete dialog) rather than the primary fill, so "Keep editing" reads as the safe default. This is the Dev's call; keep it consistent with Log out and Delete.
- `confirmOpen` reset: rendering the prompt only while `open` would make the reset structural rather than effect-driven. Either is acceptable. Keep M5 whichever you choose.
- A compile-time check of the `DiscardGuardProps` union (`// @ts-expect-error` on `isDirty` without `discardCopy`) is worth one line if a type-test file is already picked up by `tsc`. Otherwise skip it.

### What the separate F-18 task should contain (recommendation to TL / BA)

- **Scope (panel-first):** pass `selectedId` (state `string | null`) and handle `onSelectedChange(id, how)`. A `'derived'` fill must never overwrite a stored or seeded non-empty postal address. Simplest: ignore derived fills, because `seeded()` already falls back to the profile address. Remove the dead `selected` prop and the `AddressSource` import. Decide the `use` value. `consent` is neither `'profile'` nor `'invoice'`, so this needs either a widened `AddressUse` or an optional `use` in the **shared** picker. That picker change needs SA review, and `BusinessProfileSection` / `InvoiceSettingsSection` must stay green. Optionally, move the picker's hand-built `z-[70]` delete confirmation to `components/ui/dialog`, which closes the R-4 / C-7 layering gap.
- **Tests:** a consent panel render test with the **real** picker and a stubbed fetch. Stored postal not overwritten on open. A picker delete does not overwrite typed text. A chosen entry is marked. The drawer is clean on an untouched open (it closes with no prompt). `tsc` reports 0 errors in `MarketingConsentPanel.tsx`.
- **Path:** a small full cycle (short Dev workplan, SA code review, QA). It changes which legal text gets written, so not the UI short path. It sits on top of S-3, so start it after S-3 merges, to avoid stacking (C-24).

### Approval

[x] Workplan approved with conditions C-1 to C-9. Proceed to implementation (T1 onward; T0 is already done).

## Implementation Notes

**Dev, 2026-10-15.** Code complete on `feature/settings-drawer-s3` at `5d7a0586`, uncommitted.

### SA conditions, where each is met

| Condition | Where |
|---|---|
| C-1 header | Header `Branch` / `Code verified against` now name `5d7a0586`; T0 marked done |
| C-2 F-17 | `MarketingConsentPanel.load()`: `hasLoaded` ref; a failure sets `loadFailed` only while nothing has loaded. Covers a thrown fetch, `!response.ok`, non-JSON, `success !== true`, and a payload without `defaults` (`isPayload`); `seeded()` runs inside the `try`. `save()`: on PUT success `setBaseline(sent)` and `setSaved(true)` run **before** the reload. `retry()` and `load()` share a `loadInFlight` ref, so Try again cannot double-fire. Refusals log `warn({ status })`, throws `error({ err })`; nothing else. Tests D-12 (five failure kinds, retry, clean close), D-7b (500 and thrown reload), M17, M19, M20 |
| C-3 F-18 | `SavedAddressPicker` call byte-for-byte; the 2 `tsc` errors remain. The test stub does not fill on mount; the file header says why and points at F-18. K21 added to manual QA |
| C-4 | `sameSettings()` compares `(a[key] ?? '') === (b[key] ?? '')`. Test "C-4: a field stored as '' that is typed into and cleared again is clean" |
| C-5 | G-12 asserts `document.activeElement` is the opener after Discard. K8 updated |
| C-6 | K7 now says mouse **and** touch |
| C-7 | K15 extended with the dirty + picker-confirmation + Escape case |
| C-8 | `SettingsDrawer.render.test.tsx`: the `use…(Dirty\|Unsaved\|Discard)` ban scans the comment-stripped **contents** of every `.ts`/`.tsx` under `components/business-os/settings/` (tests excluded), with negative controls (`useDiscardGuard(`, `useUnsavedChanges`, `useIsDirty` fail; the same in a comment passes). Provider relaxation: the set of `\w*Provider` tokens must equal exactly `{TabFooterSlotProvider}`, imported from `@/components/business-os/settings/TabFooter`. `createContext` / `useContext` still banned |
| C-9 | Hebrew reworded (table below); `settingsDrawerCopy.test.ts` pins that the he Discard does not use בטל |
| Suggestions | Discard uses danger styling (`bg-red-600 text-white`), Keep editing the page's secondary classes, and Keep editing is first in the DOM. The prompt is rendered only when `discardCopy` is given and its content mounts only while `confirmOpen`; the reset on `open=false` stays an effect (M5 kept and caught). The `@ts-expect-error` type test was skipped: no type-test file is picked up by a gate that runs today |

### Wording for the user to check (he / es)

| Key | en | he | es |
|---|---|---|---|
| `settings.drawer.discard_title` | Discard your changes? | למחוק את השינויים? | ¿Descartar los cambios? |
| `settings.drawer.discard_desc` | You have changes here that are not saved. If you close now, they will be lost. | יש כאן שינויים שלא נשמרו. אם תסגור עכשיו, הם יאבדו. | Tienes cambios sin guardar. Si cierras ahora, se perderán. |
| `settings.drawer.keep_editing` | Keep editing | המשך לערוך | Seguir editando |
| `settings.drawer.discard` | Discard changes | מחק את השינויים | Descartar cambios |
| `consent.save_failed` | Not saved. Your changes are still here. Please try again. | לא נשמר. השינויים שלך עדיין כאן, נסה שוב. | No se ha guardado. Tus cambios siguen aquí. Inténtalo de nuevo. |
| `consent.load_failed` | Could not load your marketing permission settings. | לא ניתן לטעון את הגדרות הרשאת השיווק. | No se pudo cargar la configuración del permiso de marketing. |

The title was also moved off "לבטל" so it matches the button.

### Deviations from the plan

1. **Focus after Keep editing (found by G-12).** The prompt has no Radix `DialogTrigger`, and Radix's modal dialog returns focus on close to its trigger only, so focus fell to `<body>`. `SettingsDrawer` now records the element that had focus when the prompt opened (`focusBeforePrompt`) and the prompt's `onCloseAutoFocus` puts focus back there. On Discard it does nothing (the `discarding` ref), so the sheet's return to the row wins. G-12 pins the X, new G-12b pins the field after Escape.
2. **New test file `MarketingConsentDrawer.owner.test.tsx`.** M12 (owner skips its `isDirty` reset) survived the first run: the real panel reports "clean" on mount, so D-14 could not see the reset. The new test uses a panel stand-in that never reports on mount; M12 is caught there.
3. **`MarketingConsentPanel` props default to `{}`.** It still works with no props, as planned.
4. **Thrown reload after a successful save logs `error({ err })`, not `warn`.** C-2 b says "`logger.warn`"; C-2 d says throws log `error`. I followed d for throws, and a refused reload logs `warn({ status })`. The UI result (form kept, "Saved", clean) is the same and D-7b covers both.
5. **`@/components/ui/select` is stubbed** with a native `<select>` in `MarketingConsentDrawer.render.test.tsx` (Radix's portalled listbox cannot be driven in jsdom). Layering stays with QA K14.
6. While saving, the Save button shows only a spinner, so it has no accessible name (pre-existing markup, unchanged). D-10 holds the element instead of re-querying by name.

### Verification

| Check | Result |
|---|---|
| Must-stay-green Jest set (workplan command) | **25 suites, 701 tests, all pass** (S-2 set + the five new S-3 suites) |
| New suites alone | `SettingsDrawer.discard.render` 15, `MarketingConsentDrawer.render` 29, `MarketingConsentDrawer.owner` 2, `settingsDrawerCopy` 19, `SettingsDrawer.layers` +6 (15), `SettingsDrawer.render` +10 (30), `settingsDeepLinks.guard` +9 (38). No React `act` / console warnings in the new suites |
| `npm run typecheck:bos-llm` | Passed: 530 files, 28 errors, **0 new** (one unrelated baseline entry, `app/api/onboarding/build/route.ts`, reported as fixed) |
| Full `tsc --noEmit` (12 GB heap) | 1855 errors repo-wide. In touched files: **0 new**. `MarketingConsentPanel.tsx` keeps exactly the **2 pre-existing F-18 errors** (`AddressSource`, the picker props; lines moved to 38 and 490). `en.ts` and `es.ts` show 8 TS1117 duplicate-key errors each; they are pre-existing duplicates (`crm.task.priority.*`, `crm.booking.status.*`, `config.intake.preview`). The duplicate count is 8 in each file both at `HEAD` and now, and each new key appears exactly once per dictionary. `SettingsDrawer.tsx`, `MarketingConsentDrawer.tsx`, `page.tsx`, `he.ts` and all test files: 0 |
| eslint on touched files | 0 errors. 3 pre-existing warnings in `page.tsx` (`loadData` deps, unused `withDeadline`, `clearSessionKeys`), on lines S-3 does not touch |
| `npm run lint:hooks` | Exit 0 |
| `git diff --numstat` | 10 tracked files, +658 / -49; 5 new source/test files (1,187 lines) plus this workplan. Explanation of the deletions below |

**Why lines were deleted (no deletion-only diff):** `page.tsx` -12 (the `expandedSection` state and its comment, the expand-in-place row and panel block, replaced by the opener and drawer); `SettingsDrawer.tsx` -17 (the old props interface, the busy-only gate and the "arrive with S-3" comment, replaced); `MarketingConsentPanel.tsx` -13 (the old `load`/`save` and the inline Save row, replaced); `SettingsDrawer.render.test.tsx` -6 (the blanket `Provider` ban, replaced by the exact relaxation); `SettingsDrawer.layers.test.tsx` -1 (one import line widened).

### Mutation run (T10)

Each mutation: the file is copied to the scratchpad, mutated, the listed suites run, the file copied back, and its SHA-1 compared with the value before. All 20 restored with a matching SHA-1. No `git stash`, no `git checkout`.

| # | Mutation | Result | Caught by |
|---|---|---|---|
| M1 | Drop the `isDirty` check from the gate | Caught (23) | L-5, L-7, G-1, G-2, G-3, D-3, D-6 … |
| M2 | Gate reordered dirty-then-busy | Caught (1) | L-6 only. G-10 / D-10 do not see it, because the busy `preventDefault` layers and the disabled X stop the request before the gate. Expected from the layered design; L-6 exists for this |
| M3 | `handleDiscard` forgets `onOpenChange(false)` | Caught (5) | L-7, G-7, G-12, D-3, D-14 |
| M4 | Keep editing calls `onOpenChange(false)` | Caught (5) | L-7 keep, G-4, G-12, D-4 … |
| M5 | No `confirmOpen` reset on `open=false` | Caught (1) | G-9 |
| M6 | Prompt `<Dialog>` moved outside `<SheetContent>` | Caught (1) | Source pin only. G-6 still passes in jsdom: the outside-press path does not reproduce there. K7 / K16 stay the live check |
| M7 | Prompt replaced by `window.confirm` | Caught (24) | Source ban and every prompt test |
| M8 | Dirty compared by reference | Caught (3) | D-5, C-4 test, D-7 |
| M9 | Failure message removed | Caught (5) | D-8, D-9 |
| M10 | Form cleared on save failure | Caught (5) | D-8, D-9 |
| M11 | `saving` not reported through `onBusyChange` | Caught (1) | D-10 |
| M12 | Owner does not reset `isDirty` on close | **Survived first run**, caught (1) after adding `MarketingConsentDrawer.owner.test.tsx` | Owner test |
| M13 | One `dir="ltr"` switch wrapper removed | Caught (1) | D-13 |
| M14 | `logger.error({ err, form })` | Caught (2) | D-9 |
| M15 | `TabFooterSlotProvider` dropped | Caught (5) | Shell footer test, D-1, D-7, D-8 … |
| M16 | Save disabled when clean | Caught (4) | D-7, D-7b, D-11 |
| M17 | Form and Save rendered after a failed load | Caught (7) | D-12 (all) |
| M18 | Consent row given back `setExpandedSection` | Caught (2) | Deep-link guard |
| M19 | Post-save reload failure shows the load-failed screen | Caught (2) | D-7b |
| M20 | Baseline not set from the sent form | Caught (2) | D-7b |

### Questions for SA

1. **Focus restore after Keep editing** (deviation 1) is new behaviour inside the wrapper: a ref holding the element focused at prompt-open, and an `onCloseAutoFocus` that always `preventDefault`s. Acceptable, or prefer a different return target (for example the drawer's X)?
2. **M2 and M6** are caught only by the mocked-sheet layer test and the source pin respectively. Is that enough, given SA S-1 finding 3 asked for exactly this kind of single-layer pin?
3. **Danger styling** on Discard uses `bg-red-600`, which is not a V2 token; the page's Delete dialog uses `text-red-600` the same way. Keep, or use the primary fill?

## SA Code Review (2026-10-15)

**Code Review by SA, 2026-10-15**
**Status:** APPROVED. No blocking finding. Findings 1 to 3 are Low: they go to follow-up or are accepted as they are. Code approved for QA: **Yes**.

**Scope read in full:** `SettingsDrawer.tsx`, `MarketingConsentDrawer.tsx` (new), the `MarketingConsentPanel.tsx` diff, the `page.tsx` diff, the en/he/es diffs, the requirement diff, and all new and changed tests (`SettingsDrawer.discard.render`, `SettingsDrawer.layers`, `SettingsDrawer.render`, `MarketingConsentDrawer.render`, `MarketingConsentDrawer.owner`, `settingsDrawerCopy`, `settingsDeepLinks.guard`). Worktree HEAD `5d7a0586`, changes uncommitted.

### Verified

| Check | Result |
|---|---|
| Must-stay-green Jest set (workplan command), re-run by SA | **25 suites, 701 tests, all pass** |
| eslint on the three component files | 0 findings |
| `console.*` in touched source files | 0 in `SettingsDrawer`, `MarketingConsentDrawer`, `MarketingConsentPanel` and `page.tsx`. The panel logs through Pino, with status or `{ err }` only |
| Entitlements imports | None in any touched file |
| C-5 guard | One gate (`handleOpenChange`) for Radix's dismiss and the X, ordered busy, then dirty, then close. Discard (`handleDiscard`) calls the parent's `onOpenChange(false)` past the gate and refuses while busy. The prompt is `@/components/ui/dialog`, rendered inside `SheetContent` (source-pinned). `confirmOpen` is reset by an effect on `open=false` (G-9, M5). No `window.confirm`, `beforeunload`, router, `history.`, exported `use…`, `createContext` or `useContext`. The only provider is `TabFooterSlotProvider` (exact-set pin plus import pin) |
| C-8 | `use\w*(Dirty\|Unsaved\|Discard)` is scanned over the comment-stripped **contents** of every non-test `.ts/.tsx` in the folder, with a check that the scan is not empty. Negative controls: `useDiscardGuard(`, `useUnsavedChanges` and `useIsDirty` fail; the same names inside comments pass |
| F-17 per C-2 a–e | (a) `loadFailed` is set only while `!hasLoaded`. Thrown, `!ok`, non-JSON, `success !== true` and missing `defaults` (`isPayload`) are all covered, and `seeded()` runs inside the `try`. (b) PUT success sets `baseline = sent` and `saved` **before** the reload. A failed reload keeps the form and "Saved" and stays clean (D-7b, 500 and thrown). (c) `retry` and `load` share `loadInFlight`, and the spinner replaces the button. The failure screen renders no field and no `TabFooter`, and a failed load is clean (`isDirty` is gated on `!loadFailed`). (d) Only warn `{ status }` and error `{ err }` are logged. (e) D-12 covers five failure kinds, plus D-7b; M17, M19 and M20 are recorded as caught |
| No form value logged | D-9 serialises every logged argument (including `err.message` and `stack`). It asserts that the typed statement, the typed postal address, the notice body and the seeded statement are all absent. D-7b repeats the check for the reload path |
| C-3 / F-18 | The `SavedAddressPicker` call has no diff hunk (byte-for-byte), and the `AddressSource` import is untouched. The picker stub fills only on click. Its header comment explains F-18 and says the auto-fill is deliberately not pinned. K21 is in manual QA |
| C-4 | `sameSettings` compares `(a[key] ?? '') === (b[key] ?? '')` over the nine keys, with `reusedAddress` excluded. A dedicated test is present |
| C-9 | he `discard_title` is "למחוק את השינויים?" and `discard` is "מחק את השינויים". `settingsDrawerCopy` pins that "בטל" is not used. The he and es wording is still flagged to the user for a check |
| Frozen code (C-9/C-13) | The `page.tsx` hunks are only: the import swap, the removal of the `expandedSection` state, the new consent state and ref, and the consent row. The deep-link effect region, including the timezone comment that names `setExpandedSection('timezone')`, is byte-identical to HEAD (diffed). `TabFooter.tsx`, `components/ui/*` and `SavedAddressPicker.tsx` have no diff |
| TS1117 duplicates | SA diffed the duplicate key sets at HEAD against the worktree. en and es have the **same 8** before and after (`config.intake.preview`, `crm.booking.status.{cancelled,completed,confirmed,no_show}`, `crm.task.priority.{high,low,medium}`); he has none. Pre-existing and not worsened. Each new key appears once per dictionary |
| Page row | `type="button"`, `aria-haspopup="dialog"`, `aria-expanded`, `ref`, a static chevron, the title only (C-8 row values), and `id="settings-section-consent"` kept |

### Code Review Comments

1. `MarketingConsentPanel.tsx` `save()`: the fields are not disabled while `saving`. An edit typed during the PUT or the reload is overwritten by the reload's `setForm(next)`, with no prompt. The drawer is busy, so it cannot close, but the keystrokes are lost. Before S-3 the old `save()` also reloaded and reseeded, so this is not a regression. **Priority: Low.** Follow-up: carry it into the F-18 task (same file, same review) as "disable the form while saving, or skip the reseed if the form has changed since `sent`". Not a condition on S-3.
2. `MarketingConsentPanel.tsx` footer message: `saveFailed` stays on screen after the owner edits the form back to its baseline (clean). So "Not saved. Your changes are still here." can sit next to a form that has no changes. Cosmetic. **Priority: Low.** Optional: show the alert only while `isDirty`, mirroring `saved && !isDirty`. Not a condition.
3. `SettingsDrawer.tsx` prompt `onCloseAutoFocus`: it always calls `preventDefault`. When `focusBeforePrompt` is null (nothing focusable had focus at the close request), focus falls to `<body>` instead of going into the sheet. This is rare, because Radix's focus trap normally keeps focus inside the sheet. **Priority: Low.** Optional: fall back to the sheet content or the X when `back` is null or disconnected. Not a condition.

### Rulings on the Dev's questions and deviations

| Item | Ruling |
|---|---|
| **Q-1 / deviation 1** (focus returns to the element that had focus when the prompt opened) | **Accepted as built.** It follows the WAI-ARIA dialog pattern (return focus to where the user was). It lives in two local refs inside the props-only wrapper, with no context, no hook and no new prop. It checks `isConnected`, and it stands aside on Discard (via `discarding`) so the sheet's return to the row wins (G-12 asserts the row). A fixed target such as the X would be worse after Escape from a field, because the owner would lose their place in a long form (G-12b pins the field). See finding 3 for the optional null fallback |
| **Q-2** (M2 caught only by L-6; M6 only by the source pin) | **Enough.** This is exactly what SA S-1 finding 3 asked for. The gate order cannot be observed through behaviour, because the busy `preventDefault` layers and the disabled X refuse first, so a single-layer pin is the right test and the only one possible. M6's outside-press path does not reproduce in jsdom. The source pin stays mandatory, and **QA K7 (mouse and touch) and K16 must actually be run** as the live check. No new test is required |
| **Q-3** (`bg-red-600` on Discard) | **Keep.** `components/ui/button` has no destructive variant, and there is no V2 danger token. The codebase's destructive confirms use the red Tailwind fill (`ConfigurationDialog`'s delete confirm uses `bg-red-500`, `InviteFriendsSection` uses `bg-red-600`, about 44 files in all). The page itself uses `red-600` / `red-700` for its danger and error states, and `darkModeTokens.guard` passes. Adding a danger token would be a design-system change, out of scope here |
| **Deviation 3** (a thrown reload after a successful save logs `error`, not `warn`) | **Accepted.** C-2 d (a throw logs `error({ err })`) governs the log level. C-2 b's "warn" described the refused-reload case, which logs `warn({ status })` as built. The UI outcome that C-2 b protects (form kept, "Saved", clean) holds in both cases, and D-7b covers both |
| Deviations 2, 5, 6 | Accepted. The owner test with a stand-in that does not report on mount is the right way to catch M12. The native-`select` stub is needed in jsdom, and the layering stays with K14. The spinner-only Save button with no accessible name is pre-existing markup |

### Optimisation Suggestions

- Findings 1–3 above. All are optional; finding 1 is recommended for the F-18 task.
- The `DiscardGuardProps` `@ts-expect-error` type test stays skipped until a gate that actually runs covers a type-test file. Agreed.

### Code Approved for QA: Yes

## QA Testing Report

See [QA Report (2026-10-15)](#qa-report-2026-10-15).

## QA Report (2026-10-15)

**QA, 2026-10-15.** Worktree `neuronforge-settings-drawers`, branch `feature/settings-drawer-s3`, uncommitted. No production code changed by QA.

**Test mode:** full · **Strategy:** A (Jest, jsdom, real Radix sheet + dialog) + mutation testing + code reading; D (manual browser) NOT RUN, because there is no browser or account in this session · **Focus:** ui, copy, no logging of form values · **Input source:** prompt keywords + workplan Test Plan / C-10 checklist

### 1. Must-stay-green set (independent re-run)

Workplan command, run unchanged: **25 suites, 701 tests, all pass** (104.8 s). This matches Dev and SA (25 / 701). The noise in the output is expected `warn`/`error` Pino lines from failure-path tests in `PlanUpgrade`, `PlanSection` and `InvoiceSettingsSection`. There is also one "worker failed to exit gracefully" notice, from pre-existing timer teardown, which does not affect the result. `test:bos-entitlements` was not needed: no touched file imports from `lib/business-os/entitlements/`.

### 2. New mutations (not in Dev's M1 to M20)

Each mutation was applied by a scratch script to a file backed up to the QA scratchpad. The script refuses to run if the find string does not match exactly once. It ran `npx jest "components/business-os/settings/__tests__/(SettingsDrawer|MarketingConsent)"` (6 suites, 110 tests), copied the backup back, and compared SHA-1. **Every file was restored with a matching SHA-1.** After the last one: `git diff --numstat` = 10 files +658 / −49 (baseline); `SettingsDrawer.tsx` `9e98cc46…`, `MarketingConsentPanel.tsx` `d3f2f48b…` and `MarketingConsentDrawer.tsx` `244a9355…` are unchanged. No `git stash` and no `git checkout`.

| # | Mutation | Result | Caught by |
|---|---|---|---|
| N1 | Discard routed back through the gate (`onClick={() => handleOpenChange(false)}`, so it re-prompts forever) | Caught (6) | L-7, G-7, G-12, D-3, D-14 |
| N2 | Dirty check treats `''` ≠ `null` (`a[key] === b[key]`) | Caught (1) | C-4 test |
| N3 | `hasLoaded.current = true` removed (the F-17 screen shows after save success + reload fail) | Caught (2) | D-7b (500 and thrown) |
| N4 | Both `loadInFlight` guards removed (Try again may double-fire) | **Survived** | See Edge Case 1 |
| N5 | A Save button rendered on the load-failure screen (with no form) | Caught (5) | D-12 (all five failure kinds) |
| N6 | A form value added to the refused-save log (`logger.warn({ status, postal: sent.postal_address })`) | Caught (2) | D-8 (400, 500) |
| N7 | `handleDiscard` does not `setConfirmOpen(false)` | Caught (1) | L-7 only. In behaviour, the `[open]` reset effect masks it |
| N7b | N7 plus the `[open]` reset effect removed (stale prompt on reopen) | Caught (6) | L-7, G-7, G-9, D-3, D-14 |
| N8 | Keep editing remounts the body (`key` bump), which clears the edits | Caught (3) | G-4, G-12b, D-4 |
| N9 | A **thrown** save marks the form clean (`setBaseline(sent)` in `catch`) | **Survived** | See Edge Case 2 |
| N10 | `dir="ltr"` removed from the **ad-label** switch wrapper (Dev's M13 removed one wrapper) | Caught (1) | D-13 |
| N11 | Load accepts a 200 with `success: false` when `data` has `defaults` (the `json.success !== true` check removed) | **Survived** | See Edge Case 3 |
| N12 | "Saved" shown while dirty (`saved && !isDirty` → `saved`) | Caught (1) | D-7 |
| N13 | `discarding.current = false` not reset when a new prompt opens | **Survived** | See Edge Case 4 |

**14 mutations: 10 caught, 4 survived.** All four survivors are test gaps. The production code they mutate is correct as written.

### 3. Code-level happy and failure paths (source read against the covering tests)

| Path | Result | Evidence |
|---|---|---|
| Open → edit → Save success: "Saved" in the bar, form clean, closes with no prompt | ✅ Pass | `save()` sets `baseline = sent` and `saved` before `load()`; D-7, D-7b |
| Edit → close → prompt → **Keep editing**: edits kept, focus back in the sheet | ✅ Pass | `focusBeforePrompt` + the prompt's `onCloseAutoFocus`; G-4, G-12, G-12b, D-4, N8 |
| Edit → close → prompt → **Discard**: closed, draft cleared, focus on the consent row | ✅ Pass | `handleDiscard` calls the parent's `onOpenChange(false)` past the gate; `discarding` keeps the prompt from pulling focus back; the sheet's `onCloseAutoFocus` goes to `returnFocusRef`; G-7, G-12 (`activeElement` is the opener), D-3, N1 |
| Clean close: no prompt | ✅ Pass | D-2, D-5, G-8 |
| Busy refuses close, and busy beats dirty | ✅ Pass | Gate order `isBusy` then `isDirty`; Escape and outside press `preventDefault`ed; X disabled; G-10, L-6, D-10 |
| Failed save: translated error, edits kept, still guarded | ✅ Pass (one gap) | D-8 (400, 500, 200 with `success:false`): `consent.save_failed`, never `json.error`, and close still prompts. Thrown path (D-9): the message and the edits are asserted, but "close still prompts" is not (Edge Case 2) |
| Load failure: alert + Try again, no form, no Save | ✅ Pass | The `loadFailed` branch returns before the form and the `TabFooter`; D-12 × 5 failure kinds, N5 |
| Try again recovers | ✅ Pass | D-12 retry test |
| No form value logged | ✅ Pass | Refusals log `{ status }` and throws log `{ err }`; D-8, D-9, D-12 key checks, N6 |
| **C-3 / F-18 not worked around** | ✅ Pass | The `<SavedAddressPicker … />` block hashes the same at `HEAD` and in the worktree (md5 `99c06737…`). `baseline` is set only in `load()` and on save success, never from `onSelect`. `SavedAddressPicker.tsx`, `TabFooter.tsx`, `dialog.tsx` and `sheet.tsx` are unchanged (`git diff --quiet`). The test stub does not fill on mount, and its header points at F-18 |

### 4. Translations

| Key | en | he | es |
|---|---|---|---|
| `settings.drawer.discard_title` | 1 | 1 | 1 |
| `settings.drawer.discard_desc` | 1 | 1 | 1 |
| `settings.drawer.keep_editing` | 1 | 1 | 1 |
| `settings.drawer.discard` | 1 | 1 | 1 |
| `consent.save_failed` | 1 | 1 | 1 |
| `consent.load_failed` | 1 | 1 | 1 |

Each new key appears exactly once in each dictionary. `crm.consent.save_failed` is a different key that already existed. The Hebrew Discard is "מחק את השינויים" and the title is "למחוק את השינויים?". The only "בטל" in the block is inside the explanatory code comment. `settingsDrawerCopy.test.ts` pins this (SA C-9). The he and es wording is still flagged to the user for a check.

### 5. Manual browser checks (C-10): all NOT RUN

There is no browser and no business account in this session. A human must run each check on desktop and on phone width (≤ 640 px), in English and Hebrew.

| # | Status | What a human must check |
|---|---|---|
| K1 | NOT RUN | The row shows the title and a static chevron, and is announced as opening a dialog; it does not expand in place |
| K2 | NOT RUN | The drawer opens on the same side as the plan drawer; the Save bar stays fixed while the 10-line notice scrolls; the URL does not change |
| K3 | NOT RUN | An untouched close by X, Escape or overlay closes at once, and focus lands on the consent row |
| K4 | NOT RUN | Edit, then X: the prompt appears **above** the dimmed drawer |
| K5 | NOT RUN | Keep editing: the edit is kept and focus is inside the drawer |
| K6 | NOT RUN | Escape opens the prompt; a second Escape closes only the prompt |
| K7 | NOT RUN | **Run with a mouse AND with touch** (SA C-6 / R-2). An overlay press opens the prompt; a press on the prompt's backdrop closes only the prompt; the prompt does not flash open and shut. jsdom cannot reproduce this path (Dev M6 note), and SA Q-2 makes K7 mandatory |
| K8 | NOT RUN | Discard: the drawer closes; focus is **on the Marketing permission row** (desktop and phone); reopening shows the stored wording |
| K9 | NOT RUN | Type a letter, delete it, close: no prompt |
| K10 | NOT RUN | Save: spinner, X greyed out, Escape and overlay refused, then "Saved"; reopening confirms the change was stored |
| K11 | NOT RUN | Save failure (block `consent-settings` or go offline): red message in the bar, edits kept, close prompts. **Include the offline (thrown) case**, because Jest does not pin "still prompts" for it (Edge Case 2) |
| K12 | NOT RUN | Load failure: "Could not load…" and Try again, no Save button, X closes with no prompt, Try again recovers |
| K13 | NOT RUN | Untouched first-time owner, Save: the seeded wording is stored |
| K14 | NOT RUN | **Privacy-notice `Select` layering:** the dropdown opens above the drawer and is clickable; choosing an option does not close the drawer; Escape on the open list closes only the list. Jest stubs `Select` with a native `<select>`, so this is not covered in Jest |
| K15 | NOT RUN | **`SavedAddressPicker` (R-4, SA C-7):** the list and "use this address" work; the z-70 delete confirmation is placed correctly and is clickable (record whether it covers the whole screen or only the sheet); Escape while it is open, on a clean drawer (expected: the drawer closes and nothing is deleted). Then **dirty drawer, confirmation open, Escape:** expected, the prompt opens *under* the picker overlay and a second Escape recovers. Record the result; S-3 does not fix it |
| K16 | NOT RUN | **Prompt over the sheet:** the prompt and its backdrop sit above the sheet and its overlay, never behind; nothing from the page header shows through, on phone too. SA Q-2 makes this mandatory |
| K17 | NOT RUN | Hebrew: both switch thumbs stay inside their tracks, on and off |
| K18 | NOT RUN | Hebrew prompt: text right-aligned; button order mirrored, as in the Log out dialog |
| K19 | NOT RUN | Regression: plan drawer (with `?section=plan` cleanup), password drawer, `?section=timezone` / `business` / `invoice`, Language / Currency / Timezone, Invite friends, Export, Log out, Delete |
| K20 | NOT RUN | `?section=consent` and `#settings-section-consent`: no drawer opens, and the hash lands on the row |
| K21 | NOT RUN | **F-18 interim (SA C-3):** with at least one saved address, open the drawer and close it untouched. Record whether "Discard your changes?" appears, and whether the postal field shows the address book's default instead of the stored address. **Expected today: yes to both.** This is not an S-3 defect, but TL must tell the user before S-3 ships, and the F-18 task follows straight after |

### Issues Found

#### Bugs (must fix before commit)

None. No product defect was found in the S-3 code paths read and tested.

#### Performance Issues (should fix)

None. The dirty check is nine equality comparisons per render (R-6).

#### Edge Cases / test gaps (nice to fix; none blocks)

1. **The Try again "cannot double-fire" test is vacuous (N4 survived).** Severity: Low. File: `MarketingConsentDrawer.render.test.tsx`, D-12 retry. The first click sets `loading`, which unmounts the button, so the second `fireEvent.click` lands on a detached node. The test still passes with both `loadInFlight` guards removed. The behaviour is safe today because the button unmounts, but the guard itself is not pinned. Fix: invoke the retry path twice before the re-render (for example, two clicks inside a single `act`), or drop the "double press" claim from the test name.
2. **A thrown save is not checked to stay guarded (N9 survived).** Severity: Low–Medium, because a regression here would silently lose data. File: `MarketingConsentDrawer.render.test.tsx`, D-9. D-8 asserts that a refused save still prompts on close. D-9 (network error, non-JSON body) asserts only the message and the value. A regression that marked a thrown save as clean would let close drop the edits without a prompt. Fix: one line, `await expectPrompts()` at the end of D-9 (after Save re-enables).
3. **The `json.success !== true` check on load is not pinned on its own (N11 survived).** Severity: Low. D-12's "200 with `success: false`" case carries no `data`, so `isPayload` rejects it by itself. Fix: add a case `respond({ success: false, data: payload() })`.
4. **The `discarding` reset is not pinned (N13 survived).** Severity: Low. Without `discarding.current = false`, after one Discard, a later Keep editing in the same page visit leaves focus on `<body>`, because the prompt's `onCloseAutoFocus` returns early. No test runs Discard → reopen → edit → prompt → Keep editing → focus check. Fix: extend G-12 with that sequence.
5. **Edits typed during the post-save reload are overwritten.** Severity: Low, not a regression. This is the same issue as SA code-review finding 1, confirmed independently by reading the code. SA has already routed it to the F-18 task.

### Final Status

- [x] Automated acceptance criteria pass: 25 suites / 701 tests green; 10 of 14 new mutations caught; the 4 survivors are test gaps, not defects
- [ ] Manual checks K1 to K21 NOT RUN. A human must run them. The priority checks are K7 (touch), K14, K15, K16 and K21

**Verdict: PASS WITH NOTES.** No bugs found. Edge Cases 2 and 4 are one assertion each and worth closing before commit; 1 and 3 are optional. Before S-3 ships, the C-10 manual checklist must be run and the user must get the K21 notice.

### QA gap closure (2026-10-15)

**Dev, 2026-10-15.** Test files only; no production file changed. The four surviving mutations from §2 now fail.

| Gap | Test change | Mutation re-applied (QA `mutate.js`) |
|---|---|---|
| N9 (Edge Case 2) | D-9 (both kinds) ends with Save re-enabled and `await expectPrompts()` | Caught: 2 tests (D-9 network error, D-9 not JSON) |
| N13 (Edge Case 4) | G-12 continues: after Discard, reopen, focus the field, edit, Escape, Keep editing, focus back on the field | Caught: 1 test (G-12) |
| N11 (Edge Case 3) | New D-12 case: a 200 with `{ success: false, data: payload() }` shows the alert and Try again, with no form and no Save | Caught: 2 tests (the new D-12 case and one more) |
| N4 (Edge Case 1) | D-12 retry: both presses inside one `act` so the button is still mounted for the second; asserts 2 fetches straight away. A third queued answer makes a double-fire show up as a third fetch | Caught: 1 test (D-12 retry) |

Each mutation ran on the 6 S-3 suites (111 tests) and was restored from the QA scratchpad backup with a matching SHA-1. Afterwards, `SettingsDrawer.tsx` `9e98cc46…`, `MarketingConsentPanel.tsx` `d3f2f48b…` and `MarketingConsentDrawer.tsx` `244a9355…` are unchanged, and `git diff --numstat` for the tracked files is the same as the QA baseline (10 files, +658 / −49). Only the untracked `MarketingConsentDrawer.render.test.tsx` (600 → 615 lines) and `SettingsDrawer.discard.render.test.tsx` (353 → 365 lines) grew. Must-stay-green: **25 suites, 702 tests, all pass** (701 + the new N11 case). eslint is clean on both test files. Edge Case 5 is unchanged and still routed to F-18.

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created | Dev workplan for S-3 (full cycle), verified against `page.tsx` at `e9f0d103`; `origin/main` `e668a7a6` identical for every touched file (S-2 merged as #389). No deep link targets consent, so no effect branch. Guard design: opt-in `isDirty` + typed `discardCopy` on `SettingsDrawer`, one gate ordered busy then dirty then close, a nested `Dialog` inside `SheetContent`, Discard bypasses the gate, `confirmOpen` reset on close. The fixed Save bar via the existing `TabFooterSlotProvider` (W-4). F-2 fixed inside the drawer. New findings F-17 (failed load renders a Save that could overwrite stored settings) and F-18 (`SavedAddressPicker` prop drift). Eight questions for SA |
| 2026-10-15 | SA workplan review | APPROVED WITH CONDITIONS (C-1 to C-9). User decisions recorded: F-17 fixed in S-3, F-18 a separate task. T0 already done (branch at `5d7a0586`, identical to `origin/main` `9afaf17b` for touched files). Guard design confirmed against Radix (Escape only on the highest layer; React-tree capture keeps the in-tree prompt "inside" the sheet; R-2 low risk, test with touch). F-17 conditions: load failure only before a payload exists; a successful save then failed reload stays clean with "Saved". F-18 runtime impact found larger: the picker's derive branch overwrites the stored postal address on every open (for any business with a saved address), which makes the S-3 drawer dirty on an untouched open. S-3 must not work around it; QA K21; F-18 scheduled right after S-3. `''`/`null` dirty normalisation; Hebrew "Discard" wording |
| 2026-10-15 | Code complete | All tasks T0 to T11 done; SA C-1 to C-9 applied (see Implementation Notes). F-17 fixed in the panel; F-18 untouched. Deviations: focus returns to the element focused before the prompt after Keep editing (found by G-12); new `MarketingConsentDrawer.owner.test.tsx` after M12 survived. Must-stay-green 25 suites / 701 tests pass; `typecheck:bos-llm` 0 new; full `tsc` 0 new in touched files (2 F-18 errors remain); eslint and `lint:hooks` clean. Mutations M1 to M20 all caught (M12 after the new test), every file restored with a matching SHA-1. Uncommitted; awaiting SA code review and QA |
| 2026-10-15 | SA code review | APPROVED; code approved for QA. SA re-ran the must-stay-green set (25 suites, 701 tests, green); eslint clean; no `console.*`; no entitlements import. C-1 to C-9 verified in code. The frozen deep-link and timezone comment are byte-identical; the TS1117 duplicates are the same 8 in en and es before and after. Rulings: Q-1 focus restore accepted; Q-2 single-layer pins are enough (K7 and K16 must be run); Q-3 keep `bg-red-600`; deviation 3 accepted. Three Low findings, none of them a condition. Finding 1 (an edit typed during a save is overwritten by the reload) is recommended for the F-18 task |
| 2026-10-15 | QA report | PASS WITH NOTES. Must-stay-green re-run: 25 suites / 701 tests pass. 14 new mutations (N1 to N13, N7b): 10 caught, 4 survived (N4 Try-again guard, N9 thrown save marked clean, N11 load `success` check, N13 `discarding` reset). All four are test gaps, not product bugs. Every file restored by SHA-1; numstat still 10 files +658/−49. C-3 / F-18 not worked around (picker call byte-identical). The six new keys appear exactly once each in en / he / es; the Hebrew Discard avoids בטל. K1 to K21 NOT RUN (no browser); K7 touch, K14, K15, K16 and K21 are the priority |
| 2026-10-15 | QA gap closure | Test files only. Closed the four surviving mutations: N9 (D-9 still prompts after a thrown save), N13 (G-12 Discard then reopen, Keep editing returns focus), N11 (new D-12 load case `success: false` with a full payload), N4 (D-12 retry presses inside one `act`). Each re-applied mutation now fails; every production file restored by SHA-1; numstat unchanged from the QA baseline. Must-stay-green 25 suites / 702 tests pass |
