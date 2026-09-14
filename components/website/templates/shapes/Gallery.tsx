/**
 * gallery: a mosaic where the first frame carries the set.
 *
 * Drawn from `section-catalogue.html` — `.gal`. Four columns on a wide screen
 * with the first image spanning two of them in both directions, so the grid has
 * a subject rather than being an even wall of thumbnails. No lightbox chrome and
 * no captions: the pictures are the section.
 *
 * @module components/website/templates/shapes/Gallery
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface GalleryImage {
  url?: string;
  src?: string;
  alt?: string;
}

interface GalleryShape {
  title?: string;
  subtitle?: string;
  images?: Array<GalleryImage | string>;
}

export function GallerySection({ content, styles, isRTL, className }: BlockRendererProps) {
  const c = content as GalleryShape;
  const images = (c.images ?? [])
    .map(image => (typeof image === 'string' ? { url: image } : image))
    .filter(image => image.url || image.src);

  if (!images.length) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      {(c.title || c.subtitle) && (
        <div className="apc-sec-head">
          {c.subtitle && <span className="apc-eyebrow">{c.subtitle}</span>}
          {c.title && <h2>{c.title}</h2>}
        </div>
      )}

      <div className="apc-gal">
        {images.map((image, index) => (
          <div
            key={index}
            className={`apc-shot${index === 0 ? ' apc-shot--big' : ''}`}
            role="img"
            aria-label={image.alt ?? ''}
            style={{ backgroundImage: `url(${image.url ?? image.src})` }}
          />
        ))}
      </div>
    </section>
  );
}
