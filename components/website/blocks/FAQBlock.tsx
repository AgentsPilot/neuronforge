'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Plus, Minus } from 'lucide-react';
import type { BlockRendererProps, FAQItem } from './types';
import { getBlockTranslation } from '@/lib/i18n/website-block-translations';

interface FAQContent {
  title?: string;
  subtitle?: string;
  faqs?: FAQItem[];
  layout?: 'accordion' | 'grid' | 'simple';
}

// Extended interface to handle legacy 'items' key from older data
interface FAQContentWithLegacy extends FAQContent {
  items?: FAQItem[];
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * MIGRATED TO THE THEME TOKENS. The reference for every other block.
 *
 * What this block used to do, and what all 26 still do:
 *
 *   ap-bg        the section, ignoring the business's ground
 *   ap-ink     headings, ignoring its ink
 *   ap-ink-2                     body copy, ignoring its muted ink
 *   ap-card-2   cards, ignoring its surface
 *   ap-divide                   rules, ignoring its border colour
 *   group-hover:text-blue-600         a literal BLUE, on a business that has
 *                                     never once been blue
 *
 * So a theme reached a page as a font, a primary colour and a radius, and every
 * neutral — which is most of what a reader sees — was Tailwind's grey.
 *
 * The `dark:` variants are the other half, and they were the wrong mechanism
 * entirely: they made the page follow the VISITOR's operating system. A
 * business whose archetype is near-black rendered white to anyone browsing in
 * light mode, and a business whose ground is ivory went slate-950 at night.
 * Light or dark is a property of the business's palette, not of whoever is
 * looking — so it comes from the theme, and `color-scheme` on the surface tells
 * native controls which way to lean.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function FAQBlock({ content, styles, theme, isRTL, className, locale = 'en' }: BlockRendererProps) {
  const t = (key: string) => getBlockTranslation('faq', key, locale);

  // Support both 'faqs' (new) and 'items' (legacy) keys for backwards compatibility
  const contentWithLegacy = content as FAQContentWithLegacy;
  const {
    title: contentTitle,
    subtitle,
    faqs = contentWithLegacy.items || [],  // Fallback to 'items' for existing data
    layout = 'accordion'
  } = contentWithLegacy;
  // Use AI-generated title from content first, translation as fallback only
  const title = contentTitle || t('frequentlyAskedQuestions');

  const [openIndex, setOpenIndex] = useState<number | null>(0);

  /*
   * Read from the variables, not from `theme`.
   *
   * `theme` is still taken — some blocks need a value in JavaScript — but
   * anything that only ends up in CSS goes through the custom property, so one
   * emitter owns every fallback and a block carries none of its own.
   */
  const ink = 'var(--ap-text)';
  const inkMuted = 'var(--ap-text-muted)';
  const brand = 'var(--ap-brand)';

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding || 'py-12 sm:py-16'} ${styles?.background || ''} ${className || ''}`}
      style={styles?.background ? undefined : { background: 'var(--ap-bg)' }}
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || subtitle) && (
          <div className="apc-sec-head text-center mb-12">
            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="font-bold"
                style={{
                  fontFamily: 'var(--ap-font-heading)',
                  fontSize: 'var(--ap-scale-h2)',
                  color: ink,
                }}
              >
                {title}
              </motion.h2>
            )}
            {subtitle && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="mt-4 text-lg"
                style={{ fontFamily: 'var(--ap-font-body)', color: inkMuted }}
              >
                {subtitle}
              </motion.p>
            )}
          </div>
        )}

        {/* Accordion Layout */}
        {layout === 'accordion' && (
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                className="apc-qa overflow-hidden"
              >
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full flex items-center justify-between p-5 text-start transition-colors"
                >
                  <span
                    className="font-semibold pe-4"
                    style={{ fontFamily: 'var(--ap-font-heading)', color: ink }}
                  >
                    {faq.question}
                  </span>
                  <motion.div
                    animate={{ rotate: openIndex === index ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex-shrink-0"
                  >
                    <ChevronDown
                      className="w-5 h-5"
                      style={{ color: brand }}
                    />
                  </motion.div>
                </button>

                <AnimatePresence>
                  {openIndex === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <p
                        className="px-5 pb-5 leading-relaxed"
                        style={{ fontFamily: 'var(--ap-font-body)', color: inkMuted }}
                      >
                        {faq.answer}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        )}

        {/* Grid Layout */}
        {layout === 'grid' && (
          <div className="apc-grid grid grid-cols-1 md:grid-cols-2 gap-6">
            {faqs.map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="apc-qa p-6"
              >
                <h3
                  className="font-semibold mb-3"
                  style={{ fontFamily: 'var(--ap-font-heading)', color: ink }}
                >
                  {faq.question}
                </h3>
                <p
                  className="leading-relaxed"
                  style={{ fontFamily: 'var(--ap-font-body)', color: inkMuted }}
                >
                  {faq.answer}
                </p>
              </motion.div>
            ))}
          </div>
        )}

        {/* Simple Layout with +/- icons */}
        {layout === 'simple' && (
          <div className="divide-y" style={{ borderColor: 'var(--ap-border)' }}>
            {faqs.map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
              >
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full flex items-start justify-between py-6 text-start group"
                >
                  <span
                    className="font-semibold pe-4 transition-colors group-hover:opacity-70"
                    style={{ fontFamily: 'var(--ap-font-heading)', color: ink }}
                  >
                    {faq.question}
                  </span>
                  <span className="flex-shrink-0 mt-1">
                    {openIndex === index ? (
                      <Minus className="w-5 h-5" style={{ color: brand }} />
                    ) : (
                      <Plus className="w-5 h-5" style={{ color: inkMuted }} />
                    )}
                  </span>
                </button>

                <AnimatePresence>
                  {openIndex === index && (
                    <motion.p
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="pb-6 leading-relaxed"
                      style={{ fontFamily: 'var(--ap-font-body)', color: inkMuted }}
                    >
                      {faq.answer}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
