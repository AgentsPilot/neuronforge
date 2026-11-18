/**
 * What we already know about a business, in the shape Stripe asks for it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER TYPED ALL OF THIS ONCE
 *
 * Stripe's onboarding asks for a business name, a website, a phone number, an
 * address, an industry and a description. Every one of those is already in
 * `business_profiles`, put there during setup. Sending none of it — which is
 * what `create-minimal` did, by name and by design — means the owner answers
 * the same questions a second time, in a form that cannot explain why.
 *
 * This builds the Stripe payload from the row we already hold, and the same
 * facts as a list the UI can show before anything is sent, so the owner
 * confirms rather than retypes.
 *
 * ── NOTHING HERE IS LOAD-BEARING ────────────────────────────────────────────
 * Every field is optional, and a field we cannot fill is simply absent: Stripe
 * then asks for it, exactly as it does today. Prefill is a convenience, so it
 * must never be the reason connecting fails — the route that calls this retries
 * without the payload if Stripe refuses any part of it.
 *
 * ── THE COUNTRY IS NOT ONE OF THOSE FIELDS ──────────────────────────────────
 * It is the one answer that cannot be corrected later: `accounts.country` is
 * fixed when the account is created, and it decides the settlement currency,
 * the KYC questions and the payout rails. So this module SUGGESTS a country and
 * never defaults one. `null` means "ask the owner", not "use the United
 * States" — that assumption is what put five live accounts in USD and made
 * shekels unreachable for a business whose services are priced in them.
 *
 * @module lib/payments/stripePrefill
 */

/** The address shape both `address_parts` and `invoice_address` carry. */
export interface AddressParts {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  /** ISO 3166-1 alpha-2, chosen from a list and never typed. */
  country?: string | null;
}

/**
 * The columns of `business_profiles` this reads.
 *
 * A subset, declared locally rather than imported: the repository's
 * `BusinessProfile` does not list `address_parts` (it arrived with a later
 * migration and `select('*')` returns it anyway), and this module needs no
 * other column.
 */
export interface BusinessFacts {
  company_name?: string | null;
  website_url?: string | null;
  phone?: string | null;
  description?: string | null;
  vertical?: string | null;
  sub_vertical?: string | null;
  language?: string | null;
  company_size?: string | null;
  address_parts?: AddressParts | null;
  invoice_address?: AddressParts | null;
  /** The EIN, VAT or company number already printed on their invoices. */
  invoice_tax_id?: string | null;
  invoice_company_name?: string | null;
  invoice_bank_name?: string | null;
  /** Free text, for printing. Only usable as a payout account when it parses. */
  invoice_bank_account?: string | null;
}

/**
 * Sole trader or company.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE FIELD THAT MADE THE PREFILL POINTLESS
 *
 * `individual` and `company` are different objects to Stripe, and it asks for
 * different things depending on which the account is: a sole trader gives a
 * date of birth and an ID number, a company gives a registered address and a
 * tax id. Prefilling the wrong one is exactly as useful as prefilling nothing.
 *
 * Measured on a live onboarding: the account was created as `individual`
 * because that was hardcoded, the owner picked Company in Stripe's form, and
 * they then retyped the address and the EIN that were both already on file.
 *
 * So it is asked, beside the country, and for the same reason: it decides what
 * the rest of the conversation is about.
 */
export type BusinessType = 'individual' | 'company';

