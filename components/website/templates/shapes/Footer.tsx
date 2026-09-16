/**
 * The last line: who this is, when they are open, how to reach them, and the
 * small print a real business carries.
 *
 * One rule above it and nothing else. Every mockup ends the same way — the
 * footer is the one section none of the six decorates, because anything drawn
 * there competes with the closing block immediately above it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT GAINED, AND WHY EACH PIECE IS OPTIONAL
 *
 * It used to carry a name, a tagline, some links and a year — less than the
 * footer of any business site a visitor has ever used. Everything added here is
 * something the platform ALREADY HOLDS and was not showing:
 *
 *   hours      `scheduling_availability`, which publishing is already gated on
 *   legal row  `invoice_company_name`, where it differs from the trading name
 *   contact    the profile's own contact columns, as the contact form uses
 *   logo       the same mark the header wears
 *   one action the page's last chance to convert, instead of a dead end
 *
 * Every one renders only when its content exists, so a business that has filled
 * in none of it sees exactly the footer it saw before. None of it is inferred
 * or invented: a footer that states opening hours nobody entered is worse than
 * a footer that states nothing.
 *
 * @module components/website/templates/shapes/Footer
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';
import { resolveBookingAction, bookingIsDead } from '@/components/website/blocks/bookingAction';

interface FooterShape {
  company_name?: string;
  tagline?: string;
  email?: string;
  phone?: string;
  address?: string;
  copyright_year?: number | string;
  /*
   * `anchor` first, and it was missing.
   *
   * Generation writes these as `{ label, anchor }` — the same shape the header
   * uses — and this read only `link`/`href`, so every generated footer link
   * fell through to `#`. The links were there and visibly did nothing.
   */
  menu_items?: Array<{ label?: string; text?: string; anchor?: string; link?: string; href?: string }>;

  /** The same mark the header wears, when the owner has one. */
  logo_url?: string;

  /*
   * Where else to find this business.
   *
   * The editor has offered these four fields for as long as the footer editor
   * has existed, and NO template shape has ever rendered them — only the legacy
   * `FooterBlock`, which no site on a template uses. So an owner could type
   * their Instagram in, save it successfully, and it appeared nowhere.
   */
  social_links?: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
  };

  /** Formatted upstream, where the page's language is known. */
  hours?: Array<{ days?: string; hours?: string }>;
  hours_title?: string;
  contact_title?: string;

  /** The registered name, where it differs from the trading name. */
  legal_name?: string;
  /** "All rights reserved." in the page's language. */
  rights_text?: string;
  /** The platform credit, off unless the owner turns it on. */
  show_powered_by?: boolean;
  powered_by_text?: string;

  /** The page's last ask. */
  cta_text?: string;
  cta_link?: string;

  serviceId?: string;
  serviceUnavailable?: boolean;
}

/**
 * The four marks, as single paths.
 *
 * Solid shapes on `currentColor` so one CSS rule colours them and each template
 * can dress them differently without the markup knowing.
 */
const SOCIALS = [
  {
    key: 'facebook' as const,
    label: 'Facebook',
    path: 'M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.44 2.9h-2.34V22c4.78-.79 8.44-4.93 8.44-9.94Z',
  },
  {
    key: 'instagram' as const,
    label: 'Instagram',
    path: 'M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07Zm0 6.68a3.16 3.16 0 1 0 0 6.32 3.16 3.16 0 0 0 0-6.32Zm0-1.8a4.96 4.96 0 1 1 0 9.92 4.96 4.96 0 0 1 0-9.92Zm5.16-.23a1.16 1.16 0 1 1-2.32 0 1.16 1.16 0 0 1 2.32 0Z',
  },
  {
    key: 'linkedin' as const,
    label: 'LinkedIn',
    path: 'M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z',
  },
  {
    key: 'twitter' as const,
    label: 'X',
    path: 'M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.96 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.11l11.97 15.64Z',
  },
];

