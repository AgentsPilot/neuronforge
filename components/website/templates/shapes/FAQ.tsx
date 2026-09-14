'use client';

/**
 * Stone's questions: a ruled list, not a stack of cards.
 *
 * Drawn from `section-catalogue.html`. Each question is a row with a hairline
 * above it and a thin mark at the far end that turns when it opens. No border,
 * no fill, no shadow — the rule does all the separating, which is what lets a
 * long list of questions stay quiet.
 *
 * @module components/website/templates/shapes/FAQ
 */

import { useState } from 'react';
import type { BlockRendererProps } from '@/components/website/blocks/types';

interface FaqItem {
  question?: string;
  answer?: string;
}

interface FaqShape {
  title?: string;
  subtitle?: string;
  faqs?: FaqItem[];
  items?: FaqItem[];
}

export function FAQSection({ content, styles, isRTL, className }: BlockRendererProps) {
  const shape = content as FaqShape;
  // `items` is the older field name; existing pages still carry it.
  const faqs = shape.faqs ?? shape.items ?? [];
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  if (!faqs.length) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      {(shape.title || shape.subtitle) && (
        <div className="apc-sec-head">
          {shape.subtitle && <span className="apc-eyebrow">{shape.subtitle}</span>}
          {shape.title && <h2>{shape.title}</h2>}
        </div>
      )}

      <div className="apc-qa-list">
        {faqs.map((faq, index) => {
          const isOpen = openIndex === index;
          return (
            <div key={index} className="apc-qa">
              <button
                type="button"
                className="apc-qa-q"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex(isOpen ? null : index)}
              >
                <span>{faq.question}</span>
                <i className="apc-qa-mark" aria-hidden="true">
                  {isOpen ? '−' : '+'}
                </i>
              </button>
              {isOpen && faq.answer && <p className="apc-qa-a">{faq.answer}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
