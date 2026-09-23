# Proposal: Denser row layout for `/admin/audit-trail`

> **Last Updated**: 2026-09-23
> **Status:** Proposal only — no code written, `page.tsx` untouched.
> **Author:** Dev · **Builds on:** [Slice A workplan](/docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_A_WORKPLAN.md) (QA-passed, uncommitted, at the user-view gate)

## Overview

An admin sees **3 full audit rows** on a 1080p screen before scrolling. This document measures
where that vertical space actually goes, offers three layout options with row counts, states what
each one costs, and recommends one. Nothing here is implemented.

---

## 1. Measurement of the current state

### Per-row budget (collapsed card, `page.tsx:609-680`)

| Element | Classes | Height |
|---|---|---|
| Card vertical padding | `p-4` | **32px** |
| Header row 1 (icon, `text-lg` title, severity badge, flags, timestamp, chevron) | `text-lg` → 28px line box | **28px** |
| Gap between the two header rows | `mb-3` | **12px** |
| Header row 2 (Entity / Resource / User) | `text-sm` → 20px line box | **20px** |
| Card border | `border` ×2 | **2px** |
| **Card total** | | **94px** |
| Gap to next card | `space-y-3` on the parent | **12px** |
| **Pitch (row to row)** | | **106px** |

**Where the space goes: 46px of the 106px pitch — 43% — is padding, inter-row gap and the
gap between the two header rows.** It carries no information. Only ~48px carries text, and that
text is split over two lines that would fit on one at 1616px of available width.

The `text-lg` (18px/28px) title is also out of proportion: it is larger than every other admin list
in the repo, all of which use `text-sm` for row titles.

### Rows per screen

Chrome above the first row, from the same class arithmetic:

| Block | Height |
|---|---|
| `main` top padding (`p-6`) | 24px |
| Page header (`pb-4` + border) | 69px |
| Filters card (`p-6`, 6 fields in 2 rows, Clear button) | **302px** |
| Results-count / pager bar (`p-4`) | 62px |
| 3 × `space-y-6` gaps | 72px |
| **Total chrome** | **529px** |

Viewport assumptions: Chrome maximized on Windows 11 (taskbar + browser chrome ≈ 140px); the admin
layout is `h-screen overflow-hidden` with a 64px `AdminHeader`, so the scroll area is
`viewport − 64`.

| Screen | Scroll area | Minus 529px chrome | **Full rows visible today** |
|---|---|---|---|
| 1920×1080 | 876px | 347px | **3** (3.27) |
| 2560×1440 | 1240px | 711px | **6** (6.71) |

At page size 20 that is **~6 screens of scrolling per page** on 1080p.

> ⚠️ **The biggest consumer of above-fold space is not the rows — it is the always-expanded filters
> card at 302px.** On 1080p it occupies *more vertical space than every visible row combined*. Any
> row-density work that ignores it leaves most of the win on the table. See §5.

### Width budget (for a column layout)

The sidebar is `w-64` and `lg:relative lg:flex-shrink-0`, so it takes 256px in flow.
Usable content width = `viewport − 256 − 48` → **1616px at 1920**, **2256px at 2560**.
Ample for 8 aligned columns; the constraint only bites below ~1280px total width.

---

## 2. The three options

Row heights use the same arithmetic as §1. "Rows visible" leaves the filters card as-is, so the
options are compared like-for-like.

### Option A — Tightened card, two header rows folded into one

Keeps the card affordance (`rounded-xl`, border, `hover:bg-white/5`, gap between rows).
`p-4` → `p-3`, `text-lg` → `text-sm font-medium`, `space-y-3` → `space-y-2`, icons `w-5` → `w-4`,
and Entity / Resource / User move inline as muted text on the title line.

- Card = 24 (padding) + 20 (one `text-sm` line) + 2 (border) = **46px**; + 8px gap = **54px pitch**.
- **1.96× denser.**

| Screen | Rows visible | vs today |
|---|---|---|
| 1920×1080 | **6** | +3 |
| 2560×1440 | **13** | +7 |

### Option B — True table with aligned columns and a sticky header ✅ recommended

`<table>` with `<thead class="sticky top-0">`, cells `px-3 py-2`, `text-sm`, `divide-y` between
rows. Columns: Severity · Time · Action (icon + label) · Entity · Resource · User · Flags · ⌄.
The expanded detail becomes a second `<tr>` with `<td colSpan={8}>` — **exactly the pattern
`app/admin/users/page.tsx:606-740` already uses**, so this introduces no new pattern.

