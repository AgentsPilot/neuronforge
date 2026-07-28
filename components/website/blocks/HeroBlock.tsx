'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, Star, Users, Award, Play } from 'lucide-react';
import type { BlockRendererProps } from './types';
import { getBlockTranslation } from '@/lib/i18n/website-block-translations';

interface HeroContent {
  headline: string;
  subheadline?: string;
  cta_text?: string;
  cta_link?: string;
  secondary_cta_text?: string;
  secondary_cta_link?: string;
  background_type?: 'gradient' | 'solid' | 'image';
  background_value?: string;
  background_image?: string;
  badge?: string;
  trust_indicators?: {
    rating?: number;
    reviews_count?: number;
    clients_count?: string;
    awards?: string[];
  };
  gradient_text?: boolean;
  video_url?: string;
}

// Generate a gradient from theme colors
function generateGradient(primary: string, secondary: string, type: 'subtle' | 'bold' | 'mesh' = 'subtle'): string {
  if (type === 'bold') {
    return `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`;
  }
  if (type === 'mesh') {
    return `
      radial-gradient(at 40% 20%, ${primary}30 0px, transparent 50%),
      radial-gradient(at 80% 0%, ${secondary}40 0px, transparent 50%),
      radial-gradient(at 0% 50%, ${primary}20 0px, transparent 50%),
      radial-gradient(at 80% 50%, ${secondary}30 0px, transparent 50%),
      radial-gradient(at 0% 100%, ${primary}25 0px, transparent 50%),
      radial-gradient(at 80% 100%, ${secondary}20 0px, transparent 50%),
      linear-gradient(180deg, #ffffff 0%, #fafafa 100%)
    `;
  }
  // Subtle gradient with white/light colors
  return `linear-gradient(135deg, #ffffff 0%, ${secondary}30 50%, ${primary}15 100%)`;
}

