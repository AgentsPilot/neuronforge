'use client';

import { motion } from 'framer-motion';
import {
  MessageCircle, Brain, Target, Dumbbell, Hand, Flower2,
  Camera, Scale, Palette, Code, BookOpen, Music, Scissors,
  Sparkles, Heart, Users, Briefcase, GraduationCap, Stethoscope,
  Calculator, PenTool, Mic, Video, Utensils, Wrench, Car,
  Home, ShieldCheck, Plane, Dog, Baby, Leaf, ArrowRight, Calendar,
  Clock, Check, Zap, Eye, Shield, Award, Globe, Lock, CreditCard,
  Activity, Compass, Moon, Building, Feather, BarChart, Star, TrendingUp,
  type LucideIcon
} from 'lucide-react';
import type { BlockRendererProps, ServiceItem, FlowStep, SelectedServiceData } from './types';
import { getBlockTranslation } from '@/lib/i18n/website-block-translations';

// Map icon names to Lucide components
const ICON_REGISTRY: Record<string, LucideIcon> = {
  MessageCircle, Brain, Target, Dumbbell, Hand, Flower2,
  Camera, Scale, Palette, Code, BookOpen, Music, Scissors,
  Sparkles, Heart, Users, Briefcase, GraduationCap, Stethoscope,
  Calculator, PenTool, Mic, Video, Utensils, Wrench, Car,
  Home, ShieldCheck, Plane, Dog, Baby, Leaf, Clock, Check,
  Zap, Eye, Shield, Award, Globe, Lock, CreditCard,
  Activity, Compass, Moon, Building, Feather, BarChart, Star, TrendingUp
};

// Helper to check if string is a Lucide icon name
const isLucideIconName = (icon: string): boolean => {
  return icon in ICON_REGISTRY;
};

// Service icon component that renders either Lucide icon or emoji
interface ServiceIconProps {
  icon: string;
  className?: string;
  primaryColor?: string;
  secondaryColor?: string;
  size?: 'sm' | 'md' | 'lg';
  withGradient?: boolean;
}

function ServiceIcon({ icon, className, primaryColor = '#4F6EF7', secondaryColor, size = 'md', withGradient = false }: ServiceIconProps) {
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-7 h-7',
    lg: 'w-8 h-8'
  };

  if (isLucideIconName(icon)) {
    const IconComponent = ICON_REGISTRY[icon];
    return (
      <IconComponent
        className={`${sizeClasses[size]} ${className || ''}`}
        style={{ color: primaryColor }}
      />
    );
  }

  // Fallback to emoji rendering
  return <span className={`text-${size === 'sm' ? '2xl' : size === 'lg' ? '4xl' : '3xl'}`}>{icon}</span>;
}

interface ServiceItemWithRawData extends ServiceItem {
  id?: string;
  priceRaw?: number;
  currency?: string;
  durationMinutes?: number;
  hidden?: boolean;
  features?: string[];
  popular?: boolean;
}

interface ServicesContent {
  title?: string;
  subtitle?: string;
  services: ServiceItemWithRawData[];
  layout?: 'grid' | 'list' | 'cards' | 'featured';
}

