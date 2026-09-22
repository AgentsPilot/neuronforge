/**
 * Where a contact came from: one chip, and the detail behind it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The chip list was written out twice — `CRMContactModal` and
 * `ClientDetailsSection` — and both copies listed only the seven a person can
 * pick. The column holds more than seven: capture writes `website_booking`,
 * `website_form`, `quote_request` and `newsletter`.
 *
 * So a client who booked through the website read "Website Booking" on their
 * CRM card and showed NOTHING selected in their drawer — the card resolves a
 * label from the value, the chips only matched one of the seven, and
 * `website_booking` is not one of them.
 *
 * ONE CHIP, NOT ONE PER CAPTURE PATH
 *
 * Every way into the product is the same answer to "how did they find you":
 * the website, a landing page, a smart link. Splitting those into separate
 * chips asks the owner to read plumbing. So the chip is the GROUP, and the
 * breakdown — which landing page, which smart link, a booking or a form — sits
 * under it, because with several landing pages "Landing Page" alone is not an
 * answer either.
 *
 * THE OWNER'S ANSWER ALWAYS WINS
 *
 * Capture sets a starting value; the owner changes it when they know better —
 * they booked through the site, but they found you on Facebook. That overwrite
 * is the feature, so the derivation below reads `source` FIRST and consults the
 * metadata only to refine a value capture itself wrote.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveChannel } from '@/lib/business-os/channel-insights/channelFromReferrer';
import {
  Facebook,
  Linkedin,
  Music2,
  QrCode,
  Youtube,
  Globe,
  Link2,
  Mail,
  MessageCircle,
  Pencil,
  Phone as PhoneIcon,
  Search as SearchIcon,
  LayoutTemplate,
  User,
  Users as UsersIcon,
  type LucideIcon,
} from 'lucide-react';

/**
 * The chip. Either a channel we can PROVE, or the property that captured them.
 *
 * There is no `direct`: an online lead never arrives directly, they arrive on
 * the website, a landing page or a smart link. Saying "direct" would hide which
 * one, and which one is the least the owner should learn from a contact.
 */
export type ContactOriginGroup =
  // Proven from a UTM tag the owner put on the link they shared.
  | 'facebook'
  | 'instagram'
  | 'google'
  | 'whatsapp'
  | 'tiktok'
  | 'linkedin'
  | 'youtube'
  | 'email'
  | 'qr'
  // The property that captured them, when nothing proves where they came from.
  | 'website'
  | 'landing_page'
  | 'smart_link'
  // Answers only a person can give, plus the two other ways a row appears.
  | 'referral'
  | 'phone_call'
  | 'in_person'
  | 'newsletter'
  | 'manual';

export interface ContactOriginOption {
  value: ContactOriginGroup;
  labelKey: string;
  icon: LucideIcon;
}

/** Every chip, in the order they are offered. */
export const CONTACT_ORIGINS: ContactOriginOption[] = [
  { value: 'website', labelKey: 'crm.source.website', icon: Globe },
  { value: 'landing_page', labelKey: 'crm.source.landing_page', icon: LayoutTemplate },
  { value: 'smart_link', labelKey: 'crm.source.smart_link', icon: Link2 },
  { value: 'facebook', labelKey: 'crm.source.facebook', icon: Facebook },
  { value: 'instagram', labelKey: 'crm.source.instagram', icon: MessageCircle },
  { value: 'google', labelKey: 'crm.source.google', icon: SearchIcon },
  { value: 'whatsapp', labelKey: 'crm.source.whatsapp', icon: MessageCircle },
  { value: 'tiktok', labelKey: 'crm.source.tiktok', icon: Music2 },
  { value: 'linkedin', labelKey: 'crm.source.linkedin', icon: Linkedin },
  { value: 'youtube', labelKey: 'crm.source.youtube', icon: Youtube },
  { value: 'email', labelKey: 'crm.source.email', icon: Mail },
  { value: 'qr', labelKey: 'crm.source.qr', icon: QrCode },
  { value: 'newsletter', labelKey: 'crm.source.newsletter', icon: Mail },
  { value: 'referral', labelKey: 'crm.source.referral', icon: UsersIcon },
  { value: 'phone_call', labelKey: 'crm.source.phone_call', icon: PhoneIcon },
  { value: 'in_person', labelKey: 'crm.source.in_person', icon: User },
  { value: 'manual', labelKey: 'crm.source.manual', icon: Pencil },
];

