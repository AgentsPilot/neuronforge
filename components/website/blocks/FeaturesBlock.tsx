'use client';

import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { BlockRendererProps, FeatureItem } from './types';

interface FeaturesContent {
  title?: string;
  subtitle?: string;
  features: FeatureItem[];
  layout?: 'grid' | 'list' | 'alternating' | 'centered';
}

export function FeaturesBlock({ content, styles, theme, isRTL, className }: BlockRendererProps) {
  const {
    title,
    subtitle,
    features = [],
    layout = 'grid'
  } = content as FeaturesContent;

  const columns = styles?.columns || 3;
  const primaryColor = theme?.colors.primary || '#4F6EF7';

  const gridColsClass = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
  }[columns] || 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-white dark:bg-slate-950'} ${className || ''}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || subtitle) && (
          <div className="text-center mb-12">
            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white"
                style={{ fontFamily: theme?.fonts.heading }}
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
                className="mt-4 text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto"
                style={{ fontFamily: theme?.fonts.body }}
              >
                {subtitle}
              </motion.p>
            )}
          </div>
        )}

        {/* Grid Layout */}
        {layout === 'grid' && (
          <div className={`grid ${gridColsClass} gap-8`}>
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="text-center"
              >
                <div
                  className="w-14 h-14 mx-auto rounded-xl flex items-center justify-center text-2xl mb-5"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  {feature.icon || <Check style={{ color: primaryColor }} />}
                </div>
                <h3
                  className="text-lg font-semibold text-gray-900 dark:text-white mb-2"
                  style={{ fontFamily: theme?.fonts.heading }}
                >
                  {feature.title}
                </h3>
                <p
                  className="text-gray-600 dark:text-gray-400"
                  style={{ fontFamily: theme?.fonts.body }}
                >
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        )}

        {/* List Layout */}
        {layout === 'list' && (
          <div className="max-w-2xl mx-auto space-y-6">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: isRTL ? 20 : -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="flex gap-4"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  {feature.icon || <Check className="w-5 h-5" style={{ color: primaryColor }} />}
                </div>
                <div>
                  <h3
                    className="text-lg font-semibold text-gray-900 dark:text-white mb-1"
                    style={{ fontFamily: theme?.fonts.heading }}
                  >
                    {feature.title}
                  </h3>
                  <p
                    className="text-gray-600 dark:text-gray-400"
                    style={{ fontFamily: theme?.fonts.body }}
                  >
                    {feature.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Alternating Layout */}
        {layout === 'alternating' && (
          <div className="space-y-16">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className={`flex flex-col lg:flex-row items-center gap-10 ${
                  index % 2 === 1 ? 'lg:flex-row-reverse' : ''
                }`}
              >
                <div
                  className="w-32 h-32 rounded-2xl flex items-center justify-center text-5xl flex-shrink-0"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  {feature.icon || '✨'}
                </div>
                <div className={`text-center lg:text-start ${isRTL ? 'lg:text-end' : ''}`}>
                  <h3
                    className="text-2xl font-bold text-gray-900 dark:text-white mb-4"
                    style={{ fontFamily: theme?.fonts.heading }}
                  >
                    {feature.title}
                  </h3>
                  <p
                    className="text-lg text-gray-600 dark:text-gray-400 max-w-lg"
                    style={{ fontFamily: theme?.fonts.body }}
                  >
                    {feature.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Centered Layout */}
        {layout === 'centered' && (
          <div className="max-w-3xl mx-auto">
            <div className="grid grid-cols-2 gap-6">
              {features.map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-slate-800/50 rounded-xl"
                  style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
                >
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                    style={{ backgroundColor: primaryColor, color: 'white' }}
                  >
                    {feature.icon || <Check className="w-4 h-4" />}
                  </span>
                  <span
                    className="font-medium text-gray-900 dark:text-white"
                    style={{ fontFamily: theme?.fonts.body }}
                  >
                    {feature.title}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
