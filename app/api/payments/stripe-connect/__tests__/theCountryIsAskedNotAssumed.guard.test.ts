/**
 * The owner's country is asked. It is never assumed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `ConfigurationDialog.handleConnectStripe` posted `{ country: 'US' }` the
 * instant the button was pressed, with the comment "Default to US, can be
 * changed in Stripe's form". It cannot be changed there or anywhere:
 * `accounts.country` is immutable once the account exists. Every Connect
 * account this platform has ever opened is American as a result.
 *
 * Three things follow from the country, and all three were wrong for anyone
 * outside the United States:
 *
 *   · the settlement currency, which `create-minimal` then wrote as
 *     `country === 'US' ? 'USD' : 'EUR'` — so shekels, pounds and yen were all
 *     recorded as euros;
 *   · the KYC questions, so an Israeli sole trader was asked for a Social
 *     Security Number and a nine-digit US routing number;
 *   · whether the business can be paid at all. Services priced at 21 ILS
 *     could not be charged in the account we opened for them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Nothing fails when the default comes back. The route compiles, the account is
 * created, Stripe accepts it, and the owner is simply handed a form for the
 * wrong country — which reads as Stripe being confusing rather than as our bug.
 * It survived in production precisely because every symptom points elsewhere.
 *
 * These assertions are about SOURCE TEXT, not behaviour, for the same reason:
 * the failure is a value present in a file, and no runtime assertion can see it
 * without a live Stripe account in each of twenty-five countries.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

/** Comment lines, so a comment EXPLAINING the old bug never fails the guard. */
function code(source: string): string {
  return source
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return !(
        trimmed.startsWith('*') ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*/')
      );
    })
    .join('\n');
}

describe('the country is asked, not assumed', () => {
  it('the payments dialog does not post a country of its own', () => {
    const dialog = code(read('components/business-os/ConfigurationDialog.tsx'));

    /* The exact shape that shipped: a literal country in the create call. */
    expect(dialog).not.toMatch(/country:\s*'US'/);
    expect(dialog).not.toMatch(/country:\s*"US"/);
  });

  it('the dialog creates nothing until the owner has seen a country screen', () => {
    const dialog = read('components/business-os/ConfigurationDialog.tsx');

    /*
     * `create-minimal` must not be called from the dialog at all any more: the
     * prepare component owns that call, after the country has been chosen. A
     * fetch reappearing here is the old one-press flow coming back.
     */
    expect(code(dialog)).not.toContain('stripe-connect/create-minimal');
    expect(dialog).toContain('StripeConnectPrepare');
  });

  it('the prepare screen offers no country until one is chosen or suggested', () => {
    const prepare = code(read('components/payments/StripeConnectPrepare.tsx'));

    /* Starts empty, and the continue button is disabled while it is empty. */
    expect(prepare).toMatch(/useState\(''\)/);
    expect(prepare).toContain('disabled={!country}');
  });

  it('create-minimal requires a supported country and defaults none', () => {
    const route = code(read('app/api/payments/stripe-connect/create-minimal/route.ts'));

    expect(route).not.toMatch(/\.default\('US'\)/);
    expect(route).toContain('isSupportedCountry');
  });

  it('no route derives a currency from a ternary on the country', () => {
    for (const path of [
      'app/api/payments/stripe-connect/create-minimal/route.ts',
      'app/api/payments/stripe-connect/create-account-custom/route.ts',
    ]) {
      const route = code(read(path));

      /* The exact expression that filed Israel in euros. */
      expect(route).not.toMatch(/===\s*'US'\s*\?\s*'USD'\s*:\s*'EUR'/);
      expect(route).toContain('settlementCurrencyFor');
    }
  });

  it('refreshing from Stripe cannot overwrite a currency with dollars', () => {
    const route = code(read('app/api/payments/stripe-connect/refresh-status/route.ts'));

    /*
     * This route runs on every open of the payments dialog, so a `|| 'USD'`
     * here does not merely guess once — it corrects a right answer to a wrong
     * one, repeatedly, for the lifetime of the account.
     */
    expect(route).not.toMatch(/defaultCurrency\s*\|\|\s*'USD'/);
    expect(route).toContain('settlementCurrencyFor');
  });
});

describe('the embedded form asks for as little as it can, in our colours', () => {
  it('only what is currently due is collected, and it is set on the component', () => {
    const component = code(read('components/payments/StripeEmbeddedOnboarding.tsx'));

    /*
     * Without this, Stripe collects `eventually_due`: every field it will ever
     * want, before the owner can take a single payment.
     */
    expect(component).toContain('setCollectionOptions');
    expect(component).toContain("fields: 'currently_due'");
  });

  it('the account session does not try to set collection options', () => {
    const route = code(read('app/api/payments/stripe-connect/account-session/route.ts'));

    /*
     * This was written here first, which is the obvious place to look and the
     * wrong one: `collection_options` is not an `accountSessions.create`
     * parameter. Stripe rejects unknown parameters, so the mistake does not
     * silently do nothing — it fails the session request and the onboarding
     * form never renders at all.
     */
    expect(route).not.toContain('collection_options:');
  });

  it('the embedded appearance comes from the V2 tokens, not from literals', () => {
    const component = code(read('components/payments/StripeEmbeddedOnboarding.tsx'));

    /*
     * Stripe purple on #ffffff was hardcoded, so in dark mode the identity and
     * bank form rendered as a white card inside a dark dialog — another
     * company's page, at the exact moment we ask for an ID number.
     *
     * The literals survive as FALLBACKS inside `token()`, which is why this
     * asserts on the assignment rather than on the value appearing at all.
     */
    expect(component).not.toMatch(/colorPrimary:\s*'#635BFF'/);
    expect(component).not.toMatch(/colorBackground:\s*'#ffffff'/);

    expect(component).toContain("token('--v2-primary'");
    expect(component).toContain("token('--v2-surface'");
  });
});

