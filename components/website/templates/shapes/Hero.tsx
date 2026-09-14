/**
 * opening: type, two pills, and the picture underneath.
 *
 * Drawn from `stone-archetype.html`. The hero carries no panel, no badge pill,
 * no gradient and no floating shapes — the headline is the whole event, set
 * hard to the start edge with the lede on a short measure beneath it. The image
 * comes AFTER the copy at full width, which is what gives the section its
 * rhythm: read, then look.
 *
 * @module components/website/templates/shapes/Hero
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';
import { resolveBookingAction, bookingIsDead } from '@/components/website/blocks/bookingAction';

interface HeroShape {
  headline?: string;
  subheadline?: string;
  badge?: string;
  cta_text?: string;
  cta_link?: string;
  secondary_cta_text?: string;
  secondary_cta_link?: string;
  background_image?: string;
  /**
   * The key the editor used to write.
   *
   * The hero image field bound `content.image` while every hero renderer reads
   * `content.background_image`, so a picture chosen or generated in the editor
   * saved correctly, reappeared in the field on reopen, and never showed on the
   * page. Reading both means those pictures come back on their own — nobody has
   * to find and re-do them.
   */
  image?: string;
  /**
   * Small facts shown ON the hero picture.
   *
   * Bold floats two of these over its image as chip cards — a label, a figure
   * and a flame dot — which is the most recognisable thing in that mockup. Every
   * other template ignores them, so the element is always rendered and only Bold
   * draws it. `trust_indicators` is the older field carrying the same idea.
   */
  stats?: Array<{ label?: string; value?: string | number }>;
  trust_indicators?: { stats?: Array<{ label?: string; value?: string | number }> };
}

export function HeroSection({
  content,
  styles,
  isRTL,
  className,
  isPreview,
  onOpenBooking,
  bookingUrl,
}: BlockRendererProps) {
  const {
    headline,
    subheadline,
    badge,
    cta_text,
    cta_link = '#contact',
    secondary_cta_text,
    secondary_cta_link,
    background_image,
  } = content as HeroShape;

  const heroImage = background_image || (content as HeroShape).image;

  const shape = content as HeroShape;
  // At most two: the mockup positions one at each side of the picture, and a
  // third would have nowhere to go.
  const chips = (shape.stats ?? shape.trust_indicators?.stats ?? []).slice(0, 2);


/*
 * The control has to be able to START a booking.
 *
 * A shape draws the section, but the section's button is the conversion path:
 * in the editor's preview it opens the in-page booking dialog, on a published
 * site it goes to the booking page, and on a page that can take no booking at
 * all it falls back to its own link. Rendering a plain anchor here made the
 * dialog unreachable from the three sections most likely to convert — which is
 * invisible in a screenshot and total in effect.
 */
  const booking = resolveBookingAction({ isPreview, onOpenBooking, bookingUrl, fallbackHref: cta_link });
  const serviceGone = bookingIsDead(content);

  if (!headline && !subheadline) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec apc-hero ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      {/*
        The copy, in one box.
        ─────────────────────────────────────────────────────────────────────
        A split hero puts this beside the picture, and that cannot be done with
        loose siblings: the picture has to span every copy row, and a grid item
        taller than the rows it spans FORCES those rows to grow — so the
        headline, lede and button were pushed apart to the height of the
        photograph however the tracks were sized.

        One wrapper makes the hero two children instead of four, so the picture
        sits beside the copy rather than through it. The mockups do the same;
        warm-archetype.html calls it .hero-copy.
      */}
      <div className="apc-hero-copy">
        {badge && <span className="apc-eyebrow">{badge}</span>}

        {headline && <h1 data-apc="headline">{headline}</h1>}

        {subheadline && <p className="apc-lede">{subheadline}</p>}

        {(cta_text || secondary_cta_text) && (
          <div className="apc-cta-row">
            {cta_text &&
              (serviceGone ? (
                // A real disabled button: an anchor has no disabled state, so
                // it would stay reachable by keyboard.
                <button type="button" disabled className="apc-btn apc-btn--solid">
                  {cta_text}
                </button>
              ) : booking.kind === 'open' ? (
                <button type="button" onClick={booking.onClick} className="apc-btn apc-btn--solid">
                  {cta_text}
                </button>
              ) : (
                <a href={booking.href} className="apc-btn apc-btn--solid">
                  {cta_text}
                </a>
              ))}
            {secondary_cta_text && (
              <a href={secondary_cta_link || '#services'} className="apc-btn">
                {secondary_cta_text}
              </a>
            )}
          </div>
        )}
      </div>

      {/* The picture sits below the copy, full width, at the panel radius. */}
      {/*
        An empty picture slot still occupies its place.

        These sections used to omit the image entirely when there was none, so a
        split band collapsed to a column of prose and a gallery vanished — the
        page did not look unfinished, it looked like a different design. A
        neutral block holds the composition's own shape and corner, which is
        what lets an owner see where a photograph belongs and reach for the
        picker. It carries no text and is hidden from screen readers: it is
        scaffolding, not content.
      */}
      {!heroImage && <div className="apc-shot apc-hero-shot apc-shot--empty" aria-hidden="true" />}

      {heroImage && (
        <div className="apc-hero-card">
          <div
            className="apc-shot apc-hero-shot"
            role="img"
            aria-label={headline ?? ''}
            style={{ backgroundImage: `url(${heroImage})` }}
          />
          {chips.map((chip, index) => (
            <div key={index} className={`apc-chip apc-chip--${index === 0 ? 'one' : 'two'}`}>
              <span className="apc-chip-k">
                <i className="apc-chip-dot" aria-hidden="true" />
                {chip.label}
              </span>
              <span className="apc-chip-v">{chip.value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