/**
 * Stripe's merchant category code, by the vertical the owner picked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `business_profile.mcc` IS MANDATORY, and it was blank for most of this
 * product's trades.
 *
 * Measured on a live account: `mcc` appears in Stripe's own `currently_due`,
 * so an account cannot finish onboarding without one. This table held five
 * entries against twenty-four verticals — and one of the five,
 * `course_creator`, is not in `SELECTABLE_VERTICALS` at all, so it could never
 * fire. A hairdresser, a trainer and a contractor all reached Stripe's
 * industry picker blank while we were holding the answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A WRONG CODE IS WORSE THAN NO CODE, which is the rule this table follows.
 *
 * Stripe does not ignore an MCC it does not recognise — `accounts.create`
 * rejects the WHOLE call, and the degrade ladder in `create-minimal` then
 * drops every other prefilled field to get an account made. So one bad entry
 * here costs that vertical its name, phone, address and bank details too.
 *
 * Every code below is from Stripe's published list, chosen as the nearest
 * honest match rather than the most flattering:
 *
 *   · the beauty trades share 7230, which is what that code is for ("Barber
 *     and Beauty Shops"); a nail technician is not a different industry to a
 *     card network, however different the work is.
 *   · `wellness` and `spa` take 7298 (Health and Beauty Spas) rather than a
 *     medical code: Stripe reads medical MCCs as regulated healthcare.
 *   · `home_services` takes 1799 (Special Trade Contractors), the catch-all
 *     for a trade we have not narrowed, rather than guessing at plumbing or
 *     electrical.
 *   · `fitness` and `trainer` take 7997. `trainer` was deliberately absent
 *     before on the grounds that fitness spans several codes, which is true
 *     and left every personal trainer typing it by hand; 7997 is the one
 *     Stripe's own examples use for gyms and personal training.
 *
 * A vertical still missing from this table sends no MCC and Stripe asks, which
 * is exactly the old behaviour. `default` and `other` are absent on purpose:
 * they are sentinels meaning "we could not read the trade", and inventing an
 * industry from a sentinel is how a business ends up categorised as something
 * it never said it was.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MCC_BY_VERTICAL: Record<string, string> = {
  /* professional services */
  lawyer: '8111', // Legal services and attorneys
  accountant: '8931', // Accounting, auditing and bookkeeping services
  consultant: '7392', // Management, consulting and public relations services
  coach: '7392',
  agency: '7311', // Advertising services
  designer: '7333', // Commercial photography, art and graphics

  /* health and care */
  therapist: '8099', // Medical services and health practitioners
  doctor: '8011', // Doctors and physicians
  dentist: '8021', // Dentists and orthodontists

  /* teaching */
  teacher: '8299', // Schools and educational services
  tutor: '8299',
  course_creator: '8299',

  /* fitness */
  fitness: '7997', // Membership clubs, sports and athletic
  trainer: '7997',

  /* the beauty trades, which share one code by Stripe's own definition */
  beauty: '7230', // Barber and beauty shops
  hairdresser: '7230',
  barber: '7230',
  nail_tech: '7230',
  makeup_artist: '7230',
  esthetician: '7230',
  wellness: '7298', // Health and beauty spas
  spa: '7298',

  /* selling things, and visiting people */
  retail: '5399', // Miscellaneous general merchandise
  photographer: '7333', // Commercial photography, art and graphics
  realtor: '6513', // Real estate agents and managers
  /*
   * Both of these take the "miscellaneous personal services" code, and the
   * reason is the same: Stripe's list has no entry for an event planner or a
   * dog walker, and the nearby specific codes would be wrong rather than
   * imprecise — 0742 is veterinary medicine, 5995 is a pet shop selling goods.
   */
  events: '7299', // Miscellaneous personal services
  pet_services: '7299',

  /* trades */
  contractor: '1520', // General contractors, residential and commercial
  home_services: '1799', // Special trade contractors
  auto_services: '7538', // Automotive service shops
};

/**
 * The country a language implies, where it implies one at all.
 *
 * Hebrew only. A Hebrew-speaking business is in Israel in every case this
 * product has seen, whereas Spanish spans a dozen countries with different
 * payout rails and English says nothing whatsoever. One honest entry beats a
 * table of plausible guesses about the one field that cannot be undone.
 */
const COUNTRY_BY_LANGUAGE: Record<string, string> = {
  he: 'IL',
};

/** A fact we hold, ready for the confirmation screen. */
export interface KnownFact {
  /** Translation key suffix: `payments.stripe.known.<key>`. */
  key:
    | 'business_name'
    | 'email'
    | 'phone'
    | 'address'
    | 'website'
    | 'sells'
    | 'trading_as'
    | 'tax_id'
    | 'bank';
  /** Already formatted for display. Never a key, never an id. */
  value: string;
}

