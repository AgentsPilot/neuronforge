'use client';

import { motion } from 'framer-motion';
import { Check, Sparkles, ArrowRight, Calendar } from 'lucide-react';
import type { BlockRendererProps, PricingPlan, SelectedServiceData } from './types';

interface ExtendedPricingPlan extends PricingPlan {
  currency?: string;
  priceRaw?: number;
  // Link to a service for booking functionality
  serviceId?: string;
  serviceName?: string;
  durationMinutes?: number;
}

interface PricingContent {
  title?: string;
  subtitle?: string;
  plans: ExtendedPricingPlan[];
  layout?: 'cards' | 'table' | 'simple';
  // Service info for landing pages created from a specific service
  serviceId?: string;
  serviceName?: string;
  durationMinutes?: number;
}

// Default CTA text by locale
const DEFAULT_CTA_TEXT: Record<string, string> = {
  en: 'Get Started',
  es: 'Comenzar',
  he: 'התחל עכשיו'
};

// Currency symbols
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  ILS: '₪',
  JPY: '¥',
  CAD: 'C$',
  AUD: 'A$',
};

// Format price with currency
const formatPrice = (price: string | number | undefined, currency?: string, locale?: string): string => {
  if (!price && price !== 0) return '';

  // If price is already a formatted string (e.g., "$100"), return as-is
  if (typeof price === 'string' && /[₪$€£¥]/.test(price)) {
    return price;
  }

  // Convert to number if string
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numPrice)) return String(price);

  const symbol = CURRENCY_SYMBOLS[currency || 'USD'] || '$';

  // Format number with locale-aware separators
  const formatted = new Intl.NumberFormat(locale === 'he' ? 'he-IL' : locale === 'es' ? 'es-ES' : 'en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(numPrice);

  // For Hebrew (RTL), put currency symbol after the number
  if (locale === 'he' && currency === 'ILS') {
    return `${formatted} ${symbol}`;
  }

  return `${symbol}${formatted}`;
};

