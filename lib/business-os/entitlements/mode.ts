// lib/business-os/entitlements/mode.ts
//
// The one switch: off, shadow, or enforce.
//
// Workplan §4.10 (FR-22, RC-6, RC-7, UD-2).
//
// ── WHAT THIS FILE MAY IMPORT, AND THE REASON ───────────────────────────────
// It is imported by `shadow.ts`, which is imported by the chat route. The
// property RC-7 actually protects is this: **reading the mode must never run
// config VALIDATION.** A bad config that threw at import would take chat down at
// cold start *even with entitlements switched off*.
//
// So the rule is narrow and stated as such (SA C3-1): **`mode.ts` must not
// import `source.ts` or `schema.ts`** — the two modules that load and Zod-parse
// the configuration. `config/launch.ts` and `config/tierMatrix.ts` are
// side-effect-free data (`tierMatrix.ts`'s only imports are types), so importing
// them statically cannot throw and costs nothing at runtime.
//
// This used to be `require()` inside the function. That worked, but a
// bundler-dependent construct in the one file that must never break was the
// wrong way to express a rule that is really about Zod. `mode.test.ts` asserts
// the rule directly.
//
// ── WHY IT READS THE ENVIRONMENT EVERY TIME ─────────────────────────────────
// Caching the mode in a module constant would mean a Vercel environment change
// needs a redeploy to take effect, and — worse — that a test cannot change it
// without resetting modules. `process.env` lookups are nanoseconds; this is not
// the hot path anybody thinks it is.

import { createLogger } from '@/lib/logger';
import { LAUNCH } from './config/launch';
import { TIER_ORDER } from './config/tierMatrix';

const logger = createLogger({ module: 'BusinessOsEntitlementsMode' });

/**
 * `off`     nothing is resolved, nothing is recorded, nothing is refused.
 * `shadow`  everything is resolved and recorded; NOTHING is refused (FR-22).
 * `enforce` decisions are acted on. Slice 2 onwards, and gated by UD-2 below.
 */
export type EntitlementMode = 'off' | 'shadow' | 'enforce';

/** The environment variable. Server-side only — this must never reach a client bundle. */
export const MODE_ENV_VAR = 'BOS_ENTITLEMENTS_MODE';

/**
 * What the environment asks for, and what that resolves to — the ONE parser
 * behind both public readers (admin reorganisation slice 4, SA C-8).
 *
 * Pure: no logging, no import, no throw. `raw` is returned only so
 * `getEntitlementMode()` can keep logging it exactly as it always has; it never
 * leaves this file (`getEntitlementModeSetting()` drops it).
 */
interface ParsedModeSetting {
  raw: string;
  requested: EntitlementMode | 'unrecognised';
  effective: EntitlementMode;
  refused: boolean;
}

function parseModeSetting(): ParsedModeSetting {
  const raw = (process.env[MODE_ENV_VAR] ?? '').trim().toLowerCase();

  if (raw === '' || raw === 'off') return { raw, requested: 'off', effective: 'off', refused: false };
  if (raw === 'shadow') return { raw, requested: 'shadow', effective: 'shadow', refused: false };
  if (raw === 'enforce') {
    return isEnforceAllowed()
      ? { raw, requested: 'enforce', effective: 'enforce', refused: false }
      : { raw, requested: 'enforce', effective: 'shadow', refused: true };
  }
  return { raw, requested: 'unrecognised', effective: 'off', refused: false };
}

/**
 * The mode, after the launch gate.
 *
 * `enforce` is refused — and downgraded to `shadow` — while the launch config
 * says a tier must be configured first and none is (UD-2). Without that, turning
 * enforcement on before a plan exists would put every new signup into grace at
 * the end of their trial with **nothing to buy**, which is the one failure mode
 * that is visible to customers and cannot be undone by an apology.
 *
 * It logs at `error` when it refuses, because a deployment that believes it is
 * enforcing and is not is exactly the kind of thing that goes unnoticed.
 */
export function getEntitlementMode(): EntitlementMode {
  const setting = parseModeSetting();

  if (setting.refused) {
    logger.error(
      { mode: setting.raw, effectiveMode: 'shadow', reason: 'no_tier_configured' },
      'BOS_ENTITLEMENTS_MODE=enforce refused: no tier is configured, so enforcing would leave ' +
        'customers with nothing to buy. Running in shadow instead.'
    );
  } else if (setting.requested === 'unrecognised') {
    logger.error({ mode: setting.raw, effectiveMode: 'off' }, 'Unrecognised BOS_ENTITLEMENTS_MODE; treating it as off');
  }

  return setting.effective;
}

/**
 * The same answer as `getEntitlementMode()`, plus WHAT WAS ASKED FOR — for the
 * admin Health page, where "we think we are enforcing and we are not" is the
 * signal (SA C-8).
 *
 * Never returns the raw environment string (an unknown value is reported as
 * `'unrecognised'`, not echoed), and does not log: `getEntitlementMode()` already
 * logs the refusal wherever the mode is actually used, and a health page that
 * logged on every load would bury it.
 */
export function getEntitlementModeSetting(): {
  effective: EntitlementMode;
  requested: EntitlementMode | 'unrecognised';
  refused: boolean;
} {
  const { effective, requested, refused } = parseModeSetting();
  return { effective, requested, refused };
}

/** True when the mode is `shadow` or `enforce` — i.e. resolution should happen. */
export function isEntitlementResolutionEnabled(): boolean {
  return getEntitlementMode() !== 'off';
}

/**
 * Whether `enforce` is permitted right now.
 *
 * Both values are plain data (see the header): reading them cannot throw, cannot
 * reach Zod, and cannot fail at import.
 */
function isEnforceAllowed(): boolean {
  if (!LAUNCH.enforceRequiresConfiguredTier) return true;
  return (TIER_ORDER as readonly string[]).length > 0;
}
