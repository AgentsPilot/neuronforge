'use client';

import { motion } from 'framer-motion';
import {
  Users, Calendar, CreditCard, Mail, FileText, ClipboardCheck,
  Send, CheckCircle, ArrowRight, Sparkles, type LucideIcon
} from 'lucide-react';
import type { BlockRendererProps, ProcessStep } from './types';
import { getBlockTranslation } from '@/lib/i18n/website-block-translations';

interface ProcessContent {
  title?: string;
  subtitle?: string;
  steps: ProcessStep[];
  layout?: 'numbered' | 'timeline' | 'horizontal' | 'cards' | 'zigzag';
}

// Map icon names to Lucide components
const ICON_REGISTRY: Record<string, LucideIcon> = {
  Users,
  Calendar,
  CreditCard,
  Mail,
  FileText,
  ClipboardCheck,
  Send,
  CheckCircle,
  ArrowRight
};

// Helper to check if string is a Lucide icon name
const isLucideIconName = (icon: string): boolean => {
  return icon in ICON_REGISTRY;
};

// Process step icon component
interface StepIconProps {
  icon?: string;
  fallback: number;
  primaryColor: string;
  size?: 'sm' | 'md' | 'lg';
}

function StepIcon({ icon, fallback, primaryColor, size = 'md' }: StepIconProps) {
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  if (icon && isLucideIconName(icon)) {
    const IconComponent = ICON_REGISTRY[icon];
    return <IconComponent className={sizeClasses[size]} />;
  }

  // If icon is an emoji, render it
  if (icon && !isLucideIconName(icon)) {
    return <span className="text-lg">{icon}</span>;
  }

  // Fallback to step number
  return <span className="font-bold">{fallback}</span>;
}