- Row = 16 (padding) + 20 (`text-sm` line) + 1 (divider) = **37px pitch**; `<thead>` costs 33px once.
- **2.86× denser.**

| Screen | Rows visible | vs today |
|---|---|---|
| 1920×1080 | **8** | +5 |
| 2560×1440 | **18** | +12 |

Aligned columns are the real prize. Today the timestamp of row 1 and row 2 sit at different x
positions because the titles differ in length, so an admin cannot scan a column of times, users or
severities at all. A table turns "which of these 18 events was critical" into one vertical sweep.

### Option C — Ultra-compact single line

`px-3 py-1`, `text-xs` throughout, no card, `divide-y` only, severity reduced to a small badge,
compliance flags and entity type removed from the row.

- Row = 8 + 18 + 1 = **27px pitch**. **3.9× denser.**

| Screen | Rows visible | vs today |
|---|---|---|
| 1920×1080 | **12** | +9 |
| 2560×1440 | **26** | +20 |

---

## 3. What each option loses

The collapsed row carries nine things today: action icon, action label, severity badge, compliance
flags, timestamp, entity type, resource name, user identifier, chevron.

| | Option A | Option B | Option C |
|---|---|---|---|
| Action icon | kept (`w-4`) | kept (`w-4`, in the Action cell) | **dropped** — no room |
| Action label | kept, `text-sm` not `text-lg` | kept, `text-sm` | kept, `text-xs`, truncated |
| Severity badge (icon + word) | kept | kept, own 90px column — **better**, now scannable | shrunk to `text-xs`, still icon + word |
| Compliance flags | kept | first flag + `+N`; full list already in the expanded Compliance tile (`:700-705`) | **moved to expanded only** |
| Timestamp | kept, full | shortened to `Sep 23, 16:12:33`, full value in `<time dateTime>` + `title` | shortened, year dropped |
| Entity type | kept, inline muted | kept, own column — **better** | **moved to expanded only** |
| Resource name | truncates at narrow width | own flex column, `truncate` + `title` | hard truncate |
| User (email) | truncates | own column, `truncate` + `title` | truncated to local-part |

**Things an admin plausibly scans for that a denser layout would hide:**

- **Option C loses compliance flags from the row.** On a compliance browser, "show me the GDPR-
  flagged events" is a plausible visual scan and there is **no filter for it** — the only way to see
  a flag would be to expand every row. This is why C is not recommended despite the best numbers.
- **Option C loses entity type**, which is how an admin distinguishes an `ai_action` row from an
  `agent` row at a glance — directly against the point of Slice A.
- **Option B's flag truncation is recoverable** (the expanded view already renders the full list)
  and only bites on rows carrying 2+ flags, which is rare in practice.
- **Below ~1280px total width** Option B must hide the Flags and Entity columns or scroll
  horizontally. `hidden xl:table-cell` is the cleaner choice; both fields remain in the expanded
  view. Admin is a desktop surface, so this is an edge case, not the main path.

### Accessibility

Applies to whichever option ships:

- Severity is **never colour-only** in any option — the badge keeps its lucide icon *and* the word.
  Option B additionally gives it a labelled column header, which is an improvement on today.
- **Pre-existing defect worth fixing here:** the collapsed header is a `<div onClick=…>` with no
  `role`, no `tabIndex`, no keyboard handler and no `aria-expanded` (`page.tsx:615-617`). It is
  unreachable by keyboard today. Any option should add a real `<button aria-expanded aria-controls>`
  on the chevron while keeping the whole row mouse-clickable — the same gap exists in `admin/users`,
  so fixing it here sets the better precedent.
- Option B needs `scope="col"` on every `<th>` and an `sr-only` `<caption>`; the expanded `<tr>`
  needs an `id` matching the trigger's `aria-controls`.
- `title` attributes are not a screen-reader substitute — acceptable only because every truncated
  value is also rendered in full in the expanded row.

---

## 4. Density toggle — recommendation: **no**

Do not build a compact/comfortable toggle persisted in `localStorage`.

- One internal page, one user class (platform admins). There is no second audience whose needs
  differ.