export function HeroBlock({ content, styles, theme, isRTL, className, locale = 'en' }: BlockRendererProps) {
  const t = (key: string, section: 'hero' | 'common' = 'hero') =>
    getBlockTranslation(section, key, locale);
  const {
    headline,
    subheadline,
    cta_text,
    cta_link = '#contact',
    secondary_cta_text,
    secondary_cta_link,
    background_type = 'gradient',
    background_value,
    background_image,
    badge,
    trust_indicators,
    gradient_text = false,
    video_url
  } = content as HeroContent;

  const alignment = styles?.alignment || 'center';
  const alignmentClasses = {
    left: 'text-start items-start',
    center: 'text-center items-center',
    right: 'text-end items-end'
  };

  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const secondaryColor = theme?.colors.secondary || '#E8DDD4';
  const backgroundColor = theme?.colors.background || '#ffffff';
  const textColor = theme?.colors.text || '#1a1a1a';

  // Determine if this is a dark theme
  const isDark = backgroundColor.startsWith('#0') || backgroundColor.startsWith('#1') || backgroundColor === '#000000';

  const getBackgroundStyle = () => {
    if (background_type === 'image' && background_image) {
      return {
        backgroundImage: `url(${background_image})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      };
    }
    if (background_type === 'solid') {
      return { backgroundColor };
    }
    // Default: beautiful mesh gradient
    if (isDark) {
      return {
        background: `
          radial-gradient(at 40% 20%, ${primaryColor}40 0px, transparent 50%),
          radial-gradient(at 80% 0%, ${secondaryColor}30 0px, transparent 50%),
          radial-gradient(at 0% 80%, ${primaryColor}30 0px, transparent 50%),
          linear-gradient(180deg, ${backgroundColor} 0%, ${backgroundColor} 100%)
        `
      };
    }
    return {
      background: generateGradient(primaryColor, secondaryColor, 'mesh')
    };
  };

  // Gradient text style
  const gradientTextStyle = gradient_text ? {
    background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 50%, ${primaryColor} 100%)`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text'
  } : {};

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`relative overflow-hidden ${styles?.padding || 'py-24 sm:py-32 lg:py-40'} ${background_value || ''} ${className || ''}`}
      style={getBackgroundStyle()}
    >
      {/* Decorative elements */}
      {background_type !== 'image' && (
        <>
          {/* Animated floating shapes */}
          <motion.div
            animate={{
              y: [0, -20, 0],
              scale: [1, 1.05, 1],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute top-20 right-[10%] w-72 h-72 rounded-full opacity-30 blur-3xl"
            style={{ backgroundColor: primaryColor }}
          />
          <motion.div
            animate={{
              y: [0, 20, 0],
              scale: [1, 0.95, 1],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute bottom-20 left-[5%] w-96 h-96 rounded-full opacity-25 blur-3xl"
            style={{ backgroundColor: secondaryColor }}
          />
          <motion.div
            animate={{
              x: [0, 10, 0],
              y: [0, -10, 0],
            }}
            transition={{
              duration: 12,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10 blur-3xl"
            style={{ backgroundColor: primaryColor }}
          />

          {/* Decorative geometric shapes */}
          <div className="absolute top-32 left-[15%] hidden lg:block">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="w-16 h-16 rounded-xl opacity-20"
              style={{
                backgroundColor: primaryColor,
                transform: 'rotate(45deg)'
              }}
            />
          </div>
          <div className="absolute bottom-32 right-[15%] hidden lg:block">
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
              className="w-12 h-12 rounded-full opacity-15 border-4"
              style={{ borderColor: secondaryColor }}
            />
          </div>

          {/* Subtle grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: `radial-gradient(${primaryColor} 1px, transparent 1px)`,
              backgroundSize: '32px 32px'
            }}
          />

          {/* Gradient orb glow */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] opacity-40"
            style={{
              background: `radial-gradient(ellipse at center top, ${primaryColor}20 0%, transparent 70%)`
            }}
          />
        </>
      )}

      {/* Overlay for image backgrounds */}
      {background_type === 'image' && (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.6) 100%)`
          }}
        />
      )}

      <div className={`relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col ${alignmentClasses[alignment]}`}>
        {/* Badge */}
        {badge && (
          <motion.span
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold mb-8 shadow-lg backdrop-blur-sm"
            style={{
              backgroundColor: isDark ? `${primaryColor}30` : `${primaryColor}12`,
              color: isDark ? '#ffffff' : primaryColor,
              border: `1px solid ${primaryColor}25`,
              boxShadow: `0 4px 24px ${primaryColor}15`
            }}
          >
            <motion.span
              animate={{ rotate: [0, 15, -15, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Sparkles className="w-4 h-4" />
            </motion.span>
            {badge}
          </motion.span>
        )}

        {/* Headline with optional gradient text */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight leading-[1.1]"
          style={{
            fontFamily: theme?.fonts.heading,
            color: background_type === 'image' ? '#ffffff' : textColor,
            ...gradientTextStyle
          }}
        >
          {headline}
        </motion.h1>

        {subheadline && (
          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-6 sm:mt-8 text-lg sm:text-xl lg:text-2xl max-w-3xl leading-relaxed"
            style={{
              fontFamily: theme?.fonts.body,
              color: background_type === 'image' ? '#e5e7eb' : (isDark ? '#9ca3af' : '#4b5563')
            }}
          >
            {subheadline}
          </motion.p>
        )}

        {/* CTA Buttons */}
        {(cta_text || secondary_cta_text) && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-10 sm:mt-12 flex flex-col sm:flex-row gap-4"
          >
            {cta_text && (
              <a
                href={cta_link}
                className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-white rounded-xl overflow-hidden transition-all duration-300"
                style={{
                  borderRadius: theme?.borderRadius || '0.75rem'
                }}
              >
                {/* Button gradient background */}
                <span
                  className="absolute inset-0 transition-opacity duration-300"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                  }}
                />
                {/* Shimmer effect */}
                <span
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)`,
                    transform: 'translateX(-100%)',
                    animation: 'shimmer 2s infinite'
                  }}
                />
                {/* Shadow glow */}
                <span
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-xl"
                  style={{ backgroundColor: primaryColor }}
                />
                <span className="relative flex items-center gap-2">
                  {cta_text}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
              </a>
            )}
            {secondary_cta_text && (
              <a
                href={secondary_cta_link || '#services'}
                className="group inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold rounded-xl backdrop-blur-sm transition-all duration-300 hover:scale-[1.02]"
                style={{
                  border: `2px solid ${background_type === 'image' ? 'rgba(255,255,255,0.3)' : `${primaryColor}30`}`,
                  color: background_type === 'image' ? 'white' : primaryColor,
                  backgroundColor: background_type === 'image' ? 'rgba(255,255,255,0.1)' : `${primaryColor}05`,
                  borderRadius: theme?.borderRadius || '0.75rem'
                }}
              >
                {video_url && <Play className="w-5 h-5" />}
                {secondary_cta_text}
              </a>
            )}
          </motion.div>
        )}

        {/* Trust Indicators */}
        {trust_indicators && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-12 sm:mt-16 flex flex-wrap items-center justify-center gap-6 sm:gap-10"
          >
            {/* Rating */}
            {trust_indicators.rating && (
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className="w-5 h-5"
                      fill={i < Math.floor(trust_indicators.rating || 0) ? '#FBBF24' : 'none'}
                      stroke={i < Math.floor(trust_indicators.rating || 0) ? '#FBBF24' : '#D1D5DB'}
                    />
                  ))}
                </div>
                <span
                  className="text-sm font-medium"
                  style={{ color: isDark ? '#9ca3af' : '#6b7280' }}
                >
                  {trust_indicators.rating.toFixed(1)}
                  {trust_indicators.reviews_count && ` (${trust_indicators.reviews_count}+ ${t('reviews', 'common')})`}
                </span>
              </div>
            )}

            {/* Clients count */}
            {trust_indicators.clients_count && (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <Users className="w-4 h-4" style={{ color: primaryColor }} />
                </div>
                <span
                  className="text-sm font-medium"
                  style={{ color: isDark ? '#9ca3af' : '#6b7280' }}
                >
                  {trust_indicators.clients_count} {t('clientsServed', 'common')}
                </span>
              </div>
            )}

            {/* Awards */}
            {trust_indicators.awards && trust_indicators.awards.length > 0 && (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <Award className="w-4 h-4" style={{ color: primaryColor }} />
                </div>
                <span
                  className="text-sm font-medium"
                  style={{ color: isDark ? '#9ca3af' : '#6b7280' }}
                >
                  {trust_indicators.awards[0]}
                </span>
              </div>
            )}
          </motion.div>
        )}

        {/* Decorative divider */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="mt-16 w-24 h-1 rounded-full mx-auto hidden sm:block"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${primaryColor}50 50%, transparent 100%)`
          }}
        />
      </div>

      {/* Add shimmer keyframes */}
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </section>
  );
}
