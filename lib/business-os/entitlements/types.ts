// lib/business-os/entitlements/types.ts
//
// The shapes of the entitlement configuration. Types only — no values, no I/O.
//
// Workplan: docs/workplans/business-os-subscription-entitlements.md §4.4–§4.7
// Requirement: docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md
//
// ── WHY THE TYPES CARRY THIS MUCH WEIGHT ────────────────────────────────────
// Two things must be impossible to get wrong:
//
//   1. A tier that forgets a capability. `TierRow` is a mapped type over the
//      catalog, so a missing key is a compile error before it is a test failure.
//   2. A value of the wrong shape for its capability — `'branded'` where a
//      number belongs. `ValueFor<C>` derives the value type from that
//      capability's own shape.
//
// The compiler is not the only gate (the Next build ignores type errors), so
// schema.ts repeats every one of these rules in Zod at load time. Both exist on
// purpose: the types catch it while you type, Zod catches it in CI and at boot.

/** The forms a commercial capability can take (requirement §5.1). */
export type CapabilityShape =
  /** On or off. */
  | { kind: 'boolean' }
  /**
   * One of several named options, ORDERED LOW TO HIGH.
   *
   * The order is load-bearing: it is how "the highest variant" is derived for a
   * cohort that grants everything, and how the snapshot test recognises a value
   * being lowered (T-4).
   */
  | { kind: 'variant'; variants: readonly [string, ...string[]] }
  /** A quantity per period that resets. Topped up by boosts (Slice 3). */
  | { kind: 'metered'; unit: 'ai_action' | 'sms'; period: 'month' }
  /** A fixed count, raised by add-ons. */
  | { kind: 'quantity'; unit: 'seat' | 'location' }
  /** A limit that alerts the platform team and never blocks the customer (B-7). */
  | { kind: 'fair_use'; unit: 'email'; period: 'month' }
  /** A named group of fine-grained operations on one surface. Boolean-valued. */
  | { kind: 'group' }
  /** Sold on top of a plan: unavailable, purchasable, or already included. */
  | { kind: 'addon' };

/**
 * Who sees the capability, which decides what happens at a limit (D-12) and in
 * grace (B-9).
 *
 * `client_render` is the odd one (SA S-1): branding is visible to clients but is
 * not a *send*, so it must not be forced to declare a message class.
 * `mixed` is `ai.actions` alone, where the audience is decided per call site.
 */
export type Audience = 'owner' | 'client' | 'client_render' | 'mixed';

/** Drives what keeps running during grace (B-9) and pause (B-11). */
export type MessageClass = 'transactional' | 'marketing';

/** Whether the feature exists yet. `not_built` is never entitled (FR-13). */
export type CapabilityLifecycle = 'available' | 'beta' | 'not_built';

/** What happens when a metered allowance runs out (§10.3). */
export type AtLimitBehaviour =
  | 'none'
  | 'degrade_to_template'
  | 'pause'
  | 'block'
  | 'alert_only'
  | 'by_call_site_audience';

export type CapabilityCategory =
  | 'crm'
  | 'website_intake'
  | 'payments'
  | 'ai_chat'
  | 'marketing'
  | 'insights'
  | 'support'
  | 'platform'
  | 'addon';

/** Customer-facing names. Same three languages as the chat catalog. */
export interface Labels {
  en: string;
  he: string;
  es: string;
}

interface CapabilityBase {
  labels: Labels;
  category: CapabilityCategory;
  shape: CapabilityShape;
  lifecycle: CapabilityLifecycle;
  atLimit: AtLimitBehaviour;
  sellableAsAddon: boolean;
  /** Marks a row still waiting on Eyal's answer (B-1). The engine ignores it. */
  placeholder?: 'B-1';
  /** Why this entry is the way it is, where that is not obvious. */
  note?: string;
}

/**
 * A catalog entry.
 *
 * The union is how S-1 becomes a compile error rather than a convention: an
 * `audience: 'client'` capability IS an automated client send, so it must
 * declare its message class, and anything else must not pretend to have one.
 */
export type CapabilityDef =
  | (CapabilityBase & { audience: 'client'; messageClass: MessageClass })
  | (CapabilityBase & { audience: Exclude<Audience, 'client'>; messageClass?: never });

// ── Capability values ───────────────────────────────────────────────────────

/** An add-on's state for one tier. */
export type AddonValue = 'unavailable' | 'purchasable' | 'included';

/** A metered allowance: per period, or a one-off total (a trial). */
export type MeteredValue = { perMonth: number } | { total: number };

