/**
 * The registry that makes the "no gate built yet" marker self-clearing (SA R-1).
 *
 * A note in a component that somebody has to remember to delete is not a
 * mechanism — it is a promise about a future code review. This suite is the
 * mechanism, and it works in both directions:
 *
 *   **Forward.** Every file `ENFORCEMENT_POINTS` names must exist and must
 *   actually contain the capability id it claims to gate. A registry entry is
 *   therefore a checkable claim, not a declaration.
 *
 *   **Backward.** A scan finds every file outside this module that names a
 *   capability id. If one appears that is not registered, this fails — so a
 *   gate cannot ship while the page still says none exists.
 *
 * The marker on the page disappears for a capability in the same commit that
 * makes it false, and cannot be removed before then.
 */

import * as fs from 'fs';
import * as path from 'path';

import { CAPABILITIES } from '@/lib/business-os/entitlements/config/catalog';
import {
  ENFORCEMENT_POINTS,
  hasEnforcementPoint,
} from '@/lib/business-os/entitlements/config/enforcementPoints';

const ROOT = process.cwd();
const CAPABILITY_IDS = Object.keys(CAPABILITIES);

/** Where a capability id may legitimately appear without being a gate. */
const NOT_A_GATE = [
  // The module itself: config, resolver, schema, report, the admin view.
  'lib/business-os/entitlements/',
  // Tests and fixtures anywhere.
  '__tests__/',
  '__fixtures__/',
  '__mocks__/',
  'tests/',
  // Documentation and SQL.
  'docs/',
  'supabase/',
  'scripts/',
];

/** Source files that could hold a gate. Walked, never listed. */
function productFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = full.replace(ROOT + path.sep, '').split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (['node_modules', '.next', '.git', '.claude'].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      if (NOT_A_GATE.some((prefix) => relative.startsWith(prefix) || relative.includes(prefix))) continue;
      found.push(relative);
    }
  };

  for (const dir of ['app', 'lib', 'components', 'hooks']) walk(path.join(ROOT, dir));
  return found.sort();
}

/**
 * Places a capability id appears for an unrelated reason.
 *
 * Checked by EQUALITY, like the FR-12 baseline: if one of these stops naming
 * the id, its entry must go in the same commit, so the list cannot go slack.
 * Each needs a reason — "it is noisy" is not one.
 */
const KNOWN_NON_GATES: ReadonlyArray<{ file: string; capability: string; why: string }> = [
  {
    file: 'lib/business-os/LanguageContext.tsx',
    capability: 'payments.invoices',
    why: 'A UI translation dictionary keyed by dotted strings. The key collides with the capability id by coincidence and gates nothing — it maps to the word "Invoices" in three languages.',
  },
];

