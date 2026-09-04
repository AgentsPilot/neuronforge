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
 * THE DENY-LIST IS DERIVED, NOT TYPED OUT.
 *
 * Hardcoding the known placeholders would be correct exactly once. The next
 * template added to `templates.ts` would introduce a value nothing here knows
 * about, and the failure is silent — a plausible-looking phone number on a real
 * customer's screen. So the seeds are harvested from `WEBSITE_TEMPLATES` at
 * module load: whatever the templates seed is, by definition, a placeholder.
 *
 * @module lib/branding/placeholderContact
 */

import { WEBSITE_TEMPLATES } from '@/lib/website-builder/templates';

/**
 * Any key whose value is a contact detail.
 *
 * Matched as a substring rather than an exact name because the block factories
 * do not agree on one: a contact-form block stores the same address under
 * `recipient_email`, `business_email` and `email` depending on which factory
 * built it. Matching the exact names would harvest none of them.
 */
const CONTACT_KEY = /(email|phone|address|tel|whatsapp)/i;

/** Every contact value any template seeds, lowercased. Built once, at load. */
const TEMPLATE_SEEDS: ReadonlySet<string> = (() => {
  const seeds = new Set<string>();

  /**
   * Walk block content looking for contact-shaped values.
   *
   * Recursive because seeds sit at varying depths — top-level on a contact
   * block, nested under `contact` or `content` elsewhere — and because the
   * whole point of deriving this list is that it must keep working when a
   * template is added in a shape nobody here anticipated.
   */
  const harvest = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== 'object' || depth > 6) return;

    if (Array.isArray(node)) {
      for (const item of node) harvest(item, depth + 1);
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (CONTACT_KEY.test(key) && value.trim()) {
          seeds.add(value.trim().toLowerCase());
        }
      } else {
        harvest(value, depth + 1);
      }
    }
  };

  for (const template of WEBSITE_TEMPLATES) {
    harvest(template.blocks, 0);
  }

  return seeds;
})();

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
