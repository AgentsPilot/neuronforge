// components/public/BusinessInfoPanel.tsx

import { Clock, Globe, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';

import { publicT } from '@/lib/i18n/public-pages';
import type { BusinessDayHours, PublicBrand } from '@/lib/branding/publicBranding';

type Section = 'contact' | 'address' | 'hours' | 'links';

interface BusinessInfoPanelProps {
  brand: PublicBrand;
  variant?: 'card' | 'inline' | 'footer';
  show?: Section[];
  /**
   * `'list'` prints all seven days. `'folded'` answers the question instead:
   * open or closed TODAY, then consecutive days that share hours as one run,
   * with the full list a tap away.
   *
   * Defaulted to the list so the surfaces that use this as a reference table —
   * the public booking page's footer, the contact page — are untouched.
   */
  hoursStyle?: 'list' | 'folded';
  /**
   * The business's zone, so "today" is the BUSINESS's today.
   *
   * A client in Tel Aviv opening this at 01:00 on Monday is still inside the
   * business's Sunday in New York, and it is that business's hours they are
   * being shown. Falls back to the reader's own device when no zone is given.
   */
  timeZone?: string | null;
}

/** Two days are one row when they open and close at the same times. */
function sameHours(a: BusinessDayHours, b: BusinessDayHours): boolean {
  if (a.windows.length !== b.windows.length) return false;
  return a.windows.every(
    (window, index) =>
      window.start === b.windows[index].start && window.end === b.windows[index].end
  );
}

/**
 * Consecutive days that open at the same times, as one run.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Seven rows of which four say `09:00 – 17:00` is a table; "Sunday – Wednesday"
 * and "Thursday – Saturday · closed" is an answer. This is only ever a
 * presentation of the same seven days: a business with genuinely irregular
 * hours produces seven runs of one and is listed day by day, which is correct
 * rather than a fallback.
 *
 * Runs never wrap around the end of the week. Saturday and Sunday sharing hours
 * is common, and "Saturday – Sunday" straddling the week's start reads as a
 * mistake, so the week is cut where the week is cut.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function groupHours(hours: BusinessDayHours[]): BusinessDayHours[][] {
  const runs: BusinessDayHours[][] = [];

  for (const day of hours) {
    const run = runs[runs.length - 1];
    if (run && sameHours(run[run.length - 1], day)) run.push(day);
    else runs.push([day]);
  }

  return runs;
}

/**
 * Which of the seven days it is where the BUSINESS is.
 *
 * `Date.getDay()` answers for the reader's device, so a client abroad would be
 * shown Monday's hours while the business is still closed on Sunday.
 */
function todayIndexIn(hours: BusinessDayHours[], timeZone?: string | null): number {
  try {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      weekday: 'long',
    })
      .format(new Date())
      .toLowerCase();

    const index = hours.findIndex(day => day.day === weekday);
    if (index >= 0) return index;
  } catch {
    // An unreadable zone is not a reason to show nothing.
  }

  return new Date().getDay();
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
/**
 * Will the panel draw anything for this business?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The panel returns null when a business has filled none of this in, which is
 * the right thing for the panel and leaves its LAYOUT wrong: the smart link's
 * contact page reserved a 20rem column for it unconditionally, so an account
 * with no phone, email or address got a form squeezed into two thirds of the
 * width beneath a full-width header, with nothing beside it.
 *
 * A caller that lays out around the panel has to ask before rendering it, and
 * it has to ask the SAME question the panel answers — which is why this is
 * exported from here and derived from the same fields, rather than being a
 * second guess written at the call site.
 */
export function hasBusinessInfo(
  brand: PublicBrand,
  show: Section[] = ['contact', 'address', 'hours', 'links']
): boolean {
  const { info } = brand;
  if (!info.hasAny) return false;

  const wants = (section: Section) => show.includes(section);

  return Boolean(
    (wants('contact') && (info.phone || info.whatsappUrl || info.email)) ||
    (wants('address') && info.address) ||
    (wants('links') && info.websiteUrl) ||
    (wants('hours') && info.hours)
  );
}