const files = productFiles();
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/** Source with comments removed: prose about a capability is not a gate. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('forward: every registered gate is a real one', () => {
  const entries = Object.entries(ENFORCEMENT_POINTS);

  it('registers only capabilities the catalog has', () => {
    for (const [capability] of entries) {
      expect({ capability, known: CAPABILITY_IDS.includes(capability) }).toEqual({
        capability,
        known: true,
      });
    }
  });

  it.each(entries.length > 0 ? entries : [['(none registered)', [] as readonly string[]]])(
    '%s is gated by files that exist and name it',
    (capability, gateFiles) => {
      if (capability === '(none registered)') {
        // Slice 1 wired no call site. This case exists so the suite states that
        // rather than passing silently on an empty list.
        expect(Object.keys(ENFORCEMENT_POINTS)).toEqual([]);
        return;
      }

      for (const file of gateFiles) {
        expect({ file, exists: fs.existsSync(path.join(ROOT, file)) }).toEqual({ file, exists: true });
        expect({ file, names: codeOf(read(file)).includes(capability) }).toEqual({ file, names: true });
      }
    }
  );
});

describe('backward: a gate cannot ship unregistered', () => {
  it('scans a non-trivial part of the product', () => {
    // A scan whose file list quietly stopped matching would pass for ever.
    expect(files.length).toBeGreaterThan(300);
  });

  it('finds no capability id in product code that the registry does not know about', () => {
    // This is the assertion that makes the page's marker trustworthy: the day
    // somebody writes the chat surface gate (FR-46), this fails until the
    // registry names it — and registering it is what clears the marker.
    const unregistered: string[] = [];

    for (const relative of files) {
      const code = codeOf(read(relative));
      for (const capability of CAPABILITY_IDS) {
        if (!code.includes(`'${capability}'`) && !code.includes(`"${capability}"`)) continue;
        if ((ENFORCEMENT_POINTS[capability] ?? []).includes(relative)) continue;
        if (KNOWN_NON_GATES.some((entry) => entry.file === relative && entry.capability === capability)) continue;
        unregistered.push(`${relative} names ${capability}`);
      }
    }

    expect(unregistered).toEqual([]);
  });

  /**
   * The literal scan alone is not enough (QA NEW-5).
   *
   * A plausible Slice 2 gate writes no capability id at all:
   *
   *     import { CHAT_SURFACE } from '@/lib/business-os/entitlements/…';
   *     const decision = decide({ capability: CHAT_SURFACE, … });
   *
   * The string lives in the entitlements module, which this scan excludes, so
   * nothing matches and the page would go on saying "no gate yet" for ever —
   * defeating the self-clearing property R-1 is built on.
   *
   * So the second rule is about REACHING the module at all. Anything outside it
   * that imports from it is either a gate, or something that must say why it is
   * not. That is a much coarser net, and it is the right coarseness: a file
   * cannot refuse a capability without talking to the resolver.
   */
  const ENTITLEMENT_IMPORT = /from\s+['"][^'"]*business-os\/entitlements\//;

  /**
   * Files that reach the module for a reason that is not a gate.
   *
   * Equality-checked like the other list: an entry that stops applying must be
   * removed in the same commit.
   */
  /**
   * Files that reach the module for a reason that is not a gate — and the exact
   * symbols each may import.
   *
   * ── Why symbols and not call names (QA R3-1) ───────────────────────────────
   * This was a DENYLIST: chat-v4 was asserted not to contain `decide(`,
   * `.check(`, `requireEntitlement` or `withEntitlement`. QA walked a plausible
   * FR-46 gate straight through it — `resolveEntitlements` imported, the call
   * named `qaChatSurfaceGate`, no capability literal anywhere — and all sixteen
   * tests stayed green while the page would have gone on saying "no gate yet".
   *
   * A denylist has to predict the name somebody will choose. An allow-list does
   * not: a gate has to reach the resolver **through some imported symbol**, and
   * every symbol here is one nobody can gate with. Adding an import to one of
   * these files now fails this suite until a human says which it is.
   *
   * Equality-checked, so an entry that stops applying must be removed in the
   * same commit.
   */
  const KNOWN_NON_GATE_IMPORTERS: ReadonlyArray<{
    file: string;
    symbols: readonly string[];
    why: string;
  }> = [
    {
      file: 'app/api/business-os/chat-v4/route.ts',
      // The one symbol that cannot refuse anything: it RECORDS what a plan
      // would have needed. This is the file the real gate will be added to
      // (FR-46), and the day it imports anything else this suite says so.
      symbols: ['shadowChatPlan'],
      why: 'SHADOW recording, not a gate: `shadowChatPlan` records what a plan WOULD have needed and can refuse nothing. On the day this file gains a gate it moves into ENFORCEMENT_POINTS, which is what clears the marker on the admin screen.',
    },
    {
      file: 'app/api/admin/business-os/entitlements/plans/route.ts',
      symbols: ['buildAdminPlansView'],
      why: 'The admin read endpoint. It renders the configuration for a screen and refuses nothing.',
    },
    {
      file: 'app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts',
      symbols: [
        'adminOpSchema',
        'executeAdminOp',
        'isBusinessOsTenant',
        'describeCapabilityValue',
        'isGrantingValue',
        'getEntitlementConfig',
        'getEntitlementService',
        'CACHE_TTL_SECONDS',
        'resolveAccountId',
        'getEntitlementMode',
      ],
      why: 'The admin inspect-and-change endpoint. It reports and edits ONE account plan through the audited op union; it gates no product feature. `isGrantingValue` here answers a question for a screen, it does not refuse a request.',
    },
    {
      file: 'app/api/admin/business-os/entitlements/launch/route.ts',
      symbols: ['getEntitlementConfig'],
      why: 'The admin launch operation. Slice 2 owns its execution; it refuses no capability.',
    },
    {
      file: 'app/api/admin/business-os/entitlements/shadow-report/route.ts',
      symbols: ['buildShadowReport', 'getEntitlementMode'],
      why: 'The admin shadow report. It counts what WOULD be refused and refuses nothing itself.',
    },
    {
      file: 'app/api/admin/business-os/accounts/[accountId]/summary/route.ts',
      symbols: ['isBusinessOsTenant'],
      why: 'The admin Businesses panel summary (admin reorganisation slice 2b). It asks whether an account is a Business OS tenant so the panel can say "Not a Business OS account", using the same check as the entitlements route; it is read-only and refuses no capability.',
    },
    {
      file: 'app/api/admin/health-summary/route.ts',
      symbols: ['getEntitlementModeSetting'],
      why: 'The admin Health landing (admin reorganisation slice 4). It reads which entitlements mode is in effect, and whether an `enforce` request was refused, to colour one tile; it resolves no account and refuses no capability.',
    },
    {
      file: 'app/business-os/layout.tsx',
      // `type PlanBadge` as the extractor sees it — an inline type import keeps
      // its `type` keyword, which is worth leaving visible: it says at a glance
      // that the layout imports one VALUE-bearing function and one type.
      // Just the one now: the read itself moved into
      // `lib/business-os/entitlements/readPlanBadge.ts` so its three safety
      // guarantees could be tested (QA-10). The layout awaits one function.
      symbols: ['readPlanBadge'],
      why: 'The Business OS chrome reads the plan ONCE, server-side, to decide whether to show the quiet Founding Partner pill (2026-09-27). It refuses nothing and gates nothing: every failure returns `null` and renders no pill. The read is `getSnapshot`, not `check` — if it ever becomes `check`, the product is being gated from a layout and belongs in ENFORCEMENT_POINTS.',
    },
    {
      file: 'lib/business-os/llm/aiActionAudit.ts',
      symbols: ['Labels'],
      why: 'Credit deduction slice 1 (fc1856bd): the AI action catalogue borrows the `Labels` TYPE for its en/he/es credit-diary labels. A type-only import from a file with no imports — erased at compile time, it can resolve no account and refuse nothing. If this file ever imports a value from the module, it is being asked to gate and this suite says so.',
    },
    {
      file: 'app/api/business-os/entitlements/my-plan/route.ts',
      symbols: ['buildCustomerPlanView', 'getEntitlementService', 'resolveAccountId'],
      why: 'The CUSTOMER read behind the "Your plan" settings section (S-4a step 1) — the first non-admin file in this list. It resolves the session account and formats the answer; it refuses nothing, and it has no capability id to gate on. Note `getEntitlementService` here is `getSnapshot`, which reports every capability, and NOT `check()`, which is the call that would make this a gate: if this file ever calls `check`, it belongs in ENFORCEMENT_POINTS instead of here. `resolveAccountId` is the account seam (SA P-1), which every external caller of the service must go through — `accountSeam.guard` enforces that product-wide.',
    },
    // ── Business OS invites (invite-only signup, Slice 0) ──────────────────
    // None of these refuses a capability. They read the invite config (expiry
    // options, invite types, the issuance policy) and PREVIEW the plan an
    // invite offers, the way the admin Tiers screen previews every plan.
    // Redemption (Slice 1) writes a plan row; it does not gate a feature either.
    {
      file: 'app/api/admin/business-os/invites/route.ts',
      symbols: ['getEntitlementConfig', 'getEntitlementMode'],
      why: 'The admin invite list/create endpoint. It passes the config to the invite operations and reports the mode so the page can say champion access is recorded, not enforced (GR-5). It refuses no capability.',
    },
    {
      file: 'app/api/admin/business-os/invites/[inviteId]/revoke/route.ts',
      symbols: ['getEntitlementConfig'],
      why: 'The admin invite revoke endpoint. It passes the config to label the revoked invite for the list. It refuses no capability.',
    },
    {
      file: 'app/api/public/invites/validate/route.ts',
      symbols: ['getEntitlementConfig'],
      why: 'The public invite check. It passes the config so the offered plan can be described and a grant that left the config refused cleanly (GR-1). It resolves no real account and refuses no capability.',
    },
    {
      file: 'lib/business-os/invites/adminInviteOps.ts',
      symbols: [
        'CHAMPION_ACCESS_MONTHS_MAX',
        'EntitlementConfig',
        'INVITE_ISSUANCE_POLICY',
        'INVITE_LINK_EXPIRY',
        'INVITE_TYPES',
        'PAID_INVITE_TYPE',
        'planLabel',
        'type InviteTypeId',
      ],
      why: 'The admin invite operations. They read the invite config (T-14, T-15) and label plans for the admin list with `planLabel`. The Paid refusal here is an issuance rule on WHO MAY INVITE, not a capability gate on what an account may do.',
    },
    {
      file: 'lib/business-os/invites/inviteOffer.ts',
      // No resolver (SA M-3): the resolution lives in `planOfferView.ts`, inside
      // the module, and this file gets only its read-only result.
      symbols: ['EntitlementConfig', 'INVITE_TYPES', 'INVITE_TYPE_IDS', 'describePlanOffer', 'type PlanOfferCategory'],
      why: 'Describes the plan an invite OFFERS through `describePlanOffer`, a read-only view inside the entitlements module that previews a plan the way `adminPlansView` and `customerPlanView` do. It imports no resolver and no decision function, so it cannot refuse a capability.',
    },
    {
      file: 'lib/business-os/invites/inviteSchemas.ts',
      symbols: ['CHAMPION_ACCESS_MONTHS_MAX', 'CHAMPION_INVITE_TYPE', 'INVITE_LINK_EXPIRY', 'PAID_INVITE_TYPE', 'TIER_ORDER'],
      why: 'Zod schemas for the invite routes, built from the config (C-7) so the expiry options and tier ids are never re-listed. Validation of a request body, not a capability gate.',
    },
    {
      file: 'lib/business-os/invites/publicInviteView.ts',
      symbols: ['EntitlementConfig', 'INVITE_ISSUANCE_POLICY'],
      why: 'The public invite view. It hands the config to `inviteOffer`, and (Slice 5a, F5a-10) reads the friend-invite switch `accountInvitesAvailable` to show an account-issued invite as "sign-up opens soon" or "unavailable". An issuance rule on an INVITE, keyed on who issued it; it resolves no account and refuses no capability.',
    },
    {
      file: 'lib/business-os/llm/chargeResolver.ts',
      symbols: ['currentCreditValue', 'type CreditValueVersion'],
      why: 'Credit deduction slice 3a: the one cost-to-credits conversion reads the credit value (`config/creditValue.ts`, data only) to turn an action cost into credits for the charge record. It MEASURES what an action cost; it resolves no account plan and refuses nothing. If it ever imports a resolver or a decision function, it is being asked to gate and this suite says so.',
    },
    {
      file: 'lib/business-os/invites/inviteRedemption.ts',
      symbols: ['CHAMPION_INVITE_TYPE', 'EntitlementConfig', 'INVITE_ISSUANCE_POLICY', 'isRedeemableCohortGrant', 'type InviteTypeId'],
      why: 'Invite-only signup Slice 1b: the redemption flow re-checks the issuance policy (T-15) and that the invite row is a decided, still-configured cohort grant (GR-1, RC-4 via `grantRules`) before claiming it. An issuance and grant-shape rule on an INVITE, not a capability gate on what an account may do.',
    },
    // ── Friend invites from a champion account (invite-only signup, Slice 5a) ──
    // An issuance rule on WHO MAY INVITE, keyed on the cohort, with no
    // capability: the `adminInviteOps.ts` precedent (SA T-17, F5a-4). The
    // lifetime allowance lives in `config/invites.ts`, not in the catalog. If it
    // ever moves to a capability, these files become gates and move to
    // ENFORCEMENT_POINTS.
    {
      file: 'lib/business-os/invites/friendInviteOps.ts',
      symbols: ['EntitlementConfig', 'FRIEND_INVITE_LIMITS', 'INVITE_ISSUANCE_POLICY', 'INVITE_LINK_EXPIRY', 'planLabel'],
      why: 'Invite-only signup Slice 5a: the champion friend-invite operations. They read the issuance policy (the champion cohort, the switch, the Essentials grant), the allowance and daily limit, and the default link expiry, and name the plan for the email with `planLabel`. The champion check reads the plan row directly, never `check()` or `getSnapshot()`: it is an issuance rule on who may invite, keyed on the cohort, with no capability, and the SQL send function is what decides. It refuses no capability.',
    },
    {
      file: 'lib/business-os/invites/friendInviteDeps.ts',
      symbols: ['EntitlementConfig', 'getEntitlementConfig'],
      why: 'Invite-only signup Slice 5a: the production wiring for the friend-invite routes. It hands the config to the operations only so the invitation email can name the plan. It resolves no account and refuses no capability.',
    },
    {
      file: 'app/api/business-os/friend-invites/route.ts',
      symbols: ['resolveAccountId'],
      why: 'Invite-only signup Slice 5a: the CUSTOMER route for a champion\'s friend invites (GET summary, POST send). It resolves the session account through the account seam (SA P-1) and nothing else from the module; who may invite is decided by `friendInviteOps` and the SQL function, keyed on the cohort, with no capability. It refuses no capability.',
    },
    {
      file: 'app/api/business-os/friend-invites/[inviteId]/revoke/route.ts',
      symbols: ['resolveAccountId'],
      why: 'Invite-only signup Slice 5a: the CUSTOMER route by which a champion revokes their own friend invite. It resolves the session account through the account seam (SA P-1) to scope the UPDATE; it reads no plan and refuses no capability.',
    },
    // ── Credit deduction slice 6a, 2026-09-30 — the owner credits card ──────
    {
      file: 'lib/business-os/credits/ownerCreditUsage.ts',
      symbols: ['creditAllowanceForDisplay', 'getEntitlementService', 'resolveAccountId'],
      why: 'Credit deduction slice 6a: the owner dashboard card reads its credit allowance for DISPLAY only. It resolves the session account through the seam (`resolveAccountId`), reads `getSnapshot` (never `check()` / `decide()`) and turns the snapshot into a figure with `creditAllowanceForDisplay`, which keeps the capability id inside the module. It refuses nothing: an owner over the allowance still sees their figures, and refusing by allowance is slices 8 and 10 through `check()`. If this file ever calls `check`, it is a gate and belongs in ENFORCEMENT_POINTS.',
    },
    // ── Credit deduction slice 11c, 2026-10-03 — the admin per-account credit view ──
    {
      file: 'app/api/admin/business-os/credits/accounts/[accountId]/route.ts',
      symbols: ['creditAllowanceDecision', 'getEntitlementService', 'isBusinessOsTenant', 'resolveAccountId'],
      why: 'Credit deduction slice 11c: the admin read-only credit view of ONE account. It asks whether the account is a Business OS tenant (`isBusinessOsTenant`, the same check as the entitlements and summary routes), resolves the path id through the account seam (`resolveAccountId`, required by `accountSeam.guard` for any file that reaches the service), reads `getSnapshot` for DISPLAY (never `check()` / `decide()`) and turns it into the allowance and its deciding layer with `creditAllowanceDecision`, which keeps the capability id inside the module. It refuses nothing: an account over its allowance is shown, not blocked. If this file ever calls `check`, it is a gate and belongs in ENFORCEMENT_POINTS.',
    },
    // ── Credit deduction slice 8a, 2026-10-03 — the admin "Credits left" column ─
    {
      file: 'lib/business-os/credits/adminCreditPercent.ts',
      symbols: ['creditAllowanceForDisplay', 'getEntitlementService', 'resolveAccountId'],
      why: 'Credit deduction slice 8a: the admin Businesses list shows each account\'s percentage of credits left, for DISPLAY only. It maps the list\'s rows through the account seam (`resolveAccountId`), reads `getSnapshots` (never `check()` / `decide()`) and turns each snapshot into a figure with `creditAllowanceForDisplay`, which keeps the capability id inside the module. It refuses nothing: every account is listed whatever its figure. If this file ever calls `check`, it is a gate and belongs in ENFORCEMENT_POINTS.',
    },
    // ── Credit deduction slice 8b, 2026-10-04 — the low-line audit record ─
    {
      file: 'lib/business-os/credits/creditLowLine.ts',
      symbols: ['creditAllowanceForDisplay', 'getEntitlementService', 'resolveAccountId'],
      why: 'Credit deduction slice 8b: after an AI charge is RECORDED, reads the account\'s plan allowance through the account seam (`resolveAccountId`, then `getSnapshot` — never `check()` / `decide()`) and `creditAllowanceForDisplay`, to decide whether the shown percentage left crossed the low line, and if so writes one admin audit entry. It refuses nothing: the charge is already written and the action continues whatever the figure. If this file ever calls `check`, it is a gate and belongs in ENFORCEMENT_POINTS.',
    },
    {
      file: 'lib/business-os/invites/paymentHoldGate.ts',
      symbols: ['resolveAccountId'],
      why: 'Invite-only signup Slice 5b (T-13 layer 2, SA Q-6): the payment-hold gate that four layouts call first. It uses `resolveAccountId` ONLY, as the account seam for the session account. It reads no plan row, no snapshot and no capability: the hold is keyed on the account LINEAGE (a friend or Paid invite with no first payment), not on a plan, so it is not a capability gate and has no place in ENFORCEMENT_POINTS. If this file ever reads a plan or calls `check()`, it becomes a gate and moves there.',
    },
    {
      file: 'lib/business-os/invites/redemptionDeps.ts',
      symbols: ['getEntitlementConfig'],
      why: 'Invite-only signup Slice 1b: the production wiring hands the config to the redemption flow so it can re-check the grant (GR-1). It resolves no account and refuses no capability.',
    },
    // ── Plan payments P-2b, 2026-10-06 — plan prices in Stripe ─────────────
    {
      file: 'lib/business-os/billing/planPriceCatalog.ts',
      symbols: ['TierId', 'allPlanLookupKeys', 'tierForPlanLookupKey'],
      why: 'Plan payments P-2b (workplan §3.3): the webhook price catalog reads the configured plan LOOKUP KEYS (`allPlanLookupKeys`) to ask Stripe which price ids are plan prices, and re-exports the key-to-tier mapping (`tierForPlanLookupKey`, `TierId` type) for P-3b. It maps Stripe price ids to plan names for the router and resolves no account; it refuses nothing by plan. If it ever calls `check()` / `decide()`, it is a gate and moves to ENFORCEMENT_POINTS.',
    },
    {
      file: 'lib/business-os/billing/planPriceCheck.ts',
      symbols: ['PLAN_STRIPE_PRICES', 'PlanStripePrice', 'TIER_MATRIX', 'TIER_ORDER', 'TierId'],
      why: 'Plan payments P-2b (workplan §3.4, SA-P12): a pure comparison of each tier\'s Stripe price with its DISPLAY price (`TIER_MATRIX.presentation.monthlyPriceUsd`), used by the price scripts and later by the P-3a checkout check. It reads configuration for comparison, resolves no account and refuses nothing by plan.',
    },
  ];

  /** Every symbol a file imports from the entitlements module. */
  function entitlementImports(relative: string): string[] {
    const code = codeOf(read(relative));
    const found = new Set<string>();

    // `import { a, b as c } from '…/business-os/entitlements/…'`, across lines.
    for (const match of code.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]*business-os\/entitlements\/[^'"]*['"]/g
    )) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) found.add(name);
      }
    }

    // `import X from` and `import * as X from`, which would otherwise be
    // invisible to the rule above.
    for (const match of code.matchAll(
      /import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*['"][^'"]*business-os\/entitlements\/[^'"]*['"]/g
    )) {
      found.add(match[1]);
    }

    return [...found].sort();
  }

  it('finds every file that reaches the entitlements module, and each is accounted for', () => {
    const importers = files.filter((relative) => ENTITLEMENT_IMPORT.test(codeOf(read(relative))));

    // Non-vacuity: the four admin routes import it today, so a scan finding
    // nothing would mean the regex stopped matching rather than that the
    // product stopped asking.
    expect(importers.length).toBeGreaterThanOrEqual(4);

    const unaccounted = importers.filter(
      (relative) =>
        !KNOWN_NON_GATE_IMPORTERS.some((entry) => entry.file === relative) &&
        !Object.values(ENFORCEMENT_POINTS).some((gateFiles) => gateFiles.includes(relative))
    );

    // A gate added in Slice 2 lands here whether or not it writes the id as a
    // literal, which is the property the marker depends on.
    expect(unaccounted).toEqual([]);
  });

  it.each(KNOWN_NON_GATE_IMPORTERS.map((entry) => [entry.file, entry.why] as const))(
    '%s still imports the module, for the reason recorded',
    (file, why) => {
      expect(ENTITLEMENT_IMPORT.test(codeOf(read(file)))).toBe(true);
      expect(why.length).toBeGreaterThan(30);
    }
  );

  it.each(KNOWN_NON_GATE_IMPORTERS.map((entry) => [entry.file, entry.symbols] as const))(
    '%s imports exactly the symbols its exemption allows',
    (file, symbols) => {
      // The assertion QA's mutation defeats if it is a denylist: a gate must
      // reach the resolver through SOME symbol, and none of these is one it can
      // be reached through. An extra import fails here, by name, until somebody
      // decides whether it is a gate.
      expect(entitlementImports(file)).toEqual([...symbols].sort());
    }
  );

  it('the symbol reader sees the shapes an import can take', () => {
    // Non-vacuity: a reader that silently returned [] would make every
    // assertion above pass on a file full of gates.
    expect(entitlementImports('app/api/business-os/chat-v4/route.ts')).toEqual(['shadowChatPlan']);
    expect(
      entitlementImports('app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts').length
    ).toBeGreaterThan(5);
  });

  it('the import rule would catch a gate that writes no literal', () => {
    // The negative control, as the real thing would look. Both spellings, since
    // an alias and a relative path reach the same module.
    const aliased = "import { decide } from '@/lib/business-os/entitlements/decide';";
    const relative = "import { decide } from '../../lib/business-os/entitlements/decide';";
    const unrelated = "import { thing } from '@/lib/business-os/crm/contacts';";

    expect(ENTITLEMENT_IMPORT.test(aliased)).toBe(true);
    expect(ENTITLEMENT_IMPORT.test(relative)).toBe(true);
    expect(ENTITLEMENT_IMPORT.test(unrelated)).toBe(false);
  });

  it.each(KNOWN_NON_GATES.map((entry) => [entry.file, entry.capability, entry.why] as const))(
    '%s still names %s for the reason recorded',
    (file, capability, why) => {
      // The ratchet: an exemption that no longer applies must be removed, not
      // left behind to hide the next real hit in that file.
      expect(codeOf(read(file))).toContain(`'${capability}'`);
      expect(why.length).toBeGreaterThan(30);
    }
  );
});

