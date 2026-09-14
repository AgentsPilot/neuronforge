/**
 * testimonial: one quote, large, centred, and nothing around it.
 *
 * Drawn from `stone-archetype.html`. No avatar, no card, no carousel chrome —
 * the mockup gives a single quote the whole band and sets it at heading size,
 * with the attribution small beneath. Where a page carries several, they stack
 * as separate quotes rather than becoming a slider, because a slider hides most
 * of what the owner wrote.
 *
 * @module components/website/templates/shapes/Testimonials
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface Testimonial {
  quote?: string;
  content?: string;
  author?: string;
  name?: string;
  role?: string;
  company?: string;
}

interface TestimonialsShape {
  title?: string;
  subtitle?: string;
  testimonials?: Testimonial[];
}

export function TestimonialsSection({ content, styles, isRTL, className }: BlockRendererProps) {
  const c = content as TestimonialsShape;
  const testimonials = c.testimonials ?? [];
  if (!testimonials.length) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec apc-quote-band ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      {testimonials.map((testimonial, index) => {
        const body = testimonial.quote ?? testimonial.content;
        if (!body) return null;
        const who = [testimonial.author ?? testimonial.name, testimonial.role ?? testimonial.company]
          .filter(Boolean)
          .join(' · ');
        return (
          <figure key={index} className="apc-quote">
            <blockquote>{`“${body}”`}</blockquote>
            {who && <cite>{who}</cite>}
          </figure>
        );
      })}
    </section>
  );
}