export function FooterSection({
  content,
  isRTL,
  className,
  isPreview,
  onOpenBooking,
  bookingUrl,
}: BlockRendererProps) {
  const c = content as FooterShape;

  const contact = [c.email, c.phone, c.address].filter(Boolean);

  /*
   * Only the ones filled in, in a fixed order so the row does not rearrange
   * itself as an owner adds them one at a time.
   *
   * Marks rather than words: four names spelled out read as a list of homework,
   * and every visitor already knows these shapes. The name stays as the
   * `aria-label`, so a screen reader hears "Instagram" where a sighted reader
   * sees the glyph.
   *
   * Drawn inline instead of imported. Brand marks are not in the icon set this
   * project uses — lucide dropped them — and a public page should not pull a
   * library for four paths it can carry itself.
   */
  const socials = SOCIALS.map(item => ({
    ...item,
    href: c.social_links?.[item.key]?.trim(),
  })).filter((item): item is typeof item & { href: string } => Boolean(item.href));
  const hours = (c.hours ?? []).filter(row => row?.days && row?.hours);

  /*
   * The same resolution the header and the closing block use.
   *
   * In the editor's preview it opens the in-page booking dialog; on a published
   * site it goes to the booking page; on a page that can take no booking it
   * falls back to its own link. Written once, in `bookingAction`, so the
   * footer's button cannot quietly behave differently from the two above it.
   */
  const booking = resolveBookingAction({
    isPreview,
    onOpenBooking,
    bookingUrl,
    fallbackHref: c.cta_link ?? '#contact',
  });
  const serviceGone = bookingIsDead(content);

  // The registered identity, when it differs from the name above. Repeating the
  // trading name in smaller type says nothing.
  const legalName = c.legal_name && c.legal_name !== c.company_name ? c.legal_name : undefined;

  return (
    <footer dir={isRTL ? 'rtl' : 'ltr'} className={`apc-footer ${className ?? ''}`}>
      <div className="apc-footer-row">
        <div className="apc-footer-who">
          {c.logo_url ? (
            <img src={c.logo_url} alt={c.company_name ?? ''} className="apc-wm-img" />
          ) : (
            c.company_name && <span className="apc-wm">{c.company_name}</span>
          )}
          {c.tagline && <span className="apc-footer-tag">{c.tagline}</span>}
        </div>

        {contact.length > 0 && (
          <div className="apc-footer-contact">
            {c.contact_title && <span className="apc-footer-head">{c.contact_title}</span>}
            {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
            {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
            {c.address && <span>{c.address}</span>}
          </div>
        )}

        {/* The commonest question a small business's site is asked, answered
            without starting a booking to find out. */}
        {hours.length > 0 && (
          <div className="apc-footer-hours">
            {c.hours_title && <span className="apc-footer-head">{c.hours_title}</span>}
            {hours.map((row, index) => (
              <span key={index} className="apc-footer-hours-row">
                <span className="apc-footer-days">{row.days}</span>
                <span dir="ltr">{row.hours}</span>
              </span>
            ))}
          </div>
        )}

        {socials.length > 0 && (
          <nav className="apc-footer-social">
            {socials.map(item => (
              <a
                key={item.key}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={item.label}
                title={item.label}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d={item.path} />
                </svg>
              </a>
            ))}
          </nav>
        )}

        {c.menu_items && c.menu_items.length > 0 && (
          <nav className="apc-footer-links">
            {c.menu_items.map((item, index) => (
              <a key={index} href={item.anchor ?? item.link ?? item.href ?? '#'}>
                {item.label ?? item.text}
              </a>
            ))}
          </nav>
        )}

        {/* The page's last ask. A footer that only looks backwards ends the
            journey at the exact point a reader who got this far is readiest. */}
        {c.cta_text &&
          (serviceGone ? (
            <button type="button" disabled className="apc-btn apc-footer-cta">
              {c.cta_text}
            </button>
          ) : booking.kind === 'open' ? (
            <button type="button" onClick={booking.onClick} className="apc-btn apc-footer-cta">
              {c.cta_text}
            </button>
          ) : (
            <a href={booking.href} className="apc-btn apc-footer-cta">
              {c.cta_text}
            </a>
          ))}
      </div>

      {/* Registered name and year. Its own row beneath a rule, because this is
          the part a reader looks for deliberately and never reads by accident. */}
      <div className="apc-footer-fine">
        {legalName && <span className="apc-footer-legal">{legalName}</span>}
        {/* "© 2026 David KPMG. All rights reserved." — the shape every
            business site's last line has. The year alone, which is what this
            used to render, is not a copyright notice. */}
        <span className="apc-footer-year">
          © {c.copyright_year ?? new Date().getFullYear()}
          {c.company_name ? ` ${c.company_name}` : ''}
          {c.rights_text ? `. ${c.rights_text}` : ''}
        </span>

        {/*
          The platform credit.

          It had a switch in the editor and no renderer here at all — only the
          legacy `FooterBlock` drew it, and no site on a template uses that. So
          the setting has been saving faithfully to a block nothing reads, and
          turning it on changed nothing on any page.
        */}
        {c.show_powered_by && c.powered_by_text && (
          <span className="apc-footer-legal">
            {c.powered_by_text}{' '}
            <a href="https://agentspilot.com" target="_blank" rel="noopener noreferrer">
              AgentsPilot
            </a>
          </span>
        )}
      </div>
    </footer>
  );
}
