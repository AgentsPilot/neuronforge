// components/public/PortalHero.tsx

import { ArrowLeft, ArrowRight } from 'lucide-react';

import type { PublicBrand } from '@/lib/branding/publicBranding';

/*
 * The public portal keeps the SAME horizontal contract as the platform's own
 * screens — `max-w-7xl` with a `px-4 sm:px-6` gutter — rather than a narrower
 * column of its own. A client who books, pays and then manages the appointment
 * should not meet three different page widths, and the constant is imported
 * rather than retyped so there is still one place that decides it.
 *
 * `PAGE_CONTAINER` carries `mx-auto` too, so nothing here centres a second time.
 */

interface PortalHeroProps {
  brand: PublicBrand;
  /** The greeting, or the task. One line, always the screen's own subject. */
  title: string;
  /** What that means — the next appointment's date, or the consequence. */
  subtitle?: string | null;
  /** A way back into the portal, on the screens that are a step out of it. */
  back?: { href: string; label: string };
  /**
   * The card that belongs to this screen — the booking, or the one-line strip.
   *
   * Rendered INSIDE the band and pulled below it, so it overlaps the edge. That
   * is what says "this is the subject" without spending a heading on it, and it
   * removes the gap a card queueing underneath would leave.
   */
  children?: React.ReactNode;
}

/**
 * The band under the portal bar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * It carries ONE thing: what this screen is. On the portal that is a greeting
 * and when the next appointment is — the question a client opened the link to
 * answer. On cancel and reschedule it is the task itself, so the question
 * "לבטל את הפגישה?" is the hero rather than a page title repeating the URL,
 * and the warning under it is a subtitle rather than a card.
 *
 * It never names the business. `PortalBar` above does that, on every screen.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PortalHero({ brand, title, subtitle, back, children }: PortalHeroProps) {
  const BackArrow = brand.dir === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <div
      className="px-5 pb-5 pt-5 sm:px-6 sm:pb-6"
      style={{
        /*
         * The business's own two colours, at the ends of a soft diagonal. Built
         * from the theme rather than from fixed values so an account with a
         * blue brand does not get somebody else's green.
         */
        background: `linear-gradient(165deg, ${brand.theme.colors.secondary} 0%, var(--ap-brand-tint) 100%)`,
        borderRadius: 'var(--ap-radius-lg)',
      }}
    >
      <div>
        {back && (
          <a
            href={back.href}
            className="mb-2.5 inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--ap-text-muted)' }}
          >
            <BackArrow className="h-3.5 w-3.5" aria-hidden />
            {back.label}
          </a>
        )}

        <h1
          className="text-xl font-bold leading-tight sm:text-2xl"
          style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
        >
          <bdi>{title}</bdi>
        </h1>

        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
            <bdi>{subtitle}</bdi>
          </p>
        )}

        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
}
