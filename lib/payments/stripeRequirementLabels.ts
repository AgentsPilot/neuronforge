/**
 * What Stripe is still waiting for, in words an owner recognises.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `account.requirements.currently_due` is the authoritative list of what is
 * MANDATORY right now — Stripe's own answer, not our guess — and we have been
 * fetching it and throwing the names away. The route sent a count because the
 * raw entries are internal paths:
 *
 *   individual.dob.day · individual.verification.document · external_account
 *   person_1Ux9.relationship.title · company.tax_id · tos_acceptance.date
 *
 * A count is a real improvement over "Setup incomplete" — "four details left"
 * is a task rather than a verdict — and it still leaves the owner with no idea
 * whether those four are two minutes of typing or a passport scan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE THINGS THIS HAS TO GET RIGHT
 *
 * 1. COLLAPSE THE PARTS. A date of birth arrives as three separate entries
 *    (`dob.day`, `dob.month`, `dob.year`) and an address as up to five. Listed
 *    raw, one missing birthday reads as three outstanding tasks.
 *
 * 2. STRIP THE PERSON PREFIX. Requirements for a company's signer are keyed by
 *    person id — `person_1Ux9KL2eZvKYlo2C.dob.day` — which is unreadable and
 *    unique per account, so no static map can hold it.
 *
 * 3. NEVER INVENT. An unmapped key is dropped rather than guessed at: Stripe
 *    adds requirement types as regulation changes, and a wrong label on a legal
 *    obligation is worse than a shorter list. The count stays authoritative, so
 *    "2 details left" beside one named item is honest and self-evident.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments
 */

/** A requirement reduced to one thing a person would say. */
export interface RequirementLabel {
  /** Stable id, used as a translation key suffix: `stripe.due.<id>`. */
  id: string;
  /** English, and the fallback wherever a translation is missing. */
  label: string;
}

/**
 * The tail of a requirement path, once the owner prefix is removed.
 *
 * Keyed on what is left after `individual.`, `company.`, `person_xxx.` or
 * nothing at all, because Stripe asks for the same fact of a sole trader, a
 * company and a company's representative under three different prefixes.
 */
const BY_SUFFIX: Record<string, RequirementLabel> = {
  'first_name': { id: 'name', label: 'Legal name' },
  'last_name': { id: 'name', label: 'Legal name' },
  'dob.day': { id: 'dob', label: 'Date of birth' },
  'dob.month': { id: 'dob', label: 'Date of birth' },
  'dob.year': { id: 'dob', label: 'Date of birth' },
  'email': { id: 'email', label: 'Email address' },
  'phone': { id: 'phone', label: 'Phone number' },
  'id_number': { id: 'id_number', label: 'Tax or ID number' },
  'ssn_last_4': { id: 'ssn_last_4', label: 'Last 4 of your SSN' },
  'tax_id': { id: 'tax_id', label: 'Business tax number' },
  'name': { id: 'legal_name', label: 'Legal business name' },
  'relationship.title': { id: 'job_title', label: 'Job title' },
  'relationship.representative': { id: 'representative', label: 'Who signs for the business' },
  'relationship.owner': { id: 'owner', label: 'Business owners' },
  'relationship.director': { id: 'director', label: 'Company directors' },
  'verification.document': { id: 'id_document', label: 'A photo of your ID' },
  'verification.additional_document': { id: 'address_document', label: 'A document proving your address' },
  'owners_provided': { id: 'owners', label: 'Confirm who owns the business' },
  'directors_provided': { id: 'directors', label: 'Confirm the company directors' },
  'executives_provided': { id: 'executives', label: 'Confirm the company executives' },
};

/** Address parts, which collapse to one entry per owner prefix. */
const ADDRESS_PART = /(^|\.)address(_kanji|_kana)?\.(line1|line2|city|state|postal_code|country|town)$/;

/** Paths that stand alone, with no `individual.`/`company.` prefix. */
const WHOLE_PATH: Record<string, RequirementLabel> = {
  'external_account': { id: 'bank_account', label: 'Where to pay you' },
  'business_profile.url': { id: 'website', label: 'Your website' },
  'business_profile.mcc': { id: 'industry', label: 'What your business does' },
  'business_profile.product_description': { id: 'description', label: 'What you sell' },
  'business_profile.name': { id: 'trading_name', label: 'Your business name' },
  'business_profile.support_phone': { id: 'support_phone', label: 'A support phone number' },
  'business_type': { id: 'business_type', label: 'How your business is registered' },
  'tos_acceptance.date': { id: 'tos', label: 'Accept Stripe terms' },
  'tos_acceptance.ip': { id: 'tos', label: 'Accept Stripe terms' },
};

/** `individual.`, `company.`, `person_1Ux9…` — the owner of the fact, not the fact. */
const PREFIX = /^(individual|company|person_[A-Za-z0-9]+)\./;

/**
 * Turn Stripe's requirement paths into a short list of named things.
 *
 * Order is preserved from Stripe's own, which puts the blocking items first,
 * and duplicates are collapsed by id so "date of birth" is said once however
 * many parts of it are outstanding.
 */
export function describeRequirements(paths: string[]): RequirementLabel[] {
  const seen = new Set<string>();
  const out: RequirementLabel[] = [];

  for (const raw of paths) {
    const path = raw.trim();
    if (!path) continue;

    let found: RequirementLabel | undefined = WHOLE_PATH[path];

    if (!found) {
      const suffix = path.replace(PREFIX, '');

      if (ADDRESS_PART.test(path)) {
        /* Whose address it is changes the words: a company's registered
           address and a signer's home address are different questions. */
        found = path.startsWith('company.')
          ? { id: 'company_address', label: 'Business address' }
          : { id: 'home_address', label: 'Home address' };
      } else {
        found = BY_SUFFIX[suffix];
      }
    }

    /* Unmapped stays unmapped. See the header: a wrong label on a legal
       obligation is worse than a list that is honestly incomplete. */
    if (!found || seen.has(found.id)) continue;

    seen.add(found.id);
    out.push(found);
  }

  return out;
}