export function ServicesBlock({ content, styles, theme, isRTL, className, clientFlow, bookingUrl, locale = 'en', isPreview, onOpenBooking }: BlockRendererProps) {
  // Translation helper
  const t = (key: string, section: 'services' | 'common' = 'services') =>
    getBlockTranslation(section, key, locale);

  // Format duration with translation
  const formatDuration = (service: ServiceItemWithRawData): string | null => {
    // Prefer raw minutes if available
    if (service.durationMinutes) {
      if (service.durationMinutes >= 60 && service.durationMinutes % 60 === 0) {
        const hours = service.durationMinutes / 60;
        return `${hours} ${t('hours', 'common')}`;
      }
      return `${service.durationMinutes} ${t('minutes', 'common')}`;
    }
    // Fallback to pre-formatted duration string
    return service.duration || null;
  };

  const typedContent = content as unknown as ServicesContent;
  const {
    title,
    subtitle,
    services: staticServices = [],
    layout = 'grid'
  } = typedContent;

  // Use translated default if no title provided
  const displayTitle = title || t('ourServices');

  // CTA labels based on flow - includes new 'scheduling' and 'client_info' steps
  const ctaLabels: Record<string, Record<FlowStep, string>> = {
    en: {
      scheduling: 'Book Now',
      client_info: 'Get Started',
      booking: 'Book Now',  // legacy
      payment: 'Buy Now',
      intake: 'Get Started',
      confirmation: 'Learn More'
    },
    es: {
      scheduling: 'Reservar',
      client_info: 'Comenzar',
      booking: 'Reservar',  // legacy
      payment: 'Comprar',
      intake: 'Empezar',
      confirmation: 'Más Info'
    },
    he: {
      scheduling: 'הזמן עכשיו',
      client_info: 'התחל',
      booking: 'הזמן עכשיו',  // legacy
      payment: 'קנה עכשיו',
      intake: 'התחל',
      confirmation: 'מידע נוסף'
    }
  };

  // Determine CTA based on first step in flow
  const firstStep = clientFlow?.[0] || 'scheduling';
  const ctaText = ctaLabels[locale || 'en']?.[firstStep] || ctaLabels.en[firstStep];
  const hasBookingFlow = clientFlow && clientFlow.length > 0;

  // Services come pre-filtered (active only) from the blocks-with-content API
  // Just filter out any hidden services (user customization)
  const services = staticServices.filter(s => !s.hidden);

  const columns = styles?.columns || 3;
  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const secondaryColor = theme?.colors.secondary || '#E8DDD4';

  // UUID regex for validation
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Helper to convert service to SelectedServiceData for booking modal
  const toSelectedServiceData = (service: ServiceItemWithRawData): SelectedServiceData | null => {
    // Validate that service.id is a valid UUID - required for booking API
    if (!service.id || !UUID_REGEX.test(service.id)) return null;
    return {
      id: service.id,
      name: service.name,
      description: service.description || null,
      duration_minutes: service.durationMinutes || 60,
      price: service.priceRaw ?? null,
      currency: service.currency || 'USD'
    };
  };

  const handleBookingClick = (service: ServiceItemWithRawData) => {
    if (onOpenBooking) {
      const serviceData = toSelectedServiceData(service);
      if (serviceData) {
        onOpenBooking(serviceData);
      }
    }
  };

  // Determine grid columns based on number of services and configured columns
  // Center services when there are fewer items than columns
  const serviceCount = services.length;
  const effectiveColumns = Math.min(columns, serviceCount);

  const gridColsClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
  }[effectiveColumns] || 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  // Add max-width and centering for fewer services
  const gridContainerClass = serviceCount < 3
    ? serviceCount === 1
      ? 'max-w-md mx-auto'
      : 'max-w-3xl mx-auto'
    : '';

  const backgroundColor = theme?.colors.background || '#ffffff';
  const textColor = theme?.colors.text || '#1a1a1a';
  const isDark = backgroundColor.startsWith('#0') || backgroundColor.startsWith('#1') || backgroundColor === '#000000';

  // Card style helper - glassmorphism effect
  const getCardStyle = (isHovered: boolean = false) => ({
    backgroundColor: isDark
      ? 'rgba(31, 41, 55, 0.8)'
      : 'rgba(255, 255, 255, 0.8)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderColor: isDark
      ? 'rgba(75, 85, 99, 0.4)'
      : 'rgba(229, 231, 235, 0.8)',
    borderRadius: theme?.borderRadius || '1.25rem',
    boxShadow: isHovered
      ? `0 25px 50px -12px ${primaryColor}20, 0 0 0 1px ${primaryColor}10`
      : '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)'
  });

  return (
    <section
      id="services"
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`relative overflow-hidden ${styles?.padding || 'py-12 sm:py-16 lg:py-20'} ${className || ''}`}
      style={{
        backgroundColor: isDark ? backgroundColor : '#fafbfc'
      }}
    >
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Gradient orbs - smaller for compact layout */}
        <div
          className="absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: primaryColor }}
        />
        <div
          className="absolute -bottom-20 -left-20 w-[350px] h-[350px] rounded-full opacity-10 blur-3xl"
          style={{ backgroundColor: secondaryColor }}
        />

        {/* Subtle pattern */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `radial-gradient(${primaryColor} 1px, transparent 1px)`,
            backgroundSize: '24px 24px'
          }}
        />

        {/* Gradient overlay at top */}
        <div
          className="absolute top-0 inset-x-0 h-40"
          style={{
            background: `linear-gradient(180deg, ${isDark ? backgroundColor : '#ffffff'}80 0%, transparent 100%)`
          }}
        />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header with decorative elements */}
        {(title || subtitle) && (
          <div className="text-center mb-10 sm:mb-12">
            {/* Decorative badge */}
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
              <span>{t('ourServices')}</span>
            </motion.div>

            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="text-2xl sm:text-3xl lg:text-4xl font-bold"
                style={{
                  fontFamily: 'var(--website-font-heading)',
                  color: isDark ? '#ffffff' : textColor
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
                transition={{ delay: 0.2 }}
                className="mt-4 text-lg sm:text-xl max-w-2xl mx-auto"
                style={{
                  fontFamily: 'var(--website-font-body)',
                  color: isDark ? '#9ca3af' : '#6b7280'
                }}
              >
                {subtitle}
              </motion.p>
            )}

            {/* Decorative line */}
            <motion.div
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className="mt-8 mx-auto w-24 h-1 rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent, ${primaryColor}, transparent)`
              }}
            />
          </div>
        )}

        {/* Grid Layout - Enhanced with glassmorphism */}
        {layout === 'grid' && (
          <div className={`grid ${gridColsClass} gap-6 sm:gap-8 ${gridContainerClass}`}>
            {services.map((service, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                whileHover={{ y: -8, transition: { duration: 0.3 } }}
                className="group relative p-8 rounded-2xl border backdrop-blur-xl"
                style={getCardStyle()}
              >
                {/* Popular badge */}
                {service.popular && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-bold text-white shadow-lg"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                    }}
                  >
                    {t('popular', 'common')}
                  </div>
                )}

                {/* Gradient accent at top */}
                <div
                  className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{
                    background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`
                  }}
                />

                {/* Icon with gradient background */}
                {service.icon && (
                  <motion.div
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ type: "spring", stiffness: 400 }}
                    className="relative w-16 h-16 rounded-2xl flex items-center justify-center mb-6 overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor}20 0%, ${secondaryColor}30 100%)`
                    }}
                  >
                    {/* Icon glow effect */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: `radial-gradient(circle at center, ${primaryColor}30 0%, transparent 70%)`
                      }}
                    />
                    <ServiceIcon icon={service.icon} primaryColor={primaryColor} size="lg" />
                  </motion.div>
                )}

                <h3
                  className="text-xl font-bold mb-3 group-hover:text-opacity-100 transition-colors"
                  style={{
                    fontFamily: 'var(--website-font-heading)',
                    color: isDark ? '#ffffff' : textColor
                  }}
                >
                  {service.name}
                </h3>

                <p
                  className="text-base leading-relaxed mb-6"
                  style={{
                    fontFamily: 'var(--website-font-body)',
                    color: isDark ? '#9ca3af' : '#6b7280'
                  }}
                >
                  {service.description}
                </p>

                {/* Features list */}
                {service.features && service.features.length > 0 && (
                  <ul className="space-y-2 mb-6">
                    {service.features.slice(0, 3).map((feature, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm" style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>
                        <Check className="w-4 h-4 flex-shrink-0" style={{ color: primaryColor }} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Price and duration */}
                {(service.price || service.duration) && (
                  <div className="flex items-center justify-between pt-6 border-t" style={{ borderColor: isDark ? 'rgba(75, 85, 99, 0.4)' : 'rgba(229, 231, 235, 0.8)' }}>
                    {service.price && (
                      <span
                        className="text-2xl font-bold"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          backgroundClip: 'text'
                        }}
                      >
                        {service.price}
                      </span>
                    )}
                    {formatDuration(service) && (
                      <span
                        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full"
                        style={{
                          backgroundColor: `${primaryColor}10`,
                          color: primaryColor
                        }}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        {formatDuration(service)}
                      </span>
                    )}
                  </div>
                )}

                {/* CTA Button with gradient */}
                {hasBookingFlow && (
                  <div className="mt-6">
                    {isPreview && onOpenBooking && service.id ? (
                      <button
                        type="button"
                        onClick={() => handleBookingClick(service)}
                        className="group/btn relative w-full flex items-center justify-center gap-2 px-6 py-3.5 text-white font-semibold rounded-xl overflow-hidden transition-all duration-300"
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
                          {firstStep === 'booking' && <Calendar className="w-4 h-4" />}
                          {ctaText}
                          <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                        </span>
                      </button>
                    ) : bookingUrl ? (
                      <a
                        href={bookingUrl}
                        className="group/btn relative w-full flex items-center justify-center gap-2 px-6 py-3.5 text-white font-semibold rounded-xl overflow-hidden transition-all duration-300"
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
                          {firstStep === 'booking' && <Calendar className="w-4 h-4" />}
                          {ctaText}
                          <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                        </span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="w-full flex items-center justify-center gap-2 px-6 py-3.5 text-white font-semibold rounded-xl opacity-60 cursor-not-allowed"
                        style={{
                          backgroundColor: primaryColor,
                          borderRadius: theme?.borderRadius || '0.75rem'
                        }}
                        title="Set a subdomain to enable booking"
                        disabled
                      >
                        {firstStep === 'booking' && <Calendar className="w-4 h-4" />}
                        {ctaText}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* List Layout - Enhanced */}
        {layout === 'list' && (
          <div className="max-w-4xl mx-auto space-y-4">
            {services.map((service, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: isRTL ? 30 : -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ x: isRTL ? -5 : 5 }}
                className="group relative flex items-center gap-6 p-6 rounded-2xl border backdrop-blur-sm transition-all duration-300"
                style={getCardStyle()}
              >
                {/* Left accent */}
                <div
                  className={`absolute ${isRTL ? 'right-0' : 'left-0'} top-4 bottom-4 w-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity`}
                  style={{ backgroundColor: primaryColor }}
                />

                {service.icon && (
                  <div
                    className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}25 100%)`
                    }}
                  >
                    <ServiceIcon icon={service.icon} primaryColor={primaryColor} size="md" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <h3
                    className="text-lg font-bold mb-1"
                    style={{
                      fontFamily: 'var(--website-font-heading)',
                      color: isDark ? '#ffffff' : textColor
                    }}
                  >
                    {service.name}
                  </h3>
                  <p
                    className="text-sm leading-relaxed"
                    style={{
                      fontFamily: 'var(--website-font-body)',
                      color: isDark ? '#9ca3af' : '#6b7280'
                    }}
                  >
                    {service.description}
                  </p>
                </div>

                <div className="flex-shrink-0 flex items-center gap-4">
                  {service.price && (
                    <span className="text-xl font-bold whitespace-nowrap" style={{ color: primaryColor }}>
                      {service.price}
                    </span>
                  )}
                  {hasBookingFlow && (
                    isPreview && onOpenBooking && service.id ? (
                      <button
                        type="button"
                        onClick={() => handleBookingClick(service)}
                        className="flex items-center gap-2 px-5 py-2.5 text-white font-medium rounded-xl transition-all hover:shadow-lg"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                        }}
                      >
                        {ctaText}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    ) : bookingUrl ? (
                      <a
                        href={bookingUrl}
                        className="flex items-center gap-2 px-5 py-2.5 text-white font-medium rounded-xl transition-all hover:shadow-lg"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                        }}
                      >
                        {ctaText}
                        <ArrowRight className="w-4 h-4" />
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="flex items-center gap-2 px-5 py-2.5 text-white font-medium rounded-xl opacity-60 cursor-not-allowed"
                        style={{ backgroundColor: primaryColor }}
                        disabled
                      >
                        {ctaText}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Cards Layout - Enhanced with hover effects */}
        {layout === 'cards' && (
          <div className={`grid ${gridColsClass} gap-6 ${gridContainerClass}`}>
            {services.map((service, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -10 }}
                className="group relative overflow-hidden rounded-2xl border backdrop-blur-xl"
                style={getCardStyle()}
              >
                {/* Top gradient bar */}
                <div
                  className="h-2"
                  style={{
                    background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`
                  }}
                />

                <div className="p-8">
                  {service.icon && (
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}25 100%)`
                      }}
                    >
                      <ServiceIcon icon={service.icon} primaryColor={primaryColor} size="lg" />
                    </div>
                  )}

                  <h3
                    className="text-xl font-bold mb-3"
                    style={{
                      fontFamily: 'var(--website-font-heading)',
                      color: isDark ? '#ffffff' : textColor
                    }}
                  >
                    {service.name}
                  </h3>

                  <p
                    className="text-sm leading-relaxed mb-6"
                    style={{
                      fontFamily: 'var(--website-font-body)',
                      color: isDark ? '#9ca3af' : '#6b7280'
                    }}
                  >
                    {service.description}
                  </p>

                  {service.price && (
                    <div className="flex items-baseline gap-1 mb-6">
                      <span
                        className="text-3xl font-bold"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent'
                        }}
                      >
                        {service.price}
                      </span>
                      {formatDuration(service) && (
                        <span className="text-sm" style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>
                          / {formatDuration(service)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* CTA Button */}
                  {hasBookingFlow && (
                    isPreview && onOpenBooking && service.id ? (
                      <button
                        type="button"
                        onClick={() => handleBookingClick(service)}
                        className="w-full flex items-center justify-center gap-2 px-5 py-3.5 text-white font-semibold rounded-xl transition-all hover:shadow-lg"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                        }}
                      >
                        {firstStep === 'booking' && <Calendar className="w-4 h-4" />}
                        {ctaText}
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                    ) : bookingUrl ? (
                      <a
                        href={bookingUrl}
                        className="w-full flex items-center justify-center gap-2 px-5 py-3.5 text-white font-semibold rounded-xl transition-all hover:shadow-lg"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                        }}
                      >
                        {firstStep === 'booking' && <Calendar className="w-4 h-4" />}
                        {ctaText}
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="w-full flex items-center justify-center gap-2 px-5 py-3.5 text-white font-semibold rounded-xl opacity-60 cursor-not-allowed"
                        style={{ backgroundColor: primaryColor }}
                        disabled
                      >
                        {firstStep === 'booking' && <Calendar className="w-4 h-4" />}
                        {ctaText}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )
                  )}
                </div>

                {/* Hover glow effect */}
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{
                    background: `radial-gradient(circle at 50% 0%, ${primaryColor}10 0%, transparent 50%)`
                  }}
                />
              </motion.div>
            ))}
          </div>
        )}

        {/* Featured Layout - New premium layout */}
        {layout === 'featured' && services.length > 0 && (
          <div className="space-y-8">
            {/* Featured service (first one) */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="relative overflow-hidden rounded-3xl border backdrop-blur-xl"
              style={getCardStyle()}
            >
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  background: `linear-gradient(135deg, ${primaryColor}20 0%, ${secondaryColor}10 100%)`
                }}
              />
              <div className="relative grid md:grid-cols-2 gap-8 p-8 md:p-12">
                <div>
                  <span
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-6"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                      color: '#ffffff'
                    }}
                  >
                    <Sparkles className="w-4 h-4" />
                    {t('featured', 'common')}
                  </span>

                  <h3
                    className="text-3xl font-bold mb-4"
                    style={{
                      fontFamily: 'var(--website-font-heading)',
                      color: isDark ? '#ffffff' : textColor
                    }}
                  >
                    {services[0].name}
                  </h3>

                  <p
                    className="text-lg leading-relaxed mb-6"
                    style={{
                      fontFamily: 'var(--website-font-body)',
                      color: isDark ? '#9ca3af' : '#6b7280'
                    }}
                  >
                    {services[0].description}
                  </p>

                  {services[0].features && (
                    <ul className="space-y-3 mb-8">
                      {services[0].features.map((feature, i) => (
                        <li key={i} className="flex items-center gap-3">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: `${primaryColor}20` }}
                          >
                            <Check className="w-4 h-4" style={{ color: primaryColor }} />
                          </div>
                          <span style={{ color: isDark ? '#d1d5db' : '#4b5563' }}>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex flex-col justify-center items-center md:items-end">
                  {services[0].price && (
                    <div className="text-center md:text-right mb-8">
                      <span
                        className="text-5xl font-bold"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent'
                        }}
                      >
                        {services[0].price}
                      </span>
                      {formatDuration(services[0]) && (
                        <p className="mt-2 text-sm" style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>
                          {formatDuration(services[0])}
                        </p>
                      )}
                    </div>
                  )}

                  {hasBookingFlow && bookingUrl && (
                    <a
                      href={bookingUrl}
                      className="inline-flex items-center gap-3 px-8 py-4 text-white font-semibold rounded-xl transition-all hover:shadow-2xl hover:scale-105"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                      }}
                    >
                      {firstStep === 'booking' && <Calendar className="w-5 h-5" />}
                      {ctaText}
                      <ArrowRight className="w-5 h-5" />
                    </a>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Other services in grid */}
            {services.length > 1 && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {services.slice(1).map((service, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={{ y: -5 }}
                    className="group p-6 rounded-2xl border backdrop-blur-xl transition-all"
                    style={getCardStyle()}
                  >
                    {service.icon && (
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                        style={{ backgroundColor: `${primaryColor}15` }}
                      >
                        <ServiceIcon icon={service.icon} primaryColor={primaryColor} size="md" />
                      </div>
                    )}
                    <h4
                      className="text-lg font-bold mb-2"
                      style={{
                        fontFamily: 'var(--website-font-heading)',
                        color: isDark ? '#ffffff' : textColor
                      }}
                    >
                      {service.name}
                    </h4>
                    <p
                      className="text-sm mb-4"
                      style={{
                        fontFamily: 'var(--website-font-body)',
                        color: isDark ? '#9ca3af' : '#6b7280'
                      }}
                    >
                      {service.description}
                    </p>
                    {service.price && (
                      <span className="font-bold" style={{ color: primaryColor }}>
                        {service.price}
                      </span>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