/** A fixed count, plus whether more can be bought. */
export interface QuantityValue {
  included: number;
  purchasable?: boolean;
}

/** An unadvertised ceiling (B-7). */
export interface FairUseValue {
  ceilingPerMonth: number;
}

/** The value type a shape admits. */
export type ValueForShape<S extends CapabilityShape> = S extends { kind: 'boolean' }
  ? boolean
  : S extends { kind: 'group' }
    ? boolean
    : S extends { kind: 'variant'; variants: readonly (infer V)[] }
      ? V
      : S extends { kind: 'metered' }
        ? MeteredValue
        : S extends { kind: 'quantity' }
          ? QuantityValue
          : S extends { kind: 'fair_use' }
            ? FairUseValue
            : S extends { kind: 'addon' }
              ? AddonValue
              : never;

/** Any capability value, for the places that handle them generically. */
export type CapabilityValue = boolean | string | MeteredValue | QuantityValue | FairUseValue | AddonValue;

// ── Tier matrix ─────────────────────────────────────────────────────────────

/**
 * A capability that a tier LOST, and what happens to the subscribers who had it
 * (B-10, T-11).
 *
 * Adding a capability to a tier is one line. Removing one is two — the value and
 * an entry here — and that is deliberate: a removal is a commercial decision
 * about existing customers, so it should not be possible to make it silently.
 */
export interface MatrixRemoval<TierName extends string = string, Capability extends string = string> {
  /** The matrix version that removed it. */
  version: number;
  tier: TierName;
  capability: Capability;
  /** What the subscriber keeps. Shape-validated against the capability. */
  previousValue: CapabilityValue;
  /**
   * `'renewal'` is rejected at load until Slice 4 ships, because before billing
   * there is no renewal event to end it — it would mean "forever" by accident.
   */
  grandfatherUntil: 'renewal' | string;
}

/**
 * The tier matrix.
 *
 * Generic over the tier names and the row so the production config (no tiers)
 * and the test fixture (three tiers) are the same shape with different
 * parameters.
 */
export interface TierMatrixShape<TierName extends string, Row> {
  version: number;
  tiers: Record<TierName, Row>;
  removals: readonly MatrixRemoval<TierName>[];
  /** What each tier is CALLED and what it COSTS. See `TierPresentation`. */
  presentation: Record<TierName, TierPresentation>;
}

/**
 * The commercial face of a tier: its name to a customer, and its price.
 *
 * Deliberately separate from the capability row. The row is a mapped type over
 * the catalog — adding a capability must break every tier until someone decides
 * its value — and mixing a price into that shape would make the compiler ask
 * for a price every time the catalog changes.
 *
 * ── WHY THE PRICE IS HERE AT ALL, AND WHAT IT IS NOT ────────────────────────
 * It is for DISPLAY and for an admin reading the config. **Stripe becomes the
 * source of truth when billing ships (Slice 4)**, and at that point this field
 * is a label, not an amount anybody is charged. Nothing in Slice 1 reads it to
 * make a decision — no gate, no resolver path, no report arithmetic.
 */
export interface TierPresentation {
  /**
   * The customer-facing name, per locale.
   *
   * The internal id and the marketing name move at different speeds: renaming a
   * plan must not rewrite the `tier` column of every stored plan row, which is
   * why the id never appears in front of a customer and this does.
   *
   * (Neither is named here on purpose — FR-12's guard scans comments too, and a
   * type is not the place to learn what the plans are called.)
   */
  labels: Labels;
  /**
   * Monthly list price in whole US dollars. `0` for a free tier.
   *
   * Whole dollars because that is what has been decided; if a price ever needs
   * cents, that is a Stripe price object rather than a decimal here.
   */
  monthlyPriceUsd: number;
}

// ── Cohorts ─────────────────────────────────────────────────────────────────

/**
 * A dated config value.
 *
 * Trial length and grace length are histories rather than numbers (SA S-7): a
 * trial uses the entry in force when it STARTED, so shortening the trial in
 * config cannot shorten trials that are already running.
 */
export interface HistoryEntry {
  /** ISO timestamp. The entry applies from this moment on. */
  effectiveFrom: string;
  days: number;
}

/**
 * What a cohort starts from.
 *
 * `{ all: true }` is the catalog-derived maximum — every boolean on, every
 * variant at the top of its list, every add-on included — with quantities,
 * allowances and ceilings supplied explicitly, because they have no natural
 * maximum (RC-2).
 */
