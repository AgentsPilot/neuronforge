import 'server-only';

/**
 * The contact section's own details, resolved from the business profile.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * These four values lived only on the block, so an owner typed their email,
 * phone, address and opening hours into the contact section by hand — details
 * they had already given the platform, which appear on their invoices and in
 * their booking confirmations. When any of it changed they had to remember this
 * section existed, and a stale phone number on a contact form is worse than
 * none.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS SHARED
 *
 * The published site resolved them and the PREVIEW did not, so the editor and
 * the preview showed an empty contact panel for a business whose profile had
 * every field filled in — and the only way to find out what a visitor would
 * actually see was to publish. One function, called from both routes, is the
 * only arrangement where those two cannot disagree again.
 *
 * @module lib/branding/contactBlockContent
 */

import { cleanPublicContact } from '@/lib/branding/placeholderContact';

/**
 * Merge profile contact details into a contact block's content.
 *
 * A value typed on the block always wins, so an owner can override one detail
 * for one page without editing their business.
 *
 * @param content the block's stored content
 * @param profile the business profile row, or null when there is none
 */
export function withProfileContact(
  content: Record<string, unknown> | null | undefined,
  profile: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const own = (key: string) => {
    const value = content?.[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
  };

  /*
   * The profile's own contact columns — the ones under Settings → Business.
   * Deliberately NOT the invoice address: that is a billing detail, and a
   * business trading from home may not want clients arriving there.
   *
   * `cleanPublicContact` because those columns were backfilled from website
   * copy that was frequently still the template's scaffolding, so a raw read
   * can hand back `contact@example.com` — which is exactly the placeholder this
   * is meant to replace.
   */
  const fromProfile = (key: string, kind: 'email' | 'phone' | 'address') => {
    const value = profile?.[key];
    return typeof value === 'string' ? cleanPublicContact(value, kind) ?? undefined : undefined;
  };

  return {
    ...(content ?? {}),
    business_email: own('business_email') ?? fromProfile('email', 'email'),
    business_phone: own('business_phone') ?? fromProfile('phone', 'phone'),
    business_address: own('business_address') ?? fromProfile('address', 'address'),
    // No profile column holds opening hours as display copy, so this stays the
    // block's own until there is one to read.
    business_hours: own('business_hours'),
  };
}