describe('what we already know is sent, not asked again', () => {
  it('create-minimal prefills from the business profile', () => {
    const route = code(read('app/api/payments/stripe-connect/create-minimal/route.ts'));

    expect(route).toContain('buildStripePrefill');
    expect(route).toContain('businessProfileRepository.findByUserId');
  });

  it('the business type is the owner\'s answer, never a constant', () => {
    const route = code(read('app/api/payments/stripe-connect/create-minimal/route.ts'));

    /*
     * ── THE BUG THIS PINS ───────────────────────────────────────────────────
     *
     * `businessType: 'individual'` was hardcoded here. Measured on a live
     * onboarding (acct_1UcSSm8KIparNYzX, 2026-11-16): the account was a
     * COMPANY, so Stripe read `company.*` and ignored the five fields we had
     * carefully placed in `individual.*`. Its owner then retyped the address
     * and the EIN, both of which were already on file — and the audit row said
     * `prefill_applied: true`, because from our side it had been.
     *
     * Prefilling the wrong block is indistinguishable from not prefilling at
     * all, except that it looks like it worked.
     */
    expect(route).not.toMatch(/businessType:\s*'individual'/);
    expect(route).not.toMatch(/businessType:\s*'company'/);
    expect(route).toContain('businessType: validated.business_type');
    expect(route).toContain("business_type: z.enum(['individual', 'company'])");
  });

  it('the stored row records the type that was actually used', () => {
    const route = code(read('app/api/payments/stripe-connect/create-minimal/route.ts'));
    expect(route).toContain('business_type: validated.business_type');
  });

  it('the screen asks the business type and will not continue without it', () => {
    const prepare = code(read('components/payments/StripeConnectPrepare.tsx'));
    expect(prepare).toContain('config.stripe.prepare.type_label');
    expect(prepare).toContain('disabled={!country || !businessType}');
    expect(prepare).toContain('business_type: businessType');
  });

  it('only one of individual and company is ever built', () => {
    const builder = code(read('lib/payments/stripePrefill.ts'));

    /*
     * Stripe rejects a `company` object on an individual account and ignores an
     * `individual` one on a company, so the builder must branch rather than
     * fill both and hope.
     */
    expect(builder).toMatch(/asked === 'individual'/);
    expect(builder).toMatch(/asked === 'company'/);
    /* The tax id we already hold goes to the company block. */
    expect(builder).toContain('block.tax_id = taxId');
  });

  it('a payout account is only sent when it can be checked', () => {
    const builder = code(read('lib/payments/stripePrefill.ts'));

    /*
     * `invoice_bank_account` is free text for printing on an invoice. In an
     * IBAN country one value is the whole account and its shape can be
     * verified; in the US an account number without a routing number cannot
     * become a payout account at all, and a malformed `external_account`
     * rejects the whole `accounts.create` call rather than being ignored.
     */
    expect(builder).toContain('IBAN_COUNTRIES');
    expect(builder).toMatch(/\^\$\{country\}\\\\d\{2\}/);
  });

  it('a bad payout account costs only the payout account', () => {
    const route = code(read('app/api/payments/stripe-connect/create-minimal/route.ts'));

    /*
     * The bank details are the likeliest field for Stripe to refuse, being
     * parsed out of free text. Dropping every other prefilled field with them
     * would punish the owner for our parsing.
     */
    expect(route).toContain('createPrefilled(false)');
    expect(route).toContain('bankApplied');
  });

  it('a prefill Stripe dislikes never blocks connecting', () => {
    const route = code(read('app/api/payments/stripe-connect/create-minimal/route.ts'));

    /*
     * `accounts.create` rejects the whole call over one field it does not like.
     * Prefill is a convenience and must degrade to the old behaviour rather
     * than showing the owner an error about data they never entered here.
     */
    expect(route).toContain('createExpressAccountMinimal');
    expect(route).toMatch(/catch\s*\(createError\)/);
  });

  it('an incomplete business profile cannot open an account', () => {
    const route = code(read('app/api/payments/stripe-connect/create-minimal/route.ts'));

    /*
     * The gate lives on the server as well as on the screen, because a gate the
     * browser can skip is a suggestion. 409 with the blockers named, so the
     * caller can show which fields rather than "something was wrong".
     */
    expect(route).toContain('stripeReadiness');
    expect(route).toContain('readiness.canConnect');
    expect(route).toMatch(/status:\s*409/);
    expect(route).toContain('blockers: readiness.blockers');
  });

  it('the gate never blocks an owner continuing an onboarding they started', () => {
    const route = code(read('app/api/payments/stripe-connect/create-minimal/route.ts'));

    /*
     * Order matters and nothing else enforces it: the existing-account return
     * must come BEFORE the readiness check, or a profile field emptied after
     * the account was opened would lock its owner out of finishing setup.
     */
    expect(route.indexOf('isExisting: true')).toBeGreaterThan(-1);
    expect(route.indexOf('isExisting: true')).toBeLessThan(route.indexOf('stripeReadiness('));
  });

  it('business facts are read on the server, never accepted from the client', () => {
    const route = code(read('app/api/payments/stripe-connect/create-minimal/route.ts'));

    /* The request body carries the country and nothing else. */
    const schema = route.slice(route.indexOf('createMinimalSchema'), route.indexOf('export async function'));
    expect(schema).not.toContain('business_profile');
    expect(schema).not.toContain('individual');
  });
});
