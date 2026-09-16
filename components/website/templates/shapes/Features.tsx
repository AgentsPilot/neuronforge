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
          {features.map((feature, index) => {
            /*
             * A CELL BECOMES A PICTURE ONLY IF IT HAS NOTHING TO SAY.
             *
             * Warm's bento turns a cell carrying an image into a full-bleed
             * photo tile, and it does that by hiding the cell's contents
             * outright (`.apc-step--photo > * { display: none }`). So an image
             * on a cell that HAS a heading and a sentence does not decorate
             * that cell — it deletes it. Pages generated with a photograph on
             * each of the first three cells showed three wordless stock photos
             * and one written point, and the copy was still sitting in the
             * block editor, intact and invisible.
             *
             * Deciding it here rather than only where pages are created is what
             * repairs the pages that already stored those images: the image is
             * simply not used for a cell that carries copy.
             */
            const asPhoto = Boolean(feature.image) && !feature.title && !feature.description;

            return (
            <li
              key={index}
              className={[
                'apc-step',
                // Warm's bento: the opening cell inverts, and a cell with a
                // picture and no words becomes the picture. Every other
                // template ignores both and draws a plain row.
                index === 0 ? 'apc-step--lead' : '',
                asPhoto ? 'apc-step--photo' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={asPhoto ? { backgroundImage: `url(${feature.image})` } : undefined}
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
            );
          })}
        </ol>
      )}
    </section>
  );
}