/**
 * What capture writes into `crm_contacts.source`. Anything else is the owner's
 * own answer and is taken as given.
 */
const CAPTURED: Record<string, { detailKey?: string }> = {
  website_booking: { detailKey: 'crm.source.detail.booking' },
  booking: { detailKey: 'crm.source.detail.booking' },
  website_form: { detailKey: 'crm.source.detail.form' },
  quote_request: { detailKey: 'crm.source.detail.quote_request' },
  newsletter: {},
  manual: {},
};

/** The attribution a contact was captured with. A subset of LeadSourceMetadata. */
export interface ContactSourceMetadata {
  smart_link_id?: string;
  smart_link_name?: string;
  smart_link_code?: string;
  capture_page_url?: string;
  /** Recorded at capture so a landing page is distinguishable from the site. */
  page_type?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  /**
   * Recorded on every capture, and deliberately NOT used to choose the chip:
   * the chip shows what can be proven, and a referrer is an inference. It stays
   * declared because it is in the data and channel insights does read it.
   */
  referrer_domain?: string;
}

export interface ContactOrigin {
  group: ContactOriginGroup;
  /** Which property captured them, for the line under the chip. */
  surface?: ContactOriginGroup;
  /** Translation key for the surface detail — "Booking", "Contact form". */
  detailKey?: string;
  /** Literal detail — a landing page path, a smart link's name. */
  detailText?: string;
  /**
   * The tag that proved the channel, shown verbatim.
   *
   * This is the owner's receipt: they shared a link with UTM on it, and this is
   * that link coming back with a client attached.
   */
  utm?: string;
}

/** The property a captured contact arrived on, and how to describe it. */
function captureSurface(
  source: string,
  metadata?: ContactSourceMetadata | null
): { surface: ContactOriginGroup; detailKey?: string; detailText?: string } {
  if (metadata?.smart_link_id) {
    return {
      surface: 'smart_link',
      detailText: metadata.smart_link_name || metadata.smart_link_code || undefined,
    };
  }
  if (metadata?.page_type === 'landing') {
    return { surface: 'landing_page', detailText: metadata.capture_page_url || undefined };
  }
  if (source === 'newsletter') return { surface: 'newsletter' };
  if (source === 'manual') return { surface: 'manual' };
  return { surface: 'website', detailKey: CAPTURED[source]?.detailKey };
}

/**
 * The chip to light, and what to say beneath it.
 *
 * Three rules, in order:
 *
 *   1. The owner's own answer wins. Any value capture does not write is one a
 *      person chose, and nothing here reinterprets it.
 *   2. A UTM tag decides the channel. ONLY a UTM — a recognised referrer is a
 *      good guess and this shows what can be proven, so `resolveChannel` is
 *      called with no referrer at all.
 *   3. Otherwise the chip is the property that captured them. Never "direct":
 *      they arrived on the website, a landing page or a smart link, and which
 *      one is the least the owner should learn.
 */
export function contactOrigin(
  source: string | null | undefined,
  metadata?: ContactSourceMetadata | null
): ContactOrigin | undefined {
  if (!source) return undefined;

  if (!(source in CAPTURED)) {
    const known = CONTACT_ORIGINS.some((o) => o.value === source);
    return known ? { group: source as ContactOriginGroup } : undefined;
  }

  const { surface, detailKey, detailText } = captureSurface(source, metadata);

  // Referrer deliberately omitted: proven, not inferred.
  const attributed = resolveChannel(null, metadata?.utm_source);
  if (attributed.basis === 'utm' && attributed.channel !== 'direct') {
    const utm = [
      metadata?.utm_source && `utm_source=${metadata.utm_source}`,
      metadata?.utm_medium && `utm_medium=${metadata.utm_medium}`,
      metadata?.utm_campaign && `utm_campaign=${metadata.utm_campaign}`,
    ]
      .filter(Boolean)
      .join(', ');

    return {
      group: attributed.channel as ContactOriginGroup,
      surface,
      detailKey,
      detailText,
      utm: utm || undefined,
    };
  }

  return { group: surface, detailKey, detailText };
}

/** The option for a group, for whoever needs its label or icon. */
export function originOption(group: ContactOriginGroup | undefined): ContactOriginOption | undefined {
  return group ? CONTACT_ORIGINS.find((o) => o.value === group) : undefined;
}
