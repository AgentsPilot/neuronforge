'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Calendar } from 'lucide-react';
import type { BlockRendererProps, SelectedServiceData } from './types';

interface CTAContent {
  title: string;
  description?: string;
  button_text?: string;
  cta_text?: string; // Alternative field name used by landing pages
  button_link?: string;
  cta_link?: string; // Alternative field name used by landing pages
  secondary_button_text?: string;
  secondary_button_link?: string;
  style?: 'primary' | 'subtle' | 'gradient' | 'dark';
  // Service info for booking integration
  serviceId?: string;
  serviceName?: string;
  priceRaw?: number;
  currency?: string;
  durationMinutes?: number;
}

export function CTABlock({ content, styles, theme, isRTL, className, locale = 'en', bookingUrl, isPreview, onOpenBooking }: BlockRendererProps) {
  const rawContent = content as CTAContent;

  // Support both button_text and cta_text field names
  const buttonText = rawContent.button_text || rawContent.cta_text ||
    (locale === 'he' ? 'התחל עכשיו' : locale === 'es' ? 'Comenzar' : 'Get Started');
  const buttonLink = rawContent.button_link || rawContent.cta_link || '#contact';

  const {
    title,
    description,
    secondary_button_text,
    secondary_button_link,
    style = 'gradient' // Default to gradient for better visibility
  } = rawContent;

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

  // UUID regex for validation
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Check if we have a valid service linked for booking (must be valid UUID)
  const hasServiceLinked = !!rawContent.serviceId && UUID_REGEX.test(rawContent.serviceId);
  const hasBookingCapability = !!(bookingUrl || (isPreview && onOpenBooking));

  // Helper to convert to SelectedServiceData for booking modal
  const toSelectedServiceData = (): SelectedServiceData | null => {
    // Only allow booking if we have a valid serviceId (required for booking API)
    if (!rawContent.serviceId || !UUID_REGEX.test(rawContent.serviceId)) {
      console.warn('[CTABlock] No valid serviceId - booking disabled');
      return null;
    }

    return {
      id: rawContent.serviceId,
      name: rawContent.serviceName || title,
      description: description || null,
      duration_minutes: rawContent.durationMinutes || 60,
      price: rawContent.priceRaw ?? null,
      currency: rawContent.currency || 'USD'
    };
  };

  const handleBookingClick = () => {
    if (onOpenBooking) {
      const serviceData = toSelectedServiceData();
      if (serviceData) {
        onOpenBooking(serviceData);
      }
    }
  };

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
          style={{ fontFamily: 'var(--website-font-heading)' }}
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
            style={{ fontFamily: 'var(--website-font-body)' }}
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
          {/* Primary CTA Button - uses booking modal if available */}
          {/* Only show booking button if we have a valid serviceId (required for booking API) */}
          {hasServiceLinked && ((isPreview && onOpenBooking) || hasBookingCapability) ? (
            // Has booking capability - use booking modal or link
            isPreview && onOpenBooking ? (
              <button
                type="button"
                onClick={handleBookingClick}
                className={`inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold rounded-lg shadow-lg transition-all hover:scale-105 ${
                  style === 'subtle' || style === 'dark' ? '' : variant.buttonBg
                }`}
                style={{
                  backgroundColor: style === 'subtle' || style === 'dark' ? primaryColor : undefined,
                  color: variant.buttonText,
                  borderRadius: theme?.borderRadius || '0.5rem'
                }}
              >
                <Calendar className="w-5 h-5" />
                {buttonText}
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : bookingUrl ? (
              <a
                href={bookingUrl}
                className={`inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold rounded-lg shadow-lg transition-all hover:scale-105 ${
                  style === 'subtle' || style === 'dark' ? '' : variant.buttonBg
                }`}
                style={{
                  backgroundColor: style === 'subtle' || style === 'dark' ? primaryColor : undefined,
                  color: variant.buttonText,
                  borderRadius: theme?.borderRadius || '0.5rem'
                }}
              >
                <Calendar className="w-5 h-5" />
                {buttonText}
                <ArrowRight className="w-4 h-4" />
              </a>
            ) : null
          ) : (
            // No service linked - use regular link
            <a
              href={buttonLink}
              className={`inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold rounded-lg shadow-lg transition-all hover:scale-105 ${
                style === 'subtle' || style === 'dark' ? '' : variant.buttonBg
              }`}
              style={{
                backgroundColor: style === 'subtle' || style === 'dark' ? primaryColor : undefined,
                color: variant.buttonText,
                borderRadius: theme?.borderRadius || '0.5rem'
              }}
            >
              {buttonText}
              <ArrowRight className="w-4 h-4" />
            </a>
          )}

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
