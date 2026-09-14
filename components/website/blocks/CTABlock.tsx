'use client';

import { motion } from 'framer-motion';
import { resolveBlockLayout } from '@/lib/website-builder/pageTheme';
import { ArrowRight, Calendar } from 'lucide-react';
import { resolveBookingAction } from './bookingAction';
import type { BlockRendererProps, SelectedServiceData } from './types';
import { getBlockTranslation } from '@/lib/i18n/website-block-translations';

interface CTAContent {
  title: string;
  description?: string;
  button_text?: string;
  cta_text?: string; // Alternative field name used by landing pages
  button_link?: string;
  cta_link?: string; // Alternative field name used by landing pages
  secondary_button_text?: string;
  secondary_button_link?: string;
  style?: 'primary' | 'subtle' | 'gradient' | 'dark';
  // Service info for booking integration
  serviceId?: string;
  /**
   * Set by the public renderer when the linked service no longer exists or has
   * been switched off — see `PricingBlock` for the reasoning.
   */
  serviceUnavailable?: boolean;
  serviceName?: string;
  priceRaw?: number;
  currency?: string;
  /** The two facts this service's journey is built from, injected live. */
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
  durationMinutes?: number;
}

export function CTABlock({ content, styles, theme, isRTL, className, locale = 'en', bookingUrl, isPreview, onOpenBooking }: BlockRendererProps) {
  const t = (key: string) => getBlockTranslation('common', key, locale);
  const rawContent = content as CTAContent;

  // Support both button_text and cta_text field names
  // Use AI-generated content first, translation as fallback only
  const buttonText = rawContent.button_text || rawContent.cta_text || t('getStarted');
  const buttonLink = rawContent.button_link || rawContent.cta_link || '#contact';

  const {
    title,
    description,
    secondary_button_text,
    secondary_button_link,
    // `style` is read below through `rawContent.style`, where it is weighed
    // against the archetype's layout rather than defaulted in isolation.
  } = rawContent;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE LAYOUT VOCABULARY, WIRED.
   *
   * `styles.layout` is written by the generator from the archetype and is one of
   * three closed names. It decides the SHAPE of the closing call; the palette
   * decides its colour, and neither knows anything about the other.
   *
   *   panel   a filled brand block, the whole width. The loudest.
   *   flat    a flat field of the brand colour with no rounding — Cloaked's
   *           closing move, and what Lumen was designed around.
   *   inline  a quiet band on the page's own surface, for an archetype that
   *           has already said everything it needs to. Stone uses this.
   *
   * `content.style` is the older, per-page way of saying the same thing and
   * still wins where a page carries one, because somebody chose it by hand.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const layout = (resolveBlockLayout('cta', theme?.layouts, styles?.layout) as
    'panel' | 'flat' | 'inline' | undefined) ?? 'panel';

  const LAYOUT_TO_STYLE = { panel: 'gradient', flat: 'primary', inline: 'subtle' } as const;
  const resolvedStyle = rawContent.style ?? LAYOUT_TO_STYLE[layout] ?? 'gradient';

  /*
   * Every value from the emitter.
   *
   * `--ap-on-brand` is the one worth naming: it is black or white depending on
   * which reads on the brand colour, worked out once where the theme is
   * emitted. Lumen's acid lime needs black text on it and Aster's indigo needs
   * white — a block hardcoding `text-white` gets one of those wrong, and it was
   * hardcoding `text-white` for three of the four variants.
   */
  const brand = 'var(--ap-brand)';
  const onBrand = 'var(--ap-on-brand)';
  const ink = 'var(--ap-text)';
  const inkMuted = 'var(--ap-text-muted)';
  const surface = 'var(--ap-surface-2)';
  const border = 'var(--ap-border)';
  const radius = 'var(--ap-radius-lg)';

  const styleVariants = {
    primary: {
      background: brand,
      color: onBrand,
      radius: '0px',
      buttonBackground: onBrand,
      buttonColor: brand,
      secondaryBorder: 'currentColor',
    },
    subtle: {
      background: surface,
      color: ink,
      radius,
      buttonBackground: brand,
      buttonColor: onBrand,
      secondaryBorder: border,
    },
    gradient: {
      background: `linear-gradient(135deg, var(--ap-brand) 0%, var(--ap-brand-secondary) 100%)`,
      color: onBrand,
      radius,
      buttonBackground: onBrand,
      buttonColor: brand,
      secondaryBorder: 'currentColor',
    },
    dark: {
      background: ink,
      color: 'var(--ap-bg)',
      radius,
      buttonBackground: brand,
      buttonColor: onBrand,
      secondaryBorder: 'currentColor',
    },
  };

  const variant = styleVariants[resolvedStyle as keyof typeof styleVariants];

  // UUID regex for validation
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /*
   * A well-formed id is not the same as a service that exists — a deleted
   * service's id still passes the shape test, so the renderer tells us
   * outright when the thing behind it is gone.
   */
  const hasServiceLinked =
    !rawContent.serviceUnavailable &&
    !!rawContent.serviceId &&
    UUID_REGEX.test(rawContent.serviceId);

  /*
   * Gone is not the same as never linked.
   *
   * Both made `hasServiceLinked` false and both fell into the branch below,
   * which opens booking for the BUSINESS — every active service. That is right
   * for a homepage's closing call to action and wrong for a landing page whose
   * one service has been deleted: its button kept working and offered the
   * client a completely different set of things to buy.
   *
   *   no `serviceId` at all      about the business  → book
   *   `serviceId` + unavailable  about a gone thing  → no control
   */
  const serviceGone = !!rawContent.serviceId && rawContent.serviceUnavailable === true;
  const hasBookingCapability = !!(bookingUrl || (isPreview && onOpenBooking));

  // For the unlinked case below: the same resolver the header and hero use.
  const ctaBooking = resolveBookingAction({
    isPreview,
    onOpenBooking,
    bookingUrl,
    fallbackHref: buttonLink,
  });

  // Helper to convert to SelectedServiceData for booking modal
  const toSelectedServiceData = (): SelectedServiceData | null => {
    // Only allow booking if we have a valid serviceId (required for booking API)
    if (!rawContent.serviceId || !UUID_REGEX.test(rawContent.serviceId)) {
      console.warn('[CTABlock] No valid serviceId - booking disabled');
      return null;
    }

    return {
      id: rawContent.serviceId,
      name: rawContent.serviceName || title,
      description: description || null,
      duration_minutes: rawContent.durationMinutes || 60,
      price: rawContent.priceRaw ?? null,
      currency: rawContent.currency || 'USD',
      // Same as pricing: the journey is the service's, injected live.
      is_scheduled: rawContent.is_scheduled,
      collection: rawContent.collection
    };
  };

  const handleBookingClick = () => {
    if (onOpenBooking) {
      const serviceData = toSelectedServiceData();
      if (serviceData) {
        onOpenBooking(serviceData);
      }
    }
  };

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding || 'py-12 sm:py-16'} ${className || ''}`}
      /*
       * The band behind the closing block, routed through a custom property so
       * a composition can switch it off.
       *
       * All three mockups close on a SINGLE inverted panel sitting on the page
       * ground. This block paints the whole section as well, so with a
       * composition applied the page showed a coloured band with a second,
       * differently-coloured panel inside it. An inline value cannot be
       * overridden by any rule, but a custom property READ by an inline value
       * can — the composition sets `--apc-band` on the surface and the fallback
       * here keeps every uncomposed page exactly as it was.
       */
      style={{
        background: `var(--apc-band, ${variant.background})`,
        color: `var(--apc-band-ink, ${variant.color})`,
      }}
    >
      <div className="apc-close max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="font-bold"
          style={{
            fontFamily: 'var(--ap-font-heading)',
            fontSize: 'var(--ap-scale-h2)',
            color: 'inherit',
          }}
        >
          {title}
        </motion.h2>

        {description && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-4 text-lg"
            style={{
              fontFamily: 'var(--ap-font-body)',
              // On a filled panel the description is the heading's colour at
              // reduced weight; on the page's own surface it is the muted ink.
              color: resolvedStyle === 'subtle' ? inkMuted : 'inherit',
              opacity: resolvedStyle === 'subtle' ? 1 : 0.82,
            }}
          >
            {description}
          </motion.p>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          {/* Primary CTA Button - uses booking modal if available */}
          {/* Only show booking button if we have a valid serviceId (required for booking API) */}
          {serviceGone ? (
            /*
             * Present, and unable to do anything.
             *
             * A real `<button disabled>` rather than a styled anchor: an anchor
             * has no disabled state, so `pointer-events: none` would stop the
             * mouse and still leave it reachable by keyboard. Kept rather than
             * removed because the owner is looking at this in the editor and a
             * closing section with no control reads as broken rather than as
             * blocked.
             */
            <button
              type="button"
              disabled
              className="apc-btn apc-btn--solid inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold opacity-45 cursor-not-allowed"
              style={{
                backgroundColor: variant.buttonBackground,
                color: variant.buttonColor,
              }}
            >
              {buttonText}
            </button>
          ) : hasServiceLinked && ((isPreview && onOpenBooking) || hasBookingCapability) ? (
            // Has booking capability - use booking modal or link
            isPreview && onOpenBooking ? (
              <button
                type="button"
                onClick={handleBookingClick}
                className="apc-btn apc-btn--solid inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold transition-all hover:opacity-90"
                style={{
                  backgroundColor: variant.buttonBackground,
                  color: variant.buttonColor,
                }}
              >
                <Calendar className="w-5 h-5" />
                {buttonText}
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : bookingUrl ? (
              <a
                href={bookingUrl}
                className="apc-btn apc-btn--solid inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold transition-all hover:opacity-90"
                style={{
                  backgroundColor: variant.buttonBackground,
                  color: variant.buttonColor,
                }}
              >
                <Calendar className="w-5 h-5" />
                {buttonText}
                <ArrowRight className="w-4 h-4" />
              </a>
            ) : null
          ) : (
            /*
             * No service linked — a homepage's closing call to action.
             *
             * It fell through to a plain anchor, so the last "book a session"
             * on the page merely scrolled. It now starts the booking the same
             * way the header does: the modal in preview, the booking URL when
             * published, and the stored anchor only where neither exists.
             * No service is passed, because this button is about the business
             * rather than any one thing it sells.
             */
            <a
              href={ctaBooking.kind === 'link' ? ctaBooking.href : buttonLink}
              onClick={(e) => {
                if (ctaBooking.kind === 'open') {
                  e.preventDefault();
                  ctaBooking.onClick();
                }
              }}
              className="apc-btn apc-btn--solid inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold transition-all hover:opacity-90"
              style={{
                backgroundColor: variant.buttonBackground,
                color: variant.buttonColor,
              }}
            >
              {buttonText}
              <ArrowRight className="w-4 h-4" />
            </a>
          )}

          {secondary_button_text &&
            (serviceGone ? (
              <button
                type="button"
                disabled
                className="apc-btn inline-flex items-center justify-center px-8 py-3 text-base font-semibold border-2 opacity-45 cursor-not-allowed"
                style={{ borderColor: variant.secondaryBorder, color: 'inherit' }}
              >
                {secondary_button_text}
              </button>
            ) : (
              <a
                href={secondary_button_link || '#'}
                className="apc-btn inline-flex items-center justify-center px-8 py-3 text-base font-semibold border-2 transition-all hover:opacity-80"
                style={{
                  borderColor: variant.secondaryBorder,
                  color: 'inherit',
                }}
              >
                {secondary_button_text}
              </a>
            ))}
        </motion.div>
      </div>
    </section>
  );
}
