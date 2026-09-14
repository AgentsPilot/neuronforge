/**
 * list of what happens: numbered, ruled, no cards and no icons.
 *
 * Drawn from `stone-archetype.html` — the "איך זה עובד" section. Each item is a
 * row with its index at the start edge and a hairline beneath. The mockup has
 * no icon anywhere in this section; the counting is what carries the sequence,
 * which is also why it reads as a process rather than a feature grid.
 *
 * @module components/website/templates/shapes/Features
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface FeatureItem {
  title?: string;
  description?: string;
  /** Warm turns a cell carrying an image into a full-bleed photo tile. */
  image?: string;
}

interface FeaturesShape {
  title?: string;
  subtitle?: string;
  features?: FeatureItem[];
}

export function FeaturesSection({ content, styles, isRTL, className }: BlockRendererProps) {
  const { title, subtitle, features = [] } = content as FeaturesShape;

  if (!features.length && !title) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      {(title || subtitle) && (
        <div className="apc-sec-head">
          {subtitle && <span className="apc-eyebrow">{subtitle}</span>}
          {title && <h2>{title}</h2>}
        </div>
      )}

      {features.length > 0 && (
        <ol className="apc-steps">
          {features.map((feature, index) => (
            <li
              key={index}
              className={[
                'apc-step',
                // Warm's bento: the opening cell inverts, and any cell the owner
                // gave a picture becomes the picture. Every other template
                // ignores both and draws a plain row.
                index === 0 ? 'apc-step--lead' : '',
                feature.image ? 'apc-step--photo' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={feature.image ? { backgroundImage: `url(${feature.image})` } : undefined}
            >
              <span className="apc-idx" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                {feature.title && <h3>{feature.title}</h3>}
                {feature.description && (
                  <p>
                    <b className="apc-tick" aria-hidden="true" />
                    {feature.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
