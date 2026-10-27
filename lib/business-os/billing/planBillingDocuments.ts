/**
 * "Update card" and "Invoices" in Settings → Plan: open Stripe's customer
 * portal on OUR configuration, and list the owner's invoices (plan payments
 * P-7a.2; workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md
 * §4.4, §4.5; SA C-1, C-6, C-7, TQ-6 to TQ-8; F9, SA-P10).
 *
 * Orchestration over injected ports, so every branch is tested with fakes.
 * Two entry points behind the two routes, sharing one order and one refusal
 * table:
 *
 *   1  price-recognition switch off, key mode unknown  → documents_unavailable
 *   2  billing row (session user, key mode)            → billing_row_unreadable
 *   3  planCardAndInvoicesOffer (our data, the screen's rule)
 *                                                      → no_billing_account
 *   portal:
 *   4  configuration: env id, retrieved and checked once per instance,
 *        success cached only (C-6); never Stripe's default configuration
 *                                                      → portal_unavailable
 *   5  Stripe: the session, for OUR row's customer; the return URL from the
 *        server-side platform origin (C-6), never the request's Host / Origin;
 *        `update_card` opens on the card form and redirects back (C-6)
 *                                                      → stripe_error
 *   6  the session's customer, mode and configuration must be ours, or the
 *        URL is NOT returned                           → stripe_error (alert)
 *   invoices:
 *   4  Stripe: ONE page of OUR row's customer's invoices, the last 12, no
 *        auto-paging (TQ-6)                            → stripe_error
 *   5  plan labels from the plan price catalog (cosmetic: unreadable → none)
 *   6  mapPlanInvoices (drafts, another customer or mode, not USD dropped)
 *
 * Every database read and every refusal from our own data precedes any Stripe
 * call (as P-7a.1 and P-7b.1's SA V-9).
 *
 * BEARER LINKS (C-6). The portal URL opens the customer's billing without a
 * login, and the invoice list carries hosted-invoice links: neither is ever
 * logged, audited or put in an error. Logs carry ids and counts only. Neither
 * is audited (not a money event, TQ-9).
 *
 * TENANT ISOLATION (tenant-isolation-guard). The request carries nothing but
 * the intent and a language: the account is the session's (the route
 * resolves it), the customer id comes from OUR billing row in the server
 * key's mode, and Stripe's answer is checked against that row before
 * anything reaches the owner.
 *
 * Expected refusals are RESULTS, never throws; an unexpected fault throws and
 * the route answers 500.
 *
 * Imports `TIER_MATRIX` from the entitlements config for the plan LABEL only
 * (registered as a non-gate in `enforcementPoints.test.ts`): it decides no
 * access and refuses nothing by plan.
 *
 * @module lib/business-os/billing/planBillingDocuments
 */

