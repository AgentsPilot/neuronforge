/**
 * Keeping template placeholder contact details off a customer's screen.
 *
 * WHY THIS EXISTS
 *
 * `website_content.contact` is scaffolded when a business applies a template,
 * and the templates ship example values — `contact@yourbusiness.com`,
 * `+1 (555) 123-4567`, `hello@moderntherapy.com`. The owner is meant to replace
 * them, and most never do: the contact section is one of the least-edited parts
 * of the builder.
 *
 * That was harmless while nothing read the column. The moment a public page
 * shows "call us" it stops being harmless — a customer would tap a 555 number
 * or email a domain the business does not own, and blame the business for it.
 *
 * THE SEED LIST IS HISTORICAL, AND THAT IS WHY IT IS WRITTEN OUT.
 *
 * These were harvested at module load from the thirty-three templates in
 * `templates.ts`, on the reasoning that whatever a template seeds is by
 * definition a placeholder. Those templates are gone — a business's copy now
 * comes from the model and its design from an archetype, and neither seeds a
 * contact detail.
 *
 * The values below still have to be denied, because they are not hypothetical:
 * every page generated from a template before the change carries them, and
 * `contact@therapypractice.com` is live on real accounts right now. Deriving
 * them from a catalogue that no longer exists would silently produce an empty
 * deny-list and put those addresses back on customers' screens.
 *
 * Nothing adds to this list any more. A new placeholder can only arrive from
 * the model, and the pattern rules below — reserved 555 numbers, example
 * domains, `123 Main Street` — are what catch those.
 *
 * @module lib/branding/placeholderContact
 */

/**
 * Every contact value the retired templates seeded, lowercased.
 *
 * Frozen as it was on the day the catalogue was removed. Published pages still
 * carry these, so they stay denied.
 */
const TEMPLATE_SEEDS: ReadonlySet<string> = new Set([
  '+1 (555) 123-4567',
  '+1 (555) 234-5678',
  '+1 (555) 345-6789',
  'appointments@clinicalpractice.com',
  'cases@justiceadvocates.com',
  'contact@estateluxe.com',
  'contact@executiveedge.com',
  'contact@financialpartners.com',
  'contact@therapypractice.com',
  'contact@yourbusiness.com',
  'create@growthlab.com',
  'defense@shielddefense.com',
  'healing@traumarecovery.com',
  'hello@annarosephoto.com',
  'hello@balancedliving.com',
  'hello@beautybar.com',
  'hello@firsthomeguide.com',
  'hello@glamourstudio.com',
  'hello@mindfulliving.com',
  'hello@moderntherapy.com',
  'hello@naturalglow.com',
  'hello@portraitstudio.com',
  'hello@techforward.com',
  'info@academicexcellence.com',
  'info@apexcommercial.com',
  'info@hartleyfamilylaw.com',
  'info@homefamilyrealty.com',
  'info@morrisonlaw.com',
  'inquiries@strategicadvisors.com',
  'learn@fluentfuture.com',
  'projects@framestudios.com',
  'studio@photographer.com',
].map(seed => seed.toLowerCase()));

/** Domains that only ever appear in examples. */
const PLACEHOLDER_DOMAINS = [
  'yourbusiness.com',
  'yourcompany.com',
  'yoursite.com',
  'example.com',
  'example.org',
  'domain.com',
];

/** North-American 555 numbers are reserved for fiction. */
const PLACEHOLDER_PHONE = /^\+?1?[\s.\-()]*\(?555\)?[\s.\-]/;

const PLACEHOLDER_ADDRESS = /\b123\s+(main|example|sample)\b/i;

function isSeed(value: string): boolean {
  return TEMPLATE_SEEDS.has(value.trim().toLowerCase());
}

export function isPlaceholderEmail(value?: string | null): boolean {
  if (!value?.trim()) return true;
  const lower = value.trim().toLowerCase();
  return isSeed(lower) || PLACEHOLDER_DOMAINS.some(domain => lower.endsWith(`@${domain}`));
}

export function isPlaceholderPhone(value?: string | null): boolean {
  if (!value?.trim()) return true;
  const trimmed = value.trim();
  if (isSeed(trimmed)) return true;
  if (PLACEHOLDER_PHONE.test(trimmed)) return true;
  // Fewer than 7 digits cannot be dialled anywhere.
  return (trimmed.match(/\d/g) || []).length < 7;
}

export function isPlaceholderAddress(value?: string | null): boolean {
  if (!value?.trim()) return true;
  const trimmed = value.trim();
  return isSeed(trimmed) || PLACEHOLDER_ADDRESS.test(trimmed);
}

/**
 * A contact value fit to show a customer, or null.
 *
 * Callers treat null as "this business has not told us" and render nothing —
 * never an empty row, and never the placeholder.
 */
export function cleanPublicContact(
  value: string | null | undefined,
  kind: 'email' | 'phone' | 'address'
): string | null {
  if (!value?.trim()) return null;

  const isPlaceholder =
    kind === 'email'
      ? isPlaceholderEmail(value)
      : kind === 'phone'
        ? isPlaceholderPhone(value)
        : isPlaceholderAddress(value);

  return isPlaceholder ? null : value.trim();
}

/** Exposed for the test that asserts every harvested seed is rejected. */
export function __templateSeedsForTest(): string[] {
  return [...TEMPLATE_SEEDS];
}