export interface StripePrefill {
  /**
   * The country to offer, or null when we genuinely cannot tell.
   *
   * Null is a real answer and the UI must honour it by requiring a choice.
   * Never substitute a default here.
   */
  suggestedCountry: string | null;
  /** Where the suggestion came from, for the log and for the screen's copy. */
  countrySource: 'address' | 'invoice_address' | 'language' | null;
  /** `business_profile` for `accounts.create`, or undefined when empty. */
  businessProfile?: {
    name?: string;
    url?: string;
    mcc?: string;
    product_description?: string;
  };
  /** `individual` for `accounts.create`. Undefined for a company. */
  individual?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    };
  };
  /**
   * The person who signs, for a COMPANY account only.
   *
   * Not part of `accounts.create` — Stripe models the signer as a separate
   * Person object — so this is carried out to the caller to send with
   * `createAccountRepresentative` once the account exists.
   *
   * Name, email and phone, and nothing else. See that method for why the home
   * address is deliberately absent even though we hold a business one.
   */
  representative?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  /** `company` for `accounts.create`. Undefined for a sole trader. */
  company?: {
    name?: string;
    phone?: string;
    tax_id?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    };
  };
  /**
   * The payout account, only when one can be built honestly.
   *
   * ── WHY THIS IS SO OFTEN ABSENT ───────────────────────────────────────────
   * `invoice_bank_account` is free text for printing on an invoice. In an IBAN
   * country one value is the whole account and can be checked by shape. In the
   * United States an account number is useless without a routing number, and
   * there is no column for one: a live profile holds `invoice_bank_name:
   * "Chase"` and `invoice_bank_account: "588755588"`, which cannot be turned
   * into a payout account no matter how it is parsed.
   *
   * So this is filled for IBAN countries and left empty elsewhere, and the
   * owner enters the bank once in Stripe's form. Sending a half-built account
   * would fail the whole `accounts.create` call.
   */
  externalAccount?: {
    country: string;
    currency: string;
    account_number: string;
    account_holder_name?: string;
  };
  /** The business type the facts imply, or null when they do not imply one. */
  suggestedBusinessType: BusinessType | null;
  /** The same facts, for the owner to read before any of it is sent. */
  known: KnownFact[];
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GATE: WHAT MUST BE ON FILE BEFORE A STRIPE ACCOUNT IS OPENED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `profileReadiness` states the rule this follows: "a gate is a thing that is
 * broken without an answer, not a thing it would be nice to know." Three
 * answers qualify, and they are the same three the invoice gate already asks
 * for, because Stripe needs exactly what a client being billed needs.
 *
 *   business_name  Stripe puts it on the account and on the card statement. An
 *                  Express account with no business name is one the owner must
 *                  name inside Stripe's form instead, where we cannot explain
 *                  what it is for or keep it consistent with their invoices.
 *
 *   address        Required for the account, AND the only honest source for the
 *                  country — which `accounts.country` fixes forever. Without
 *                  one the owner is guessing at the single field no later
 *                  correction can repair. Street, city and country, the same
 *                  standard `hasUsableAddress` sets: postal code and state are
 *                  not asked for, because many countries write neither.
 *
 *   phone          Stripe asks individuals for one in most countries, and a
 *                  payouts problem is the one thing it will telephone about.
 *
 * Everything else is a NUDGE: Stripe will ask, the owner will answer, and the
 * only cost is typing. A website and a description fall there, and so does the
 * industry code we derive from the vertical.
 *
 * Both lists are returned rather than one verdict, so the screen can block on
 * the first and merely mention the second.
 */
export type StripeBlocker = 'business_name' | 'address' | 'phone';
export type StripeNudge = 'website' | 'description';

export interface StripeReadiness {
  /** Must be fixed before an account is created. */
  blockers: StripeBlocker[];
  /** Worth filling in, never a reason to refuse. */
  nudges: StripeNudge[];
  canConnect: boolean;
}

