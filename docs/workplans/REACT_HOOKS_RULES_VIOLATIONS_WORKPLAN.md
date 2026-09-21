# Workplan: Fix the 14 `react-hooks/rules-of-hooks` Violations

> **Last Updated**: 2026-09-21

## Overview

`npx eslint app lib components` reports **14 `react-hooks/rules-of-hooks` errors**. They became
visible on 2026-09-20 when PR #76 deleted a shadow `eslint.config.js` that caused ESLint 9 to load
an eslintrc-shaped file under a flat-config filename, so `npm run lint` checked almost nothing.
**The violations are pre-existing, not a regression introduced by PR #76.**

This workplan diagnoses each of the 14 sites, separates the ones that are purely a naming problem
from the ones that are a real React problem, and states — per site — whether the fix changes runtime
behaviour. **"Lint is green" is not the goal**; not breaking agent creation, the V6 pipeline, the
Business OS refund flow or the public booking flow is.

| Field | Value |
|---|---|
| **Developer** | Dev |
| **Requirement** | None — no BA requirement MD exists (see [Open Question SA-0](#open-questions-for-sa)). Origin: PR #76 (`chore/eslint-config-cleanup`). |
| **Branch** | `fix/react-hooks-violations` (cut from `origin/main` @ `47bef914`) |
| **Worktree** | `.claude/worktrees/eslint-cleanup` |
| **Date** | 2026-09-20 (implemented 2026-09-21) |
| **Status** | **Code Complete** — SA-approved with conditions R-1…R-8, all applied. Gates V1, V2, V3, V6 **pass**; V4 static half passes, V4 runtime half + V5 are **QA-owed** (need a running app). **Uncommitted** — RM commits, keeping the five-commit split (gate V2 depends on it). |

---

## Table of Contents

1. [Evidence: the live lint run](#1-evidence-the-live-lint-run)
2. [Diagnosis part 1 — the seven feature-flag functions](#2-diagnosis-part-1--the-seven-feature-flag-functions)
3. [Diagnosis part 2 — the real React violations](#3-diagnosis-part-2--the-real-react-violations)
4. [Call-site inventory and blast radius](#4-call-site-inventory-and-blast-radius)
5. [Implementation approach](#5-implementation-approach)
6. [Files to create / modify](#6-files-to-create--modify)
7. [Runtime-behaviour risk register](#7-runtime-behaviour-risk-register)
8. [Test plan](#8-test-plan)
9. [Task list](#9-task-list)
10. [Open questions for SA](#open-questions-for-sa)
11. [Out of scope](#11-out-of-scope)
12. [SA Review Notes](#sa-review-notes)
13. [QA Testing Report](#qa-testing-report)
14. [Commit Info](#commit-info)
15. [Change History](#change-history)

---

## 1. Evidence: the live lint run

Run in the worktree on 2026-09-20 against `47bef914`:

```bash
npx eslint app lib components -f json -o eslint.json
# → 9109 problems (177 errors, 8932 warnings)
```

Error breakdown by rule (severity 2 only):

| Rule | Count |
|---|---|
| `prefer-const` | 79 |
| `@typescript-eslint/no-require-imports` | 64 |
| **`react-hooks/rules-of-hooks`** | **14** |
| `@typescript-eslint/ban-ts-comment` | 8 |
| `react/jsx-no-duplicate-props` | 6 |
| `@typescript-eslint/no-empty-object-type` | 3 |
| `react/display-name` | 2 |
| `@typescript-eslint/no-unsafe-function-type` | 1 |

Only the 14 `rules-of-hooks` errors are in scope. The exact 14:

| # | Location | Message shape |
|---|---|---|
| 1 | `lib/utils/featureFlags.ts:158:34` | `useThreadBasedAgentCreation` called in `getFeatureFlags` (not a component/hook) |
| 2 | `lib/utils/featureFlags.ts:159:28` | `useNewAgentCreationUI` — same |
| 3 | `lib/utils/featureFlags.ts:160:27` | `useV6AgentGeneration` — same |
| 4 | `lib/utils/featureFlags.ts:161:22` | `useV6ReviewMode` — same |
| 5 | `lib/utils/featureFlags.ts:162:40` | `useMoveToCalibrationAfterCreation` — same |
| 6 | `lib/utils/featureFlags.ts:163:21` | `useAIDataLayer` — same |
| 7 | `lib/utils/featureFlags.ts:164:31` | `useBusinessDeleteSurface` — same |
| 8 | `app/v2/agents/new/page.tsx:1287:21` | `useV6AgentGeneration` called in `createAgent` |
| 9 | `app/v2/agents/new/page.tsx:1629:11` | `useMoveToCalibrationAfterCreation` called in `executeAgentCreation` |
| 10 | `app/v2/agents/new/page.tsx:2587:18` | `useMoveToCalibrationAfterCreation` called conditionally (in JSX) |
| 11 | `components/agent-creation/AgentBuilderParent.tsx:515:20` | `useNewAgentCreationUI` called conditionally (after early returns) |
| 12 | `components/payments/RefundModal.tsx:308:3` | `useEffect` called conditionally |
| 13 | `components/payments/RefundModal.tsx:319:3` | `useEffect` called conditionally |
| 14 | `components/website/blocks/ProcessFlowSection.tsx:1564:5` | `useEffect` called conditionally |

**Sites 1–11 (eleven of the fourteen) are one root cause**: seven plain functions wear a `use`
prefix. **Sites 12–14 (three) are real React violations.**

---

## 2. Diagnosis part 1 — the seven feature-flag functions

### 2.1 Verdict: all seven are misnamed plain functions. None is a React hook.

Source evidence from `lib/utils/featureFlags.ts` (@ `47bef914`). Every one of the seven has the
identical body shape: read `process.env.NEXT_PUBLIC_*`, optionally `clientLogger.debug(...)`,
return `parseBooleanFlag(value, default)`.

| # | Function | Line | Reads `process.env` | Calls a real hook (`useState`/`useEffect`/`useContext`/`useMemo`/`useRef`/`useReducer`) | React import in file | Verdict |
|---|---|---|---|---|---|---|
| 1 | `useThreadBasedAgentCreation` | 18 | `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` | No | No | **Not a hook** |
| 2 | `useNewAgentCreationUI` | 38 | `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` | No | No | **Not a hook** |
| 3 | `useV6AgentGeneration` | 53 | `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` | No | No | **Not a hook** |
| 4 | `useV6ReviewMode` | 74 | `NEXT_PUBLIC_USE_V6_REVIEW_MODE` (default `true`) | No | No | **Not a hook** |
| 5 | `useMoveToCalibrationAfterCreation` | 91 | `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION` (default `false`) | No | No | **Not a hook** |
| 6 | `useAIDataLayer` | 116 | `NEXT_PUBLIC_USE_AI_DATA_LAYER` (default `false`) | No | No | **Not a hook** |
| 7 | `useBusinessDeleteSurface` | 151 | `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` | No | No | **Not a hook** |

Supporting evidence:

- **The module imports no React at all.** `lib/utils/featureFlags.ts` has exactly two imports:
  `clientLogger` from `@/lib/logger/client` and `parseBooleanFlag` from `@/lib/utils/parseBooleanFlag`.
  A file with zero React imports cannot contain a React hook.
- **`parseBooleanFlag` is a pure function** in a deliberately zero-import module
  (`lib/utils/parseBooleanFlag.ts`, extracted under C-33 precisely so server code could share it).
  It does string normalisation and returns a boolean.
- **`clientLogger` is a three-line re-export** of the same Pino instance the server uses
  (`lib/logger/client.ts`). Not React state.
- **They are already called from non-React contexts today** and work: `getFeatureFlags()` (a plain
  function), and `app/v2/agents/new/page.tsx:1287` / `:1629` inside async event handlers. If any of
  them were a real hook, those calls would already be throwing
  `Invalid hook call` / `Rendered more hooks than during the previous render`. Nothing crashes,
  which corroborates the static reading.

**Conclusion:** the `use` prefix is a naming accident (very likely copied from the
`docs/FEATURE_FLAGS.md` authoring template — see §5.4), not a semantic claim. The `react-hooks`
plugin is a *lexical* rule: it decides "is this a hook?" from the identifier, so it is flagging
eleven false positives that are nonetheless real *naming* defects. Renaming is therefore the
correct fix, and it is a **pure rename with no runtime semantics change** (same function object,
same body, same call order — only the binding name differs).

### 2.2 Proposed names

Prefix `is…Enabled`, matching the existing non-hook-named precedent in this repo:
`isBusinessDeleteSurfaceEnabled()` in `lib/business-os/purge/purgeAuthz.ts:61` — which already reads
the *same* `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` flag through `parseBooleanFlag` without a `use`
prefix. The codebase has already chosen this convention once; this aligns the rest with it.

| Old | New |
|---|---|
| `useThreadBasedAgentCreation` | `isThreadBasedAgentCreationEnabled` |
| `useNewAgentCreationUI` | `isNewAgentCreationUIEnabled` |
| `useV6AgentGeneration` | `isV6AgentGenerationEnabled` |
| `useV6ReviewMode` | `isV6ReviewModeEnabled` |
| `useMoveToCalibrationAfterCreation` | `isMoveToCalibrationAfterCreationEnabled` |
| `useAIDataLayer` | `isAIDataLayerEnabled` |
| `useBusinessDeleteSurface` | `isBusinessDeleteSurfaceEnabled` |

⚠️ **Name collision to resolve.** `isBusinessDeleteSurfaceEnabled` already exists in
`lib/business-os/purge/purgeAuthz.ts:61`. These are two *deliberately separate* readers of one env
var: the purge one is an **authorization** gate that must not import the client dependency graph
(documented at length in `lib/utils/parseBooleanFlag.ts:1-19` and in the JSDoc at
`featureFlags.ts:128-150`, which explicitly says *"Do not 'simplify' `authorizePurge` to call this
hook"*). They must stay separate modules. Since they live in different modules there is no compile
error, but the identical name invites exactly the merge the comments forbid. See
[Open Question SA-3](#open-questions-for-sa).

### 2.3 Backwards-compatible aliases: recommend a **clean break**

| Option | Assessment |
|---|---|
| **A. Clean break** (delete old names) — **recommended** | The old name is the defect. Keeping it keeps the lint error, because the *export declaration* `export const useX = isXEnabled` still trips `rules-of-hooks` at every call site that uses it, and the alias would be a permanent invitation to re-introduce them. The full call-site set is small and fully enumerated (§4). |
| **B. Deprecated aliases** | Would leave the 11 errors in place unless every caller also migrated — i.e. all the work of A plus dead exports. Only justified if there were out-of-repo consumers. There are none: this is a private Next.js app with no published package surface. |

**Recommendation: clean break, single atomic rename, no aliases.** Confirmation requested from SA.

### 2.4 Does any call site rely on React semantics?

Checked every one of the nine production call sites (§4.1). **No.** Specifically:

- No call site's result is used as a dependency of `useEffect`/`useMemo`/`useCallback` in a way that
  assumes render-stable identity. The return is a `boolean` primitive, and `process.env.NEXT_PUBLIC_*`
  is inlined at build time by Next.js — so the value is **constant for the lifetime of the bundle**.
- The two call sites inside real custom hooks (`useThreadManagement.ts:55`,
  `useConversationalBuilder.ts:57`) call it unconditionally at hook top level. That placement is
  *currently* what keeps them lint-clean; after the rename the calls remain valid (a plain function
  call inside a hook is always legal) and their position no longer matters. **No behaviour change.**
- `app/v2/agent-list/page.tsx:167` calls it at component top level and assigns to
  `calibrationGateOn`. After the rename this is a plain const from a build-time constant. **No
  behaviour change.**

---

## 3. Diagnosis part 2 — the real React violations

### 3.1 `components/payments/RefundModal.tsx:308` and `:319` — genuine, currently **latent**

**What the file looks like.** `RefundModal` declares ~14 `useState`, one `useRef`, then three
`useEffect`s. Then:

```tsx
  if (!isOpen) return null;      // line 233
```

…followed by derived consts (`BLOCK_MESSAGES`, `blockMessage`, `isGroup`, `maxRefundable`,
`effectiveType`, `canOfferDelete`) and then **two more `useEffect`s**:

| Line | Effect | Purpose (from its own comment) |
|---|---|---|
| 308 | `useEffect(() => { if (!canOfferDelete && deleteBooking) setDeleteBooking(false); }, [canOfferDelete, deleteBooking])` | Disarm a hidden switch: `deleteBooking` used to keep its value when the control disappeared, so **a partial refund could delete the booking**. |
| 319 | `useEffect(() => { if (deleteBooking && livePlan && !stopPlan) setStopPlan(true); }, [deleteBooking, livePlan, stopPlan])` | Deleting a booking that still has a live payment plan **must** stop the plan, or the client keeps being charged for an appointment that no longer exists. |

Both guard money-affecting behaviour. That is why this site matters more than the others.

**What the early return skips.** Every render where `isOpen === false` runs 18 hooks; every render
where `isOpen === true` runs 20. React throws
`Rendered fewer hooks than expected. This may be caused by an accidental early return statement.`
on a **mounted** component whose hook count shrinks between renders — i.e. on a `true → false`
transition of `isOpen` while the component stays mounted.

**Why it is not crashing today — verified at all five mount sites:**

| Mount site | Pattern | Can render mounted with `isOpen === false`? |
|---|---|---|
| `components/crm/contact-drawer/PaymentsSection.tsx:531` | `{refundEntry && <RefundModal isOpen={!!refundEntry} …>}` | **No** — `isOpen` is `true` by construction whenever mounted; closing unmounts. |
| `components/payments/MoneyList.tsx:654` | `{refundTarget && <RefundModal isOpen={!!refundTarget} …>}` | **No** — same. |
| `components/payments/PaymentInvoiceList.tsx:1118` | `{refundTarget && <RefundModal isOpen={!!refundTarget} …>}` | **No** — same. |
| `components/payments/PaymentTransactionList.tsx:1051` | `{selectedTransaction && <RefundModal isOpen={refundModalOpen} …>}` | **Not currently** — `isOpen` is an independent state, but the *only* writer of `false` (line 1054) sets `setSelectedTransaction(null)` on the very next line (1055). React batches both, so the modal unmounts in the same commit rather than re-rendering with `isOpen=false`. **One unpaired `setRefundModalOpen(false)` anywhere would crash this.** |
| `components/crm/contact-drawer/PaymentManagementModal.tsx:382` | `if (view === 'refund' && canRefund) return <RefundModal isOpen={isOpen} …>` — and `PaymentManagementModal` is itself **unconditionally mounted** by `CRMContactDrawerV2.tsx:2993` | **Not currently** — the parent's `onClose` (`CRMContactDrawerV2.tsx:2995-2998`) sets `setShowPaymentModal(false)` *and* `setSelectedBookingForPayment(null)` together; the `null` booking makes `PaymentManagementModal` bail at its own `if (!booking ‖ !paymentData) return null` (line 155), which is *before* the RefundModal branch — so RefundModal unmounts. Same for `onBookingDeleted` (3003-3007). Again: the two updates being paired is load-bearing and undocumented. |

**Verdict: a real violation, currently latent, held off only by an accidental invariant at five
independent call sites.** It is one refactor — anyone splitting a `setState` pair, or adding
`<RefundModal isOpen={x}>` unconditionally as is already the style in `PaymentManagementModal` — away
from a white-screen crash in the Business OS payments UI. It should be fixed.

**Correct placement.** Hoist both effects above `if (!isOpen) return null;`, and hoist the single
const they depend on. `canOfferDelete` is a one-line prop alias (`const canOfferDelete =
showDeleteBookingOption;`), so hoisting it is trivial and side-effect free. All other state the two
effects read (`deleteBooking`, `livePlan`, `stopPlan`) is already declared above the early return.
Effect bodies and dependency arrays stay **byte-identical**.

**Does behaviour change?** In the current mount topology, **no** — proven above that no render ever
occurs with the component mounted and `isOpen === false`, so the two effects run on exactly the same
set of renders before and after. For robustness after the fix (when a future caller *does* render it
closed), both effects are already internally guarded and idempotent:

- Effect@308 on a closed render would set `deleteBooking` to `false` when the delete option is not
  offered — which is the desired resting state anyway.
- Effect@319 on a closed render is inert. ⚠️ **Corrected per SA R-1** — the original wording here
  said this was "because the existing reset effect sets `livePlan = null` and `stopPlan = false`",
  which is the wrong mechanism. On the commit where `isOpen` flips `true → false`, effect@319's
  deps (`deleteBooking`, `livePlan`, `stopPlan`) have not changed, so **it does not re-run in that
  commit at all**. It re-runs only on the *following* commit, by which time the reset effect's
  writes have landed and its guard is false. The conclusion (inert) holds; the dependency array is
  what makes it so, not the reset.

No extra `if (!isOpen) return;` guard is needed, and adding one would be misleading. SA confirmed
this reading (SA-4) — see [Open Question SA-4](#open-questions-for-sa).

**R-1 gap closed.** Tracing the above exposed that the reset effect cleared `stopPlan`, `livePlan`,
`showStopPlan` and `blockedProcessor` but **not `deleteBooking`** — the one flag that deletes a
customer's booking. Harmless while every caller unmounts on close, but the whole point of this fix
is to make the component correct for the mounted-and-closed render. `setDeleteBooking(false)` was
added to that reset effect with a comment explaining why.

### 3.2 `components/website/blocks/ProcessFlowSection.tsx:1564` — genuine, but in **dead code**

```tsx
function IntakeStep({ fields, /* … */ onSubmit }: IntakeStepProps) {
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSubmit(); };

  if (fields.length === 0) {
    // No intake fields configured - auto-proceed
    useEffect(() => { onSubmit(); }, []);     // ← line 1564
    return null;
  }
  // …
}
```

A textbook violation: a `useEffect` inside an `if` before an early return. But the branch is
**unreachable**. The only render site is `ProcessFlowSection.tsx:2729`:

```tsx
{currentStep === 'intake' && !intakeTemplate && intake_fields.length > 0 && (
  <IntakeStep fields={intake_fields} … />
)}
```

`IntakeStep` is mounted only when `intake_fields.length > 0`, and `fields` is passed straight through
from `intake_fields`. So `fields.length === 0` can never be true inside the component, the `useEffect`
never runs, and the hook count never varies. This is the public booking/intake flow, so a crash here
would be customer-facing — but there is no live defect.

Two candidate fixes, both zero-behaviour-change *today*:

| Option | Change | Trade-off |
|---|---|---|
| **A. Delete the dead branch** | Remove the `if (fields.length === 0) { … }` block; add a comment at `:2729` recording that the `intake_fields.length > 0` guard is what makes the component's non-empty assumption safe. | Smallest, honest diff. Removes a defensive fallback that never fired — and if the guard at `:2729` is ever relaxed, `IntakeStep` would render an empty form instead of auto-proceeding. |
| **B. Hoist the effect** | `const noFields = fields.length === 0;` then an unconditional `useEffect` that fires `onSubmit()` once when `noFields`, guarded by a `useRef` so it cannot re-fire; then `if (noFields) return null;`. | Preserves the intent. But `onSubmit` is `handleIntakeSubmit`, not memoised, so it must be kept out of the dep array (or ref-latched) — i.e. deliberately writing a stale-closure effect, which is its own smell. Also *activates* code that has never run in production. |

**Recommendation: A (delete).** It is the only option with no new untested code path. B resurrects a
never-executed auto-submit on the public booking flow, which is a worse risk than the dead code.
SA decision — [Open Question SA-5](#open-questions-for-sa).

### 3.3 `app/v2/agents/new/page.tsx:1287`, `:1629`, `:2587` and `AgentBuilderParent.tsx:515`

All four are consequences of §2 and are fixed **by the rename alone** — no structural change.

| Site | Context | After rename |
|---|---|---|
| `page.tsx:1287` | `const useV6 = useV6AgentGeneration()` inside async `createAgent` | Plain function call in an async handler — legal, already correct. |
| `page.tsx:1629` | `if (useMoveToCalibrationAfterCreation())` inside async `executeAgentCreation` | Same. |
| `page.tsx:2587` | `{useMoveToCalibrationAfterCreation() && (() => { … })()}` in JSX | Plain function call in render — legal. Value is a build-time constant, so no render-order concern. |
| `AgentBuilderParent.tsx:515` | `const useNewUI = useNewAgentCreationUI();` after two early returns (`!isInitialized`, `shouldShowSmartBuilder`) | Legal. Note: the local variable `useNewUI` also starts with `use` but is never *called*, so it is not flagged; renaming it to `showNewUI` is optional tidy-up. |

⚠️ Note the shape of `page.tsx:1287` / `:1629`: reading a feature flag *inside* an async submit
handler. Since the flag is a build-time constant this is behaviourally identical to reading it at
module scope, so the rename is safe. It is not a hook-order problem in disguise.

---

## 4. Call-site inventory and blast radius

### 4.1 Complete production call-site inventory (the rename's full surface)

Generated with:

```bash
grep -rn "useThreadBasedAgentCreation\|useNewAgentCreationUI\|useV6AgentGeneration\|useV6ReviewMode\|useMoveToCalibrationAfterCreation\|useAIDataLayer\|useBusinessDeleteSurface\|getFeatureFlags" \
  --include=*.ts --include=*.tsx app lib components hooks scripts tests types
```

**Definitions — `lib/utils/featureFlags.ts`:** lines 18, 38, 53, 74, 91, 116, 151 (the seven),
156 (`getFeatureFlags`), 158–164 (the seven self-calls).

**Imports + calls — 6 files, 9 call sites:**

| # | File | Import line | Call line | Flag | Feature gated | If broken |
|---|---|---|---|---|---|---|
| 1 | `app/v2/agents/new/page.tsx` | 48 | **1287** | `useV6AgentGeneration` | V6 vs V4 generation pipeline | Agent creation silently falls back to the **dormant V4 path** |
| 2 | `app/v2/agents/new/page.tsx` | 48 | **1629** | `useMoveToCalibrationAfterCreation` | post-creation calibration choice | Reverts to auto-redirect |
| 3 | `app/v2/agents/new/page.tsx` | 48 | **2587** | `useMoveToCalibrationAfterCreation` | left-rail "Step 8" card | Step 8 disappears |
| 4 | `app/v2/agent-list/page.tsx` | 10 | **167** | `useMoveToCalibrationAfterCreation` | `calibrationGateOn` | Calibration gate off in the list |
| 5 | `components/agent-creation/AgentBuilderParent.tsx` | 16 | **515** | `useNewAgentCreationUI` | V2 vs legacy conversational builder | Users get the **legacy** builder |
| 6 | `components/agent-creation/conversational/hooks/useThreadManagement.ts` | 11 | **55** | `useThreadBasedAgentCreation` | thread-based creation | Falls back to legacy flow |
| 7 | `components/agent-creation/useConversationalBuilder.ts` | 14 | **57** | `useThreadBasedAgentCreation` | thread-based creation | Falls back to legacy flow |
| 8–9 | `lib/utils/__tests__/featureFlags.test.ts` | `require()` @ 29–337 | ~60 assertions | all 7 + `getFeatureFlags` | — | Tests fail loudly |

**Three of the seven have ZERO production call sites** — they are only reachable through
`getFeatureFlags()` and the test file:

| Flag | Production callers | Note |
|---|---|---|
| `useV6ReviewMode` | **none** | Documented in CLAUDE.md as "default: true"; the V6 review split is presumably now unconditional. **Flag may be dead** — see [SA-6](#open-questions-for-sa). |
| `useAIDataLayer` | **none** | `app/api/business-os/chat-v2/route.ts:67` reads `process.env.NEXT_PUBLIC_USE_AI_DATA_LAYER === 'true'` **directly**, bypassing this helper *and* `parseBooleanFlag` — so `=1`/`=TRUE` behave differently there than everywhere else. Pre-existing inconsistency; flagging, not fixing. |
| `useBusinessDeleteSurface` | **none** | Superseded in practice by `isBusinessDeleteSurfaceEnabled()` in `lib/business-os/purge/purgeAuthz.ts:61`, which reads the same env var via its own zero-import path **by design** (C-33 / T30). |

**`getFeatureFlags()` has no production consumer at all** — only the test file. It is a debug helper.

### 4.2 Blast radius

The flags gate: **agent creation** (V6-vs-V4 pipeline, thread-based flow, V2-vs-legacy builder UI),
**post-creation calibration**, and the **Business OS delete surface**. A wrong rename could flip any
of them.

**How a wrong rename could go undetected — this is the central risk, and CI will not catch it:**

- `next.config.js` sets `typescript.ignoreBuildErrors: true` **and** `eslint.ignoreDuringBuilds: true`.
- The only CI gate on this change is `.github/workflows/build.yml` → `npm run build`.
- **Therefore `npm run build` passing proves nothing about a missed rename.** A stale
  `import { useV6AgentGeneration }` would compile, bundle as `undefined`, and only fail at runtime.

Two distinct failure modes:

| Mode | Mechanism | Detectability |
|---|---|---|
| **Loud** | Stale *named import* of a deleted export → binding is `undefined` → `TypeError: useV6AgentGeneration is not a function` when the handler runs. | Crashes on use. Bad, but visible. |
| **Silent — the dangerous one** | *Property* access on the `getFeatureFlags()` result (`flags.useV6AgentGeneration`) after the object's **keys** are renamed → `undefined` → falsy → **the feature is silently off, no error**. | Invisible. |

The silent mode is currently closed only because `getFeatureFlags()` has no production consumer.
That makes the object's key naming a real decision, not cosmetics — see
[SA-2](#open-questions-for-sa).

**Mitigations (mandatory, in the task list):**

1. Run `tsc` explicitly as its own gate, not via `npm run build`. ⚠️ **`npx tsc --noEmit` currently
   OOMs** on this repo (V8 heap crash, reproduced in the worktree). Use
   `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` and **compare the error list before and
   after** the rename — the baseline is not clean, so a raw exit code is not a signal.
2. After renaming, `grep -rn` for each of the seven **old** identifiers across `app lib components
   hooks scripts tests types docs` and require **zero** hits outside intentionally historical
   documentation.
3. Re-run `npx eslint app lib components` and confirm the `rules-of-hooks` count is exactly **0**,
   with the other error counts (79 / 64 / 8 / 6 / 3 / 2 / 1) **unchanged**.
4. QA manually exercises each gated feature with the flag on and off (§8.3).

---

## 5. Implementation approach

Five independent commits so SA/QA can review and, if needed, revert each fix on its own merits.
The riskiest change (RefundModal) is isolated.

### 5.1 Commit 1 — rename the seven flag readers (sites 1–11)

Atomic: rename the seven exports in `lib/utils/featureFlags.ts`, update all 7 production call sites
across 6 files, update the test file. Clean break, no aliases (§2.3, pending SA-1).

### 5.2 Commit 2 — `RefundModal` (sites 12–13)

Hoist `const canOfferDelete = showDeleteBookingOption;` and both `useEffect`s above
`if (!isOpen) return null;`. Effect bodies and dep arrays unchanged. Add a short comment recording
*why* they must stay above the early return, so the next editor does not move them back.

### 5.3 Commit 3 — `ProcessFlowSection` (site 14)

Per SA-5: delete the unreachable branch (recommended) or hoist with a ref latch.

### 5.4 Commit 4 — documentation

| Doc | What changes |
|---|---|
| `CLAUDE.md` § Feature Flags (lines ~489–512) | Code sample + the 4-row flag table name all four old identifiers. Update. **CLAUDE.md is the user's configuration file — Dev must not edit it unilaterally; request explicit user approval for this hunk** ([SA-7](#open-questions-for-sa)). |
| `docs/FEATURE_FLAGS.md` (643 lines) | ~20 references across §§ for each flag, plus the `getFeatureFlags` sample at 596–599. **Most important: the "add a new flag" template at lines 541 and 579 literally instructs `export function useFeatureFlag()` / `useMyNewFeature()`.** That template is the likely origin of all seven misnamings and will regenerate the bug unless changed. Add a "why not `use…`" note. |

`archive/CLAUDE_BACKUP_1406.md` is a historical snapshot — **do not edit**.

### 5.5 Commit 5 — a guard so this cannot silently return

`rules-of-hooks` is only enforced by `npx eslint`, which **no CI job runs** (`npm run lint` is not in
any workflow, and `next build` ignores ESLint). So this fix has no regression protection. Options in
[SA-8](#open-questions-for-sa); the cheapest is a Jest source-level guard in the style of the existing
`lib/__tests__/system-initializer-removed.guard.test.ts`, asserting that `lib/utils/featureFlags.ts`
exports no `use`-prefixed function.

---

## 6. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/utils/featureFlags.ts` | modify | Rename 7 exports + the 7 keys/calls in `getFeatureFlags` (sites 1–7) |
| `app/v2/agents/new/page.tsx` | modify | Import @48; calls @1287, @1629, @2587 (sites 8–10) |
| `app/v2/agent-list/page.tsx` | modify | Import @10; call @167 |
| `components/agent-creation/AgentBuilderParent.tsx` | modify | Import @16; call @515 (site 11) |
| `components/agent-creation/conversational/hooks/useThreadManagement.ts` | modify | Import @11; call @55 |
| `components/agent-creation/useConversationalBuilder.ts` | modify | Import @14; call @57 |
| `lib/utils/__tests__/featureFlags.test.ts` | modify | ~60 assertions across 342 lines reference the old names |
| `components/payments/RefundModal.tsx` | modify | Hoist 2 effects + 1 const above the early return (sites 12–13) |
| `components/website/blocks/ProcessFlowSection.tsx` | modify | Remove (or hoist) the dead `useEffect` @1564 (site 14) |
| `CLAUDE.md` | modify | § Feature Flags names 4 of the 7 — **needs explicit user approval** |
| `docs/FEATURE_FLAGS.md` | modify | ~20 references + the flag-authoring template that caused this |
| `lib/utils/__tests__/featureFlags.naming.guard.test.ts` | **create** | Regression guard (pending SA-8) |

**Not modified:** `lib/business-os/purge/purgeAuthz.ts` and `lib/utils/parseBooleanFlag.ts` — both
carry explicit comments forbidding the coupling a "tidy-up" here would create.

---

## 7. Runtime-behaviour risk register

Separated from lint outcomes on purpose. **Green lint is not the acceptance criterion.**

| # | Site | Does runtime behaviour change? | Risk | Mitigation |
|---|---|---|---|---|
| R1 | featureFlags rename | **No** — identical function bodies; `process.env.NEXT_PUBLIC_*` is build-time-inlined, so values are bundle constants. | 🟡 A *missed* call site flips a feature (§4.2). CI cannot catch it. | Explicit `tsc` w/ raised heap + old-name grep + QA flag matrix |
| R2 | `getFeatureFlags()` **keys** | Only if keys are renamed **and** a consumer reads them by name. No production consumer exists today. | 🟢 today / 🔴 if a consumer is added later | SA-2 decision; test file updated in the same commit |
| R3 | `RefundModal` hoist | **No** in the current mount topology (proved: no mount site renders it with `isOpen === false`). Removes a latent crash. | 🟡 Money-affecting effects (delete-booking disarm, plan-stop force). A mistake here could let a partial refund delete a booking, or refund without stopping a live plan. | Byte-identical effect bodies + dep arrays; QA scenarios §8.3 |
| R4 | `ProcessFlowSection` delete | **No** — branch is unreachable (`:2729` guard). | 🟢 if deleted / 🟡 if hoisted (option B activates a never-executed auto-submit on the **public** booking flow) | Prefer option A |
| R5 | `AgentBuilderParent:515` | **No** — plain call, same position. | 🟢 | — |
| R6 | `agents/new:1287/1629` | **No** — build-time constant read inside async handlers. | 🟢 | — |
| R7 | Import churn across 6 files | Editor-assisted rename could touch unrelated symbols (e.g. the local `useNewUI`, `useV6`, `useThreadFlow` variables). | 🟡 | Manual edits only — **no IDE project-wide rename**; review `git diff --stat` line counts against the expected 9 call sites |
| R8 | ⚠️ **`console.*` in touched files** | Converting them would be a large behaviour-adjacent diff in a lint-only change. | 🟡 | Flagged below; **recommend a separate branch** |

### 7.1 Logging-standard exception request (CLAUDE.md mandatory rule 3)

CLAUDE.md requires that a file touched with `console.*` logging be flagged and converted to Pino.
Counts in the files this workplan touches:

| File | `console.*` calls |
|---|---|
| `components/agent-creation/useConversationalBuilder.ts` | **103** |
| `app/v2/agents/new/page.tsx` | **49** |
| `components/agent-creation/AgentBuilderParent.tsx` | **24** |
| `components/agent-creation/conversational/hooks/useThreadManagement.ts` | **15** |
| `components/website/blocks/ProcessFlowSection.tsx` | **5** |
| `app/v2/agent-list/page.tsx` | **3** |
| `lib/utils/featureFlags.ts` | 0 ✅ |
| `components/payments/RefundModal.tsx` | 0 ✅ |
| **Total** | **199** |

**Flagged as required.** Converting 199 call sites would turn a ~40-line lint fix into a ~400-line
diff spanning the entire agent-creation UI, and would bury the hook changes SA needs to review — in
files where `next build` would not catch a mistake.

**Proposal:** convert them on a **separate `fix/console-to-pino-agent-creation` branch**, reviewed on
its own. **This is the user's call, not mine** — see [SA-9](#open-questions-for-sa). If the user
wants them converted in-branch, I will.

---

## 8. Test plan

Per CLAUDE.md § Testing: **E2E does not exist in this repo** — Playwright is not installed, there is
no `e2e/` folder and no `test:e2e` script. So: **Jest where it fits, plus a recorded manual QA pass**
for the UI paths.

### 8.1 Automated — Jest

| Test | File | Covers |
|---|---|---|
| Existing flag suite, renamed | `lib/utils/__tests__/featureFlags.test.ts` | All 7 readers: unset / `'true'` / `'false'` / `'1'` / `'0'` / whitespace / garbage / defaults (`useV6ReviewMode` → `true`, calibration → `false`) — happy **and** failure paths already present across 342 lines. Must pass unchanged in *semantics*; only identifiers change. |
| **New** naming guard | `lib/utils/__tests__/featureFlags.naming.guard.test.ts` | Reads `lib/utils/featureFlags.ts` as source; asserts no exported function name matches `/^use[A-Z]/`. Prevents silent reintroduction (SA-8). |
| Full suite | `npm test` | Confirms no collateral damage. Record pass/fail counts **before and after** — the baseline may not be green. |

⚠️ **Not unit-testable:** the two `RefundModal` effects and the `ProcessFlowSection` change. There is
no React Testing Library / jsdom component-test setup in this repo (adding one is a new tooling
pattern and would need its own SA review — out of scope here). These are covered by §8.3.

### 8.2 Static verification gates

```bash
npx eslint app lib components -f json -o eslint.json   # rules-of-hooks must be 0; other error counts unchanged
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit # diff against baseline (plain tsc --noEmit OOMs)
npm run build                                          # the CI gate — necessary, NOT sufficient (§4.2)
grep -rn "useThreadBasedAgentCreation\|useNewAgentCreationUI\|useV6AgentGeneration\|useV6ReviewMode\|useMoveToCalibrationAfterCreation\|useAIDataLayer\|useBusinessDeleteSurface" app lib components hooks scripts tests types
# ^ must return zero hits
```

### 8.3 Manual QA (to be recorded in [QA Testing Report](#qa-testing-report))

**A. Feature-flag matrix** — for each flag, toggle the env var and confirm the gated behaviour
actually changes. This is what catches a missed rename; a flag stuck in one position is the exact
silent failure §4.2 describes.

| # | Env var | Off (or unset) | On |
|---|---|---|---|
| 1 | `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` | agent creation uses V4 path | uses V6 IntentContract pipeline |
| 2 | `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION` | auto-redirect to `/agents/[id]` | calibration choice card + left-rail Step 8 appear |
| 3 | `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` | legacy `ConversationalAgentBuilder` | `ConversationalAgentBuilderV2` |
| 4 | `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` | legacy creation flow | thread-based flow |
| 5 | `NEXT_PUBLIC_USE_V6_REVIEW_MODE` | n/a — **no production consumer**; assert only that `getFeatureFlags()` still reports it | — |
| 6 | `NEXT_PUBLIC_USE_AI_DATA_LAYER` | n/a — route reads `process.env` directly | — |
| 7 | `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` | delete surface hidden | surface renders; **server still refuses for non-admins** (`authorizePurge`) — must remain true |

**B. RefundModal — money paths** (no DB writes against production; use a test business):

| # | Scenario | Expected |
|---|---|---|
| B1 | Open refund from **payments tab** (`MoneyList`), close, reopen | No console error; **specifically no "Rendered fewer hooks than expected"** |
| B2 | Same from **invoices tab** (`PaymentInvoiceList`) | as B1 |
| B3 | Same from **transactions list** (`PaymentTransactionList`) | as B1 |
| B4 | Same from **CRM contact drawer** (`PaymentsSection`) | as B1 |
| B5 | Same from **CRM booking payment modal** (`PaymentManagementModal`) — the unconditionally-mounted parent | as B1 |
| B6 | With `showDeleteBookingOption`: toggle **delete booking** on, switch full → partial | Delete-booking switch clears (effect@308 still fires) |
| B7 | On a payment with a **live plan**: toggle delete booking on | **Stop plan is forced on** (effect@319 still fires) |
| B8 | Full refund + delete booking on a booking with a live plan | Plan stops; refund succeeds |
| B9 | Close the modal mid-flow, reopen | State reset as before (`stopPlan`/`livePlan`/`showStopPlan`/`blockedProcessor` cleared) |

**C. Public booking / intake flow** (`ProcessFlowSection`):

| # | Scenario | Expected |
|---|---|---|
| C1 | Service with legacy `intake_fields` populated | Intake step renders the form; submit advances |
| C2 | Service with `intake_fields` empty | Intake step **skipped entirely at the parent** (`:2729` guard) — unchanged from today |
| C3 | Service using `intakeTemplate` | Template path unaffected |

**D. Agent creation smoke:** create one agent end-to-end with default env and confirm it reaches the
success card and the agent page.

---

## 9. Task list

**Phase 0 — SA gate (blocking)**

- [x] T0.1 SA reviews this workplan and answers SA-1 … SA-9  ✅
- [x] T0.2 User approves the `CLAUDE.md` § Feature Flags edit (SA-7)  ✅
- [x] T0.3 User decides on the 199 `console.*` calls (SA-9)  ✅

**Phase 1 — Baselines (before any edit)**

- [x] T1.1 Record baseline `npx eslint app lib components` error counts by rule  ✅
- [x] T1.2 Record baseline `npm test` pass/fail counts  ✅
- [x] T1.3 Record baseline `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` output  (2789 error lines)

**Phase 2 — Commit 1: flag rename (sites 1–11)**

- [x] T2.1 Rename the 7 exports in `lib/utils/featureFlags.ts`  ✅
- [x] T2.2 Update `getFeatureFlags()` calls; keys per SA-2  ✅
- [x] T2.3 `app/v2/agents/new/page.tsx` — import @48, calls @1287/@1629/@2587  ✅
- [x] T2.4 `app/v2/agent-list/page.tsx` — import @10, call @167  ✅
- [x] T2.5 `components/agent-creation/AgentBuilderParent.tsx` — import @16, call @515  ✅
- [x] T2.6 `components/agent-creation/conversational/hooks/useThreadManagement.ts` — @11, @55  ✅
- [x] T2.7 `components/agent-creation/useConversationalBuilder.ts` — @14, @57  ✅
- [x] T2.8 `lib/utils/__tests__/featureFlags.test.ts` — update identifiers only, no semantics  ✅
- [x] T2.9 Zero-hit grep for all 7 old names  ✅
- [x] T2.10 `tsc` + `eslint` deltas vs T1.1/T1.3 → `rules-of-hooks` 11 → 0  ✅

**Phase 3 — Commit 2: RefundModal (sites 12–13)**

- [x] T3.1 Hoist `const canOfferDelete = showDeleteBookingOption;` above `if (!isOpen) return null;`  ✅
- [x] T3.2 Move both `useEffect`s above the early return — bodies and dep arrays byte-identical  ✅
- [x] T3.3 Add a comment explaining why they must stay above it  ✅
- [x] T3.4 Verify hook order is identical for `isOpen === true` renders (the only renders that occur today)  ✅
- [x] T3.5 `eslint` → `rules-of-hooks` 2 → 0  ✅
- [x] **T3.6 (R-1)** Add `setDeleteBooking(false)` to the reset effect + comment; correct the section 3.1 prose

**Phase 4 — Commit 3: ProcessFlowSection (site 14)**

- [x] T4.1 Apply SA-5's chosen option  ✅
- [x] T4.2 If deleted, comment the `:2729` guard as the load-bearing invariant  ✅
- [x] T4.3 `eslint` → `rules-of-hooks` 1 → 0  ✅

**Phase 5 — Commit 4: docs**

- [x] T5.1 `CLAUDE.md` § Feature Flags (sample @489–500, table @509–512) — **only after T0.2**  ✅
- [x] T5.2 `docs/FEATURE_FLAGS.md` — ~20 refs + `getFeatureFlags` sample @596–599  ✅
- [x] T5.3 `docs/FEATURE_FLAGS.md` — fix the flag-authoring template @541/@579 + add a "why not `use…`" note  ✅
- [x] T5.4 Add a Change History row to `docs/FEATURE_FLAGS.md`  ✅

**Phase 6 — Commit 5: regression guard**

- [x] T6.1 Per SA-8, add `lib/utils/__tests__/featureFlags.naming.guard.test.ts`  ✅

**Phase 7 — Verification**

- [x] T7.1 `npx eslint app lib components` → `rules-of-hooks` **0**; all other error counts unchanged  ✅
- [~] T7.2 `npm test` green vs baseline  -- **NOT green: 21 suites / 129 tests fail, all pre-existing and proven unrelated (QA report F1, F2).** No full-suite baseline was captured at T1.2; verified instead by showing no failing suite references any changed file.
- [x] T7.3 `npm run build` succeeds  ✅
- [x] T7.4 `tsc` delta empty vs baseline  ✅
- [x] **T7.0 (new)** Paste V1-V6 outputs into the QA report
- [ ] T7.5 Hand this workplan to SA for **code** review
- [ ] T7.6 QA executes §8.3 A/B/C/D and records results below
- [ ] T7.7 TL retrospective → user approval → **RM commits and merges** (Dev does not commit)

---

## Open Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| **SA-0** | No BA requirement MD exists — this originates from PR #76's lint cleanup. Proceed on this workplan alone, or route through BA first? | Proceed; it is remediation of a discovered defect, not a feature. |
| **SA-1** | Clean break on the rename, or keep deprecated `use*` aliases? | **Clean break** (§2.3). Aliases would not clear the lint errors and would re-seed the anti-pattern. |
| **SA-2** | Should the **keys** returned by `getFeatureFlags()` be renamed too, or stay as-is? | Rename the keys for consistency. Safe **today** (no production consumer, §4.1), and leaving `use*` keys preserves the misleading vocabulary. But this is the one silent-failure vector (R2) — SA should rule explicitly. |
| **SA-3** | `isBusinessDeleteSurfaceEnabled` would then exist in **two** modules (`featureFlags.ts` and `purgeAuthz.ts`) — which is exactly the pairing that `parseBooleanFlag.ts:1-19` and the `featureFlags.ts:128-150` JSDoc forbid merging. Give the `featureFlags.ts` one a distinct name (e.g. `isBusinessDeleteSurfaceVisible`), or **delete it** as unused? | Prefer **delete** (zero production callers), else `…Visible` to keep "renders" and "is permitted" lexically distinct. |
| **SA-4** | `RefundModal`: is the analysis in §3.1 correct that hoisting is behaviour-preserving, and that **no** `if (!isOpen) return;` guard should be added inside the two effects? | Yes — no guard. Adding one would imply a closed-state path that does not exist and would mask the reset-effect interaction. |
| **SA-5** | `ProcessFlowSection`: delete the unreachable branch (A) or hoist with a ref latch (B)? | **A (delete).** B activates a never-executed auto-submit on the public booking flow. |
| **SA-6** | `useV6ReviewMode`, `useAIDataLayer`, `useBusinessDeleteSurface` have **zero production callers**. Retire them in this branch (matching the existing "Retired …" comment convention at lines 24-31 / 97-100), or rename-and-keep? | **Rename and keep in this branch**; open a separate cleanup item. Retiring flags is a product decision, not a lint fix, and mixing the two obscures this diff. |
| **SA-7** | `CLAUDE.md` § Feature Flags names four of the seven. It is the user's configuration file — confirm Dev should not edit it without **explicit user approval in-session**. | Confirm. I will prepare the hunk and request approval rather than apply it. |
| **SA-8** | `rules-of-hooks` is enforced by **no CI job** (`npm run lint` is in no workflow; `next build` sets `eslint.ignoreDuringBuilds: true`). Add (a) a Jest source guard on `featureFlags.ts`, (b) a `lint` step in `build.yml` scoped to errors-only, or (c) nothing? | **(a) now**, and propose **(b)** as a follow-up requirement — 177 errors remain repo-wide, so a blanket lint gate would be red on arrival. |
| **SA-9** | 199 `console.*` calls across six touched files (§7.1). Convert in-branch per CLAUDE.md rule 3, or separate branch? | **Separate branch.** Flagged as mandated; final call is the **user's**. |

---

## 11. Out of scope

- The other **163 ESLint errors** (`prefer-const` 79, `no-require-imports` 64, `ban-ts-comment` 8,
  `jsx-no-duplicate-props` 6, `no-empty-object-type` 3, `display-name` 2, `no-unsafe-function-type` 1).
- The **8,932 warnings** (`no-explicit-any`, `no-unused-vars`, `no-unescaped-entities`) that PR #76
  deliberately demoted.
- Retiring the three unused flags (SA-6).
- Converting 199 `console.*` calls (SA-9).
- Fixing `app/api/business-os/chat-v2/route.ts:67` reading `NEXT_PUBLIC_USE_AI_DATA_LAYER` directly
  instead of via `parseBooleanFlag` (§4.1) — pre-existing, noted only.
- Adding React Testing Library / Playwright — new tooling patterns needing their own SA review.
- **Committing or merging.** Dev does not commit; RM merges after SA ✅, QA ✅ and explicit user approval.

---

## SA Review Notes

**Reviewed by SA — 2026-09-21**
**Status:** ✅ **Approved with conditions** — proceed to implementation applying **R-1 … R-8** below. No second workplan pass is required; the conditions are carried into code review.

This is a high-quality workplan. The diagnosis is correct, the evidence is real, and the separation of "lint outcome" from "runtime behaviour" is exactly right. SA verified rather than accepted every load-bearing claim; results in §SA.1. The conditions below are additions, not corrections — with one exception (R-1), which is a latent money-path gap the hoist opens and the workplan misses.

---

### SA.1 — Independent verification of the Dev's findings

| Claim | SA check | Result |
|---|---|---|
| 14 `rules-of-hooks` errors, at the exact 14 locations listed | Re-ran `npx eslint` on the five named files | ✅ **Confirmed** — all 14 reproduce, with the messages and line:col as tabled |
| `featureFlags.ts` imports no React; all seven are `process.env` + `parseBooleanFlag` | Read the full module | ✅ **Confirmed** — two imports only (`clientLogger`, `parseBooleanFlag`); no React, no hook calls |
| Call-site inventory: 6 files, 9 production sites + the test file | Re-ran the grep repo-wide (all `.ts/.tsx/.js/.jsx`, excluding `node_modules`/`.next`) | ✅ **Confirmed, and complete** — no site was missed |
| Three flags (`useV6ReviewMode`, `useAIDataLayer`, `useBusinessDeleteSurface`) have zero production callers | Same grep | ✅ **Confirmed** |
| `getFeatureFlags()` has no production consumer | Same grep | ✅ **Confirmed** — only `featureFlags.test.ts` |
| `isBusinessDeleteSurfaceEnabled` exists at `purgeAuthz.ts:61` reading the same env var | Read `purgeAuthz.ts:1-80` and `parseBooleanFlag.ts` | ✅ **Confirmed**, and see R-4 — the separation is *stronger* than the workplan states |
| RefundModal: 18 hooks above `if (!isOpen) return null;` @233, two more @308/@319, none below | Read the file's full hook map | ✅ **Confirmed** — no hook exists after :319 |
| All five RefundModal mount sites currently avoid a mounted `isOpen === false` render | Read the props interface + the reset effect @150 | ✅ **Confirmed as far as the hoist's safety goes**, but the *reason* given in §3.1 for effect@319's inertness is imprecise — see R-1 |
| `ProcessFlowSection` `IntakeStep` has exactly one render site, guarded by `intake_fields.length > 0` | `grep -n "IntakeStep\|intake_fields"` — hits at 1530/1544/1863/1947/1949/2727/**2728**/2729/2730 | ✅ **Confirmed unreachable** — `:2728` guards, `fields={intake_fields}` passes straight through, and `hasIntake` @1949 gates the step upstream too |
| `next.config.js` sets both ignore flags; no CI job runs lint or `npm test` | Read `next.config.js:3-8`, all four workflows, `package.json` scripts | ✅ **Confirmed** — `build.yml` runs `npm run build` only; `npm run lint` appears in no workflow; `npm test` appears in no workflow |
| `docs/FEATURE_FLAGS.md` template instructs `use*` naming | Read lines 530-600 | ✅ **Confirmed** — `useFeatureFlag()` @541, `useMyNewFeature()` @579, and the `getFeatureFlags()` sample @~588. **Plus a second defect the workplan missed** — see R-5 |

**One scope gap found.** The baseline lint run covered `app lib components` but **not `hooks/`**, which is a first-class source root per CLAUDE.md § Repository Structure. SA ran it: `npx eslint hooks` → **0 errors, 6 warnings**. So the count of 14 stands — but every lint command in this workplan (T1.1, T7.1, and the R-3 CI gate) must be widened to `app lib components hooks`.

---

### SA.2 — Decisions on the open questions

| # | Decision | Reasoning |
|---|---|---|
| **SA-0** | ✅ **Proceed without a BA requirement.** | This is remediation of a discovered defect with no product surface. The one genuinely product-shaped decision in the area — *retiring* flags — is correctly deferred (SA-6), which is what keeps this out of BA's lane. |
| **SA-1** | ✅ **Clean break. No aliases.** | Dev's reasoning is correct and SA verified it: `rules-of-hooks` is a lexical rule on the *called identifier*, so `export const useV6AgentGeneration = isV6AgentGenerationEnabled` leaves every call site still erroring. An alias is therefore all of the work with none of the benefit, plus a permanent re-seed of the anti-pattern. There is no out-of-repo consumer to protect: private Next.js app, no package surface. |
| **SA-2** | ✅ **Rename the keys too.** | And note the silent-failure framing needs one correction, which makes this safer than the workplan assumes: `getFeatureFlags()` returns an **inferred object-literal type**, so `flags.useV6AgentGeneration` after a key rename is a *compile error* (TS2339), not silently `undefined`. It is only silent at runtime because `typescript.ignoreBuildErrors: true` hides it from the build. That means the vector is fully closed by gate **V3** (R-2) rather than by avoiding the rename. Leaving `use*` keys would instead preserve the misleading vocabulary in the one artefact people copy from. **Also add a one-line comment on `getFeatureFlags()` recording that it is a debug helper with no production consumer** — so the next person does not wire it into a real gate and re-open the vector. |
| **SA-3** | ✅ **Distinct name: `isBusinessDeleteSurfaceVisible`. Keep it. Do NOT delete, do NOT consolidate.** | See R-4 — SA found the two modules are *harder* to merge than the workplan says. |
| **SA-4** | ⚠️ **Agreed on the hoist and on adding no `if (!isOpen) return;` guard — but the stated reason is wrong, and one real gap follows from it.** See R-1. | |
| **SA-5** | ✅ **Option A — delete the dead branch.** | Confirmed unreachable. Option B is disqualified on its own terms: it would activate a never-executed auto-submit on a **public, customer-facing** booking flow, and it requires deliberately writing a stale-closure effect (`onSubmit` is unmemoised `handleIntakeSubmit`) to do it. That is new untested code on the highest-consequence surface in the diff, bought for a branch that has never run. SA also considered a third option — keep `if (fields.length === 0) return null;` without the effect — and **rejects it**: if the `:2728` guard is ever relaxed, rendering `null` strands the user on a step with no way forward, whereas the plain form (option A) still has a working submit. Option A is the more robust failure mode as well as the smaller diff. Apply R-8. |
| **SA-6** | ✅ **Rename and keep all three. Do not retire in this branch.** | Agreed. Retiring a flag is a rollout decision with a blast radius (a dormant V4 path, a chat-v2 code path); mixing it into a rename would make the diff unreviewable against gate V2. Open a separate cleanup item. Note `isBusinessDeleteSurfaceVisible` is a different case — the flag itself is *not* being retired there; its authoritative reader survives in `purgeAuthz.ts`. |
| **SA-7** | ✅ **The user has already decided this in-session: `CLAUDE.md` § Feature Flags WILL be updated as part of this change.** | T0.2 is therefore satisfied and is **not** a blocker. Dev should still show the hunk in the code-review pass rather than burying it. `archive/CLAUDE_BACKUP_1406.md` stays untouched — correct. |
| **SA-8** | 🔄 **Rejected as proposed. A Jest guard test would be inert.** | See R-3 — this is the correction SA most wants carried. |
| **SA-9** | ✅ **Out of scope. The user has parked the logging debt.** | The 199 `console.*` calls across the six touched files are **not** to be converted in this branch, and their presence must **not** be raised as a blocker at code review. This is an explicit user decline under CLAUDE.md § Logging, and it is recorded here so the decision is auditable rather than silent. The workplan's §7.1 flagging discharged rule 3 correctly. |

---

### SA.3 — Required changes (R-1 … R-8)

#### R-1 (🔴 High — money path) `RefundModal`: the hoist opens a residual-state gap the workplan does not close

§3.1 says effect@319 "on a closed render is inert, because the existing reset effect (lines 147-155) sets `livePlan = null` and `stopPlan = false` whenever `!isOpen`, so its guard is false." That reasoning does not hold as stated — on the render where `isOpen` flips `true → false`, effect@319's deps (`deleteBooking`, `livePlan`, `stopPlan`) have **not** changed yet, so it does not re-run in that commit at all; it re-runs only in the *next* commit, after the reset's writes have landed. The conclusion (inert) happens to be right; the mechanism is the dependency array, not the reset effect. SA traced both commits and confirms **the hoist is safe**.

But tracing it surfaces the real gap: **the reset effect at :150-157 does not reset `deleteBooking`.** It clears `stopPlan`, `livePlan`, `showStopPlan` and `blockedProcessor` — not the one flag that deletes a customer's booking. Today that is invisible, because every mount site unmounts the component on close and state is destroyed. The entire point of this fix is to make the component correct for the mounted-and-closed render that does not happen *yet*. In that world, a user who arms "delete booking" and closes the modal reopens it with delete-booking still armed, on a different payment. Effect@308 only disarms it when `canOfferDelete` is false; if the next refund also offers the option, it stays on.

**Required:** add `setDeleteBooking(false);` to the existing reset effect at `components/payments/RefundModal.tsx:150-157`, with a comment recording *why* (a money-affecting flag must not survive a close, now that a closed render is a supported state). This is a **no-op today** — the branch is unreachable under the current mount topology, exactly like the effects being hoisted — and it is the difference between "the crash is fixed" and "the crash is fixed and the component is actually correct when closed".

Also correct the §3.1 prose so the next reader does not inherit the wrong mechanism.

Everything else in §3.1 is approved as written: hoist `const canOfferDelete = showDeleteBookingOption;` (with its comment block) and both effects above `if (!isOpen) return null;`, bodies and dep arrays byte-identical, **no** `if (!isOpen) return;` guard inside either effect. A guard inside effect@308 would be actively wrong — disarming a hidden switch is precisely what it exists to do.

#### R-2 (🔴 High) Replace the tsc "baseline diff" with targeted gates V1–V6

T1.3 / T7.4 as written ("compare the error list before and after" on a heap-raised full-repo `tsc`) is not a workable gate: the baseline is dirty, the run is slow and OOM-prone, and a thousand-line diff is not something a reviewer can certify. Since `npm run build` is provably blind here (`ignoreBuildErrors` + `ignoreDuringBuilds`, both verified), the burden of proof falls entirely on these. **All six are mandatory and their outputs must be pasted into the QA report.** Together they answer the question "did a rename silently switch a feature off?" mechanically, not by inspection.

**V1 — env-literal invariance.** A rename must not touch a single environment read or default.

```bash
git diff -U0 -- lib/utils/featureFlags.ts app components | grep -E '^[+-].*(process\.env|parseBooleanFlag\()'
```

→ **must be empty.** Any hit means the change is no longer a rename, and the hunk must be justified individually. This is the single cheapest proof that no flag changed its source or its default.

**V2 — the diff is a pure token substitution.** For commit 1 only, write a throwaway script (scratchpad, not committed) that reads `git diff -U0`, pairs `-`/`+` lines within each hunk, applies the seven old→new replacements to each `-` line, and asserts the result equals the `+` line. **Every pair must match.** Any pair that does not is, by definition, an edit that is not a rename — it gets called out line by line in the code review. **This is why the five-commit split is load-bearing, not stylistic** — V2 is only meaningful against a commit that contains nothing but the rename. Do not squash.

**V3 — targeted tsc, not a baseline diff.** Run once, then assert on *classes of error naming the old identifiers* rather than on the whole list:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit > tsc.after.txt 2>&1 || true
grep -E "TS2305|TS2724|TS2304|TS2552|TS2339" tsc.after.txt \
  | grep -E "useThreadBasedAgentCreation|useNewAgentCreationUI|useV6AgentGeneration|useV6ReviewMode|useMoveToCalibrationAfterCreation|useAIDataLayer|useBusinessDeleteSurface"
```

→ **must be empty.** Then additionally filter `tsc.after.txt` to the nine touched file paths and diff *that* subset against the same subset of the baseline — a tractable handful of lines. This is what closes the SA-2 vector: a missed named import (TS2305/TS2724) and a stale `getFeatureFlags()` key access (TS2339) both land in this grep.

**V4 — runtime log oracle.** Six of the seven readers already emit `clientLogger.debug({ flag: 'NEXT_PUBLIC_...', value, default }, 'Feature flag evaluated')`, and the `flag:` field is the **env var literal, not the function name** — so it is invariant under the rename. Capture those lines from `npm run dev:pretty` before and after, with identical env, exercising agent creation and the agent list. **The set of `Feature flag evaluated` lines and their `value`/`default` fields must be identical.** This is an objective runtime assertion, and it is strictly better evidence than "the UI looked right". (`isBusinessDeleteSurfaceVisible` is the one without a debug line — see the optimisation note below.)

**V5 — flip, don't just check.** §8.3 matrix A is **mandatory and must be executed in both positions** for the four flags that have production consumers. Verifying only the "on" position cannot distinguish "working" from "stuck on", which is the exact failure mode in scope. Rows 5 and 6 must be recorded honestly as N/A-no-consumer rather than quietly passed.

**V6 — test-count invariance.** `npm test -- lib/utils/__tests__/featureFlags.test.ts` must report the **same number of tests, with the same names modulo the rename**, before and after. A find/replace across ~60 assertions can drop or duplicate a case and still go green.

#### R-3 (🟡 Medium) SA-8: a Jest guard test alone is inert — make the gate a scoped ESLint CI job

SA verified the workplan's own premise and it is decisive: **no workflow runs `npm test`.** `build.yml` runs `npm run build`; `plugin-tests.yml` runs the plugin suites; `bos-llm-typecheck.yml` runs a scoped tsc; `admin-authz-guard.yml` runs *one named test file* via its own `test:authz-guard` script. `admin-authz-guard.yml:21-23` states this in its own header. So adding `featureFlags.naming.guard.test.ts` and stopping there produces **zero regression protection** — it would never execute in CI.

**Required instead** (and cheaper to maintain than the proposed regex guard):

1. Add a `lint:hooks` npm script that runs ESLint over `app lib components hooks` with `react-hooks/rules-of-hooks` as the **only** rule at error severity (everything else off), asserting **0**. Use the real rule rather than reimplementing it in a regex — a regex on `featureFlags.ts` would guard one file, while the rule guards the whole defect class including the RefundModal and ProcessFlowSection shapes.
2. Attach it as its own workflow, modelled on `.github/workflows/admin-authz-guard.yml`. **No `paths:` filter** — a new `use*`-named plain function can be added in any file, so a filtered job would be defeated by the change it guards, for exactly the reason that workflow documents at length.
3. Carry that workflow's honesty note: a red workflow blocks nothing until the repository owner makes it a required status check. Record it as a follow-up for the user, do not claim it as a gate.

This is **not a new pattern** — it is the third instance of an established one (`admin-authz-guard`, `bos-llm-typecheck`), and it is green on arrival because it is scoped to the one rule this branch drives to zero. The Dev's point that a blanket lint gate would be red on arrival (177 errors remain) is correct and is precisely why the job is rule-scoped. The separate Jest guard file is then **optional** — if kept, it must be attached to a script/workflow too, or dropped.

#### R-4 (🟡 Medium) SA-3: `isBusinessDeleteSurfaceVisible`, kept, with reciprocal cross-references

SA read both modules and the separation is **stronger than the workplan states**, which settles the question:

- `purgeAuthz.ts` imports `@/lib/logger` and `@/lib/services/AdminAccessService`. It is unambiguously **server** code. So the coupling is forbidden in *both* directions: `purgeAuthz → featureFlags` would drag an authz decision into the client bundle (what the JSDoc forbids), and `featureFlags → purgeAuthz` would drag `AdminAccessService` into the client bundle (worse). There is no consolidation available, and `getFeatureFlags()` cannot delegate to the purge reader.
- **Do not delete the `featureFlags.ts` reader.** Deleting it takes the JSDoc at `featureFlags.ts:128-150` with it — and that comment block is the only thing in the client-side module that tells the next developer this flag is a rendering hint and not an authorization boundary. When D9 un-gating later needs a client-side render check, someone will re-add one; better that they find the documented reader than copy the server one into a component. Deleting an export is also scope creep inside a commit that gate V2 requires to be a pure rename.

**Required:** name it **`isBusinessDeleteSurfaceVisible`** — `Visible` for "what gets drawn", `Enabled` for "what is permitted" — keep the full JSDoc, and add a one-line reciprocal pointer in each module naming the other function and why they are separate. Two identically-named functions in two modules is the actual hazard here: it is one autocomplete-assisted import away from the merge both files spend paragraphs forbidding.

#### R-5 (🟡 Medium) The `FEATURE_FLAGS.md` template has a *second* defect — fix both

The workplan correctly identifies the `use*` naming at :541 / :579 as the origin. SA read the template and it also **hand-rolls the boolean parsing inline** instead of importing `parseBooleanFlag`. That is the same divergence already shipped at `app/api/business-os/chat-v2/route.ts:67` (`=== 'true'`, so `=1` and `=TRUE` read as off) — i.e. the template has demonstrably produced that bug once already. Fixing only the name would leave the template generating the *other* half of the defect.

**Required:** the rewritten template must (a) use an `is…Enabled` name, (b) `import { parseBooleanFlag }` rather than reimplement it, (c) carry a short "why not `use…`" note explaining that `react-hooks/rules-of-hooks` keys off the identifier, and (d) update the `getFeatureFlags()` sample at ~588 to the new key names. Add the Change History row (T5.4) — required for a living doc under CLAUDE.md § Documentation Standards.

#### R-6 (🟡 Medium) Two rename traps that a repo-wide find/replace will hit

R7 in the risk register is right to ban an IDE project-wide rename. Two concrete instances to guard, both confirmed by SA's grep:

- **`app/api/business-os/chat-v2/route.ts:67-68` declares a local `const useAIDataLayer`** that is not an import from `featureFlags.ts`. A blind `sed s/useAIDataLayer/…/g` rewrites it. **This file must not appear in the commit-1 diff at all** — its presence is itself the signal that the rename over-reached. (Its `=== 'true'` divergence stays out of scope per §11, correctly.)
- **The local variables `useNewUI` (`AgentBuilderParent.tsx:515`) and `useThreadFlow` (`useThreadManagement.ts:55`, `useConversationalBuilder.ts:57`)** are assignment targets, not calls, so ESLint does not flag them. Renaming them is **optional tidy-up and SA's preference is to leave them alone in this branch** — they would add noise to a diff that gate V2 wants to be mechanically verifiable. If the Dev does rename them, it belongs in a separate commit.

**Required:** commit 1 touches exactly the eight files in §6 that relate to the rename. `git diff --stat` line counts get checked against the nine enumerated call sites at code review.

#### R-7 (🟢 Low) Widen every lint scope to include `hooks/`

T1.1, T7.1, the §8.2 grep and the R-3 CI job all run against `app lib components hooks`. SA confirmed `hooks/` is currently clean (0 errors), so this changes no counts — it closes the blind spot that let the original `eslint.config.js` shadowing go unnoticed for as long as it did.

#### R-8 (🟢 Low) `ProcessFlowSection`: document the invariant where the next editor will look

Option A is approved. But a comment at the `:2728` call site (T4.2) is the wrong place on its own — someone editing `IntakeStep` reads the component, not its caller.

**Required:** put the invariant on **`IntakeStepProps.fields` at :1530-1543** ("non-empty by contract; the only render site guards on `intake_fields.length > 0` at :2728 — a caller that relaxes that guard gets an empty form, not an auto-submit"), **and** the short note at `:2728`. Both, not either.

---

### SA.4 — Adjusted items in the task list

- **T0.2** — satisfied. The user has approved the `CLAUDE.md` edit in-session; it is no longer a blocker on Phase 1.
- **T0.3** — decided. `console.*` conversion is **out of scope** by explicit user decision (SA-9). Remove it from the blocking gate.
- **T1.1 / T7.1 / §8.2 grep** — scope becomes `app lib components hooks` (R-7).
- **T1.3 / T7.4** — replaced by gates **V1–V6** (R-2). The whole-repo tsc baseline diff is dropped.
- **T2.1** — the seventh name is **`isBusinessDeleteSurfaceVisible`**, not `…Enabled` (R-4); reciprocal cross-reference comments in `featureFlags.ts` and `purgeAuthz.ts`.
- **T2.2** — keys renamed (SA-2), plus the "debug helper, no production consumer" comment on `getFeatureFlags()`.
- **New T3.6** — add `setDeleteBooking(false)` to the reset effect at `RefundModal.tsx:150-157`, with a comment (R-1). Correct the §3.1 prose on why effect@319 is inert.
- **T4.2** — invariant documented on `IntakeStepProps.fields` **and** at `:2728` (R-8).
- **T5.3** — template fix also replaces the hand-rolled parser with `parseBooleanFlag` (R-5).
- **T6.1** — replaced by the `lint:hooks` script + its own workflow, per `admin-authz-guard.yml` (R-3). The Jest guard file is optional and must be CI-attached if kept.
- **New T7.0** — paste V1–V6 outputs into the QA report before handing over.

### Optimisation Suggestions (non-blocking, do not hold the cycle)

- `isBusinessDeleteSurfaceVisible` is the only one of the seven with no `clientLogger.debug` line. Adding one would make gate V4 cover all seven uniformly. Cosmetic; Dev's call.
- `IntakeStepProps.fields` could be typed `[FormField, ...FormField[]]` to make R-8's invariant compile-enforced rather than commented. Elegant, but it ripples into the caller and is disproportionate to a lint fix — noted for a future cleanup, not now.
- Worth an open item after this branch: `app/api/business-os/chat-v2/route.ts:67` reading `NEXT_PUBLIC_USE_AI_DATA_LAYER` with `=== 'true'` while every other reader uses `parseBooleanFlag` means `=1`/`=TRUE` behave differently on that one route. Correctly out of scope here; R-5 stops the template from producing more of them.

### Approval

- [x] **Workplan approved with conditions** — proceed to implementation applying R-1 … R-8.
- [x] No BA requirement needed (SA-0).
- [x] No architectural escalation to TL.
- [ ] SA code review pending (T7.5) — will be walked against R-1 … R-8 and gates V1–V6.


---

## QA Testing Report

> **Dev → QA handover, 2026-09-21.** Gate outputs below are pasted per SA **R-2 / new T7.0**.
> Everything Dev could verify without a running app is done and recorded honestly, including the
> items that did **not** come back clean. **Two gates remain owed by QA** because they require a
> running dev server and manual UI interaction: the runtime half of **V4** and all of **V5**.

### T7.0 — Gate results (V1–V6)

| Gate | What it proves | Result |
|---|---|---|
| **V1** env-literal invariance | No `process.env` read or `parseBooleanFlag` default changed | ✅ **PASS** — empty output |
| **V2** pure token substitution | Commit 1 is a rename and nothing else | ✅ **PASS** — 123/124 removed lines are exact substitutions; the 1 remainder + all 37 additions are comment-only (**0 non-comment additions**) |
| **V3** targeted tsc | No missed import (TS2305/2724/2304/2552) or stale key (TS2339) | ✅ **PASS** — grep empty; total tsc error lines **2789 → 2789**; per-touched-file counts identical |
| **V4** runtime log oracle | Flag values identical before/after | ⚠️ **PARTIAL** — static half passes; runtime capture **owed by QA** |
| **V5** flip each flag both ways | A flag is not stuck in one position | ❌ **NOT RUN** — requires a running app; **owed by QA** |
| **V6** test-count invariance | Find/replace dropped or duplicated no test | ✅ **PASS** — **44 tests before and after**, same 6 failed / 38 passed split |

**V1 — env-literal invariance**

```bash
$ git diff -U0 -- lib/utils/featureFlags.ts app components | grep -E '^[+-].*(process[.]env|parseBooleanFlag[(])'
(no output)
```

**V2 — pure token substitution** (throwaway script, scratchpad, not committed)

```
TOTAL removed lines examined: 124
MISMATCHED PAIRS (must be 0): 1
  lib/utils/featureFlags.ts
   got -   * **Do not "simplify" `authorizePurge` to call this hook.** Doing so would move
   got +   * **Do not "simplify" `authorizePurge` to call this function.** Doing so would move
UNPAIRED DELETIONS: 6      (the orphaned getFeatureFlags JSDoc, moved onto the function)
UNPAIRED ADDITIONS: 37     (purgeAuthz.ts 13, featureFlags.ts 24)
UNPAIRED ADDITIONS THAT ARE NOT COMMENTS (must be 0): 0
```

Each non-substitution justified:

| Item | Justification |
|---|---|
| 1 "mismatch" | Prose only: the function is no longer named like a hook, so "call this hook" became "call this function". No code. |
| 6 unpaired deletions | The `getFeatureFlags` JSDoc was **orphaned** in the original file — it sat above the *delete-surface* JSDoc, documenting neither. Moved onto `getFeatureFlags` and extended with the SA-2 "debug helper, no production consumer" warning. |
| 37 unpaired additions | All comments, verified mechanically (0 non-comment). R-4 reciprocal cross-references (13 in `purgeAuthz.ts`, part of 24 in `featureFlags.ts`) + the SA-2 note. |

> ⚠️ **The first version of this script was itself broken** and reported all 118 pairs as
> mismatched: the shell ate the backslashes in its `new RegExp` inside a heredoc, so the
> substituter was a silent no-op. The final version uses `split`/`join` (no backslashes) and
> **self-tests the substituter before running**, so a broken checker can never again masquerade as
> a failed gate. Worth knowing if this is ever re-run.

**V3 — targeted tsc**

```bash
$ NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit > tsc.final.txt 2>&1
$ wc -l tsc.final.txt      # 2789   (baseline before any edit: 2789)
$ grep -E "TS2305|TS2724|TS2304|TS2552|TS2339" tsc.final.txt | grep -E "<the seven old names>"
(no output)
```

Per-touched-file error counts, baseline → final — all identical:
`featureFlags.ts` 0→0 · `RefundModal.tsx` 0→0 · `ProcessFlowSection.tsx` 0→0 · `purgeAuthz.ts` 0→0 ·
`agents/new/page.tsx` 0→0 · `agent-list/page.tsx` 0→0 · `AgentBuilderParent.tsx` **9→9** (pre-existing) ·
`useThreadManagement.ts` 0→0 · `useConversationalBuilder.ts` 0→0

**V4 — runtime log oracle (PARTIAL)**

Static half ✅: the six `Feature flag evaluated` debug lines are **untouched by the diff**, so the
`flag:` keys remain the env-var literals and the oracle is valid.

```
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION             (featureFlags.ts:20)
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI                   (:40)
NEXT_PUBLIC_USE_V6_AGENT_GENERATION                     (:55)
NEXT_PUBLIC_USE_V6_REVIEW_MODE             default:true (:76)
NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION    default:false (:93)
NEXT_PUBLIC_USE_AI_DATA_LAYER              default:false (:118)
```

**Owed by QA:** capture these lines from `npm run dev:pretty` with identical env, exercising agent
creation and the agent list, and confirm the set and every `value`/`default` matches the pre-change
capture. Dev cannot run this (needs a live app; also out of scope per "do not run anything against
the database").

> Note: `isBusinessDeleteSurfaceVisible` is still the one reader with **no** debug line. SA's
> optimisation suggestion was to add one. **Deliberately not done** — it would add a runtime side
> effect to a commit whose entire warrant (gate V2) is "pure rename", and the flag has no
> production consumer for V4 to observe anyway. Left as a follow-up.

**V5 — flag flip matrix: NOT RUN.** Requires a running app. This is the gate that actually catches
a missed rename, so it must not be skipped. QA runs §8.3 matrix **A in both positions** for the
four flags with production consumers (rows 5 and 6 recorded as N/A-no-consumer), plus B, C, D.

**V6 — test-count invariance**

```
before: Tests: 6 failed, 38 passed, 44 total
after:  Tests: 6 failed, 38 passed, 44 total
```

### ⚠️ Findings that did NOT come back clean

| # | Finding | Assessment |
|---|---|---|
| F1 | **`featureFlags.test.ts` was already red before any change** — 6 of 44 tests fail. | **Pre-existing, not caused by this work, and deliberately not fixed.** Cause: the suite sets `process.env.USE_THREAD_BASED_AGENT_CREATION` (19 occurrences, **no `NEXT_PUBLIC_` prefix**) while the source reads `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION`. So every "should be true" case for that flag asserts against a variable nothing reads. Fixing it would change test *semantics* mid-rename and defeat gate V6, which requires identical counts. **Recommend a separate follow-up** — note this means the thread-flag tests currently prove nothing. |
| F2 | **Full suite: 21 suites / 129 tests failing.** | **Pre-existing and proven unrelated.** No full-suite baseline was captured at T1.2 (Dev's omission), so it was verified by other means: (a) **none** of the 20 non-featureFlags failing suites references any of the 11 files changed here — checked mechanically; (b) they are all V6/pilot/orchestration/website-builder domain assertion failures (e.g. `ConditionalEvaluator` numeric-coercion cases, `TokenBudgetManager`), which a rename cannot produce. Consistent with the known main-CI-red `evaluateCondition` item. |
| F3 | **`npm run build` fails in the worktree** with `Error: supabaseUrl is required`. | **Environment, not code.** The worktree has no `.env`. Re-run with `build.yml`'s exact CI env (dummy Supabase/Stripe/QStash values) → **exit 0, build succeeds.** |
| F4 | `npx tsc --noEmit` **OOMs** without a raised heap. | Confirmed again; `NODE_OPTIONS=--max-old-space-size=8192` is required. Recorded so the next person does not read the crash as a code failure. |

### Static gates — final state

| Check | Result |
|---|---|
| `npx eslint app lib components hooks` → `rules-of-hooks` | **14 → 0** ✅ |
| All other ESLint error counts | **unchanged**: `prefer-const` 79, `no-require-imports` 64, `ban-ts-comment` 8, `jsx-no-duplicate-props` 6, `no-empty-object-type` 3, `display-name` 2, `no-unsafe-function-type` 1 ✅ |
| `npm run lint:hooks` (new R-3 gate) | **exit 0** ✅ |
| `npm run lint:hooks` **negative control** | Injected a `use*` plain function → **exit 1**, correct error. Restored → exit 0. The guard genuinely detects the defect class ✅ |
| `npm run build` (with CI env) | **exit 0** ✅ |
| Zero-hit grep, seven old names, `app lib components hooks types` | Only 2 hits, both the **local** `const useAIDataLayer` in `app/api/business-os/chat-v2/route.ts:67-68` that **R-6 requires be left untouched** ✅ |
| R-6 trap: `chat-v2/route.ts` in the diff? | **No** ✅ |
| R-6 trap: `useNewUI` / `useThreadFlow` locals renamed? | **No**, left alone per SA preference ✅ |

### QA — still to do

1. **V5 / §8.3 matrix A, both positions**, for the four flags with production consumers.
2. **V4 runtime capture**, before/after `Feature flag evaluated` lines.
3. **§8.3 matrix B (B1–B9)** — the RefundModal money paths, including the new R-1 reset behaviour:
   arm "delete booking", close, reopen, confirm it is **disarmed**.
4. **§8.3 matrix C** — public booking/intake flow.
5. **§8.3 D** — agent-creation smoke.

---

### QA — independent verification, 2026-09-21

**Test mode:** full (static scope) · **Strategy used:** A + B + C — Jest (unit + full suite), a
purpose-written source-invariant checker, ESLint/tsc gates and a negative control. No Option D
(Playwright is not installed in this repo). · **Focus:** api/ui-adjacent static correctness,
security-neutral · **Skipped:** V4 runtime half and V5 (require a running app — owed to the user, §QA
runtime hand-off below) · **Input source:** prompt keywords + the workplan's V1–V6 gate definitions.

**Method note — nothing below re-uses a Dev artefact except where explicitly stated.** Gates were
re-derived from `git show HEAD:<file>`, and the baseline was established from a **separate
`git worktree add` of `47bef914`** (never `git stash`, which is shared across worktrees).

#### QA re-run of the gates

| Gate | QA method (independent of the Dev's scripts) | Result |
|---|---|---|
| **V1** env-literal invariance | `git diff -U0` per file, grepping `process.env`/`parseBooleanFlag(` — run over **all 13 changed files**, wider than the Dev's `featureFlags.ts app components` (which did not cover the test file) | ✅ **PASS** — **0** hits in every code file. The only 7 hits repo-wide are prose/templates in `docs/FEATURE_FLAGS.md` + `CLAUDE.md` |
| **V2** pure token substitution | **Rewritten from scratch, stronger shape.** Instead of pairing `-`/`+` diff lines, QA applies the 7 renames to the *whole file at HEAD* and asserts equality with the working tree. Substitution is a **tokenizer, not a regex** — no backslash escapes exist, so the heredoc failure that silently neutered the Dev's first attempt is structurally impossible. **14 self-tests run first and abort on failure**, including explicit no-op detection and false-positive probes (`myUseV6AgentGeneration`, `useAIDataLayer2`, `useV6AgentGenerationX`) | ✅ **PASS** — **6 of 8 files are byte-identical to `rename(HEAD)`**: `agents/new/page.tsx`, `agent-list/page.tsx`, `AgentBuilderParent.tsx`, `useThreadManagement.ts`, `useConversationalBuilder.ts`, `featureFlags.test.ts`. Residuals only in `featureFlags.ts` (−3/+21) and `purgeAuthz.ts` (+13) — **0 non-comment lines** in both; read and confirmed to be the R-4 cross-references, the SA-2 `getFeatureFlags` note and "call this hook"→"call this function" |
| **V3** targeted tsc | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`, re-run by QA | ✅ **PASS** — **0** TS2305/2724/2304/2552/2339 errors naming any of the seven old identifiers. Touched-file error counts: 8 files at 0, `AgentBuilderParent.tsx` at 9 — all 9 read and confirmed **pre-existing and unrelated** (`ConversationalState`/`SmartBuilderState` shape mismatches at lines 214–530; **none at the changed lines 16/515**, none naming the renamed symbol) |
| **V6** test-count invariance | **Strengthened.** The Dev compared counts; QA compares the **full set of test `fullName` + pass/fail status**, canonicalised through the same rename map | ✅ **PASS** — 44/44, 38 passed / 6 failed both sides, and the name+status sets are **exactly equal modulo the rename** |
| **V4** runtime log oracle | static half only | ⚠️ **PARTIAL** — static half re-confirmed by V1 (no `clientLogger.debug` line changed, so the `flag:` keys remain the env-var literals). Runtime capture **owed by the user** |
| **V5** flag-flip matrix | — | ❌ **NOT RUN** — needs a running app. **Owed by the user.** See the hand-off below |

#### Independent baseline (the Dev captured none for the full suite)

A detached worktree of `47bef914` was created, and the pre-change files were additionally
materialised via `git show HEAD:` so they could be linted and tested in place.

| Baseline claim | QA verification | Result |
|---|---|---|
| 14 `rules-of-hooks` errors before | Ran the rule-scoped config against HEAD copies of the five files | ✅ **Reproduced exactly** — 14 errors at **exactly the 14 `line:col` positions** tabled in §1 |
| 0 after | `npx eslint app lib components hooks` in the worktree | ✅ **0** |
| **F1** `featureFlags.test.ts` already red, 6/44 | Ran the **HEAD version** of the suite against the **HEAD version** of the source | ✅ **Confirmed pre-existing: 6 failed / 38 passed / 44 total**, identical to after. Root cause re-derived independently: the suite writes `process.env.USE_THREAD_BASED_AGENT_CREATION` **19 times with no `NEXT_PUBLIC_` prefix**, while the source reads `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` |
| **F2** other 20 failing suites unrelated | Full `npx jest --ci --json`, then machine-matched every failing suite path against the 13 changed files | ✅ **Confirmed** — 21 failed / 351 passed (380 suites); 129 failed / 5505 passed (5693 tests). **Exactly one** failing suite touches a changed file (`featureFlags.test.ts`, the 6 above). The other 20 are `lib/pilot`, `lib/agentkit/v6`, `lib/orchestration`, `lib/website-builder` — **8 of them fail at suite load**, i.e. pre-existing infrastructure breakage. None can be reached from this diff: `featureFlags.ts` has exactly **5** production importers, none in those trees |

#### "All other ESLint counts unchanged" — measured, not asserted

Comparing the pre-change report against QA's post-change run over the identical 2,249-file scope:

```
BASELINE: files=2249 errors=177 warnings=8932
AFTER   : files=2249 errors=163 warnings=8931

--- ERROR rules that changed ---
    14 ->    0  react-hooks/rules-of-hooks       <-- the only one
--- WARNING rules that changed ---
   155 ->  154  react-hooks/exhaustive-deps      <-- the deleted dead effect
```

Every other error rule is unchanged to the unit (`prefer-const` 79, `no-require-imports` 64,
`ban-ts-comment` 8, `jsx-no-duplicate-props` 6, `no-empty-object-type` 3, `display-name` 2,
`no-unsafe-function-type` 1). The single warning delta is fully explained: the deleted
`useEffect(() => { onSubmit(); }, [])` in `ProcessFlowSection` carried a missing-dependency warning.
*(This one table uses the Dev's pre-change ESLint JSON as the baseline; its load-bearing number — the
14 — was independently reproduced by QA above.)*

#### Acceptance criteria

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| `rules-of-hooks` 14 → 0 over `app lib components hooks` | ✅ | **Pass** | Both endpoints reproduced by QA |
| All other lint error counts unchanged | ✅ | **Pass** | Measured per-rule; only `rules-of-hooks` moved |
| The rename is purely mechanical | ✅ | **Pass** | V2: 6/8 files byte-identical to `rename(HEAD)`; 0 non-comment residual in the other 2 |
| No flag's default or polarity changed (incl. the 3 with no callers) | ✅ | **Pass** | All 7 bodies are **context lines** in the diff. Verified explicitly: `parseBooleanFlag(flag)` ×4, `(flag, true)` for `isV6ReviewModeEnabled`, `(flag, false)` for calibration and AI-data-layer — identical HEAD vs now |
| `chat-v2/route.ts` local `const useAIDataLayer` not rewritten | ✅ | **Pass** | File is **byte-identical to HEAD** (`git diff --quiet`) and absent from the diff. Its 2 occurrences are the only old-name hits left in `app lib components hooks types scripts tests` |
| No other local identifier caught by the rename | ✅ | **Pass** | Implied by V2's byte-equality; confirmed directly — `useV6` (page.tsx:1287), `useNewUI` (AgentBuilderParent:515), `useThreadFlow` (×2) all survive verbatim |
| All 7 production call sites + 5 imports renamed, none missed | ✅ | **Pass** | Re-enumerated; also checked the silent vectors the grep would miss: **no namespace import** (`import * as`) and **no computed/dynamic access** of the module anywhere |
| `getFeatureFlags()` still has no production consumer | ✅ | **Pass** | Zero references outside its own definition and the test file |
| **R-1** RefundModal: both effects + the const hoisted, bodies/deps unchanged | ✅ | **Pass** | See the mechanical proof below |
| **R-1** new `setDeleteBooking(false)` in the reset effect | ✅ | **Pass** | Present, commented, and a no-op today |
| **R-3** `lint:hooks` + workflow actually fire | ✅ | **Pass** | QA ran its own negative control — see below |
| **SA-5** deleted branch unreachable, booking flow unaffected | ✅ | **Pass** | See below |
| **R-4** distinct name + reciprocal cross-references | ✅ | **Pass** | `isBusinessDeleteSurfaceVisible` (client) vs `isBusinessDeleteSurfaceEnabled` (server); pointers in both modules; `purgeAuthz.ts` change is **comment-only (+13, 0 code lines)** |
| **R-5** template fixed (name **and** parser) | ✅ | **Pass** | Template now `isFeatureFlagEnabled` / `isMyNewFeatureEnabled` and **imports `parseBooleanFlag`** instead of hand-rolling; "why not `use…`" note present; `getFeatureFlags` sample updated; Change History row added |
| **R-6/R-7** no rename over-reach; scopes widened to `hooks/` | ✅ | **Pass** | Confirmed |
| **R-8** invariant documented on the prop **and** at the render site | ✅ | **Pass** | Both present |
| Docs match the new names | ✅ | **Pass** | **0** stale names in `CLAUDE.md` and `docs/FEATURE_FLAGS.md`. The two remaining `use*` mentions in the doc are historical records of *retired* helpers (`useCalibrationButton`, `useEnhancedTechnicalWorkflowReview`) — correct to leave |
| Runtime behaviour of the four consumed flags | ❌ | **Not run** | Needs a running app — user-owned, see hand-off |

#### R-1 — RefundModal, verified mechanically rather than by reading

QA compared the **multiset of non-comment source lines** of `RefundModal.tsx` at HEAD vs the working
tree. For a pure move this must be empty on both sides:

```
### components/payments/RefundModal.tsx
    code lines HEAD=610 now=611
    REMOVED code lines: 0
    ADDED code lines: 1
      + setDeleteBooking(false);
```

**Zero removed, exactly one added.** So both effect bodies, both dependency arrays and the
`canOfferDelete` alias are byte-identical, and the *only* new behaviour in the file is the R-1 reset
line. No guard was smuggled into either effect.

**Hook order is provably unchanged.** QA built the hook map both sides: 16 `useState` + 1 `useRef` +
5 `useEffect` = **22 hooks**, at identical positions, in identical relative order. At HEAD the early
return sat at `:233` with 20 hooks above and 2 below (**the workplan's §3.1 "18 / 20" is off by
two — see finding Q2**); now all 22 are above `if (!isOpen) return null` at `:301` and **none**
below. `canOfferDelete` reads only the prop `showDeleteBookingOption` (destructured, defaulted
`= false`), and the effects read only state declared far above — so the hoist introduces no
temporal-dead-zone and no new dependency.

**Why the hoist cannot change behaviour at any mount site — a stronger argument than enumeration.**
Either (a) no mounted render with `isOpen === false` occurs, in which case the two effects run on
*exactly* the same set of renders before and after → zero behaviour change; or (b) such a render does
occur, in which case **HEAD already throws** `Rendered fewer hooks than expected` → the change is a
strict improvement. There is no third case, so the hoist cannot regress anything.

Case (a) also holds today, re-verified at all five sites (QA confirmed there are exactly five
`<RefundModal` render sites repo-wide):

| Mount site | QA finding |
|---|---|
| `PaymentsSection.tsx:531`, `MoneyList.tsx:654`, `PaymentInvoiceList.tsx:1118` | `{X && <RefundModal isOpen={!!X}>}` — `isOpen` is `true` by construction whenever mounted |
| `PaymentTransactionList.tsx:1051` | **Exactly two writers exist** (`:248-249` set transaction+open together; `:1054-1055` clear both together). No unpaired write → no mounted closed render |
| `PaymentManagementModal.tsx:382` | Parent `CRMContactDrawerV2` has **exactly three writer sites** (`:2491-2492`, `:2996-2997`, `:3008-3009`), each pairing `showPaymentModal` with `selectedBookingForPayment`. Clearing the booking makes `paymentData = booking?.payment` undefined, so the modal bails at `if (!booking ‖ !paymentData) return null` (`:155`) **before** the RefundModal branch |

**The new reset line is a no-op today**, on two independent grounds: its `!isOpen` branch is
unreachable while mounted (above), and even on a hypothetical mount-with-`isOpen=false`,
`setDeleteBooking(false)` against the initial `false` is a React bail-out with no re-render. It only
ever does work in precisely the scenario that crashes at HEAD.

#### SA-5 — ProcessFlowSection, unreachability re-derived

```
### components/website/blocks/ProcessFlowSection.tsx
    REMOVED code lines: 7   (6 = the dead branch, 1 = the replaced JSX comment)
    ADDED code lines:   5   (all 5 are the replacement JSX comment)
```

**No executable line was added.** `IntakeStep` is **module-local (not exported)** with **exactly one
render site** — `:2741`, guarded by `currentStep === 'intake' && !intakeTemplate &&
intake_fields.length > 0` — and `fields={intake_fields}` passes the same array straight through.
`hasIntake` (`:1957`) gates the step upstream on the same condition. So `fields.length === 0` was
unreachable inside the component and the deleted `useEffect` never ran: **nothing changes for the
public booking flow**. `useEffect` remains used 9× elsewhere in the file, so the import stays live
(confirmed: no new unused-import warning).

#### R-3 — the guard genuinely fires (QA's own negative control)

Rather than editing production code, QA created a throwaway file containing **all three** defect
shapes the config claims to cover, ran the gate, then deleted it.

```
BASELINE                 npm run lint:hooks  -> exit 0
INJECT 3 violations      npm run lint:hooks  -> exit 1, 3 errors (3 problems, 0 warnings)
   shape 1: use*-named plain function called from a plain function   -> caught
   shape 2: useEffect after an early return                          -> caught
   shape 3: useEffect inside an if                                   -> caught
REVERT (file deleted)    npm run lint:hooks  -> exit 0
```

**Bonus confirmation:** the probe carried a top-of-file
`/* eslint-disable react-hooks/rules-of-hooks */`. It was correctly **ignored** — `--no-inline-config`
does what the header claims, so a file cannot disable its way past the gate.

**Workflow shape:** `react-hooks-guard.yml` has **no `paths:` filter** and matches
`admin-authz-guard.yml` step-for-step (same triggers, `permissions: contents: read`, `concurrency`
with `cancel-in-progress`, `timeout-minutes: 15`, `fetch-depth: 2`, the scope step, `npm ci`, the
run step, the skip-summary step). It does carry the shared *scope* step; QA verified that is **not**
a path filter in effect — `.github/ci/non-deploying-change.sh` skips only `docs/`, `scripts/`,
`.claude/` and root-level `*.md`, and every path under `app|lib|components|hooks` falls to the
catch-all and forces the gate to run. Confirmed against the script's own branch logic. See finding
Q4 for the residual coupling.

---

### Issues found

No High-severity bug. Nothing here blocks the commit; Q1 and Q4/Q5 are carry-forward items.

#### Bugs
*(none introduced by this change)*

#### Pre-existing defects confirmed and quantified

**Q1 — `featureFlags.test.ts` gives far less cover than its 44 tests suggest. (Medium, pre-existing,
out of scope — recommend a follow-up.)** The Dev's F1 is correct but understates it:

1. The 19 unprefixed `process.env.USE_THREAD_BASED_AGENT_CREATION` writes fail 4 "should be true"
   cases **and make the passing "should be false" cases vacuous** — they would pass against a
   function that simply `return false`. The thread flag has effectively **zero** real coverage.
2. Only **3 of the 7** readers are tested at all. `isNewAgentCreationUIEnabled`,
   `isMoveToCalibrationAfterCreationEnabled`, `isAIDataLayerEnabled` and
   `isBusinessDeleteSurfaceVisible` have **no test whatsoever** — including the flag with the most
   production call sites (calibration, 3 sites) and the one gating the whole builder UI.

   *Consequence for this cycle:* the automated safety net under the rename is thinner than the green
   tick implies. What actually carries the change is gate V2's byte-level proof plus V3 — which is
   why QA re-derived V2 from scratch rather than trusting it.

#### Documentation / process (Low)

**Q2 — §3.1's hook arithmetic is wrong.** It says 18 hooks closed / 20 open; the real counts are
**20 / 22**. The conclusion (two extra hooks when open) is unaffected. Worth correcting so a future
reader auditing the hook map does not think they have miscounted.

**Q3 — §6 "Files to create / modify" is now stale and should not be used as the commit checklist.**
It states `lib/business-os/purge/purgeAuthz.ts` is **"Not modified"**, but SA's R-4 required a change
there and one was made (comment-only, +13 lines). It also still lists
`featureFlags.naming.guard.test.ts` as *create* although R-3 superseded it (correctly not created),
and omits `package.json`, `eslint.hooks.config.mjs` and `.github/workflows/react-hooks-guard.yml`.
**§Commit Info is correct and complete — RM should work from that.**

**Q4 — the guard's effectiveness is now coupled to a shared script, and that is undocumented in the
workplan. (Medium, carry-forward.)** R-3 asked for "no `paths:` filter"; the workflow honours that
literally, but the scope step gives the same *effect* through
`.github/ci/non-deploying-change.sh`. QA verified it is safe **today** (fails open; every
`app|lib|components|hooks` path forces a run). The residual risk is that the guard's coverage is now
a property of a file that is shared with the Vercel ignore rule and the two other guards: **if anyone
ever adds `components/` or a broad glob to that script's skip list, this guard silently stops running
and goes green.** Suggest a one-line comment in `non-deploying-change.sh` naming the three workflows
that depend on its fail-open behaviour.

**Q5 — the guard blocks nothing yet. (Carry-forward, user action.)** Already stated honestly by Dev
and SA; repeating it so it is not lost: `React hooks rules guard` must be added under
**Settings → Branches → branch protection for `main` → Require status checks to pass before
merging**, matched **by job name**. Until then a new violation merges with a red tick.

#### Notes for RM (informational)

- **Rebase, no conflict expected.** `origin/main` has advanced past the branch base `47bef914`. Of
  the 13 changed files only `CLAUDE.md` also changed on main, and that change is in the *Key
  Documentation* table (~line 770) while this branch edits *§ Feature Flags* (~lines 486–520) —
  disjoint regions, clean auto-merge.
- **`CLAUDE.md` is the user's configuration file.** SA records the user approved this hunk in-session
  (SA-7 / T0.2). QA cannot verify that consent independently — please re-confirm before committing.
- The worktree contains a stale `.next/` from the Dev's build check; it accounts for 4 generated-type
  tsc errors and is gitignored. Not part of the change.
- **Do not squash.** Gate V2's evidence depends on commit 1 containing nothing but the rename.

---

### QA runtime hand-off — exactly what must be checked with the app running (V4 + V5)

Everything below needs a dev server and is **not** QA's to run. It is ordered so it can be done in
**one pass**.

> ⚠️ **Read this first or the whole matrix will report false failures.** `NEXT_PUBLIC_*` values are
> **inlined at build time** by Next.js. **Restart the dev server after every flag change** — editing
> `.env.local` and only refreshing the browser leaves the old value compiled in, which looks exactly
> like "the flag is stuck", i.e. the precise failure V5 exists to detect. §8.3 does not say this.

**Capture for V4 (do it once, at the start):** run `npm run dev:pretty`, load
`/v2/agents/new` and `/v2/agent-list`, and capture every `Feature flag evaluated` line. The `flag:`
field is the **env-var literal**, so it is invariant under the rename — the set of lines and every
`value`/`default` must match a capture from pre-change code. A pre-change capture can be taken from
the main repo checkout (it is at `origin/main`, i.e. pre-change for these files) without disturbing
the worktree.

| # | Env var | Set to | Restart, then verify | Expected |
|---|---|---|---|---|
| 1a | `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` | `true` | `/v2/agents/new` → create an agent | V6 IntentContract pipeline runs (`page.tsx:1287` `useV6` true) |
| 1b | same | `false`/unset | same | Falls to the V4 path — **must visibly differ from 1a** |
| 2a | `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION` | `true` | `/v2/agents/new` after creation **and** `/v2/agent-list` | Calibration choice card shows (`:1629`); left-rail **Step 8** card renders (`:2587`); `calibrationGateOn` true in the list (`agent-list:167`) |
| 2b | same | `false`/unset | same | Auto-redirect to `/agents/[id]`; **no** Step 8; gate off in the list. **This flag has 3 call sites — check all three, they were renamed independently** |
| 3a | `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` | `true` | agent-creation entry | `ConversationalAgentBuilderV2` (`AgentBuilderParent:515`) |
| 3b | same | `false`/unset | same | Legacy `ConversationalAgentBuilder` |
| 4a | `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` | `true` | agent creation | Thread-based flow. **Two independent call sites** — `useThreadManagement.ts:55` *and* `useConversationalBuilder.ts:57`; exercise a path that reaches each |
| 4b | same | `false`/unset | same | Legacy flow |
| 5 | `NEXT_PUBLIC_USE_V6_REVIEW_MODE` | — | — | **N/A — no production consumer.** Record as N/A, do not pass it silently |
| 6 | `NEXT_PUBLIC_USE_AI_DATA_LAYER` | — | — | **N/A — no consumer of the helper**; `chat-v2/route.ts:67` reads `process.env` directly and is untouched |
| 7 | `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` | both | delete surface | **N/A for the renamed reader — it has no consumer.** The live path is the *server* `isBusinessDeleteSurfaceEnabled()` in `purgeAuthz.ts`, which this branch did not change. If exercised anyway: the server must still refuse for non-admins |

> Note: `isBusinessDeleteSurfaceVisible` is the one reader with **no** `clientLogger.debug` line, so
> V4's log oracle cannot observe it. It also has no consumer, so there is nothing to observe.

**Then §8.3 B1–B9 (RefundModal money paths)** — the highest-consequence manual work in this cycle:

- **B1–B5** open/close/reopen from each of the five mount sites; the pass condition is specifically
  **no `Rendered fewer hooks than expected` in the console**.
- **B6** arm *delete booking*, switch full → partial: the switch must clear (effect@308 still fires
  from its new position).
- **B7** on a payment with a live plan, arm *delete booking*: *stop plan* must be forced on
  (effect@319 still fires).
- **B8** full refund + delete booking on a booking with a live plan: plan stops, refund succeeds.
- **B9 (new, R-1)** arm *delete booking*, close the modal, reopen: it must come back **disarmed**.
  Expected to behave identically to today because every caller unmounts on close — the line is
  defensive.

**Then §8.3 C1–C3** (intake with legacy `intake_fields`; empty `intake_fields`; `intakeTemplate`
path) and **§8.3 D** (one agent created end-to-end on default env).

---

### Final status

- [x] **Static scope: PASS.** Every claim QA was asked to verify independently was reproduced, and
      two gates (V2, V6) were re-derived in a stronger form than the Dev's. No High-severity issue;
      no bug introduced by this change. The rename is mechanically proven pure; the RefundModal hoist
      adds exactly one line of new behaviour and cannot regress any mount site; the deleted
      ProcessFlowSection branch is provably unreachable; the CI guard genuinely fires.
- [ ] **Not clear to commit yet** — **V4 runtime half and V5 remain open and are user-owned.** V5 is
      the only gate that can distinguish "flag works" from "flag stuck", which is the one failure mode
      `next build` provably cannot catch here.
- [ ] Carry-forward, non-blocking: **Q1** (follow-up to fix the unprefixed env vars and cover the 4
      untested readers), **Q4** (note the guard's dependency on the shared skip script), **Q5**
      (make `React hooks rules guard` a required status check).

---

## Commit Info

_RM to populate._

**Dev note — the five-commit split is load-bearing, do NOT squash.** Gate V2 (pure token
substitution) is only meaningful against a commit that contains nothing but the rename; squashing
destroys the evidence SA's review walks. Suggested split of the 13 changed files:

| # | Commit | Files |
|---|---|---|
| 1 | `refactor: rename feature-flag readers from use* to is*Enabled` | `lib/utils/featureFlags.ts`, `lib/business-os/purge/purgeAuthz.ts`, `app/v2/agents/new/page.tsx`, `app/v2/agent-list/page.tsx`, `components/agent-creation/AgentBuilderParent.tsx`, `components/agent-creation/conversational/hooks/useThreadManagement.ts`, `components/agent-creation/useConversationalBuilder.ts`, `lib/utils/__tests__/featureFlags.test.ts` |
| 2 | `fix: hoist RefundModal effects above the early return; reset deleteBooking on close` | `components/payments/RefundModal.tsx` |
| 3 | `fix: remove unreachable hook-bearing branch in IntakeStep` | `components/website/blocks/ProcessFlowSection.tsx` |
| 4 | `docs: rename flag readers and fix the flag-authoring template` | `CLAUDE.md`, `docs/FEATURE_FLAGS.md`, `docs/workplans/REACT_HOOKS_RULES_VIOLATIONS_WORKPLAN.md` |
| 5 | `ci: add rule-scoped react-hooks guard` | `package.json`, `eslint.hooks.config.mjs`, `.github/workflows/react-hooks-guard.yml` |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-20 | Workplan created | Diagnosed all 14 `react-hooks/rules-of-hooks` violations against `47bef914`. Established that 11 of 14 stem from seven misnamed plain functions in `lib/utils/featureFlags.ts` (evidence: no React import in the module, pure `process.env` + `parseBooleanFlag` bodies). Three are genuine React violations: `RefundModal` ×2 (real but latent — proved all five mount sites currently avoid a mounted `isOpen=false` render) and `ProcessFlowSection` ×1 (unreachable branch per the `:2728` guard). Recorded the full call-site inventory, the CI blind spot (`ignoreBuildErrors` + `ignoreDuringBuilds` mean `npm run build` cannot catch a missed rename), the `tsc --noEmit` OOM, the 199 `console.*` calls in touched files, and 9 open questions for SA. Status: Planning — no code written. |
| 2026-09-21 | SA review | Approved with conditions R-1 … R-8. Decisions: clean break (SA-1); rename `getFeatureFlags()` keys too, with the correction that a stale key is a TS2339 **compile** error rather than a silent `undefined` (SA-2); `isBusinessDeleteSurfaceVisible`, kept, not deleted (SA-3); delete the dead `ProcessFlowSection` branch (SA-5); `console.*` out of scope (SA-9). SA-8 rejected as proposed — a Jest guard would never run, since no workflow runs `npm test`. |
| 2026-09-21 | Implemented | All of R-1 … R-8 applied. **R-1**: found and closed the residual-state gap — the reset effect never cleared `deleteBooking`, the one flag that deletes a customer's booking; corrected §3.1's wrong mechanism for why effect@319 is inert (dependency array, not the reset effect). **R-3**: added `npm run lint:hooks` (ESLint scoped to the single rule, `--no-inline-config` so it cannot be disabled in-file) + `.github/workflows/react-hooks-guard.yml`, modelled on `admin-authz-guard.yml`; verified with a negative control that it actually fails on an injected violation. **R-4**: reciprocal cross-reference comments in `featureFlags.ts` and `purgeAuthz.ts`. **R-5**: rewrote the flag-authoring template — it had produced *both* halves of the defect (`use…` naming *and* a hand-rolled parser instead of `parseBooleanFlag`). **R-6**: both rename traps avoided — the local `const useAIDataLayer` in `chat-v2/route.ts` untouched and that file absent from the diff; `useNewUI`/`useThreadFlow` locals left alone. **R-7**: all lint scopes widened to `hooks/`. **R-8**: invariant documented on `IntakeStepProps.fields` *and* at the render site. Result: `rules-of-hooks` **14 → 0** with every other ESLint error count unchanged. Gates V1/V2/V3/V6 pass; V4 partial, V5 owed by QA. Three pre-existing problems surfaced and reported rather than fixed: `featureFlags.test.ts` is already red (6/44 fail — tests set an unprefixed env var the source never reads), the full suite has 129 pre-existing unrelated failures, and `npm run build` needs CI env vars locally. Status: Code Complete, uncommitted. |