export type CohortBase = { tier: string } | { all: true };

export interface CohortConfigShape<ExplicitValues> {
  base: CohortBase;
  /**
   * What this cohort is CALLED to the person in it.
   *
   * "Test Flight" and "Founding Partner" are the names the user chose; `trial`
   * and `champion` are internal ids that a customer must never see. There is no
   * price: a cohort is what somebody has while they are not paying.
   */
  labels: Labels;
  /** Lifecycles this cohort may reach beyond `available` — in practice `['beta']`. */
  includeLifecycle: readonly CapabilityLifecycle[];
  /** Quantity / metered / fair-use values. Required for every such capability. */
  values: ExplicitValues;
  /** How long grace lasts for this cohort, as a history (S-7). */
  graceHistory: readonly HistoryEntry[];
  /** Trial only: how long the trial runs. */
  durationHistory?: readonly HistoryEntry[];
  /** Trial only: which recorded fact starts the clock (Q-B3). */
  clockStartsAt?: TrialClockStart;
}

/** Which fact on the plan row the trial clock is measured from. */
export type TrialClockStart = 'first_onboarding_message' | 'profile_created';

// ── Lifecycle overlay ───────────────────────────────────────────────────────

/** The account states (requirement §9). `unknown` is the anomaly state. */
export type LifecycleState = 'trial' | 'champion' | 'active' | 'past_due' | 'grace' | 'paused' | 'unknown';

/**
 * The kinds of surface the overlay distinguishes.
 *
 * Sends are split by message class AND initiator, which is what B-11 needs: in
 * `paused`, a receipt (the client just paid) still goes out, while a reminder
 * (the system decided to nudge) does not.
 */
export type SurfaceKind =
  | 'owner_read'
  | 'owner_write'
  | 'owner_ai'
  | 'public_business'
  | 'public_self_service'
  | 'send:transactional:client'
  | 'send:transactional:system'
  | 'send:marketing';

export type OverlayOutcome = 'allow' | 'allow_with_warning' | 'read_only' | 'paused_public' | 'suppress';

/** Who triggered an automated send: the client's own action, or the system. */
export type SendInitiator = 'client' | 'system';

/**
 * One automated client-facing send.
 *
 * The full registry is Slice 2's job; component 2 seeds the entries the Slice 1
 * tests need (SA R2-4), so AC-37 is provable on the production config rather
 * than only on a fixture.
 */
export interface SendDefinition {
  id: string;
  labels: Labels;
  messageClass: MessageClass;
  initiator: SendInitiator;
  /** The capability that gates it, when one does. */
  capability?: string;
  note?: string;
}

export interface LifecycleConfigShape {
  /** Grace after a paid tier ends (a cohort carries its own). */
  subscriptionGraceHistory: readonly HistoryEntry[];
  /** What each state allows on each surface kind. */
  overlay: Record<LifecycleState, Record<SurfaceKind, OverlayOutcome>>;
  /** The seeded part of the Slice 2 send registry. */
  sends: Readonly<Record<string, SendDefinition>>;
  /**
   * Per-send exceptions to the overlay, keyed by send id.
   *
   * This is what makes "do intake questionnaires still go out when paused?" a
   * config value rather than a code change (Q-B4).
   */
  sendPolicyOverrides: Readonly<Record<string, Partial<Record<LifecycleState, OverlayOutcome>>>>;
}

// ── Chat action map ─────────────────────────────────────────────────────────

/** A mapping entry that deliberately gates nothing, with the reason why. */
export interface Ungated {
  ungated: string;
}

export type CapabilityOrUngated<Capability extends string = string> = Capability | Ungated;

/**
 * How a chat READ is mapped to a capability (Q-B1).
 *
 * `domain_group` — a read needs its entity's domain capability, so a plan that
 * includes scheduling can still answer "what's on tomorrow?".
 * `read_only_plans_need_search` — any look-up that is the answer itself needs
 * `chat.search`; reads that feed a write are covered by the write.
 *
 * Shadow mode records both, so the choice can be made with numbers.
 */
export type ChatReadRule = 'domain_group' | 'read_only_plans_need_search';

// ── Launch ──────────────────────────────────────────────────────────────────

export interface LaunchConfigShape {
  /**
   * Refuse `BOS_ENTITLEMENTS_MODE=enforce` while no tier is configured (UD-2).
   *
   * Without it, switching enforcement on before a plan exists would put new
   * signups into grace with nothing to buy.
   */
  enforceRequiresConfiguredTier: boolean;
}
