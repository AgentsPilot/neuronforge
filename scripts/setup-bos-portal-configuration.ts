/**
 * setup-bos-portal-configuration: creates the Business OS customer-portal
 * configuration (card and invoices only) in a Stripe account, idempotently,
 * and prints its id for `STRIPE_BOS_PORTAL_CONFIGURATION_ID` (plan payments
 * P-7a.2, workplan §4.4; SA-P10, C-8, TQ-7; go-live row 13).
 *
 * SAFETY (the `setup-bos-plan-prices.ts` model, `lib/stripe-script-guards.ts`)
 *   - TEST MODE BY DEFAULT: only an `sk_test_` key. LIVE ONLY WITH `--live`,
 *     which then accepts only an `sk_live_` / `rk_live_` key. Checked before
 *     any network call. Every object Stripe returns must be of that mode, or
 *     the run stops.
 *   - `--expect-account acct_...` is REQUIRED; one read-only call and the run
 *     stops if the key belongs to another account.
 *   - `--env <file>` is REQUIRED and must lie outside every git checkout
 *     (P2-C9). The key is never printed.
 *   - DRY RUN BY DEFAULT: it prints what it would create. `--apply` creates.
 *
 * WHAT IT DOES
 *   - Lists the account's portal configurations and finds ours by metadata
 *     `product: business_os_portal`.
 *   - None: creates one with exactly `BOS_PORTAL_FEATURES` (card update and
 *     invoice history on; cancel, plan switching and customer edits off),
 *     never asking to be the account default (Stripe makes the FIRST one of an
 *     account its default anyway: reported as a NOTE). Branding (headline, privacy and terms
 *     links) is left to the Stripe dashboard (go-live row 10).
 *   - One: COMPARES it with the specification and STOPS on any difference. It
 *     never edits a configuration: a drifted one is decided by hand.
 *   - More than one, or an archived one: STOPS.
 *   - `--return-origin <origin>` (optional) also sets / compares the
 *     configuration's default return URL (`<origin>/business-os/settings?section=plan`).
 *     The app passes its own return URL on every session, so this is only a
 *     fallback. Live mode requires https.
 *
 * USAGE
 *   npx tsx scripts/setup-bos-portal-configuration.ts --env <file outside the repo> --expect-account acct_... [--live] [--return-origin https://...] [--apply]
 */

import Stripe from 'stripe';

import {
  BOS_PORTAL_FEATURES,
  PORTAL_CONFIGURATION_ENV,
  PORTAL_FEATURE_NAMES,
  portalConfigurationProblems,
  portalReturnUrl,
  type PortalConfigurationFacts,
} from '@/lib/business-os/billing/portalConfiguration';
import { BOS_PORTAL_PRODUCT_MARKER, BOS_PRODUCT_METADATA_KEY } from '@/lib/business-os/billing/stripeMetadataKeys';
import { API_VERSION } from './check-bos-plan-prices';
import {
  ScriptRefusal,
  argValue,
  assertKeyKind,
  hasFlag,
  isLiveKind,
  readStripeKey,
  requireExpectedAccount,
  resolveEnvFile,
  runScript,
  verifyAccount,
  type StripeKeyKind,
} from './lib/stripe-script-guards';

const out = (line: string) => process.stdout.write(`${line}\n`);

/** How many pages of configurations to read before giving up (100 each). */
const MAX_PAGES = 10;

/**
 * Stripe makes the FIRST configuration of an account its default (seen on the
 * sandbox, 2026-10-26: no `is_default` parameter was sent). Ours being the
 * default is harmless for Business OS (the app always names its configuration)
 * but narrows any portal opened WITHOUT one, such as the parked agent
 * platform's legacy `create-portal` route, to card and invoices. Reported, not
 * refused: the script never edits the default.
 */
export const DEFAULT_NOTE =
  "NOTE   this configuration is the account's DEFAULT (Stripe made it so: it was the first). Any portal opened without a configuration now offers only card and invoices.";

export const PORTAL_CONFIGURATION_NAME = 'AgentPilot Business OS plan: card and invoices';