describe('what the page reads', () => {
  it('reports no gate for every capability today, because none is built', () => {
    // Slice 1 resolves and records; it refuses nothing. If this ever starts
    // failing it is good news, and the page updates itself.
    for (const capability of CAPABILITY_IDS) {
      expect({ capability, gated: hasEnforcementPoint(capability) }).toEqual({
        capability,
        gated: false,
      });
    }
  });

  it('is total: an unknown capability is simply not gated, never a crash', () => {
    expect(hasEnforcementPoint('chat.telepathy')).toBe(false);
  });

  it('would report a gate the moment one is registered — through the real function', () => {
    // QA NEW-6: this used to build a record and assert its own array was
    // non-empty, never calling `hasEnforcementPoint` at all. It reduced to
    // `expect(true).toBe(true)` while reading as coverage of the mechanism.
    const registered: Record<string, readonly string[]> = {
      'chat.access': ['app/api/business-os/chat/route.ts'],
    };

    expect(hasEnforcementPoint('chat.access', registered)).toBe(true);
    expect(hasEnforcementPoint('crm.core', registered)).toBe(false);
    // An entry with no files is not a gate: the page must not clear its marker
    // because somebody wrote the key and nothing else.
    expect(hasEnforcementPoint('chat.access', { 'chat.access': [] })).toBe(false);
  });
});
