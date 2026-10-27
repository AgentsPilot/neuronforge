/**
 * The Business OS customer-portal configuration: what it must allow, and the
 * runtime reader that refuses anything else (plan payments P-7a.2; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §4.4; SA-P10, C-6,
 * C-8, TQ-7).
 *
 * ONE SPECIFICATION, TWO READERS. `BOS_PORTAL_FEATURES` is what the portal
 * may do: update the card and show invoices, nothing else (no cancel, no plan
 * switch, no customer-detail edits: cancel and plan changes stay in the app,
 * RD-7). The setup script (`scripts/setup-bos-portal-configuration.ts`)
 * creates a configuration with exactly these features and stops on any drift;
 * the portal route checks the configured one against the same list before it
 * opens a session.
 *
 * NEVER STRIPE'S DEFAULT. A portal session created without a configuration
 * uses the account's default one, which on many accounts allows cancel and
 * plan switching. So a missing or malformed `STRIPE_BOS_PORTAL_CONFIGURATION_ID`
 * refuses (`portal_unavailable`); there is no fallback.
 *
 * SUCCESS-ONLY CACHE (C-6). The configuration is retrieved and checked once
 * per server instance; only a configuration that PASSED is remembered (by id
 * and mode). A failed retrieve or a mismatch is not cached: it refuses this
 * request and is asked again on the next one.
 *
 * Pure apart from the injected retrieve; reads `process.env` only through
 * `readPortalConfigurationId`'s default argument. No `server-only` marker, so
 * the operator script (run by tsx, outside Next) can share the specification.
 * Imports nothing from the entitlements module.
 *
 * @module lib/business-os/billing/portalConfiguration
 */

/** The env var naming the configuration of the server key's mode. */
export const PORTAL_CONFIGURATION_ENV = 'STRIPE_BOS_PORTAL_CONFIGURATION_ID';

/**
 * Where the portal sends the owner back: Settings → Plan, the same fixed path
 * the plan checkout returns to (`PLAN_CHECKOUT_RETURN_PATHS.settings_plan`,
 * pinned equal by test). Never a request value (C-6).
 */
export const PORTAL_RETURN_PATH = '/business-os/settings?section=plan';

/** The return URL on the given SERVER-SIDE origin (`platformOrigin()`), never the request's Host / Origin. */
export function portalReturnUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${PORTAL_RETURN_PATH}`;
}

/** Stripe's portal configuration id shape. */
const CONFIGURATION_ID_PATTERN = /^bpc_[A-Za-z0-9]+$/;

/** The five feature switches Stripe's configuration has, in the order they are reported. */
export const PORTAL_FEATURE_NAMES = [
  'payment_method_update',
  'invoice_history',
  'subscription_cancel',
  'subscription_update',
  'customer_update',
] as const;
export type PortalFeatureName = (typeof PORTAL_FEATURE_NAMES)[number];

/** SA-P10: card and invoices on; cancel, plan switching and customer edits off. */
export const BOS_PORTAL_FEATURES: Readonly<Record<PortalFeatureName, boolean>> = {
  payment_method_update: true,
  invoice_history: true,
  subscription_cancel: false,
  subscription_update: false,
  customer_update: false,
};

/** A portal configuration, reduced to what the check reads. */
export interface PortalConfigurationFacts {
  id: string;
  active: boolean;
  livemode: boolean;
  features: Readonly<Record<PortalFeatureName, boolean>>;
}

/** Why a configuration is not ours to use. Empty: it passes. */
export function portalConfigurationProblems(config: PortalConfigurationFacts, expectedLivemode: boolean): string[] {
  const problems: string[] = [];
  if (config.livemode !== expectedLivemode) {
    problems.push(`livemode is ${config.livemode}, expected ${expectedLivemode}`);
  }
  if (!config.active) problems.push('configuration is not active');
  for (const name of PORTAL_FEATURE_NAMES) {
    if (config.features[name] !== BOS_PORTAL_FEATURES[name]) {
      problems.push(`${name} is ${config.features[name] ? 'on' : 'off'}, expected ${BOS_PORTAL_FEATURES[name] ? 'on' : 'off'}`);
    }
  }
  return problems;
}

/** The configured id, or `null` when it is missing or not a `bpc_…` id. */
export function readPortalConfigurationId(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const value = env[PORTAL_CONFIGURATION_ENV]?.trim();
  return value && CONFIGURATION_ID_PATTERN.test(value) ? value : null;
}

// ── The runtime check ───────────────────────────────────────────────────────

export interface PortalConfigurationLogger {
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface PortalConfigurationCheckDeps {
  /** The server key's mode, as Stripe spells it. */
  livemode: boolean;
  /** Retrieves the configuration (StripeService.retrieveBusinessOsPortalConfiguration). */
  retrieve: (configurationId: string) => Promise<PortalConfigurationFacts>;
  logger: PortalConfigurationLogger;
  /** Test seam; default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
}

export type PortalConfigurationCheck =
  | { ok: true; configurationId: string }
  | { ok: false; reason: 'configuration_missing' | 'configuration_unreadable' | 'configuration_mismatch' };

/** `<id>:<livemode>` of the last configuration that passed. Success only (C-6). */
let verified: string | null = null;

/**
 * The configuration id to open a portal session with, checked. Every refusal
 * is logged at `error` with `alert: true` (a configuration fault, never the
 * owner's): the owner reads "not available right now".
 */
export async function ensurePortalConfiguration(deps: PortalConfigurationCheckDeps): Promise<PortalConfigurationCheck> {
  const configurationId = readPortalConfigurationId(deps.env);
  if (configurationId === null) {
    deps.logger.error(
      { event: 'bos_billing_portal_configuration_missing', alert: true, env: PORTAL_CONFIGURATION_ENV },
      'Business OS portal configuration is not set; the portal stays closed (never the default configuration)'
    );
    return { ok: false, reason: 'configuration_missing' };
  }

  const cacheKey = `${configurationId}:${deps.livemode}`;
  if (verified === cacheKey) return { ok: true, configurationId };

  let config: PortalConfigurationFacts;
  try {
    config = await deps.retrieve(configurationId);
  } catch {
    // Not cached: the next request asks again (C-6).
    deps.logger.error(
      { event: 'bos_billing_portal_configuration_unreadable', alert: true, configurationId },
      'Business OS portal configuration could not be read; the portal stays closed'
    );
    return { ok: false, reason: 'configuration_unreadable' };
  }

  const problems = config.id === configurationId ? portalConfigurationProblems(config, deps.livemode) : ['id differs'];
  if (problems.length > 0) {
    deps.logger.error(
      { event: 'bos_billing_portal_configuration_mismatch', alert: true, configurationId, problems },
      'Business OS portal configuration does not match what the portal may do; the portal stays closed'
    );
    return { ok: false, reason: 'configuration_mismatch' };
  }

  verified = cacheKey;
  return { ok: true, configurationId };
}

/** Test seam: forget the verified configuration. */
export function resetPortalConfigurationCacheForTests(): void {
  verified = null;
}