- **No precedent:** `grep` finds zero `localStorage` preference reads anywhere under `app/admin/`.
  It would be a new pattern on the least-trafficked surface in the product.
- It doubles the test matrix. Slice A's `searchTotals.render.test.tsx` renders the real page; a
  toggle means every row-level assertion needs both states, plus a hydration-mismatch guard (server
  renders one density, `localStorage` says the other).
- The honest framing: a toggle is what you build when you cannot decide. One well-chosen density
  beats two mediocre ones, and if the chosen density turns out wrong, changing it is a one-line
  Tailwind edit — cheaper than maintaining the toggle forever.

**Build instead:** a page-size selector (§5), which is a genuine functional need rather than a
preference.

---

## 5. Interaction with what already exists

**Expand/collapse** — unchanged in all three options. `expandedLog` stays a single-id state; only
the container element changes (`<div>` → `<tr><td colSpan>` in Option B).

**The Slice A AI detail renderer and the AIS renderers** — all self-contained `<div>` blocks
(`page.tsx:684-980`). They move into the expanded cell verbatim; none assumes a card parent. The one
to eyeball is the normalization-refresh renderer at `:845`, which has `max-h-96 overflow-y-auto` —
valid inside a `<td>`, but worth a visual check.

**Page size** — the page hardcodes `useState(20)` at `:151`. **The route's own default is already
50** (`requestSchemas.ts:153`), so the page is actively asking for less than the API offers. At
Option B density a 1440p screen shows 18 rows, so a 20-row page is barely one screen — the pager
becomes the bottleneck instead of the scroll.

Recommend a **20 / 50 / 100 selector defaulting to 50**, with one caveat: `route.ts:124` fetches
`pageSize × 5` rows when a search term is active. That is 100 rows today, **250 at page size 50, 500
at 100**. 500 is where I would stop — hence 100 as the UI ceiling even though `MAX_ADMIN_PAGE_SIZE`
is 200 (which would mean a 1000-row in-memory fetch). This is a known limitation of the unfixed
search path (Slice A Non-Goal 2), not a new one.

**The filters card** — the highest-value change per line of code, and independent of which row
option is chosen. Collapsing it to a one-line summary bar (`Filters: AI Action · Critical · ⌄`)
frees **248px**:

| | Rows at 1080p, filters open | Rows at 1080p, filters collapsed |
|---|---|---|
| Today | 3 | 5 |
| Option A | 6 | 11 |
| **Option B** | **8** | **15** |
| Option C | 12 | 22 |

**Design-system alignment is out of scope.** This page uses raw Tailwind slate tokens rather than V2
tokens — but so do all ten other `app/admin/*` pages. It is conformant with its neighbours and
non-conformant with V2. Migrating `/admin` to V2 is a cross-cutting concern; doing it in one page
would make that page the odd one out. Likewise `components/ui/` has **no `table.tsx` primitive** —
Option B should follow the existing `admin/users` raw-table pattern. Adding a table primitive would
be a new pattern and needs SA review first.

---

## 6. Effort, risk, and where it ships

| | Effort | Risk | Test impact |
|---|---|---|---|
| **A** | ~1–2h | **Low** — typography and padding only, confined to `:614-680` | None. The guard test scans for `<option>` literals; the render test asserts on the count line and pager. Re-run, no edits. |
| **B** | ~4–6h | **Medium** — restructures the list container `:600-986`; the expanded block becomes `colSpan`. Mitigated by the `admin/users` precedent | Re-run `searchTotals.render.test.tsx` (queries by text, should pass unchanged). Worth adding 1–2 assertions that the expanded `<td colSpan>` renders the AI block exactly once — that invariant is Slice A's R-1.1 and a restructure is where it would silently break. |
| **C** | ~2–3h | Low technically, **high product risk** — drops two scannable compliance fields | Same as B. |

**Ship it separately, not folded into Slice A.**

- Slice A is SA-approved and QA-passed and sitting at the user-view gate. Folding a layout
  restructure in re-opens SA code review **and** the full QA pass on a slice with a 994-line
  workplan, and re-runs the T10/T11/T12 verification chain — the re-review cost exceeds the cost of
  a second cycle.
- They are different review lenses: Slice A is correctness and data exposure (Zod, error leak,
  honest totals, an allow-listed AI renderer); density is pure presentation.
- A density regression must not be able to hold up the AI-action filter, which **Gap B depends on**.

