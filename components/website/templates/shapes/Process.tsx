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
import { StepIcon } from '@/components/website/blocks/ProcessBlock';

interface Step {
  title?: string;
  description?: string;
  label?: string;
  /*
   * The mark the owner chose for this step.
   *
   * Generated steps carry one, the editor offers a picker for it, and this
   * shape rendered the index and nothing else — so the icon was stored,
   * editable, and invisible on every published page. The legacy `ProcessBlock`
   * has always drawn it, falling back to the number; the template shapes
   * dropped that when they took the section over.
   */
  icon?: string;
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
                {/*
                  The icon where there is one, the number where there is not —
                  the same rule `ProcessBlock` uses, so the two renderers agree.
                  The number stays the default: the counting is what carries the
                  sequence in these designs, and a step with no icon must not
                  lose its place in the order.
                */}
                <span className="apc-idx" aria-hidden="true">
                  {step.icon
                    ? <StepIcon icon={step.icon} fallback={index + 1} size="sm" />
                    : String(index + 1).padStart(2, '0')}
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