export function PricingBlock({ content, styles, theme, isRTL, className, locale = 'en', bookingUrl, isPreview, onOpenBooking }: BlockRendererProps) {
  const {
    title = 'Pricing',
    subtitle,
    plans = [],
    layout = 'cards'
  } = content as PricingContent;

  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const secondaryColor = theme?.colors.secondary || '#6366F1';

  // Helper to get CTA text with fallback
  const getCtaText = (plan: ExtendedPricingPlan): string => {
    return plan.cta_text || DEFAULT_CTA_TEXT[locale] || DEFAULT_CTA_TEXT.en;
  };

  // Helper to get CTA link with fallback
  const getCtaLink = (plan: ExtendedPricingPlan): string => {
    return plan.cta_link || '#contact';
  };

  // Get formatted price
  const getFormattedPrice = (plan: ExtendedPricingPlan): string => {
    // Use priceRaw and currency if available, otherwise use price string
    if (plan.priceRaw !== undefined || (typeof plan.price === 'number')) {
      return formatPrice(plan.priceRaw ?? plan.price, plan.currency, locale);
    }
    return formatPrice(plan.price, plan.currency, locale);
  };

  // Detect single plan - show as featured center card
  const isSinglePlan = plans.length === 1;

  // Get service info from content (for landing pages created from a specific service)
  const pricingContent = content as PricingContent;
  const defaultServiceId = pricingContent.serviceId;
  const defaultServiceName = pricingContent.serviceName;
  const defaultDurationMinutes = pricingContent.durationMinutes;

  // UUID regex for validation
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Helper to check if a serviceId is valid
  const isValidServiceId = (id: string | undefined): boolean => {
    return !!id && UUID_REGEX.test(id);
  };

  // Check if we have a valid service for booking
  const hasValidService = (plan: ExtendedPricingPlan): boolean => {
    return isValidServiceId(plan.serviceId) || isValidServiceId(defaultServiceId);
  };

  // Helper to convert plan to SelectedServiceData for booking modal
  const toSelectedServiceData = (plan: ExtendedPricingPlan, index: number): SelectedServiceData | null => {
    const serviceId = plan.serviceId || defaultServiceId;

    // Validate that serviceId is a valid UUID - required for booking API
    if (!serviceId || !UUID_REGEX.test(serviceId)) {
      console.warn('[PricingBlock] No valid serviceId for plan:', plan.name, '- booking disabled');
      return null;
    }

    // Parse price from formatted string if needed
    let priceNum: number | null = null;
    if (plan.priceRaw !== undefined) {
      priceNum = plan.priceRaw;
    } else if (typeof plan.price === 'number') {
      priceNum = plan.price;
    } else if (typeof plan.price === 'string') {
      const parsed = parseFloat(plan.price.replace(/[^0-9.-]/g, ''));
      if (!isNaN(parsed)) priceNum = parsed;
    }

    return {
      id: serviceId,
      name: plan.serviceName || defaultServiceName || plan.name,
      description: plan.description || null,
      duration_minutes: plan.durationMinutes || defaultDurationMinutes || 60,
      price: priceNum,
      currency: plan.currency || 'USD'
    };
  };

  const handleBookingClick = (plan: ExtendedPricingPlan, index: number) => {
    if (onOpenBooking) {
      const serviceData = toSelectedServiceData(plan, index);
      if (serviceData) {
        onOpenBooking(serviceData);
      }
    }
  };

  // Check if we have booking capability
  const hasBookingCapability = !!(bookingUrl || (isPreview && onOpenBooking));

  return (
    <section
      id="pricing"
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`relative overflow-hidden ${styles?.padding || 'py-16 sm:py-24'} ${className || ''}`}
      style={{
        backgroundColor: theme?.colors.background || '#fafbfc'
      }}
    >
      {/* Decorative background */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-32 -right-32 w-[400px] h-[400px] rounded-full opacity-10 blur-3xl"
          style={{ backgroundColor: primaryColor }}
        />
        <div
          className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full opacity-10 blur-3xl"
          style={{ backgroundColor: secondaryColor }}
        />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || subtitle) && (
          <div className="text-center mb-12">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-6"
              style={{
                backgroundColor: `${primaryColor}10`,
                color: primaryColor,
                border: `1px solid ${primaryColor}20`
              }}
            >
              <Sparkles className="w-4 h-4" />
              <span>{locale === 'he' ? 'מחירון' : locale === 'es' ? 'Precios' : 'Pricing'}</span>
            </motion.div>

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
                className="mt-4 text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto"
                style={{ fontFamily: 'var(--website-font-body)' }}
              >
                {subtitle}
              </motion.p>
            )}

            {/* Decorative line */}
            <motion.div
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2, duration: 0.8 }}
              className="mt-8 mx-auto w-24 h-1 rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent, ${primaryColor}, transparent)`
              }}
            />
          </div>
        )}

        {/* Cards Layout */}
        {layout === 'cards' && (
          <div className={`grid grid-cols-1 ${
            isSinglePlan
              ? 'max-w-lg mx-auto'
              : plans.length === 2
                ? 'lg:grid-cols-2 max-w-4xl mx-auto'
                : 'lg:grid-cols-3'
          } gap-8`}>
            {plans.map((plan, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                whileHover={{ y: -8, transition: { duration: 0.3 } }}
                className={`group relative bg-white dark:bg-slate-800 rounded-2xl overflow-hidden ${
                  plan.popular || isSinglePlan ? 'ring-2 shadow-2xl' : 'shadow-lg border border-gray-100 dark:border-gray-700'
                }`}
                style={{
                  borderRadius: theme?.borderRadius || '1.5rem',
                  ringColor: (plan.popular || isSinglePlan) ? primaryColor : undefined
                }}
              >
                {/* Top gradient accent */}
                <div
                  className="h-2"
                  style={{
                    background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`
                  }}
                />

                {plan.popular && (
                  <div
                    className="absolute top-2 inset-x-0 py-2 text-center text-sm font-semibold text-white"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`
                    }}
                  >
                    {locale === 'he' ? 'הכי פופולרי' : locale === 'es' ? 'Más Popular' : 'Most Popular'}
                  </div>
                )}

                <div className={`p-8 ${plan.popular ? 'pt-14' : ''}`}>
                  <h3
                    className="text-xl font-bold text-gray-900 dark:text-white"
                    style={{ fontFamily: 'var(--website-font-heading)' }}
                  >
                    {plan.name}
                  </h3>

                  {plan.description && (
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                      {plan.description}
                    </p>
                  )}

                  {/* Price with gradient */}
                  <div className="mt-6 flex items-baseline gap-2">
                    <span
                      className="text-5xl font-bold"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        fontFamily: 'var(--website-font-heading)'
                      }}
                    >
                      {getFormattedPrice(plan)}
                    </span>
                    {plan.period && (
                      <span className="text-gray-500 dark:text-gray-400 text-lg">
                        /{plan.period}
                      </span>
                    )}
                  </div>

                  {/* Features list */}
                  {plan.features && plan.features.length > 0 && (
                    <ul className="mt-8 space-y-4">
                      {plan.features.map((feature, fIndex) => (
                        <li key={fIndex} className="flex items-start gap-3">
                          <div
                            className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
                            style={{ backgroundColor: `${primaryColor}15` }}
                          >
                            <Check
                              className="w-4 h-4"
                              style={{ color: primaryColor }}
                            />
                          </div>
                          <span
                            className="text-gray-600 dark:text-gray-300"
                            style={{ fontFamily: 'var(--website-font-body)' }}
                          >
                            {feature}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* CTA Button with gradient - uses booking modal if available */}
                  {/* Only show booking button if we have a valid UUID serviceId */}
                  {hasValidService(plan) && ((isPreview && onOpenBooking) || hasBookingCapability) ? (
                    // Has booking capability - use booking modal or link
                    isPreview && onOpenBooking ? (
                      <button
                        type="button"
                        onClick={() => handleBookingClick(plan, index)}
                        className="group/btn relative mt-8 flex items-center justify-center gap-2 w-full py-4 text-white font-semibold rounded-xl overflow-hidden transition-all duration-300 hover:shadow-xl"
                        style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
                      >
                        <span
                          className="absolute inset-0"
                          style={{
                            background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                          }}
                        />
                        <span
                          className="absolute inset-0 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-300"
                          style={{
                            background: `linear-gradient(135deg, ${secondaryColor} 0%, ${primaryColor} 100%)`
                          }}
                        />
                        <span className="relative flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          {getCtaText(plan)}
                          <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                        </span>
                      </button>
                    ) : bookingUrl ? (
                      <a
                        href={`${bookingUrl}${(plan.serviceId || defaultServiceId) ? `?service=${plan.serviceId || defaultServiceId}` : ''}`}
                        className="group/btn relative mt-8 flex items-center justify-center gap-2 w-full py-4 text-white font-semibold rounded-xl overflow-hidden transition-all duration-300 hover:shadow-xl"
                        style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
                      >
                        <span
                          className="absolute inset-0"
                          style={{
                            background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                          }}
                        />
                        <span
                          className="absolute inset-0 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-300"
                          style={{
                            background: `linear-gradient(135deg, ${secondaryColor} 0%, ${primaryColor} 100%)`
                          }}
                        />
                        <span className="relative flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          {getCtaText(plan)}
                          <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                        </span>
                      </a>
                    ) : null
                  ) : (
                    // No service linked - use regular link
                    <a
                      href={getCtaLink(plan)}
                      className="group/btn relative mt-8 flex items-center justify-center gap-2 w-full py-4 text-white font-semibold rounded-xl overflow-hidden transition-all duration-300 hover:shadow-xl"
                      style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
                    >
                      <span
                        className="absolute inset-0"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                        }}
                      />
                      <span
                        className="absolute inset-0 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-300"
                        style={{
                          background: `linear-gradient(135deg, ${secondaryColor} 0%, ${primaryColor} 100%)`
                        }}
                      />
                      <span className="relative flex items-center gap-2">
                        {getCtaText(plan)}
                        <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                      </span>
                    </a>
                  )}
                </div>

                {/* Hover glow effect */}
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{
                    background: `radial-gradient(circle at 50% 0%, ${primaryColor}08 0%, transparent 50%)`
                  }}
                />
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
                    style={{ fontFamily: 'var(--website-font-heading)' }}
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
                        style={{ fontFamily: 'var(--website-font-heading)' }}
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
                        href={getCtaLink(plan)}
                        className="block w-full py-3 text-center font-semibold rounded-lg transition-all"
                        style={{
                          backgroundColor: plan.popular ? primaryColor : 'transparent',
                          border: `2px solid ${primaryColor}`,
                          color: plan.popular ? 'white' : primaryColor,
                          borderRadius: theme?.borderRadius || '0.5rem'
                        }}
                      >
                        {getCtaText(plan)}
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