Suggested follow-up branch: `feature/admin-audit-row-density` (RM to cut), sequenced after Slice A
merges so it starts from the post-Slice-A `page.tsx`.

---

## 7. Recommendation

**Option B — the table — plus a collapsible filters card and a page-size selector defaulting to 50.**
Shipped as a separate slice after Slice A merges.

**8 rows at 1080p and 18 at 1440p with filters open; 15 and 25 with filters collapsed** — against 3
and 6 today. Nothing leaves the collapsed row except part of the compliance-flag list, which is
already in the expanded view. Severity and entity type become *more* scannable, not less, because
they gain aligned columns. It reuses a table-with-expanding-row pattern the repo already has, so
there is nothing new for SA to rule on.

Option A is the fallback if effort is the binding constraint: a genuine 2× for an hour or two with
zero test churn, but it does not deliver the column alignment that makes a compliance log scannable.
Option C is not recommended — it buys 4 more rows than B by hiding the two fields an auditor is most
likely to be scanning for.

### Mock — Option B collapsed row (illustrative, not to be pasted)

```tsx
<table className="w-full">
  <caption className="sr-only">Platform audit trail</caption>
  <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">
    <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
      <th scope="col" className="px-3 py-2 font-medium w-[90px]">Severity</th>
      <th scope="col" className="px-3 py-2 font-medium w-[150px]">Time</th>
      <th scope="col" className="px-3 py-2 font-medium w-[260px]">Action</th>
      <th scope="col" className="px-3 py-2 font-medium w-[130px] hidden xl:table-cell">Entity</th>
      <th scope="col" className="px-3 py-2 font-medium">Resource</th>
      <th scope="col" className="px-3 py-2 font-medium w-[240px]">User</th>
      <th scope="col" className="px-3 py-2 font-medium w-[110px] hidden xl:table-cell">Flags</th>
      <th scope="col" className="px-3 py-2 w-[44px]"><span className="sr-only">Expand</span></th>
    </tr>
  </thead>
  <tbody className="divide-y divide-slate-700/50 text-sm">
    <tr
      className={cn('cursor-pointer transition-colors hover:bg-white/5',
                    isExpanded && 'bg-slate-700/20')}
      onClick={() => toggle(log.id)}
    >
      {/* icon + word: never colour alone */}
      <td className="px-3 py-2">
        <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
                            severityClasses(log.severity))}>
          {getSeverityIcon(log.severity, 'w-3.5 h-3.5')}
          <span className="capitalize">{log.severity}</span>
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-400">
        <time dateTime={log.created_at} title={formatDate(log.created_at)}>
          {formatDateShort(log.created_at)}
        </time>
      </td>
      <td className="px-3 py-2">
        <span className="flex items-center gap-2">
          {getActionIcon(log.action, 'w-4 h-4')}
          <span className="truncate font-medium text-white">{getActionLabel(log.action)}</span>
        </span>
      </td>
      <td className="px-3 py-2 hidden xl:table-cell text-slate-400">{log.entity_type}</td>
      <td className="px-3 py-2 max-w-0">
        <span className="block truncate text-slate-300"
              title={log.resource_name || log.entity_id}>
          {log.resource_name || log.entity_id}
        </span>
      </td>
      <td className="px-3 py-2 max-w-0">
        <span className="block truncate text-slate-400" title={userLabel(log)}>
          {userLabel(log)}
        </span>
      </td>
      <td className="px-3 py-2 hidden xl:table-cell">{/* first flag + "+N" */}</td>
      <td className="px-3 py-2">
        {/* the keyboard-reachable control the current card lacks entirely */}
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={`audit-detail-${log.id}`}
          onClick={(e) => { e.stopPropagation(); toggle(log.id); }}
          className="rounded p-1 text-slate-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <span className="sr-only">
            {isExpanded ? 'Collapse' : 'Expand'} {getActionLabel(log.action)} details
          </span>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </td>
    </tr>

    {isExpanded && (
      <tr id={`audit-detail-${log.id}`} className="bg-slate-900/50">
        <td colSpan={8} className="px-6 py-6">
          {/* existing :684-980 detail blocks move here verbatim */}
        </td>
      </tr>
    )}
  </tbody>
</table>
```

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-23 | Created | Measured current density; three options proposed; Option B recommended as a follow-up slice after Slice A merges |
