/**
 * about: prose on one side, a picture on the other, credentials ruled.
 *
 * Drawn from `stone-archetype.html` — the split band. The heading sits with the
 * prose rather than over the whole width, and any credentials become a dated
 * list separated by hairlines, which is how Stone carries authority on a page
 * that may have no photographs at all.
 *
 * @module components/website/templates/shapes/About
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface AboutShape {
  title?: string;
  content?: string;
  paragraphs?: string[];
  image?: string;
  credentials?: Array<string | { title?: string; year?: string }>;
  years_experience?: string | number;
  highlight_text?: string;
}

export function AboutSection({ content, styles, isRTL, className }: BlockRendererProps) {
  const c = content as AboutShape;
  const paragraphs =
    c.paragraphs?.length ? c.paragraphs : c.content ? [c.content] : [];

  if (!paragraphs.length && !c.title) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      <div className="apc-split">
        <div className="apc-split-copy">
          {c.highlight_text && <span className="apc-eyebrow">{c.highlight_text}</span>}
          {c.title && <h2>{c.title}</h2>}
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="apc-prose">
              {paragraph}
            </p>
          ))}

          {c.credentials && c.credentials.length > 0 && (
            <ul className="apc-facts-list">
              {c.credentials.map((credential, index) => {
                const label =
                  typeof credential === 'string' ? credential : credential.title ?? '';
                const year = typeof credential === 'string' ? null : credential.year;
                return (
                  <li key={index}>
                    <span>{label}</span>
                    {year && <i>{year}</i>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!c.image && <div className="apc-shot apc-split-shot apc-shot--empty" aria-hidden="true" />}

        {c.image && (
          <div
            className="apc-shot apc-split-shot"
            role="img"
            aria-label={c.title ?? ''}
            style={{ backgroundImage: `url(${c.image})` }}
          />
        )}
      </div>
    </section>
  );
}
