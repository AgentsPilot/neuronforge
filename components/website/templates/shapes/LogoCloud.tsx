/**
 * The names a business is trusted by, set as words rather than images.
 *
 * Every mockup does this the same way and it is deliberate: a row of logos at
 * assorted weights and colours is the one element that makes an otherwise
 * coherent page look assembled. Where the owner supplies an image it is used at
 * a single height and desaturated; where they supply only a name, the name IS
 * the mark.
 *
 * @module components/website/templates/shapes/LogoCloud
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface Logo {
  name?: string;
  alt?: string;
  url?: string;
  image?: string;
}

interface LogoCloudShape {
  title?: string;
  subtitle?: string;
  logos?: Array<Logo | string>;
}

export function LogoCloudSection({ content, styles, isRTL, className }: BlockRendererProps) {
  const c = content as LogoCloudShape;
  const logos = (c.logos ?? []).map(l => (typeof l === 'string' ? { name: l } : l));
  if (!logos.length) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      {c.title && (
        <div className="apc-sec-head">
          {c.subtitle && <span className="apc-eyebrow">{c.subtitle}</span>}
          <h2>{c.title}</h2>
        </div>
      )}

      <div className="apc-logos">
        {logos.map((logo, index) =>
          logo.image || logo.url ? (
            <img
              key={index}
              src={logo.image ?? logo.url}
              alt={logo.alt ?? logo.name ?? ''}
              className="apc-logo-img"
            />
          ) : (
            <span key={index} className="apc-logo">
              {logo.name}
            </span>
          )
        )}
      </div>
    </section>
  );
}