export interface ExistingPortalConfiguration extends PortalConfigurationFacts {
  readonly metadataProduct: string | null;
  readonly isDefault: boolean;
  readonly defaultReturnUrl: string | null;
}

export type PortalSetupPlan =
  | { readonly kind: 'create'; readonly stops: readonly string[] }
  | { readonly kind: 'unchanged'; readonly id: string; readonly isDefault: boolean; readonly stops: readonly string[] };

/** The key kinds a run accepts: test by default, live only with `--live` (TQ-7). */
export function allowedKeyKinds(live: boolean): readonly StripeKeyKind[] {
  return live ? ['sk_live', 'rk_live'] : ['sk_test'];
}

/**
 * `--return-origin`, validated: an origin only (no path, query or fragment);
 * https in live mode, http only for localhost in test mode. `null` when absent.
 */
export function parseReturnOrigin(value: string | undefined, live: boolean): string | null {
  if (value === undefined) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ScriptRefusal('--return-origin must be an origin such as https://app.example.com');
  }
  const bare = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === '';
  if (!bare) throw new ScriptRefusal('--return-origin must be an origin only, with no path, query or credentials');
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal && !live)) {
    throw new ScriptRefusal(live ? '--return-origin must be https in live mode' : '--return-origin must be https (http only for localhost)');
  }
  return url.origin;
}

/** Pure: what the script would do, given what Stripe holds. */
export function planPortalSetup(
  existing: readonly ExistingPortalConfiguration[],
  livemode: boolean,
  defaultReturnUrl: string | null
): PortalSetupPlan {
  const ours = existing.filter((c) => c.metadataProduct === BOS_PORTAL_PRODUCT_MARKER);
  if (ours.length === 0) return { kind: 'create', stops: [] };
  if (ours.length > 1) {
    return {
      kind: 'unchanged',
      id: ours[0].id,
      isDefault: ours[0].isDefault,
      stops: [`${ours.length} configurations carry ${BOS_PRODUCT_METADATA_KEY}=${BOS_PORTAL_PRODUCT_MARKER}: ${ours.map((c) => c.id).join(', ')}`],
    };
  }
  const config = ours[0];
  const stops = portalConfigurationProblems(config, livemode).map((p) => `${config.id}: ${p}`);
  if (defaultReturnUrl !== null && config.defaultReturnUrl !== defaultReturnUrl) {
    stops.push(`${config.id}: default return URL is ${config.defaultReturnUrl ?? '(none)'}, expected ${defaultReturnUrl}`);
  }
  return { kind: 'unchanged', id: config.id, isDefault: config.isDefault, stops };
}

export function configurationFacts(c: Stripe.BillingPortal.Configuration): ExistingPortalConfiguration {
  const features = c.features;
  return {
    id: c.id,
    active: c.active,
    livemode: c.livemode,
    isDefault: c.is_default,
    metadataProduct: c.metadata?.[BOS_PRODUCT_METADATA_KEY] ?? null,
    defaultReturnUrl: c.default_return_url ?? null,
    features: {
      payment_method_update: features.payment_method_update?.enabled === true,
      invoice_history: features.invoice_history?.enabled === true,
      subscription_cancel: features.subscription_cancel?.enabled === true,
      subscription_update: features.subscription_update?.enabled === true,
      customer_update: features.customer_update?.enabled === true,
    },
  };
}

/** The create parameters: exactly the specification, our marker, never the default. */
export function createParams(defaultReturnUrl: string | null): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    name: PORTAL_CONFIGURATION_NAME,
    features: {
      payment_method_update: { enabled: BOS_PORTAL_FEATURES.payment_method_update },
      invoice_history: { enabled: BOS_PORTAL_FEATURES.invoice_history },
      subscription_cancel: { enabled: BOS_PORTAL_FEATURES.subscription_cancel },
      subscription_update: { enabled: BOS_PORTAL_FEATURES.subscription_update },
      customer_update: { enabled: BOS_PORTAL_FEATURES.customer_update },
    },
    metadata: { [BOS_PRODUCT_METADATA_KEY]: BOS_PORTAL_PRODUCT_MARKER },
    ...(defaultReturnUrl ? { default_return_url: defaultReturnUrl } : {}),
  };
}

