'use client';

import { motion } from 'framer-motion';
import type { BlockRendererProps } from './types';

interface CTAContent {
  title: string;
  description?: string;
  button_text: string;
  button_link?: string;
  secondary_button_text?: string;
  secondary_button_link?: string;
  style?: 'primary' | 'subtle' | 'gradient' | 'dark';
}

export function CTABlock({ content, styles, theme, isRTL, className }: BlockRendererProps) {
  const {
    title,
    description,
    button_text,
    button_link = '#contact',
    secondary_button_text,
    secondary_button_link,
    style = 'primary'
  } = content as CTAContent;

  const primaryColor = theme?.colors.primary || '#4F6EF7';

  const styleVariants = {
    primary: {
      bg: styles?.background || `bg-gradient-to-r from-blue-600 to-purple-600`,
      text: 'text-white',
      buttonBg: 'bg-white hover:bg-gray-100',
      buttonText: primaryColor,
      secondaryBorder: 'border-white/30 text-white hover:bg-white/10'
    },
    subtle: {
      bg: styles?.background || 'bg-gray-100 dark:bg-slate-800',
      text: 'text-gray-900 dark:text-white',
      buttonBg: '',
      buttonText: 'white',
      secondaryBorder: 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700'
    },
    gradient: {
      bg: 'bg-gradient-to-r from-purple-600 via-pink-500 to-orange-500',
      text: 'text-white',
      buttonBg: 'bg-white hover:bg-gray-100',
      buttonText: '#9333ea',
      secondaryBorder: 'border-white/30 text-white hover:bg-white/10'
    },
    dark: {
      bg: 'bg-gray-900 dark:bg-black',
      text: 'text-white',
      buttonBg: '',
      buttonText: 'white',
      secondaryBorder: 'border-gray-600 text-gray-300 hover:bg-gray-800'
    }
  };

  const variant = styleVariants[style];

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-12 sm:py-16'} ${variant.bg} ${className || ''}`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className={`text-2xl sm:text-3xl lg:text-4xl font-bold ${variant.text}`}
          style={{ fontFamily: theme?.fonts.heading }}
        >
          {title}
        </motion.h2>

        {description && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className={`mt-4 text-lg ${style === 'primary' || style === 'gradient' || style === 'dark' ? 'text-white/80' : 'text-gray-600 dark:text-gray-300'}`}
            style={{ fontFamily: theme?.fonts.body }}
          >
            {description}
          </motion.p>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href={button_link}
            className={`inline-flex items-center justify-center px-8 py-3 text-base font-semibold rounded-lg shadow-lg transition-all ${
              style === 'subtle' || style === 'dark' ? '' : variant.buttonBg
            }`}
            style={{
              backgroundColor: style === 'subtle' || style === 'dark' ? primaryColor : undefined,
              color: variant.buttonText,
              borderRadius: theme?.borderRadius || '0.5rem'
            }}
          >
            {button_text}
          </a>

          {secondary_button_text && (
            <a
              href={secondary_button_link || '#'}
              className={`inline-flex items-center justify-center px-8 py-3 text-base font-semibold border-2 rounded-lg transition-all ${variant.secondaryBorder}`}
              style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
            >
              {secondary_button_text}
            </a>
          )}
        </motion.div>
      </div>
    </section>
  );
}