/** Trimmed, or undefined — so an empty string never reaches Stripe as a value. */
function clean(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A URL Stripe will accept.
 *
 * Owners type `studioaviv.co.il`; Stripe wants a scheme. The same preprocessing
 * `create-account-custom`'s Zod schema already does, moved here so the UI and
 * the server agree on what will be sent.
 */
function asUrl(value: string | null | undefined): string | undefined {
  const raw = clean(value);
  if (!raw) return undefined;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** An alpha-2 country code, uppercased, or undefined when it is not one. */
function asCountry(value: string | null | undefined): string | undefined {
  const raw = clean(value);
  if (!raw || raw.length !== 2 || !/^[A-Za-z]{2}$/.test(raw)) return undefined;
  return raw.toUpperCase();
}

/** The address the business shows clients, falling back to its billing one. */
function pickAddress(facts: BusinessFacts): { parts: AddressParts; from: 'address' | 'invoice_address' } | null {
  const own = facts.address_parts;
  if (own && (clean(own.line1) || clean(own.city) || asCountry(own.country))) {
    return { parts: own, from: 'address' };
  }
  const billing = facts.invoice_address;
  if (billing && (clean(billing.line1) || clean(billing.city) || asCountry(billing.country))) {
    return { parts: billing, from: 'invoice_address' };
  }
  return null;
}

/** One line of address, for the confirmation screen rather than for Stripe. */
function renderAddress(parts: AddressParts): string | undefined {
  const pieces = [clean(parts.line1), clean(parts.line2), clean(parts.city), clean(parts.postal_code)];
  const line = pieces.filter(Boolean).join(', ');
  return line.length > 0 ? line : undefined;
}

/**
 * Split a display name into the two fields Stripe wants.
 *
 * Only when there are at least two words, and the last word is the surname.
 * Wrong for some naming conventions, which is why it is prefill and not a
 * claim: the owner sees both fields in Stripe's form and can correct them. A
 * single-word name sends nothing rather than a surname nobody gave.
 */
function splitName(fullName: string | null | undefined): { first_name?: string; last_name?: string } {
  const name = clean(fullName);
  if (!name) return {};
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return {};
  return { first_name: words.slice(0, -1).join(' '), last_name: words[words.length - 1] };
}

/**
 * Is this business's profile complete enough to open a Stripe account?
 *
 * Read on the server from `business_profiles`, and enforced there too: a gate
 * the browser could skip is a suggestion.
 */
export function stripeReadiness(facts: BusinessFacts | null | undefined): StripeReadiness {
  const row = facts ?? {};
  const blockers: StripeBlocker[] = [];
  const nudges: StripeNudge[] = [];

  if (!clean(row.company_name)) blockers.push('business_name');

  /* Street, city and country, from whichever address the business has. */
  const address = pickAddress(row);
  const usable =
    address !== null &&
    Boolean(clean(address.parts.line1)) &&
    Boolean(clean(address.parts.city)) &&
    Boolean(asCountry(address.parts.country));
  if (!usable) blockers.push('address');

  if (!clean(row.phone)) blockers.push('phone');

  if (!asUrl(row.website_url)) nudges.push('website');
  if (!clean(row.description)) nudges.push('description');

  return { blockers, nudges, canConnect: blockers.length === 0 };
}

/**
 * The countries whose payout account is a single IBAN we can check by shape.
 *
 * Deliberately not "everywhere that uses IBAN": only the ones this product
 * offers, so the check and the country picker cannot drift apart.
 */
const IBAN_COUNTRIES = new Set([
  'IL', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'CH', 'SE', 'NO', 'DK', 'GB',
]);

/**
 * A payout account from the bank details on file, or undefined.
 *
 * Undefined far more often than not, and that is the correct outcome: a
 * malformed `external_account` does not degrade gracefully, it rejects the
 * whole `accounts.create` call. The shape test is deliberately strict — the
 * country's own prefix, two check digits, then 10 to 30 alphanumerics — so a
 * bank name, a sort code or a US account number can never be mistaken for one.
 */
function payoutAccountFrom(
  facts: BusinessFacts,
  country: string | null,
  currency: string | null,
  holder: string | undefined
): StripePrefill['externalAccount'] {
  if (!country || !currency) return undefined;
  if (!IBAN_COUNTRIES.has(country)) return undefined;

  const raw = clean(facts.invoice_bank_account);
  if (!raw) return undefined;

  const candidate = raw.replace(/[\s-]/g, '').toUpperCase();
  const pattern = new RegExp(`^${country}\\d{2}[A-Z0-9]{10,30}$`);
  if (!pattern.test(candidate)) return undefined;

  return {
    country,
    currency: currency.toLowerCase(),
    account_number: candidate,
    ...(holder ? { account_holder_name: holder } : {}),
  };
}

/**
 * Sole trader or company, as the facts imply it — never as a default.
 *
 * A tax id on the invoices is the strongest signal available: a business that
 * prints an EIN or a company number is registered. `company_size` of 'solo'
 * points the other way. When neither speaks, this answers null and the screen
 * asks, because getting it wrong wastes the entire prefill.
 */
function suggestBusinessType(facts: BusinessFacts): BusinessType | null {
  if (clean(facts.invoice_tax_id)) return 'company';
  const size = clean(facts.company_size)?.toLowerCase();
  if (size === 'solo') return 'individual';
  return null;
}

export interface PrefillInput {
  facts: BusinessFacts | null;
  /** The signed-in owner's email, from auth rather than from the profile. */
  email?: string | null;
  /** Their display name, where auth carries one. */
  fullName?: string | null;
  /**
   * Which block to fill. Omitted on the read that FEEDS the screen (it has not
   * been asked yet); always supplied by the route that creates the account.
   */
  businessType?: BusinessType | null;
  /** The chosen country, so a payout account can be shape-checked against it. */
  country?: string | null;
  /** Its settlement currency, for the same reason. */
  currency?: string | null;
}

/**
 * Everything we can tell Stripe without asking the owner a single question.
 */
export function buildStripePrefill(input: PrefillInput): StripePrefill {
  const facts = input.facts ?? {};
  const known: KnownFact[] = [];

  /* ── the country, which is a suggestion and never a default ───────────── */
  const address = pickAddress(facts);
  const fromAddress = address ? asCountry(address.parts.country) : undefined;
  const fromLanguage = facts.language ? COUNTRY_BY_LANGUAGE[facts.language.toLowerCase()] : undefined;

  let suggestedCountry: string | null = null;
  let countrySource: StripePrefill['countrySource'] = null;
  if (fromAddress) {
    suggestedCountry = fromAddress;
    countrySource = address?.from ?? 'address';
  } else if (fromLanguage) {
    suggestedCountry = fromLanguage;
    countrySource = 'language';
  }

  /* ── what the business is ─────────────────────────────────────────────── */
  const name = clean(facts.company_name);
  const url = asUrl(facts.website_url);
  const description = clean(facts.description);
  const mcc = facts.vertical ? MCC_BY_VERTICAL[facts.vertical.toLowerCase()] : undefined;

  const businessProfile: NonNullable<StripePrefill['businessProfile']> = {};
  if (name) businessProfile.name = name;
  if (url) businessProfile.url = url;
  if (mcc) businessProfile.mcc = mcc;
  if (description) businessProfile.product_description = description;

  /* ── who the owner is ─────────────────────────────────────────────────── */
  const email = clean(input.email);
  const phone = clean(facts.phone);
  const taxId = clean(facts.invoice_tax_id);

  /* The address, in the shape both blocks take. Built once. */
  let addressParts: NonNullable<NonNullable<StripePrefill['individual']>['address']> | undefined;
  if (address) {
    const parts: NonNullable<NonNullable<StripePrefill['individual']>['address']> = {};
    const line1 = clean(address.parts.line1);
    const line2 = clean(address.parts.line2);
    const city = clean(address.parts.city);
    const state = clean(address.parts.state);
    const postal = clean(address.parts.postal_code);
    const country = asCountry(address.parts.country);
    if (line1) parts.line1 = line1;
    if (line2) parts.line2 = line2;
    if (city) parts.city = city;
    if (state) parts.state = state;
    if (postal) parts.postal_code = postal;
    if (country) parts.country = country;
    if (Object.keys(parts).length > 0) addressParts = parts;
  }

  /*
   * ── ONE BLOCK OR THE OTHER, NEVER BOTH ──────────────────────────────────
   *
   * Stripe rejects a `company` object on an individual account and ignores an
   * `individual` one on a company. Which is why the type is asked rather than
   * assumed: the hardcoded 'individual' sent five fields into the block Stripe
   * was not reading, and the owner retyped all of them.
   *
   * With the type still unknown (the read that feeds the screen) neither is
   * built — there is nothing to send yet, only something to show.
   */
  const asked = input.businessType ?? null;

  let individual: StripePrefill['individual'];
  let company: StripePrefill['company'];
  let representative: StripePrefill['representative'];

  if (asked === 'individual') {
    const block: NonNullable<StripePrefill['individual']> = { ...splitName(input.fullName) };
    if (email) block.email = email;
    if (phone) block.phone = phone;
    if (addressParts) block.address = addressParts;
    /* No tax id here on purpose: `individual.id_number` is an SSN in the US,
       and `invoice_tax_id` is whatever a business prints on an invoice. */
    individual = Object.keys(block).length > 0 ? block : undefined;
  } else if (asked === 'company') {
    const block: NonNullable<StripePrefill['company']> = {};
    /* The registered name, which may differ from the trading name. */
    const registered = clean(facts.invoice_company_name) ?? name;
    if (registered) block.name = registered;
    if (phone) block.phone = phone;
    if (taxId) block.tax_id = taxId;
    if (addressParts) block.address = addressParts;
    company = Object.keys(block).length > 0 ? block : undefined;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * AND THE PERSON WHO SIGNS FOR IT.
     *
     * A company account has no `individual` block, so everything we know
     * about the human was being dropped on this branch: "Verify your personal
     * details" opened with every field blank, and the owner retyped a name
     * and a phone number sitting in our own tables.
     *
     * The same name and phone the individual branch sends. NOT the address:
     * ours is the business one, and the signer's home address is an identity
     * attestation that a wrong value makes worse rather than faster.
     * ───────────────────────────────────────────────────────────────────────
     */
    const signer: NonNullable<StripePrefill['representative']> = { ...splitName(input.fullName) };
    if (email) signer.email = email;
    if (phone) signer.phone = phone;
    representative = Object.keys(signer).length > 0 ? signer : undefined;
  }

  const payout = payoutAccountFrom(
    facts,
    asCountry(input.country) ?? null,
    clean(input.currency) ?? null,
    clean(facts.invoice_company_name) ?? name
  );

  /* ── the same facts, for the owner to read ────────────────────────────── */
  if (name) known.push({ key: 'business_name', value: name });
  if (email) known.push({ key: 'email', value: email });
  if (phone) known.push({ key: 'phone', value: phone });
  if (address) {
    const rendered = renderAddress(address.parts);
    if (rendered) known.push({ key: 'address', value: rendered });
  }
  if (taxId) known.push({ key: 'tax_id', value: taxId });
  if (url) known.push({ key: 'website', value: url });
  if (description) known.push({ key: 'sells', value: description });
  /* Only when it will actually be sent, so the screen never promises a bank
     account that Stripe is about to ask for anyway. */
  if (payout) {
    const tail = payout.account_number.slice(-4);
    known.push({ key: 'bank', value: `${clean(facts.invoice_bank_name) ?? ''} ••••${tail}`.trim() });
  }

  return {
    suggestedCountry,
    countrySource,
    suggestedBusinessType: suggestBusinessType(facts),
    businessProfile: Object.keys(businessProfile).length > 0 ? businessProfile : undefined,
    individual,
    representative,
    company,
    externalAccount: payout,
    known,
  };
}