export function ProcessBlock({ content, styles, theme, isRTL, className, locale = 'en' }: BlockRendererProps) {
  // Translation helper
  const t = (key: string, section: 'process' | 'common' = 'process') =>
    getBlockTranslation(section, key, locale);

  const {
    title,
    subtitle,
    steps = [],
    layout = 'numbered'
  } = content as ProcessContent;

  // Use translated default if no title provided
  const displayTitle = title || t('howItWorks');

  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const secondaryColor = theme?.colors.secondary || '#E8DDD4';
  const backgroundColor = theme?.colors.background || '#ffffff';
  const textColor = theme?.colors.text || '#1a1a1a';

  // Determine if dark theme
  const isDark = backgroundColor.startsWith('#0') || backgroundColor.startsWith('#1') || backgroundColor === '#000000';

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`relative overflow-hidden ${styles?.padding || 'py-20 sm:py-32'} ${className || ''}`}
      style={{
        backgroundColor: isDark ? backgroundColor : '#ffffff'
      }}
    >
      {/* Decorative background */}
      {!isDark && (
        <>
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(at 20% 80%, ${primaryColor}08 0px, transparent 50%),
                radial-gradient(at 80% 20%, ${secondaryColor}12 0px, transparent 50%)
              `
            }}
          />
          {/* Subtle grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: `linear-gradient(${primaryColor} 1px, transparent 1px), linear-gradient(90deg, ${primaryColor} 1px, transparent 1px)`,
              backgroundSize: '60px 60px'
            }}
          />
        </>
      )}

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        {/* Enhanced Header */}
        {(title || subtitle) && (
          <div className="text-center mb-16 sm:mb-20">
            {/* Decorative badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-6"
              style={{
                background: `linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}20 100%)`,
                color: primaryColor,
                border: `1px solid ${primaryColor}15`
              }}
            >
              <Sparkles className="w-4 h-4" />
              {t('simpleProcess')}
            </motion.div>

            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-3xl sm:text-4xl lg:text-5xl font-bold"
                style={{
                  fontFamily: 'var(--website-font-heading)',
                  color: isDark ? '#ffffff' : textColor
                }}
              >
                {displayTitle}
              </motion.h2>
            )}
            {subtitle && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="mt-5 text-lg max-w-2xl mx-auto"
                style={{
                  fontFamily: 'var(--website-font-body)',
                  color: isDark ? '#9ca3af' : '#6b7280'
                }}
              >
                {subtitle}
              </motion.p>
            )}
          </div>
        )}

        {/* Numbered Layout - Enhanced */}
        {layout === 'numbered' && (
          <div className="max-w-3xl mx-auto">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: isRTL ? 30 : -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15, duration: 0.5 }}
                className="relative flex gap-6 sm:gap-8 group"
              >
                {/* Connector line */}
                {index < steps.length - 1 && (
                  <motion.div
                    initial={{ scaleY: 0 }}
                    whileInView={{ scaleY: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.15 + 0.3, duration: 0.4 }}
                    className="absolute top-16 w-0.5 h-[calc(100%-2rem)] origin-top"
                    style={{
                      [isRTL ? 'right' : 'left']: '1.5rem',
                      background: `linear-gradient(180deg, ${primaryColor} 0%, ${primaryColor}30 100%)`
                    }}
                  />
                )}

                {/* Step number circle */}
                <motion.div
                  whileHover={{ scale: 1.1 }}
                  className="relative w-12 h-12 rounded-2xl flex items-center justify-center text-xl text-white flex-shrink-0 shadow-lg"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                    boxShadow: `0 10px 25px -5px ${primaryColor}40`
                  }}
                >
                  <StepIcon icon={step.icon} fallback={step.number || index + 1} primaryColor={primaryColor} size="md" />

                  {/* Pulse effect */}
                  <motion.div
                    animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                    transition={{ duration: 2, repeat: Infinity, delay: index * 0.5 }}
                    className="absolute inset-0 rounded-2xl"
                    style={{ backgroundColor: primaryColor }}
                  />
                </motion.div>

                {/* Content card */}
                <motion.div
                  whileHover={{ x: isRTL ? -5 : 5 }}
                  className="flex-1 pb-10 pt-1"
                >
                  <div
                    className="p-6 rounded-2xl transition-all duration-300"
                    style={{
                      backgroundColor: isDark ? 'rgba(31, 41, 55, 0.5)' : `${primaryColor}05`,
                      border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.3)' : `${primaryColor}10`}`
                    }}
                  >
                    <h3
                      className="text-xl font-semibold mb-2"
                      style={{
                        fontFamily: 'var(--website-font-heading)',
                        color: isDark ? '#ffffff' : textColor
                      }}
                    >
                      {step.title}
                    </h3>
                    <p
                      style={{
                        fontFamily: 'var(--website-font-body)',
                        color: isDark ? '#9ca3af' : '#6b7280'
                      }}
                    >
                      {step.description}
                    </p>
                    {step.capability_link && (
                      <motion.a
                        href={step.capability_link}
                        whileHover={{ x: 5 }}
                        className="inline-flex items-center gap-2 mt-4 text-sm font-semibold"
                        style={{ color: primaryColor }}
                      >
                        <span>{t('learnMore', 'common')}</span>
                        <ArrowRight className="w-4 h-4" />
                      </motion.a>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Timeline Layout - Enhanced */}
        {layout === 'timeline' && (
          <div className="max-w-4xl mx-auto relative">
            {/* Animated vertical line */}
            <motion.div
              initial={{ scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className={`absolute ${isRTL ? 'end-7' : 'start-7'} top-0 bottom-0 w-1 rounded-full origin-top`}
              style={{
                background: `linear-gradient(180deg, ${primaryColor} 0%, ${secondaryColor} 50%, ${primaryColor}30 100%)`
              }}
            />

            <div className="space-y-8">
              {steps.map((step, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: isRTL ? 30 : -30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.15, duration: 0.5 }}
                  className="flex gap-8 relative group"
                >
                  {/* Enhanced dot with glow */}
                  <motion.div
                    whileHover={{ scale: 1.15 }}
                    className="relative w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 z-10 shadow-xl"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                      color: 'white',
                      boxShadow: `0 10px 30px -5px ${primaryColor}50`
                    }}
                  >
                    <StepIcon icon={step.icon} fallback={step.number || index + 1} primaryColor={primaryColor} size="md" />

                    {/* Animated ring */}
                    <motion.div
                      animate={{
                        scale: [1, 1.3, 1],
                        opacity: [0.3, 0, 0.3]
                      }}
                      transition={{ duration: 3, repeat: Infinity, delay: index * 0.3 }}
                      className="absolute inset-0 rounded-2xl border-2"
                      style={{ borderColor: primaryColor }}
                    />
                  </motion.div>

                  {/* Enhanced content card */}
                  <motion.div
                    whileHover={{
                      y: -5,
                      boxShadow: `0 20px 40px -15px ${primaryColor}25`
                    }}
                    className="flex-1 p-6 sm:p-8 rounded-2xl transition-colors duration-300"
                    style={{
                      backgroundColor: isDark ? 'rgba(31, 41, 55, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                      backdropFilter: 'blur(10px)',
                      border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.3)' : `${primaryColor}15`}`,
                      borderRadius: theme?.borderRadius || '1rem'
                    }}
                  >
                    {/* Step indicator */}
                    <span
                      className="text-xs font-bold uppercase tracking-wider mb-3 block"
                      style={{ color: primaryColor }}
                    >
                      {`${t('step', 'common')} ${step.number || index + 1}`}
                    </span>

                    <h3
                      className="text-xl font-bold mb-3"
                      style={{
                        fontFamily: 'var(--website-font-heading)',
                        color: isDark ? '#ffffff' : textColor
                      }}
                    >
                      {step.title}
                    </h3>
                    <p
                      className="leading-relaxed"
                      style={{
                        fontFamily: 'var(--website-font-body)',
                        color: isDark ? '#9ca3af' : '#6b7280'
                      }}
                    >
                      {step.description}
                    </p>
                    {step.capability_link && (
                      <motion.a
                        href={step.capability_link}
                        whileHover={{ x: 5 }}
                        className="inline-flex items-center gap-2 mt-4 text-sm font-semibold"
                        style={{ color: primaryColor }}
                      >
                        <span>{t('learnMore', 'common')}</span>
                        <ArrowRight className="w-4 h-4" />
                      </motion.a>
                    )}
                  </motion.div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Horizontal Layout - Enhanced with animated connectors */}
        {layout === 'horizontal' && (
          <div className="relative">
            {/* Animated horizontal connector line (desktop only) */}
            <motion.div
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              className="hidden lg:block absolute top-12 start-[12%] end-[12%] h-1 rounded-full origin-left"
              style={{
                background: `linear-gradient(90deg, ${primaryColor} 0%, ${secondaryColor} 50%, ${primaryColor} 100%)`
              }}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-6">
              {steps.map((step, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.15, duration: 0.5 }}
                  className="text-center relative group"
                >
                  {/* Step circle with effects */}
                  <motion.div
                    whileHover={{ scale: 1.1, y: -5 }}
                    className="relative mx-auto"
                  >
                    <div
                      className="w-24 h-24 mx-auto rounded-3xl flex items-center justify-center text-white shadow-xl relative z-10"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                        boxShadow: `0 15px 35px -10px ${primaryColor}50`
                      }}
                    >
                      <StepIcon icon={step.icon} fallback={step.number || index + 1} primaryColor={primaryColor} size="lg" />
                    </div>

                    {/* Decorative ring */}
                    <div
                      className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        border: `2px solid ${primaryColor}30`,
                        transform: 'scale(1.15)'
                      }}
                    />

                    {/* Pulse animation */}
                    <motion.div
                      animate={{ scale: [1, 1.2], opacity: [0.4, 0] }}
                      transition={{ duration: 2.5, repeat: Infinity, delay: index * 0.4 }}
                      className="absolute inset-0 rounded-3xl"
                      style={{ backgroundColor: primaryColor }}
                    />
                  </motion.div>

                  {/* Arrow connector (between steps, desktop only) */}
                  {index < steps.length - 1 && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.15 + 0.5 }}
                      className="hidden lg:flex absolute top-12 -right-3 transform translate-x-1/2 z-20"
                    >
                      <ArrowRight className="w-6 h-6" style={{ color: primaryColor }} />
                    </motion.div>
                  )}

                  <h3
                    className="mt-8 text-lg font-bold"
                    style={{
                      fontFamily: 'var(--website-font-heading)',
                      color: isDark ? '#ffffff' : textColor
                    }}
                  >
                    {step.title}
                  </h3>
                  <p
                    className="mt-3 text-sm leading-relaxed"
                    style={{
                      fontFamily: 'var(--website-font-body)',
                      color: isDark ? '#9ca3af' : '#6b7280'
                    }}
                  >
                    {step.description}
                  </p>
                  {step.capability_link && (
                    <motion.a
                      href={step.capability_link}
                      whileHover={{ scale: 1.05 }}
                      className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full text-sm font-semibold"
                      style={{
                        backgroundColor: `${primaryColor}15`,
                        color: primaryColor
                      }}
                    >
                      <span>{t('learnMore', 'common')}</span>
                      <ArrowRight className="w-3 h-3" />
                    </motion.a>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Cards Layout - Enhanced with glassmorphism */}
        {layout === 'cards' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                whileHover={{
                  y: -10,
                  boxShadow: `0 25px 50px -12px ${primaryColor}25`
                }}
                className="relative p-8 overflow-hidden group cursor-default"
                style={{
                  backgroundColor: isDark ? 'rgba(31, 41, 55, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                  backdropFilter: 'blur(20px)',
                  border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.3)' : `${primaryColor}10`}`,
                  borderRadius: theme?.borderRadius || '1.25rem'
                }}
              >
                {/* Top gradient accent */}
                <div
                  className="absolute top-0 left-0 right-0 h-1 opacity-80"
                  style={{
                    background: `linear-gradient(90deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                  }}
                />

                {/* Step number watermark */}
                <span
                  className="absolute -top-8 -end-6 text-[120px] font-black opacity-[0.04] transition-opacity group-hover:opacity-[0.08]"
                  style={{ color: primaryColor }}
                >
                  {step.number || index + 1}
                </span>

                {/* Decorative corner gradient */}
                <div
                  className="absolute -bottom-20 -right-20 w-40 h-40 rounded-full opacity-0 group-hover:opacity-20 transition-opacity duration-500"
                  style={{ backgroundColor: primaryColor }}
                />

                <div className="relative z-10">
                  {/* Icon with gradient background */}
                  <motion.div
                    initial={{ rotate: -10, scale: 0.8 }}
                    whileInView={{ rotate: 0, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 + 0.2, type: "spring" }}
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 text-white"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                      boxShadow: `0 8px 20px -5px ${primaryColor}40`
                    }}
                  >
                    <StepIcon icon={step.icon} fallback={step.number || index + 1} primaryColor={primaryColor} size="md" />
                  </motion.div>

                  <h3
                    className="text-xl font-bold mb-3"
                    style={{
                      fontFamily: 'var(--website-font-heading)',
                      color: isDark ? '#ffffff' : textColor
                    }}
                  >
                    {step.title}
                  </h3>
                  <p
                    className="leading-relaxed"
                    style={{
                      fontFamily: 'var(--website-font-body)',
                      color: isDark ? '#9ca3af' : '#6b7280'
                    }}
                  >
                    {step.description}
                  </p>
                  {step.capability_link && (
                    <motion.a
                      href={step.capability_link}
                      whileHover={{ x: 5 }}
                      className="inline-flex items-center gap-2 mt-5 text-sm font-semibold"
                      style={{ color: primaryColor }}
                    >
                      <span>{t('learnMore', 'common')}</span>
                      <ArrowRight className="w-4 h-4" />
                    </motion.a>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Zigzag Layout - NEW: Alternating left/right steps */}
        {layout === 'zigzag' && (
          <div className="max-w-5xl mx-auto">
            {steps.map((step, index) => {
              const isEven = index % 2 === 0;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: isEven ? -50 : 50 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.15, duration: 0.6 }}
                  className={`relative flex flex-col lg:flex-row items-center gap-8 lg:gap-16 ${
                    index < steps.length - 1 ? 'pb-16' : ''
                  } ${isEven ? '' : 'lg:flex-row-reverse'}`}
                >
                  {/* Connector line to next step */}
                  {index < steps.length - 1 && (
                    <motion.div
                      initial={{ scaleY: 0 }}
                      whileInView={{ scaleY: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.15 + 0.3, duration: 0.5 }}
                      className="hidden lg:block absolute bottom-0 left-1/2 -translate-x-1/2 w-0.5 h-16 origin-top"
                      style={{
                        background: `linear-gradient(180deg, ${primaryColor} 0%, ${primaryColor}20 100%)`
                      }}
                    />
                  )}

                  {/* Number/Icon circle */}
                  <motion.div
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    className="relative flex-shrink-0"
                  >
                    <div
                      className="w-28 h-28 rounded-3xl flex items-center justify-center text-white text-3xl font-bold shadow-2xl"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                        boxShadow: `0 20px 40px -10px ${primaryColor}50`
                      }}
                    >
                      <StepIcon icon={step.icon} fallback={step.number || index + 1} primaryColor={primaryColor} size="lg" />
                    </div>

                    {/* Decorative elements */}
                    <div
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full"
                      style={{ backgroundColor: secondaryColor, opacity: 0.6 }}
                    />
                    <div
                      className="absolute -bottom-3 -left-3 w-4 h-4 rounded-full"
                      style={{ backgroundColor: primaryColor, opacity: 0.4 }}
                    />
                  </motion.div>

                  {/* Content */}
                  <motion.div
                    whileHover={{ y: -5 }}
                    className={`flex-1 p-8 rounded-2xl ${isEven ? 'lg:text-left' : 'lg:text-right'} text-center`}
                    style={{
                      backgroundColor: isDark ? 'rgba(31, 41, 55, 0.5)' : `${primaryColor}05`,
                      border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.3)' : `${primaryColor}10`}`,
                      borderRadius: theme?.borderRadius || '1.25rem'
                    }}
                  >
                    <span
                      className="text-xs font-bold uppercase tracking-wider mb-2 block"
                      style={{ color: primaryColor }}
                    >
                      {`${t('step', 'common')} ${step.number || index + 1}`}
                    </span>
                    <h3
                      className="text-2xl font-bold mb-3"
                      style={{
                        fontFamily: 'var(--website-font-heading)',
                        color: isDark ? '#ffffff' : textColor
                      }}
                    >
                      {step.title}
                    </h3>
                    <p
                      className="text-base leading-relaxed"
                      style={{
                        fontFamily: 'var(--website-font-body)',
                        color: isDark ? '#9ca3af' : '#6b7280'
                      }}
                    >
                      {step.description}
                    </p>
                    {step.capability_link && (
                      <motion.a
                        href={step.capability_link}
                        whileHover={{ scale: 1.05 }}
                        className={`inline-flex items-center gap-2 mt-5 px-5 py-2.5 rounded-full text-sm font-semibold ${
                          isEven ? '' : 'lg:flex-row-reverse'
                        }`}
                        style={{
                          backgroundColor: `${primaryColor}15`,
                          color: primaryColor
                        }}
                      >
                        <span>{t('learnMore', 'common')}</span>
                        <ArrowRight className={`w-4 h-4 ${isEven ? '' : 'lg:rotate-180'}`} />
                      </motion.a>
                    )}
                  </motion.div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
