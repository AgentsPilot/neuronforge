/**
 * team: a square portrait, a name, a role. Nothing framed.
 *
 * Drawn from `section-catalogue.html` — `.member`. The portrait is a 1:1 crop at
 * the panel radius with no border and no shadow, and the name sits directly
 * beneath it rather than inside a card. The owner supplies the image, the name,
 * the role and the bio; everything about how that is arranged is decided here.
 *
 * @module components/website/templates/shapes/Team
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface Member {
  name?: string;
  role?: string;
  title?: string;
  bio?: string;
  image?: string;
  photo?: string;
}

interface TeamShape {
  title?: string;
  subtitle?: string;
  members?: Member[];
}

export function TeamSection({ content, styles, isRTL, className }: BlockRendererProps) {
  const c = content as TeamShape;
  const members = c.members ?? [];
  if (!members.length) return null;

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

      <div className="apc-team">
        {members.map((member, index) => {
          const portrait = member.image ?? member.photo;
          return (
            <article key={index} className="apc-member">
              {!portrait && (
                <div className="apc-shot apc-member-shot apc-shot--empty" aria-hidden="true" />
              )}
              {portrait && (
                <div
                  className="apc-shot apc-member-shot"
                  role="img"
                  aria-label={member.name ?? ''}
                  style={{ backgroundImage: `url(${portrait})` }}
                />
              )}
              {member.name && <h3>{member.name}</h3>}
              {(member.role || member.title) && <p>{member.role ?? member.title}</p>}
              {member.bio && <p className="apc-member-bio">{member.bio}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
