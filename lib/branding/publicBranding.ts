/**
 * Everything a customer-facing page needs to wear the business's identity.
 *
 * WHY THIS EXISTS
 *
 * The public pages are the only part of the product a business's own customers
 * ever see, and they were each resolving branding differently — or not at all.
 * `/c/*` read a real theme through the conversion API. `/invoice/[id]` read the
 * logo and nothing else, and hardcoded a blue button. The four `/book/manage/*`
 * pages threaded a `primaryColor` through their entire UI that the API filled
 * in as the constant `#4F46E5`, with a comment explaining the column did not
 * exist — so every business on the platform showed its clients platform indigo
 * while its emails, sent minutes earlier, were correctly branded.
 *
 * One resolver, one shape. A page says who the business is — by user id, by
 * smart-link code, by subdomain — and gets back a complete theme, a logo, a
 * language, and the contact details it is safe to show a stranger.
 *
 * SERVER ONLY. Reads through the repository layer with the service role,
 * because a customer holding a booking token or an invoice link is not
 * authenticated and has no row-level access of their own. Never throws:
 * branding is decoration, and failing to resolve it must degrade to defaults
 * rather than take down the page a customer came to pay on.
 *
 * @module lib/branding/publicBranding
 */

import 'server-only';
import { cache } from 'react';

import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { WebsiteContentRepository } from '@/lib/repositories/WebsiteContentRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { verifyBookingToken } from '@/lib/services/BookingEmailService';
import { verifyProposalToken } from '@/lib/business-os/proposalToken';
import { resolveBusinessLogo } from '@/lib/branding/businessLogo';
import { resolveBusinessTheme } from '@/lib/branding/resolveTheme';
import { completeTheme, DEFAULT_PUBLIC_THEME } from '@/lib/branding/theme';
import { cleanPublicContact } from '@/lib/branding/placeholderContact';
import { whatsappLink } from '@/lib/branding/phone';
import { safeExternalUrl } from '@/lib/branding/externalUrl';
import { isDarkColor } from '@/lib/branding/color';
import { DAY_NAMES, windowsForDay, hasAnyAvailability, type AvailabilityWindow } from '@/lib/scheduling/availabilityWindows';
import { isValidLocale, getDirection, defaultLocale, type Locale } from '@/lib/i18n/config';
import type { PageTheme } from '@/lib/repositories/WebsitePageRepository';

const logger = createLogger({ module: 'PublicBranding' });

/** How a page names the business it is rendering for. */
export type PublicBrandRef =
  | { by: 'userId'; userId: string }
  | { by: 'userCode'; userCode: string }
  | { by: 'subdomain'; subdomain: string }
  /** A signed booking-management link, as sent to a client by email. */
  | { by: 'bookingToken'; token: string }
  /** A public invoice link. The id is the unguessable part. */
  | { by: 'invoiceId'; invoiceId: string }
  /** A signed quote link, as sent to a client by email. */
  | { by: 'proposalToken'; token: string };

/** One day's opening hours, Sunday first. */
export interface BusinessDayHours {
  day: (typeof DAY_NAMES)[number];
  windows: AvailabilityWindow[];
}

/**
 * The business facts it is safe to put in front of a stranger.
 *
 * Every field is nullable and every null means the same thing: the business has
 * not told us, so render nothing. Not an empty row, not a placeholder — the
 * majority of accounts have never filled the contact section in, and a "Call
 * us" heading over a blank line looks worse than no heading.
 */
export interface PublicBusinessInfo {
  email: string | null;
  phone: string | null;
  /** `https://wa.me/...`, derived from the phone. Null whenever the phone is. */
  whatsappUrl: string | null;
  address: string | null;
  /** Null when the business has no open window at all, never an empty array. */
  hours: BusinessDayHours[] | null;
  websiteUrl: string | null;
  /** The business's own booking page, when it has a smart-link code. */
  bookingUrl: string | null;
  /** False when there is nothing worth rendering. */
  hasAny: boolean;
}

export interface PublicBrand {
  userId: string;
  userCode: string | null;
  businessName: string;
  /**
   * The business's logo, or null when it has none.
   *
   * On the smart-link pages this also respects `show_logo_on_smart_links`,
   * the opt-out that exists for those pages alone. Every other public surface
   * shows the logo whenever there is one.
   */
  logoUrl: string | null;
  /** Always complete — a caller never needs a fallback of its own. */
  theme: PageTheme;
  templateId: string | null;
  locale: Locale;
  dir: 'ltr' | 'rtl';
  /** For `Intl` — `he-IL`, `es-ES`, `en-US`. */
  localeCode: string;
  currency: string;
  /** Whether the chosen palette is a dark one, for `color-scheme`. */
  colorScheme: 'light' | 'dark';
  info: PublicBusinessInfo;
}

