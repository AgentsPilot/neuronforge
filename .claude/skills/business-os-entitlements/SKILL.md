---
name: business-os-entitlements
description: >-
  The registration rules around the Business OS entitlements module (what a plan includes). Use whenever a change IMPORTS ANYTHING from lib/business-os/entitlements/ — including a type-only import like `import type { Labels }` — or writes a capability id or a tier name ('basic', 'pro') as a string literal, flips a capability's lifecycle in catalog.ts, edits the tier matrix or cohorts, or gates a feature by plan. Also use when reviewing or testing such a change. Prevents the "Business OS entitlements invariants" check going red on main, which has happened three times from work that was not about entitlements at all.
---

# business-os-entitlements

Use this whenever your change **touches the entitlements module from the outside**, even in passing. The misses so far were not entitlements work: a credit-diary change borrowed a type, an admin screen borrowed a helper, a reminders change switched a feature on. Each one compiled, worked, and turned `npm run test:bos-entitlements` red on main, where it stayed until someone noticed.

That suite is **not a required check**, so a red result does not block a merge. Catching it is this skill's job, before the commit.

**Canonical sources (read + link, do not duplicate):**
- **Architecture and procedures:** `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` (§ Adding or changing a tier, § Removing a capability from a tier)
- **Tier procedure, in the file itself:** the header of `lib/business-os/entitlements/config/tierMatrix.ts`
- **The guards:** `lib/business-os/entitlements/__tests__/` — `enforcementPoints.test.ts`, `tierLiteral.forbidden.test.ts`, `tierMatrix.snapshot.test.ts`, `customerPlanView.test.ts`, `accountSeam.guard.test.ts`

---

## Why the module is fenced

Nothing is enforced yet (production runs `shadow`), and the admin screen says, per capability, whether a gate exists. That statement must never be false. So **any file outside the module that reaches into it must say what it is**: a gate, or a recorded non-gate. The guard cannot tell a type import from a gate, and it is not meant to: a person decides, and writes it down.

---

## The tripwires

| You are about to… | The guard that fails | What to do in the same change |
|---|---|---|
| **Import anything** from `lib/business-os/entitlements/**` in a file outside it (app, lib, components, hooks; tests exempt). **Type-only imports count.** | `enforcementPoints.test.ts` › backward | **A gate** (it can refuse something): register the file under its capability in `config/enforcementPoints.ts` → `ENFORCEMENT_POINTS`. **Not a gate:** add `{ file, symbols, why }` to `KNOWN_NON_GATE_IMPORTERS` in `__tests__/enforcementPoints.test.ts` |
| Add or remove an imported symbol in a file **already** in `KNOWN_NON_GATE_IMPORTERS` | same suite › "imports exactly the symbols its exemption allows" | Update that entry's `symbols` to match exactly. A new symbol means deciding again whether the file is now a gate |
| Remove the last import from a listed file | same suite › "still imports the module" | Delete its entry. The lists are equality-checked and must not go slack |
| Write a **capability id** as a string literal (`'payments.invoices'`) in product code | `enforcementPoints.test.ts` › "finds no capability id…" | Register it in `ENFORCEMENT_POINTS` if it gates; otherwise add it to `KNOWN_NON_GATES` in the same test, with a reason |
| Write a **tier name** (`'basic'`, `'pro'`, or any name in `TIER_ORDER`) as a literal outside `entitlements/config/**` | `tierLiteral.forbidden.test.ts` | Don't. Branch on a **capability**, never on a tier: moving a capability between plans must stay a config edit. Unrelated old uses are baselined by count |
| Switch a capability's `lifecycle` from `not_built` to `available` in `config/catalog.ts` | `customerPlanView.test.ts` (champion parity), `tierMatrix.snapshot.test.ts` | Grant it in `BASE` in `config/tierMatrix.ts` too: every `available` capability is on in every tier at its highest value (paid tiers differ ONLY by `chat.*` and `ai.actions`). Then run `npm run entitlements:snapshot` |
| Lower or remove a capability from a tier | `tierMatrix.snapshot.test.ts` | Two lines plus a version bump: the value, an entry in `removals`, and `version`. **Taking something away from paying customers is a business decision**, so take it to the user through the BA, not as a code choice |
| Take an account id for the service in new code | `accountSeam.guard.test.ts` | Go through `resolveAccountId`; never pass a raw user id to the service |

### Writing a `KNOWN_NON_GATE_IMPORTERS` entry

```ts
{
  file: 'lib/business-os/llm/aiActionAudit.ts',          // repo-relative, forward slashes
  symbols: ['Labels'],                                    // EXACTLY what the file imports from the module
  why: 'Credit deduction slice 1 (fc1856bd): … borrows the `Labels` TYPE … it can resolve no account and refuse nothing. If this file ever imports a value from the module, it is being asked to gate and this suite says so.',
},
```

- `why` must be over 30 characters. Say **which change** introduced the import, **what it uses it for**, and **why it cannot refuse anything**.
- A file that calls `check()` / `decide()`, or otherwise refuses a request by plan, is a **gate**. It goes in `ENFORCEMENT_POINTS`, never in this list.
- Reading a snapshot for display (`getSnapshot`, a plan badge, a view builder) is not a gate. Say so in `why`.

---

## Definition of done

```bash
npm run test:bos-entitlements
```

Run it **before handing over for review** whenever the diff touches any row of the table above. It is the exact command the "Business OS entitlements invariants" CI job runs (~10 s). Report the result in the workplan. "Not a required check" is not a reason to skip it.

---

## The misses this skill exists for

| Date | Change | Missed | Fixed in |
|---|---|---|---|
| 2026-09-26 | Admin Businesses summary route imported `isBusinessOsTenant` | Non-gate importer not registered | 9ffdf05b |
| 2026-09-28 | Payment reminders built; catalog flipped to `available` (#127) | Not granted in `BASE`, so champion parity broke (28 vs 29) | 674ea389 (#129) |
| 2026-09-28 | Credit deduction slice 1 (#130) added `import type { Labels }` to `aiActionAudit.ts` | Non-gate importer not registered; main red through #132, #133 | #134 |

---

## Review checklist (SA code review / QA)

- [ ] Every file in the diff that is outside the module and imports from it is in `ENFORCEMENT_POINTS` or `KNOWN_NON_GATE_IMPORTERS`, and the `symbols` match its imports exactly
- [ ] Every `KNOWN_NON_GATE_IMPORTERS` entry added in the diff is truly not a gate (no `check()` / `decide()` / refusal by plan)
- [ ] No new tier-name literal outside `entitlements/config/**`; no new capability-id literal left unregistered
- [ ] A capability switched to `available` is granted in `BASE`, and `entitlements.snapshot.json` was regenerated with `npm run entitlements:snapshot`, not hand-edited
- [ ] A lowered or removed capability has a `removals` entry, a version bump, and a recorded user decision
- [ ] `npm run test:bos-entitlements` was run on the final diff and is green (QA: run it yourself)

---

## When NOT to use

- Work inside `lib/business-os/entitlements/**` only, with no new importer outside it and no catalog/matrix change. The module's own tests cover it; run them anyway.
- Designing new entitlements behaviour (Slice 2 enforcement, metering, billing). Start from `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` and the requirement; this skill covers only the registration rules.
