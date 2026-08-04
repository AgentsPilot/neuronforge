'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Plus, Minus } from 'lucide-react';
import type { BlockRendererProps, FAQItem } from './types';
import { getBlockTranslation } from '@/lib/i18n/website-block-translations';

interface FAQContent {
  title?: string;
  subtitle?: string;
  faqs: FAQItem[];
  layout?: 'accordion' | 'grid' | 'simple';
}

// Extended interface to handle legacy 'items' key from older data
interface FAQContentWithLegacy extends FAQContent {
  items?: FAQItem[];
}

export function FAQBlock({ content, styles, theme, isRTL, className, locale = 'en' }: BlockRendererProps) {
  const t = (key: string) => getBlockTranslation('faq', key, locale);

  // Support both 'faqs' (new) and 'items' (legacy) keys for backwards compatibility
  const contentWithLegacy = content as FAQContentWithLegacy;
  const {
    title = t('frequentlyAskedQuestions'),
    subtitle,
    faqs = contentWithLegacy.items || [],  // Fallback to 'items' for existing data
    layout = 'accordion'
  } = contentWithLegacy;

  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const primaryColor = theme?.colors.primary || '#4F6EF7';

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-12 sm:py-16'} ${styles?.background || 'bg-white dark:bg-slate-950'} ${className || ''}`}
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || subtitle) && (
          <div className="text-center mb-12">
            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white"
                style={{ fontFamily: 'var(--website-font-heading)' }}
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
                className="mt-4 text-lg text-gray-600 dark:text-gray-300"
                style={{ fontFamily: 'var(--website-font-body)' }}
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
                className="bg-gray-50 dark:bg-slate-800/50 rounded-xl overflow-hidden"
                style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
              >
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full flex items-center justify-between p-5 text-start hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <span
                    className="font-semibold text-gray-900 dark:text-white pe-4"
                    style={{ fontFamily: 'var(--website-font-heading)' }}
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
                      style={{ color: primaryColor }}
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
                        className="px-5 pb-5 text-gray-600 dark:text-gray-300 leading-relaxed"
                        style={{ fontFamily: 'var(--website-font-body)' }}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {faqs.map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="p-6 bg-gray-50 dark:bg-slate-800/50 rounded-xl"
                style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
              >
                <h3
                  className="font-semibold text-gray-900 dark:text-white mb-3"
                  style={{ fontFamily: 'var(--website-font-heading)' }}
                >
                  {faq.question}
                </h3>
                <p
                  className="text-gray-600 dark:text-gray-300 leading-relaxed"
                  style={{ fontFamily: 'var(--website-font-body)' }}
                >
                  {faq.answer}
                </p>
              </motion.div>
            ))}
          </div>
        )}

        {/* Simple Layout with +/- icons */}
        {layout === 'simple' && (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
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
                    className="font-semibold text-gray-900 dark:text-white pe-4 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                    style={{ fontFamily: 'var(--website-font-heading)' }}
                  >
                    {faq.question}
                  </span>
                  <span className="flex-shrink-0 mt-1">
                    {openIndex === index ? (
                      <Minus className="w-5 h-5" style={{ color: primaryColor }} />
                    ) : (
                      <Plus className="w-5 h-5 text-gray-400" />
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
                      className="pb-6 text-gray-600 dark:text-gray-300 leading-relaxed"
                      style={{ fontFamily: 'var(--website-font-body)' }}
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
