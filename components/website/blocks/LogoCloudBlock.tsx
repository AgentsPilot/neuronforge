'use client';

import { motion } from 'framer-motion';
import type { BlockRendererProps } from './types';

interface Logo {
  name: string;
  url: string;
  link?: string;
}

interface LogoCloudContent {
  title?: string;
  subtitle?: string;
  logos: Logo[];
  layout?: 'simple' | 'grid' | 'scrolling';
}

export function LogoCloudBlock({ content, styles, theme, isRTL, className }: BlockRendererProps) {
  const {
    title = 'Trusted By',
    subtitle,
    logos = [],
    layout = 'simple'
  } = content as LogoCloudContent;

  const primaryColor = theme?.colors.primary || '#4F6EF7';

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-12 sm:py-16'} ${styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || subtitle) && (
          <div className="text-center mb-10">
            {title && (
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                {title}
              </motion.p>
            )}
            {subtitle && (
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="mt-2 text-gray-600 dark:text-gray-300"
                style={{ fontFamily: 'var(--website-font-body)' }}
              >
                {subtitle}
              </motion.p>
            )}
          </div>
        )}

        {/* Simple Layout */}
        {layout === 'simple' && (
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
            {logos.map((logo, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                {logo.link ? (
                  <a
                    href={logo.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <img
                      src={logo.url}
                      alt={logo.name}
                      className="h-10 w-auto object-contain grayscale hover:grayscale-0 transition-all"
                    />
                  </a>
                ) : (
                  <img
                    src={logo.url}
                    alt={logo.name}
                    className="h-10 w-auto object-contain opacity-60 grayscale"
                  />
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* Grid Layout */}
        {layout === 'grid' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-8">
            {logos.map((logo, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center justify-center p-4 bg-white dark:bg-slate-800 rounded-lg"
                style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
              >
                {logo.link ? (
                  <a
                    href={logo.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block opacity-70 hover:opacity-100 transition-opacity"
                  >
                    <img
                      src={logo.url}
                      alt={logo.name}
                      className="h-8 w-auto object-contain"
                    />
                  </a>
                ) : (
                  <img
                    src={logo.url}
                    alt={logo.name}
                    className="h-8 w-auto object-contain opacity-70"
                  />
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* Scrolling/Marquee Layout */}
        {layout === 'scrolling' && (
          <div className="relative overflow-hidden">
            {/* Gradient masks */}
            <div className="absolute inset-y-0 start-0 w-20 bg-gradient-to-e from-gray-50 dark:from-slate-900 to-transparent z-10 pointer-events-none" />
            <div className="absolute inset-y-0 end-0 w-20 bg-gradient-to-s from-gray-50 dark:from-slate-900 to-transparent z-10 pointer-events-none" />

            <motion.div
              className="flex gap-16 py-4"
              animate={{
                x: isRTL ? ['0%', '50%'] : ['0%', '-50%']
              }}
              transition={{
                x: {
                  repeat: Infinity,
                  repeatType: 'loop',
                  duration: 20,
                  ease: 'linear'
                }
              }}
            >
              {/* Duplicate logos for seamless loop */}
              {[...logos, ...logos].map((logo, index) => (
                <div key={index} className="flex-shrink-0">
                  {logo.link ? (
                    <a
                      href={logo.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block opacity-60 hover:opacity-100 transition-opacity"
                    >
                      <img
                        src={logo.url}
                        alt={logo.name}
                        className="h-12 w-auto object-contain grayscale hover:grayscale-0 transition-all"
                      />
                    </a>
                  ) : (
                    <img
                      src={logo.url}
                      alt={logo.name}
                      className="h-12 w-auto object-contain opacity-60 grayscale"
                    />
                  )}
                </div>
              ))}
            </motion.div>
          </div>
        )}
      </div>
    </section>
  );
}
