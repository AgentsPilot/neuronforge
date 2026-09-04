// components/public/BusinessInfoPanel.tsx

import { Clock, Globe, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';

import { publicT } from '@/lib/i18n/public-pages';
import type { BusinessDayHours, PublicBrand } from '@/lib/branding/publicBranding';

type Section = 'contact' | 'address' | 'hours' | 'links';

interface BusinessInfoPanelProps {
  brand: PublicBrand;
  variant?: 'card' | 'inline' | 'footer';
  show?: Section[];
}

/** `09:00 – 17:00`, or several ranges for a split day. */
function formatWindows(day: BusinessDayHours, closedLabel: string): string {
  if (day.windows.length === 0) return closedLabel;
  return day.windows.map(w => `${w.start} – ${w.end}`).join(', ');
}

/**
 * Where the business is, when it is open, and how to reach it.
 *
 * WHY THIS IS ON THESE PAGES AT ALL
 *
 * The booking-management page is what a client opens on the morning of their
 * appointment, and it could not tell them the address or give them a number to
 * ring. The contact page offered a form and no other way to get in touch, which
 * is the wrong answer for someone who wants to phone. Everything shown here was
 * already in the database and was not being read.
 *
 * RENDERS NOTHING WHEN THERE IS NOTHING.
 *
 * Most accounts have never filled in the contact section, and the ones that
 * have often still carry the template's example values. `PublicBusinessInfo`
 * has already stripped those, so a null here means "the business has not told
 * us" — and a "Contact" heading over three blank lines is worse than no
 * heading. This returning null is the contract, not an optimisation.
 */
export function BusinessInfoPanel({
  brand,
  variant = 'card',
  show = ['contact', 'address', 'hours', 'links'],
}: BusinessInfoPanelProps) {
  const { info, locale } = brand;
  if (!info.hasAny) return null;

  const t = (key: string) => publicT(locale, key);
  const wants = (section: Section) => show.includes(section);

  /*
   * `text` is what the client reads, and it is not always the underlying value.
   *
   * WhatsApp is the case that matters: it is derived from the phone number, so
   * rendering the value gave two rows showing the SAME digits — one with a
   * handset icon, one with a speech bubble — which reads as the business having
   * listed its number twice by mistake. The number is stated once, under the
   * phone; WhatsApp is an action, and says so.
   */
  const rows: Array<{ icon: typeof Phone; key: string; text: string; href?: string }> = [];

  if (wants('contact') && info.phone) {
    rows.push({
      icon: Phone,
      key: 'phone',
      text: info.phone,
      href: `tel:${info.phone.replace(/\s/g, '')}`,
    });
  }
  if (wants('contact') && info.whatsappUrl) {
    rows.push({ icon: MessageCircle, key: 'whatsapp', text: t('whatsapp'), href: info.whatsappUrl });
  }
  if (wants('contact') && info.email) {
    rows.push({ icon: Mail, key: 'email', text: info.email, href: `mailto:${info.email}` });
  }
  if (wants('address') && info.address) {
    rows.push({
      icon: MapPin,
      key: 'address',
      text: info.address,
      href: `https://maps.google.com/?q=${encodeURIComponent(info.address)}`,
    });
  }
  if (wants('links') && info.websiteUrl) {
    rows.push({
      icon: Globe,
      key: 'website',
      // The bare host reads as a link; the full URL with its scheme and any
      // tracking tail does not.
      text: info.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      href: info.websiteUrl,
    });
  }

  const hours = wants('hours') ? info.hours : null;
  if (rows.length === 0 && !hours) return null;

  const isCard = variant === 'card';

  return (
    <section
      className={isCard ? 'p-5' : variant === 'footer' ? 'pt-6' : 'mt-4'}
      style={
        isCard
          ? {
              background: 'var(--ap-surface)',
              border: '1px solid var(--ap-border)',
              borderRadius: 'var(--ap-radius-lg)',
              boxShadow: 'var(--ap-shadow-sm)',
            }
          : variant === 'footer'
            ? { borderTop: '1px solid var(--ap-border)' }
            : undefined
      }
    >
      <div className={variant === 'footer' ? 'grid gap-6 sm:grid-cols-2' : 'space-y-4'}>
        {rows.length > 0 && (
          <div>
            <h3
              className="mb-3 text-xs font-semibold uppercase"
              style={{
                color: 'var(--ap-text-muted)',
                // Hebrew has no case, so uppercase does nothing but add
                // unnatural letter-spacing to it.
                letterSpacing: locale === 'he' ? 'normal' : '0.05em',
                textTransform: locale === 'he' ? 'none' : 'uppercase',
              }}
            >
              {t('contactDetails')}
            </h3>
            <ul className="space-y-2.5">
              {rows.map(row => {
                const Icon = row.icon;
                const body = (
                  <span className="flex items-start gap-2.5">
                    <Icon
                      className="mt-0.5 h-4 w-4 shrink-0"
                      style={{ color: 'var(--ap-brand)' }}
                      aria-hidden
                    />
                    {/* `bdi` so a Latin address or a `+972` number does not get
                        reordered inside a right-to-left paragraph, and so a
                        long address wraps instead of overflowing on a phone. */}
                    <bdi className="text-sm break-words" style={{ color: 'var(--ap-text)' }}>
                      {row.text}
                    </bdi>
                  </span>
                );

                return (
                  <li key={row.key}>
                    {row.href ? (
                      <a
                        href={row.href}
                        target={row.href.startsWith('http') ? '_blank' : undefined}
                        rel={row.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                        className="transition-opacity hover:opacity-70"
                      >
                        {body}
                      </a>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {hours && (
          <div>
            <h3
              className="mb-3 flex items-center gap-2 text-xs font-semibold"
              style={{
                color: 'var(--ap-text-muted)',
                letterSpacing: locale === 'he' ? 'normal' : '0.05em',
                textTransform: locale === 'he' ? 'none' : 'uppercase',
              }}
            >
              <Clock className="h-3.5 w-3.5" style={{ color: 'var(--ap-brand)' }} aria-hidden />
              {t('openingHours')}
            </h3>
            <ul className="space-y-1.5">
              {hours.map(day => {
                const closed = day.windows.length === 0;
                return (
                  <li key={day.day} className="flex items-center justify-between gap-4 text-sm">
                    <span style={{ color: 'var(--ap-text)' }}>{t(day.day)}</span>
                    <span
                      // Times read left-to-right even in Hebrew: `09:00 – 17:00`
                      // reordered by the bidi algorithm becomes a different range.
                      dir="ltr"
                      style={{ color: closed ? 'var(--ap-text-muted)' : 'var(--ap-text)' }}
                    >
                      {formatWindows(day, t('closed'))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