import { TIER_MATRIX } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  getStripeService,
  type BusinessOsPortalLocale,
  type StripeService,
} from '@/lib/stripe/StripeService';
import {
  businessOsBillingAccountRepository,
  isHostedInvoiceUrl,
  type BusinessOsBillingAccountRepository,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { planCardAndInvoicesOffer, type PlanManageSwitches } from '@/lib/business-os/billing/planManageOffer';
import { planPriceCatalog, planTierForLookupKey, type PlanPriceCatalog } from '@/lib/business-os/billing/planPriceCatalog';
import { PLAN_INVOICE_LIST_LIMIT, mapPlanInvoices, type PlanInvoiceRow } from '@/lib/business-os/billing/planInvoiceList';
import { ensurePortalConfiguration, portalReturnUrl } from '@/lib/business-os/billing/portalConfiguration';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import { platformOrigin } from '@/lib/utils/origins';

// ── Refusals ────────────────────────────────────────────────────────────────

export type PlanBillingDocsRefusalCode =
  | 'documents_unavailable'
  | 'billing_row_unreadable'
  | 'no_billing_account'
  | 'portal_unavailable'
  | 'stripe_error';

/** HTTP status and owner-facing message per refusal. Never a Stripe or database message. */
export const PLAN_BILLING_DOCS_REFUSALS: Readonly<Record<PlanBillingDocsRefusalCode, { status: number; message: string }>> = {
  documents_unavailable: { status: 503, message: 'This is not available right now. Please try again later.' },
  billing_row_unreadable: { status: 503, message: 'We could not check your billing right now. Please try again.' },
  no_billing_account: { status: 409, message: 'There is no paid plan on your account.' },
  portal_unavailable: { status: 503, message: 'This is not available right now. Please try again later.' },
  stripe_error: { status: 502, message: 'The payment provider did not respond. Please try again.' },
};

// ── Ports ───────────────────────────────────────────────────────────────────

export interface PlanBillingDocsLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export type PlanBillingDocsStripe = Pick<
  StripeService,
  'retrieveBusinessOsPortalConfiguration' | 'createBusinessOsPortalSession' | 'listBusinessOsInvoices'
>;

export interface PlanBillingDocsDeps {
  logger: PlanBillingDocsLogger;
  repo?: Pick<BusinessOsBillingAccountRepository, 'findByUser'>;
  stripe?: PlanBillingDocsStripe;
  /** Default: the price-recognition switch only (SA C-1, BQ-1). */
  switches?: () => PlanManageSwitches;
  mode?: () => StripeMode;
  /** Default `platformOrigin()`: the SERVER-SIDE origin (C-6). */
  origin?: () => string;
  /** Default `process.env` (the portal configuration id). */
  env?: Readonly<Record<string, string | undefined>>;
  catalog?: Pick<PlanPriceCatalog, 'load'>;
}

export type PlanPortalIntent = 'update_card' | 'invoices';
export type PlanPortalLanguage = 'en' | 'he' | 'es';

export type PlanBillingDocsRefusal = { ok: false; code: PlanBillingDocsRefusalCode };

export type PlanPortalResult = { ok: true; url: string } | PlanBillingDocsRefusal;
export type PlanInvoicesResult = { ok: true; invoices: PlanInvoiceRow[]; hasMore: boolean } | PlanBillingDocsRefusal;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Logged at `error` with `alert: true`: provider faults. `portal_unavailable`
 * is a warn here because `ensurePortalConfiguration` has already alerted
 * with the configuration fault itself.
 */
const ALERTED: readonly PlanBillingDocsRefusalCode[] = ['stripe_error'];

/**
 * TQ-8 / X-5 (2026-10-26, sandbox): Stripe's portal accepts `en` and `es`
 * and REFUSES `he` (and `he-IL`), so Hebrew opens with `auto` (the
 * customer's preferred locales, then the browser's).
 */
export function portalLocaleFor(language: PlanPortalLanguage | undefined): BusinessOsPortalLocale {
  if (language === 'en' || language === 'es') return language;
  return 'auto';
}

/** A Stripe error, reduced to what an operator needs. The error object itself is never logged. */
function safeErr(err: unknown): Record<string, unknown> {
  if (typeof err !== 'object' || err === null) return { kind: typeof err };
  const e = err as { type?: unknown; code?: unknown; statusCode?: unknown; requestId?: unknown; name?: unknown };
  return {
    name: typeof e.name === 'string' ? e.name : null,
    type: typeof e.type === 'string' ? e.type : null,
    code: typeof e.code === 'string' ? e.code : null,
    statusCode: typeof e.statusCode === 'number' ? e.statusCode : null,
    requestId: typeof e.requestId === 'string' ? e.requestId : null,
  };
}

function defaultSwitches(): PlanManageSwitches {
  return { pricesEnabled: isPlanPriceRecognitionEnabled() };
}

type Operation = 'portal' | 'invoices';

function refuser(log: PlanBillingDocsLogger, userId: string, operation: Operation) {
  return (code: PlanBillingDocsRefusalCode, context: Record<string, unknown> = {}): PlanBillingDocsRefusal => {
    const reason = typeof context.reason === 'string' ? context.reason : null;
    const alerted = ALERTED.includes(code) || reason === 'stripe_key_mode_unknown';
    log[alerted ? 'error' : 'warn'](
      { event: 'bos_billing_documents_refused', code, operation, userId, ...(alerted ? { alert: true } : {}), ...context },
      'Plan card / invoices request refused'
    );
    return { ok: false, code };
  };
}

/** Steps 1 to 3, shared: our data only, no Stripe call. */
async function readOwnCustomer(
  userId: string,
  deps: PlanBillingDocsDeps,
  refuse: ReturnType<typeof refuser>
): Promise<{ ok: true; customerId: string; livemode: boolean } | PlanBillingDocsRefusal> {
  const switches = (deps.switches ?? defaultSwitches)();
  if (!switches.pricesEnabled) return refuse('documents_unavailable', { reason: 'bos_billing_prices_switch_off' });
  let livemode: boolean;
  try {
    livemode = isLiveMode((deps.mode ?? currentStripeMode)());
  } catch {
    return refuse('documents_unavailable', { reason: 'stripe_key_mode_unknown' });
  }

  const read = await (deps.repo ?? businessOsBillingAccountRepository).findByUser(userId, livemode);
  if (read.error) return refuse('billing_row_unreadable');
  const row = read.data;
  if (!planCardAndInvoicesOffer(row, switches) || !row) return refuse('no_billing_account');
  // The row was read in this mode; its own flag must agree (defence in depth, PF-15).
  if (row.livemode !== livemode) return refuse('no_billing_account', { reason: 'row_mode_differs' });
  return { ok: true, customerId: row.stripeCustomerId, livemode };
}

// ── Portal ──────────────────────────────────────────────────────────────────

export async function openPlanBillingPortal(
  input: { userId: string; intent: PlanPortalIntent; language?: PlanPortalLanguage },
  deps: PlanBillingDocsDeps
): Promise<PlanPortalResult> {
  const { userId, intent } = input;
  const log = deps.logger;
  const refuse = refuser(log, userId, 'portal');

  const own = await readOwnCustomer(userId, deps, refuse);
  if (!own.ok) return own;

  const stripe = deps.stripe ?? getStripeService();
  const configuration = await ensurePortalConfiguration({
    livemode: own.livemode,
    retrieve: (id) => stripe.retrieveBusinessOsPortalConfiguration(id),
    logger: log,
    env: deps.env,
  });
  if (!configuration.ok) return refuse('portal_unavailable', { reason: configuration.reason });

  const returnUrl = portalReturnUrl((deps.origin ?? platformOrigin)());
  let session: Awaited<ReturnType<PlanBillingDocsStripe['createBusinessOsPortalSession']>>;
  try {
    session = await stripe.createBusinessOsPortalSession({
      customerId: own.customerId,
      configurationId: configuration.configurationId,
      returnUrl,
      locale: portalLocaleFor(input.language),
      flow: intent === 'update_card' ? 'payment_method_update' : null,
    });
  } catch (err) {
    return refuse('stripe_error', { stripeError: safeErr(err), step: 'portal_session', customerId: own.customerId });
  }

  // Never hand out a link to anything but OUR customer's billing, on OUR configuration.
  const checks = {
    customerMatches: session.customerId === own.customerId,
    modeMatches: session.livemode === own.livemode,
    configurationMatches: session.configurationId === configuration.configurationId,
    hasUrl: typeof session.url === 'string' && session.url.startsWith('https://'),
  };
  if (!checks.customerMatches || !checks.modeMatches || !checks.configurationMatches || !checks.hasUrl) {
    return refuse('stripe_error', { reason: 'portal_session_differs', customerId: own.customerId, ...checks });
  }

  // Ids only: the URL is a bearer link (C-6).
  log.info(
    { event: 'bos_billing_portal_opened', userId, customerId: own.customerId, intent, configurationId: configuration.configurationId, livemode: own.livemode },
    'Plan billing portal session created'
  );
  return { ok: true, url: session.url };
}

// ── Invoices ────────────────────────────────────────────────────────────────

export async function listPlanInvoices(input: { userId: string }, deps: PlanBillingDocsDeps): Promise<PlanInvoicesResult> {
  const { userId } = input;
  const log = deps.logger;
  const refuse = refuser(log, userId, 'invoices');

  const own = await readOwnCustomer(userId, deps, refuse);
  if (!own.ok) return own;

  const stripe = deps.stripe ?? getStripeService();
  let page: Awaited<ReturnType<PlanBillingDocsStripe['listBusinessOsInvoices']>>;
  try {
    page = await stripe.listBusinessOsInvoices({ customerId: own.customerId, limit: PLAN_INVOICE_LIST_LIMIT });
  } catch (err) {
    return refuse('stripe_error', { stripeError: safeErr(err), step: 'invoice_list', customerId: own.customerId });
  }

  // The plan label is cosmetic: a catalog that cannot be read leaves it empty.
  let byPriceId: ReadonlyMap<string, string> = new Map();
  try {
    byPriceId = (await (deps.catalog ?? planPriceCatalog).load()).byPriceId;
  } catch (err) {
    log.warn({ event: 'bos_billing_invoice_labels_unavailable', userId, err: safeErr(err) }, 'Invoice list shown without plan labels');
  }
  const labelForPriceId = (priceId: string): string | null => {
    const lookupKey = byPriceId.get(priceId);
    const tier = lookupKey ? planTierForLookupKey(lookupKey) : null;
    return tier ? TIER_MATRIX.presentation[tier].labels.en : null;
  };

  const mapped = mapPlanInvoices(page.invoices, { customerId: own.customerId, livemode: own.livemode, labelForPriceId, isHostedInvoiceUrl });

  // Ids and reasons only, never a URL or the list itself (C-6).
  const faults = mapped.dropped.filter((d) => d.reason === 'other_customer' || d.reason === 'other_mode' || d.reason === 'not_usd');
  if (faults.length > 0) {
    log.error(
      { event: 'bos_billing_invoice_list_dropped', alert: true, userId, customerId: own.customerId, dropped: faults },
      'Invoices on the Business OS customer that cannot be shown (another customer or mode, or not USD)'
    );
  }
  log.info(
    { event: 'bos_billing_invoices_listed', userId, customerId: own.customerId, shown: mapped.rows.length, dropped: mapped.dropped.length, hasMore: page.hasMore, livemode: own.livemode },
    'Plan invoice list read'
  );
  return { ok: true, invoices: mapped.rows, hasMore: page.hasMore };
}
