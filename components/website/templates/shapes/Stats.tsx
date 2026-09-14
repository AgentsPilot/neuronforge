/**
 * facts: four figures on one band, separated by hairlines.
 *
 * Drawn from `section-catalogue.html`. The grid carries a 1px gap over the rule
 * colour, so the lines between cells are the background showing through rather
 * than borders — which is why the corners stay clean at the panel radius.
 *
 * @module components/website/templates/shapes/Stats
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface Stat {
  value?: string | number;
  number?: string | number;
  label?: string;
  suffix?: string;
}

interface StatsShape {
  title?: string;
  subtitle?: string;
  stats?: Stat[];
}

export function StatsSection({ content, styles, isRTL, className }: BlockRendererProps) {
  const c = content as StatsShape;
  const stats = c.stats ?? [];
  if (!stats.length) return null;

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

      <div className="apc-facts">
        {stats.map((stat, index) => (
          <div key={index} className="apc-stat">
            <span className="apc-stat-n">
              {stat.value ?? stat.number}
              {stat.suffix}
            </span>
            {stat.label && <span className="apc-stat-l">{stat.label}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
