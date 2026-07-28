'use client';

import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { BlockRendererProps, PricingPlan } from './types';

interface PricingContent {
  title?: string;
  subtitle?: string;
  plans: PricingPlan[];
  layout?: 'cards' | 'table' | 'simple';
}

export function PricingBlock({ content, styles, theme, isRTL, className }: BlockRendererProps) {
  const {
    title = 'Pricing',
    subtitle,
    plans = [],
    layout = 'cards'
  } = content as PricingContent;

  const primaryColor = theme?.colors.primary || '#4F6EF7';

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
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

        {/* Cards Layout */}
        {layout === 'cards' && (
          <div className={`grid grid-cols-1 ${plans.length === 2 ? 'lg:grid-cols-2 max-w-4xl mx-auto' : 'lg:grid-cols-3'} gap-8`}>
            {plans.map((plan, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className={`relative bg-white dark:bg-slate-800 rounded-2xl overflow-hidden ${
                  plan.popular ? 'ring-2 shadow-xl scale-105' : 'shadow-lg'
                }`}
                style={{
                  borderRadius: theme?.borderRadius || '1rem',
                  ringColor: plan.popular ? primaryColor : undefined
                }}
              >
                {plan.popular && (
                  <div
                    className="absolute top-0 inset-x-0 py-2 text-center text-sm font-semibold text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    Most Popular
                  </div>
                )}

                <div className={`p-8 ${plan.popular ? 'pt-14' : ''}`}>
                  <h3
                    className="text-xl font-bold text-gray-900 dark:text-white"
                    style={{ fontFamily: theme?.fonts.heading }}
                  >
                    {plan.name}
                  </h3>

                  {plan.description && (
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      {plan.description}
                    </p>
                  )}

                  <div className="mt-6 flex items-baseline">
                    <span
                      className="text-4xl font-bold text-gray-900 dark:text-white"
                      style={{ fontFamily: theme?.fonts.heading }}
                    >
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span className="ms-2 text-gray-500 dark:text-gray-400">
                        /{plan.period}
                      </span>
                    )}
                  </div>

                  <ul className="mt-8 space-y-4">
                    {plan.features.map((feature, fIndex) => (
                      <li key={fIndex} className="flex items-start gap-3">
                        <Check
                          className="w-5 h-5 flex-shrink-0 mt-0.5"
                          style={{ color: primaryColor }}
                        />
                        <span
                          className="text-gray-600 dark:text-gray-300"
                          style={{ fontFamily: theme?.fonts.body }}
                        >
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <a
                    href={plan.cta_link}
                    className={`mt-8 block w-full py-3 text-center font-semibold rounded-lg transition-all ${
                      plan.popular
                        ? 'text-white shadow-lg hover:opacity-90'
                        : 'border-2 hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}
                    style={{
                      backgroundColor: plan.popular ? primaryColor : undefined,
                      borderColor: plan.popular ? primaryColor : primaryColor,
                      color: plan.popular ? 'white' : primaryColor,
                      borderRadius: theme?.borderRadius || '0.5rem'
                    }}
                  >
                    {plan.cta_text}
                  </a>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Simple Layout */}
        {layout === 'simple' && (
          <div className="max-w-2xl mx-auto space-y-4">
            {plans.map((plan, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: isRTL ? 20 : -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="flex items-center justify-between p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm"
                style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
              >
                <div>
                  <h3
                    className="text-lg font-semibold text-gray-900 dark:text-white"
                    style={{ fontFamily: theme?.fonts.heading }}
                  >
                    {plan.name}
                  </h3>
                  {plan.description && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {plan.description}
                    </p>
                  )}
                </div>
                <div className="text-end">
                  <span
                    className="text-2xl font-bold"
                    style={{ color: primaryColor }}
                  >
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span className="text-sm text-gray-500 dark:text-gray-400 ms-1">
                      /{plan.period}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Table Layout */}
        {layout === 'table' && (
          <div className="overflow-x-auto">
            <table className="w-full bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="p-4 text-start text-gray-500 dark:text-gray-400 font-medium">Plan</th>
                  {plans.map((plan, index) => (
                    <th
                      key={index}
                      className={`p-4 text-center ${plan.popular ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                    >
                      <span
                        className="text-lg font-bold text-gray-900 dark:text-white"
                        style={{ fontFamily: theme?.fonts.heading }}
                      >
                        {plan.name}
                      </span>
                      <div className="mt-2">
                        <span className="text-2xl font-bold" style={{ color: primaryColor }}>
                          {plan.price}
                        </span>
                        {plan.period && (
                          <span className="text-sm text-gray-500 ms-1">/{plan.period}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Get unique features across all plans */}
                {Array.from(new Set(plans.flatMap(p => p.features))).map((feature, fIndex) => (
                  <tr
                    key={fIndex}
                    className="border-b border-gray-100 dark:border-gray-700/50"
                  >
                    <td className="p-4 text-gray-600 dark:text-gray-300">{feature}</td>
                    {plans.map((plan, pIndex) => (
                      <td
                        key={pIndex}
                        className={`p-4 text-center ${plan.popular ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                      >
                        {plan.features.includes(feature) ? (
                          <Check className="w-5 h-5 mx-auto" style={{ color: primaryColor }} />
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="p-4" />
                  {plans.map((plan, index) => (
                    <td
                      key={index}
                      className={`p-4 ${plan.popular ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                    >
                      <a
                        href={plan.cta_link}
                        className="block w-full py-3 text-center font-semibold rounded-lg transition-all"
                        style={{
                          backgroundColor: plan.popular ? primaryColor : 'transparent',
                          border: `2px solid ${primaryColor}`,
                          color: plan.popular ? 'white' : primaryColor,
                          borderRadius: theme?.borderRadius || '0.5rem'
                        }}
                      >
                        {plan.cta_text}
                      </a>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
