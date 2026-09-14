/**
 * close: one inverted panel, and nothing else on the screen.
 *
 * Drawn from `stone-archetype.html`. Solid ink at the panel radius, sitting on
 * the page ground rather than inside a coloured band, with the heading held to
 * 16ch so it breaks where the mockup breaks it. The control inverts again —
 * page ground on ink — which is the only place in Stone where a filled button
 * is not black.
 *
 * @module components/website/templates/shapes/CTA
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';
import { resolveBookingAction, bookingIsDead } from '@/components/website/blocks/bookingAction';

interface CtaShape {
  title?: string;
  description?: string;
  button_text?: string;
  cta_text?: string;
  button_link?: string;
  cta_link?: string;
  secondary_button_text?: string;
  secondary_button_link?: string;
  /** This block sells one particular service. */
  serviceId?: string;
  /** …and that service has been deleted or switched off. */
  serviceUnavailable?: boolean;
}

export function CTASection({
  content,
  styles,
  isRTL,
  className,
  isPreview,
  onOpenBooking,
  bookingUrl,
}: BlockRendererProps) {
  const c = content as CtaShape;
  const buttonText = c.button_text || c.cta_text;
  const buttonLink = c.button_link || c.cta_link || '#contact';


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
  const booking = resolveBookingAction({ isPreview, onOpenBooking, bookingUrl, fallbackHref: buttonLink });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A CTA FOR A SERVICE THAT IS GONE OFFERS NOTHING.
   *
   * `resolveBookingAction` opens the booking dialog for the BUSINESS — every
   * active service — which is exactly right for a homepage's closing call to
   * action, and exactly wrong here. This shape called it unconditionally, so a
   * landing page written to sell one course kept a working "book now" after
   * that course was deleted, and the dialog it opened offered the client a
   * completely different set of services. The page was already unpublished;
   * the editor's preview was still demonstrating the wrong journey.
   *
   * Two states that look alike and are not:
   *
   *   no `serviceId` at all      a homepage CTA, about the business → book
   *   `serviceId` + unavailable  a landing page CTA, about a gone thing → stop
   *
   * The section keeps its copy AND its button — the owner wrote both and is
   * looking at this in the editor, so removing the control would make the
   * section read as broken rather than as blocked. The button is rendered
   * DISABLED instead: visibly the page's call to action, and unable to open
   * anything.
   */
  const serviceGone = bookingIsDead(content);

  if (!c.title && !buttonText) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      <div className="apc-close">
        {c.title && <h2>{c.title}</h2>}
        {c.description && <p>{c.description}</p>}
        {(buttonText || c.secondary_button_text) && (
          <div className="apc-cta-row apc-cta-row--centred">
            {buttonText &&
              (serviceGone ? (
                /*
                 * A real `<button disabled>`, not a styled anchor.
                 *
                 * An anchor has no disabled state — `pointer-events: none`
                 * stops the mouse and leaves it in the tab order, so a keyboard
                 * still activates it. A disabled button is skipped by the
                 * keyboard and announced as unavailable.
                 */
                <button type="button" disabled className="apc-btn">
                  {buttonText}
                </button>
              ) : booking.kind === 'open' ? (
                <button type="button" onClick={booking.onClick} className="apc-btn">
                  {buttonText}
                </button>
              ) : (
                <a href={booking.href} className="apc-btn">
                  {buttonText}
                </a>
              ))}
            {c.secondary_button_text &&
              (serviceGone ? (
                <button type="button" disabled className="apc-btn apc-btn--ghost">
                  {c.secondary_button_text}
                </button>
              ) : (
                <a href={c.secondary_button_link || '#'} className="apc-btn apc-btn--ghost">
                  {c.secondary_button_text}
                </a>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}
