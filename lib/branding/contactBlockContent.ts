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
import { openingHoursRows } from '@/lib/branding/openingHours';

/**
 * Merge profile contact details into a contact block's content.
 *
 * The profile is authoritative for email, phone and address — a value typed on
 * the block is only a fallback for a business that has not filled the profile
 * in. Otherwise one page could state two different phone numbers, this form's
 * and the footer's, with nothing to tell a visitor which is real.
 *
 * @param content the block's stored content
 * @param profile the business profile row, or null when there is none
 */
export function withProfileContact(
  content: Record<string, unknown> | null | undefined,
  profile: Record<string, unknown> | null | undefined,
  /** Decides the day names in the derived opening hours. */
  locale: string = 'en'
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
    /*
     * THE PROFILE WINS. A TYPED VALUE IS A FALLBACK, NOT AN OVERRIDE.
     *
     * This read the block first, which is how one page ends up stating two
     * different phone numbers: an old one typed into this form, and the current
     * one in the footer below it, which resolves the same details the same way.
     * A visitor cannot tell which is real, and the owner never finds out —
     * they change their number in Settings, see the footer update, and have no
     * reason to suspect a block three sections up is still handing out the old
     * one.
     *
     * The override this gives up was never used deliberately: these keys are
     * written by generation, not by anyone choosing a per-page contact.
     */
    business_email: fromProfile('email', 'email') ?? own('business_email'),
    business_phone: fromProfile('phone', 'phone') ?? own('business_phone'),
    business_address: fromProfile('address', 'address') ?? own('business_address'),
    /*
     * Opening hours, from the one place the business states them.
     *
     * This used to say "no profile column holds opening hours as display copy,
     * so this stays the block's own until there is one to read". True of a
     * display string — but `scheduling_availability` holds the hours
     * themselves, and it is what the booking calendar already runs on.
     * `openingHoursRows` turns one into the other.
     *
     * Availability is the ONLY source. Not the block, not a typed fallback: a
     * string typed months ago goes on telling clients to come on a Tuesday long
     * after the calendar stopped accepting Tuesdays, and hours are the one
     * claim on a small business's site that a visitor acts on by physically
     * turning up. A business with no availability set says nothing here, which
     * is the honest answer and the one the footer gives too.
     */
    business_hours:
      openingHoursRows(profile?.scheduling_availability, locale)
        .map(row => `${row.days} ${row.hours}`)
        .join(' · ') || undefined,
  };
}