/**
 * No currency column exists on `business_profiles`, so it follows the language
 * the business works in — the same mapping the internal app uses.
 */
const CURRENCY_BY_LOCALE: Record<Locale, string> = { en: 'USD', es: 'EUR', he: 'ILS' };

const LOCALE_CODES: Record<Locale, string> = { en: 'en-US', es: 'es-ES', he: 'he-IL' };

/** The shape of the profile row this module reads. */
interface ProfileRow {
  user_id: string;
  user_code?: string | null;
  company_name?: string | null;
  invoice_company_name?: string | null;
  website_url?: string | null;
  logo_url?: string | null;
  show_logo_on_smart_links?: boolean | null;
  /** What the business publishes to its clients: call, email, come here. */
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  language?: string | null;
  template_id?: string | null;
  theme?: unknown;
  scheduling_availability?: unknown;
  invoice_address?: Record<string, unknown> | null;
}

/** A postal address as one line, or null when there is nothing in it. */
function formatAddress(address: Record<string, unknown> | null | undefined): string | null {
  if (!address || typeof address !== 'object') return null;

  const parts = ['line1', 'line2', 'city', 'state', 'postal_code', 'country']
    .map(key => address[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim());

  return parts.length ? parts.join(', ') : null;
}

function readHours(availability: unknown): BusinessDayHours[] | null {
  if (!hasAnyAvailability(availability)) return null;

  return DAY_NAMES.map(day => ({ day, windows: windowsForDay(availability, day) }));
}

/** Resolve a reference to the user id that owns the business. */
async function resolveUserId(ref: PublicBrandRef): Promise<{ userId: string; profile?: ProfileRow } | null> {
  if (ref.by === 'userId') return { userId: ref.userId };

  if (ref.by === 'userCode') {
    const { data } = await businessProfileRepository.findByUserCode(ref.userCode);
    if (!data) return null;
    return { userId: (data as ProfileRow).user_id, profile: data as ProfileRow };
  }

  if (ref.by === 'bookingToken') {
    const decoded = verifyBookingToken(ref.token);
    if (!decoded) return null;

    /*
     * Read without a `user_id` filter, deliberately.
     *
     * The reader is the CLIENT, not the account holder — they have no session
     * and no row-level access of their own. The signed token IS the
     * authorization, and this is a branding lookup that returns only the
     * business's public identity. The stronger check (the token's email must
     * match the booking's contact) stays where it always was, on the API route
     * that returns the booking itself.
     */
    const { data } = await supabaseServer
      .from('scheduling_bookings')
      .select('user_id')
      .eq('id', decoded.bookingId)
      .maybeSingle();

    if (!data?.user_id) return null;
    return { userId: data.user_id };
  }

  if (ref.by === 'proposalToken') {
    /*
     * Same reasoning as the booking token above: the reader is the client being
     * quoted, who has no session. The signature is the authorization, and this
     * returns only the business's public identity — never the quote.
     *
     * Resolved in the LAYOUT rather than the page so the theme is emitted with
     * the first byte of HTML. A page that fetches its own brand renders once
     * unstyled and then repaints, which on the screen where a business is
     * asking to be trusted with money is the worst place for it.
     */
    const decoded = verifyProposalToken(ref.token);
    if (!decoded?.proposalId) return null;

    const { data } = await supabaseServer
      .from('proposals')
      .select('user_id')
      .eq('id', decoded.proposalId)
      .maybeSingle();

    if (!data?.user_id) return null;
    return { userId: data.user_id };
  }

  if (ref.by === 'invoiceId') {
    // Same reasoning as the booking token: the reader is the customer being
    // billed, who has no session. The invoice id is the capability.
    const { data } = await supabaseServer
      .from('payment_invoices')
      .select('user_id')
      .eq('id', ref.invoiceId)
      .maybeSingle();

    if (!data?.user_id) return null;
    return { userId: data.user_id };
  }

  // Subdomain. The profile carries it, but accounts that predate the column
  // fall back to their `user_code`, which is what the subdomain resolver does
  // in the other direction.
  const { data } = await supabaseServer
    .from('business_profiles')
    .select('*')
    .or(`subdomain.eq.${ref.subdomain},user_code.eq.${ref.subdomain}`)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { userId: (data as ProfileRow).user_id, profile: data as ProfileRow };
}

async function loadPublicBranding(
  ref: PublicBrandRef,
  includeInfo: boolean
): Promise<PublicBrand | null> {
  let userId: string;
  let profile: ProfileRow | null = null;

  try {
    const resolved = await resolveUserId(ref);
    if (!resolved) return null;
    userId = resolved.userId;
    profile = resolved.profile ?? null;
  } catch (err) {
    logger.warn({ err, ref }, 'Could not identify the business behind a public page');
    return null;
  }

  try {
    if (!profile) {
      const { data } = await businessProfileRepository.findByUserId(userId);
      profile = (data as ProfileRow) ?? null;
    }
  } catch (err) {
    logger.warn({ err, userId }, 'Could not load the business profile for a public page');
  }

  // Independent reads, so they go together rather than serially in front of a
  // customer waiting on a page.
  const [themeResult, logoUrl, content] = await Promise.all([
    resolveBusinessTheme(
      userId,
      (profile?.theme ?? null) as never,
      profile?.template_id ?? null
    ).catch(() => ({ theme: DEFAULT_PUBLIC_THEME, raw: null, templateId: null })),

    /*
     * The smart-link pages are the one public surface with a logo opt-out, and
     * it is a real setting a business can have turned on. Resolving without
     * telling the logo resolver which surface is asking silently ignored it —
     * so a business that had chosen not to be branded on its shared links was
     * branded anyway.
     */
    resolveBusinessLogo(userId, profile, ref.by === 'userCode' ? { surface: 'smart_link' } : undefined),

    includeInfo
      ? // `findByUserId`, never `ensure()`. `ensure()` is a writer, and an
        // anonymous page view materialising a content row is exactly the bug
        // that seeded accounts with English placeholder copy they never asked
        // for.
        new WebsiteContentRepository(supabaseServer)
          .findByUserId(userId)
          .then(r => r.data)
          .catch(err => {
            logger.warn({ err, userId }, 'Could not load business content for a public page');
            return null;
          })
      : Promise.resolve(null),
  ]);

  const language = profile?.language;
  const locale: Locale = language && isValidLocale(language) ? language : defaultLocale;

  const theme = themeResult.theme ?? completeTheme(null, null);
  const businessName =
    profile?.company_name?.trim() || profile?.invoice_company_name?.trim() || 'Business';

  const contact = (content as { contact?: Record<string, unknown> } | null)?.contact;

  /*
   * The business's own details first, the website copy second.
   *
   * `business_profiles.{phone,email,address}` are the fields the owner fills in
   * under Settings → Business, and are the answer for every business including
   * the majority with no website. `website_content.contact` is website display
   * copy, kept as the fallback so accounts that filled it in there before these
   * columns existed keep working.
   *
   * Everything goes through `cleanPublicContact`, because the website values
   * are frequently still the template's scaffolding — and the backfill copied
   * those into the new columns rather than silently dropping them.
   */
  const email = includeInfo
    ? cleanPublicContact(profile?.email, 'email') ??
      cleanPublicContact(contact?.email as string, 'email')
    : null;

  const phone = includeInfo
    ? cleanPublicContact(profile?.phone, 'phone') ??
      cleanPublicContact(contact?.phone as string, 'phone')
    : null;
  const address = includeInfo
    ? cleanPublicContact(profile?.address, 'address') ??
      cleanPublicContact(contact?.address as string, 'address') ??
      // The invoice address last: it is a billing detail, and a business
      // trading from home may deliberately not want clients turning up there.
      // Used only when nothing else has been given.
      cleanPublicContact(formatAddress(profile?.invoice_address), 'address')
    : null;

  const hours = includeInfo ? readHours(profile?.scheduling_availability) : null;
  /*
   * Parsed, not trusted.
   *
   * This becomes an `href` on a public page (`BusinessInfoPanel`), and the
   * column is owner-supplied text. It has been null on every account so far
   * only because nothing can write it yet — the guard belongs here before that
   * changes, not after.
   */
  const websiteUrl = safeExternalUrl(profile?.website_url);
  const userCode = profile?.user_code ?? null;
  const bookingUrl = userCode ? `/c/${userCode}/book` : null;

  const info: PublicBusinessInfo = {
    email,
    phone,
    whatsappUrl: whatsappLink(phone),
    address,
    hours,
    websiteUrl,
    bookingUrl,
    hasAny: Boolean(email || phone || address || hours || websiteUrl),
  };

  return {
    userId,
    userCode,
    businessName,
    logoUrl,
    theme,
    templateId: themeResult.templateId,
    locale,
    dir: getDirection(locale),
    localeCode: LOCALE_CODES[locale],
    currency: CURRENCY_BY_LOCALE[locale],
    colorScheme: isDarkColor(theme.colors.background) ? 'dark' : 'light',
    info,
  };
}

/**
 * The business behind a public page, or null when there is no such business.
 *
 * Memoised per request, so a segment layout and the page inside it resolve the
 * same business once rather than twice.
 */
export const resolvePublicBranding = cache(
  async (ref: PublicBrandRef, opts?: { includeInfo?: boolean }): Promise<PublicBrand | null> => {
    try {
      return await loadPublicBranding(ref, opts?.includeInfo !== false);
    } catch (err) {
      logger.error({ err, ref }, 'Public branding could not be resolved');
      return null;
    }
  }
);

export { DEFAULT_PUBLIC_THEME, completeTheme };