export function BusinessInfoPanel({
  brand,
  variant = 'card',
  show = ['contact', 'address', 'hours', 'links'],
  hoursStyle = 'list',
  timeZone,
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
      /* `apc-panel` only on the card variant: inline and footer deliberately
         draw no surface, and a composition's panel would give them one. */
      className={
        isCard ? 'apc-panel p-5' : variant === 'footer' ? 'pt-6' : 'mt-4'
      }
      style={
        isCard
          ? { boxShadow: 'var(--ap-shadow-sm)' }
          : // The footer variant sits directly above the page's own footer,
            // which already draws a rule. Two hairlines a few rows apart read
            // as a mistake rather than as structure, and the spacing separates
            // these details from what is above them on its own.
            undefined
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
            {/*
              THREE TO A COLUMN, filling downwards.

              Phone, WhatsApp, email, address and a website are each a few
              characters in a card half the page wide, so one per line left
              most of every row empty and made the card twice as tall as it
              needed to be.

              `grid-flow-col` with three rows fills the first column top to
              bottom before starting the next, which is how a list of contact
              details reads. Row-first flow would have put the phone beside the
              WhatsApp link and broken the pairs apart. One column on a phone,
              where there is no second column to flow into.
            */}
            <ul className="grid gap-x-6 gap-y-2.5 sm:grid-flow-col sm:grid-rows-3">
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
            {(() => {
              /*
               * Times read left-to-right even in Hebrew: `09:00 – 17:00`
               * reordered by the bidi algorithm becomes a different range.
               */
              const dayRow = (run: BusinessDayHours[]) => {
                const first = run[0];
                const last = run[run.length - 1];
                const closed = first.windows.length === 0;

                return (
                  <li
                    key={first.day}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span style={{ color: 'var(--ap-text)' }}>
                      {run.length > 1 ? `${t(first.day)} – ${t(last.day)}` : t(first.day)}
                    </span>
                    <span
                      dir="ltr"
                      className="tabular-nums"
                      style={{ color: closed ? 'var(--ap-text-muted)' : 'var(--ap-text)' }}
                    >
                      {formatWindows(first, t('closed'))}
                    </span>
                  </li>
                );
              };

              if (hoursStyle !== 'folded') {
                return <ul className="space-y-1.5">{hours.map(day => dayRow([day]))}</ul>;
              }

              const runs = groupHours(hours);
              const today = hours[todayIndexIn(hours, timeZone)] ?? null;
              const openToday = Boolean(today && today.windows.length > 0);

              return (
                <>
                  {today && (
                    <div
                      className="mb-3 flex items-center gap-2 px-3 py-2.5 text-sm font-semibold"
                      style={{
                        background: 'var(--ap-brand-tint)',
                        borderRadius: 'var(--ap-radius-md)',
                        color: 'var(--ap-text)',
                      }}
                    >
                      {t(openToday ? 'portal.open_today' : 'portal.closed_today')}
                      {openToday && (
                        <span dir="ltr" className="ms-auto tabular-nums">
                          {formatWindows(today, t('closed'))}
                        </span>
                      )}
                    </div>
                  )}

                  <ul className="space-y-1.5">{runs.map(dayRow)}</ul>

                  {/*
                    `details` rather than a state toggle: this component has no
                    `'use client'` of its own and is rendered from a server page
                    too, so the full list has to open without JavaScript.
                    Folding earns nothing when every day already differs.
                  */}
                  {runs.length < hours.length && (
                    <details className="group mt-2">
                      <summary
                        className="cursor-pointer list-none text-xs font-bold"
                        style={{ color: 'var(--ap-brand)' }}
                      >
                        <span className="group-open:hidden">{t('portal.all_days')}</span>
                        <span className="hidden group-open:inline">{t('portal.fewer_days')}</span>
                      </summary>
                      <ul className="mt-2 space-y-1.5">{hours.map(day => dayRow([day]))}</ul>
                    </details>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </section>
  );
}
