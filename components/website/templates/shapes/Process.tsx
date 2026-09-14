/**
 * process: numbered, ruled, one line each.
 *
 * Drawn from `stone-archetype.html`. The same numbered list the features
 * section uses, because in this design a process and a set of steps ARE the
 * same object — what changes is only what the owner put in them.
 *
 * @module components/website/templates/shapes/Process
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface Step {
  title?: string;
  description?: string;
  label?: string;
}

interface ProcessShape {
  title?: string;
  subtitle?: string;
  steps?: Step[];
  image?: string;
}

export function ProcessSection({ content, styles, isRTL, className }: BlockRendererProps) {
  const c = content as ProcessShape;
  const steps = c.steps ?? [];
  if (!steps.length && !c.title) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      {/* Image beside the list where there is one, stacked where there is not —
          the mockup pairs the steps with a photograph when the business has one. */}
      <div className={c.image ? 'apc-split' : undefined}>
        <div className="apc-split-copy">
          {(c.title || c.subtitle) && (
            <div className="apc-sec-head">
              {c.subtitle && <span className="apc-eyebrow">{c.subtitle}</span>}
              {c.title && <h2>{c.title}</h2>}
            </div>
          )}

          <ol className="apc-steps">
            {steps.map((step, index) => (
              <li key={index} className="apc-step">
                <span className="apc-idx" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  {(step.title || step.label) && <h3>{step.title ?? step.label}</h3>}
                  {step.description && <p>{step.description}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>

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
