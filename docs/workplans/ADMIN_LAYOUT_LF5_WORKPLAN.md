# Workplan: Admin Layout LF-5 (Admin users page wording)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1 LF-5 (user request 2026-10-13; copy approved by the user)
**Branch:** `feature/admin-layout-lf5` (from `origin/main` 229a6c2e)
**Path:** UI short path (Dev, then SA code review and QA in parallel, then user diff, then RM)
**Date:** 2026-10-13
**Status:** Code Complete (uncommitted), awaiting SA + QA

## Overview

Copy-only change on Admin users (`/admin/settings`). No request, data or behaviour change. The one layout addition is a single note line under the second section's title, styled as the page's existing secondary text (`text-sm text-slate-400`).

## Approved copy (word for word)

| Where | Now | New |
|---|---|---|
| Header purpose line | "Who can open admin." | "People who can sign in to this admin area, and where their access comes from." |
| Second section title | "Granted by the ADMIN_EMAILS environment setting" | "Admins set in the server configuration" |
| Second section, note under the title | (none) | "Added through the ADMIN_EMAILS setting, not through the list above. Changing it needs a redeploy." |
| Second section, empty state | "No addresses beyond the table." | "No extra admins come from the server configuration. Everyone with access is in the list above." |

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/settings/page.tsx` | modify | The four strings above; the note `<p>` |
| `app/admin/settings/__tests__/page.render.test.tsx` | modify | `ENV_HEADING` constant, P-3 (adds the note), P-3b (new empty sentence) |
| `app/admin/settings/__tests__/adminUsersLayout.render.test.tsx` | modify | A-1 purpose line |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §7.15 and the registry row quote the old purpose |
| `docs/workplans/ADMIN_LAYOUT_L12_WORKPLAN.md` | modify | Dated LF-5 note: quoted copy superseded (history rows left as written) |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | Quotes the old section title |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 LF-5 row, Change History row |

Out of scope: the sidebar description "Who can open admin" (`AdminSidebar.tsx`), not part of the approved copy.

## Task List

- ✅ Step 1: Page copy and the note line
- ✅ Step 2: Test edits (A-11, A-12, S-1 to S-4 untouched)
- ✅ Step 3: Docs quoting the old copy
- ✅ Step 4: Runs: jest `app/admin/settings` and `app/admin/components`, authz guard, tailwind guard, `lint:hooks`

## SA Review Notes

### SA Code Review

**Code Review by SA, 2026-10-14**
**Status:** ✅ Code Approved

- `page.tsx`: the diff holds exactly the four approved strings, word for word, plus one note `<p className="mb-3 text-sm text-slate-400">`. The JSDoc header line was reworded to match; it is a comment only. The fetch, state and render branches are unchanged, so there is no request or behaviour change.
- Tests: `ENV_HEADING` changed, the new `ENV_NOTE` and `ENV_EMPTY_TEXT` constants were added, and the P-3, P-3b and A-1 assertions were updated or added. A-11, A-12 and S-1 to S-4 are unedited. `npx jest app/admin/settings --ci`: 2 suites, 54 tests, all pass.
- Docs: `git diff --numstat` shows only additions plus one-line replacements (2 + 0, 4 + 1, 3 + 1, 3 + 2). No content was lost and no line was mangled. Every Change History row was appended in the right table. There are no backslashes in the diff or in this workplan.
- Low (no action): row 18 of the requirement's §1 still quotes the old purpose line. That row is a status record, and the new §7.15 note covers the change. The Files table's mention of "the registry row" is therefore a little more than what was actually done. The Sidebar text "Who can open admin" is out of scope, as the workplan states.

### Code Approved for QA: Yes

## QA Testing Report

## Commit Info
