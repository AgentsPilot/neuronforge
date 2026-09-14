/**
 * The last line: who this is, how to reach them, and the year.
 *
 * One rule above it and nothing else. Every mockup ends the same way — the
 * footer is the one section none of the six decorates, because anything drawn
 * there competes with the closing block immediately above it.
 *
 * @module components/website/templates/shapes/Footer
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface FooterShape {
  company_name?: string;
  tagline?: string;
  email?: string;
  phone?: string;
  address?: string;
  copyright_year?: number | string;
  menu_items?: Array<{ label?: string; text?: string; link?: string; href?: string }>;
}

export function FooterSection({ content, isRTL, className }: BlockRendererProps) {
  const c = content as FooterShape;
  const contact = [c.email, c.phone, c.address].filter(Boolean);

  return (
    <footer dir={isRTL ? 'rtl' : 'ltr'} className={`apc-footer ${className ?? ''}`}>
      <div className="apc-footer-row">
        <div className="apc-footer-who">
          {c.company_name && <span className="apc-wm">{c.company_name}</span>}
          {c.tagline && <span className="apc-footer-tag">{c.tagline}</span>}
        </div>

        {contact.length > 0 && (
          <div className="apc-footer-contact">
            {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
            {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
            {c.address && <span>{c.address}</span>}
          </div>
        )}

        {c.menu_items && c.menu_items.length > 0 && (
          <nav className="apc-footer-links">
            {c.menu_items.map((item, index) => (
              <a key={index} href={item.link ?? item.href ?? '#'}>
                {item.label ?? item.text}
              </a>
            ))}
          </nav>
        )}

        <span className="apc-footer-year">
          © {c.copyright_year ?? new Date().getFullYear()}
        </span>
      </div>
    </footer>
  );
}