async function listConfigurations(stripe: Stripe): Promise<ExistingPortalConfiguration[]> {
  const all: ExistingPortalConfiguration[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await stripe.billingPortal.configurations.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    all.push(...result.data.map(configurationFacts));
    if (!result.has_more || result.data.length === 0) return all;
    startingAfter = result.data[result.data.length - 1].id;
  }
  throw new ScriptRefusal(`more than ${MAX_PAGES * 100} portal configurations; decide by hand`);
}

function describeFeatures(features: Readonly<Record<string, boolean>>): string {
  return PORTAL_FEATURE_NAMES.map((name) => `${name}=${features[name] ? 'on' : 'off'}`).join(' ');
}

async function main(argv: readonly string[]): Promise<number> {
  const envFile = resolveEnvFile(argv);
  const expectedAccount = requireExpectedAccount(argv);
  const live = hasFlag(argv, '--live');
  const key = readStripeKey(envFile);
  const kind = assertKeyKind(key, allowedKeyKinds(live));
  const livemode = isLiveKind(kind);
  const origin = parseReturnOrigin(argValue(argv, '--return-origin'), live);
  const defaultReturnUrl = origin ? portalReturnUrl(origin) : null;
  const doApply = hasFlag(argv, '--apply');

  const stripe = new Stripe(key, { apiVersion: API_VERSION });
  const account = await verifyAccount(stripe, expectedAccount);
  out(`mode ${livemode ? 'LIVE' : 'test'}  account ${account.id} (${account.displayName})  ${doApply ? 'APPLY' : 'DRY RUN (add --apply to create)'}`);

  const existing = await listConfigurations(stripe);
  for (const c of existing) {
    if (c.livemode !== livemode) throw new Error(`configuration ${c.id} is not a ${livemode ? 'live' : 'test'}-mode object; stopping`);
  }
  const plan = planPortalSetup(existing, livemode, defaultReturnUrl);

  if (plan.stops.length > 0) {
    for (const stop of plan.stops) out(`STOP   ${stop}`);
    throw new ScriptRefusal('Stripe holds a Business OS portal configuration this script will not change; nothing was created');
  }

  if (plan.kind === 'unchanged') {
    out(`OK     configuration ${plan.id} matches (${describeFeatures(BOS_PORTAL_FEATURES)})`);
    if (plan.isDefault) out(DEFAULT_NOTE);
    out(`${PORTAL_CONFIGURATION_ENV}=${plan.id}   (${livemode ? 'live' : 'test'} mode)`);
    return 0;
  }

  out(`CREATE configuration "${PORTAL_CONFIGURATION_NAME}" (${describeFeatures(BOS_PORTAL_FEATURES)})${defaultReturnUrl ? ` return ${defaultReturnUrl}` : ''}`);
  if (!doApply) return 0;

  const created = await stripe.billingPortal.configurations.create(createParams(defaultReturnUrl), {
    idempotencyKey: `bos-portal-configuration:v1:${livemode ? 'live' : 'test'}`,
  });
  const facts = configurationFacts(created);
  const problems = portalConfigurationProblems(facts, livemode);
  if (facts.metadataProduct !== BOS_PORTAL_PRODUCT_MARKER) problems.push('metadata marker missing');
  if (problems.length > 0) {
    for (const p of problems) out(`STOP   ${created.id}: ${p}`);
    throw new Error(`created configuration ${created.id} does not match the specification; deactivate it by hand`);
  }
  out(`created configuration ${created.id}`);
  if (facts.isDefault) out(DEFAULT_NOTE);
  out(`${PORTAL_CONFIGURATION_ENV}=${created.id}   (${livemode ? 'live' : 'test'} mode)`);
  return 0;
}

if (require.main === module) runScript(() => main(process.argv.slice(2)), out);
