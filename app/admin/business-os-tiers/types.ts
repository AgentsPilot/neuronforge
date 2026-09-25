/**
 * The shapes this screen receives. Nothing here is a source of truth.
 *
 * These mirror `lib/business-os/entitlements/adminPlansView.ts`, which is
 * `server-only` and therefore cannot be imported here — so the mirror is the
 * price of the boundary, and it is deliberately **passive**: field names and
 * primitive types, no unions of capability ids, no plan ids, no prices, no
 * rules. Nothing in this file can be wrong about the product; it can only be
 * wrong about the payload, which a render test catches immediately.
 */

export interface PlanCapability {
  capability: string;
  label: string;
  category: string;
  display: string;
  granting: boolean;
  /** Does anything in the product actually refuse this capability? */
  gateBuilt: boolean;
}

export interface Plan {
  id: string;
  kind: 'tier' | 'cohort';
  name: string;
  monthlyPriceUsd: number;
  inheritsFrom: string | null;
  aiActions: string;
  endsWhen: string;
  state: string;
  basis: string;
  includes: PlanCapability[];
  withholds: PlanCapability[];
}

export interface NotBuiltCapability {
  capability: string;
  label: string;
  category: string;
  note: string;
}

export interface PlansPayload {
  generatedAt: string;
  mode: 'off' | 'shadow' | 'enforce';
  modeEnvVar: string;
  modeMeaning: string;
  enforced: boolean;
  matrixVersion: number;
  withheldWithoutGate: string[];
  plans: Plan[];
  notBuilt: NotBuiltCapability[];
  writeOpsNotOnThisPage: string[];
}

/** What the account lookup shows, from the existing accounts endpoint. */
export interface AccountCapability {
  value: unknown;
  decidedBy: string;
  /**
   * Whether the value grants anything, decided by the SERVER with
   * `isGrantingValue` (QA, 2026-09-24).
   *
   * This screen must not answer that question itself. It did — with
   * `value !== false` — and called `{ included: 0 }` and `'unavailable'`
   * entitlements, reporting 26 of 38 in force where the resolver said 19, on
   * the same screen as a card that said 19.
   */
  granting: boolean;
  /**
   * The value written for a human, by the SAME formatter the plan cards use
   * (QA-8). This column printed `{"included":1,"purchasable":false}` beside a
   * card reading `1 seat`: two ways of saying one thing, on one screen.
   */
  display: string;
}

/**
 * The resolver's basis, which is an OBJECT and not a string.
 *
 * Declared here as it really is, because the previous `basis: string` is what
 * let `{payload.basis}` compile and then throw `Objects are not valid as a
 * React child` on every successful lookup (QA). A type that lies about a
 * payload is worse than no type: it removes the one check that would have
 * caught it.
 */
export interface AccountBasis {
  kind: 'tier' | 'cohort' | 'none';
  tier?: string;
  cohort?: string;
}

export interface AccountPlanRow {
  tier: string | null;
  cohort: string | null;
  tier_expires_at: string | null;
  cohort_expires_at: string | null;
  plan_version: number;
  origin: string | null;
  updated_at: string | null;
}

export interface AccountPayload {
  accountId: string;
  mode: string;
  state: string;
  basis: AccountBasis;
  anomaly: string | null;
  matrixVersion: number;
  capabilities: Record<string, AccountCapability>;
  plan: AccountPlanRow | null;
  effectiveWithinSeconds: number;
}
