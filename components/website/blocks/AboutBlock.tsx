'use client';

import { motion } from 'framer-motion';
import { Award, Quote, CheckCircle, Star, Heart, Sparkles } from 'lucide-react';
import type { BlockRendererProps } from './types';
import { getBlockTranslation } from '@/lib/i18n/website-block-translations';

interface AboutContent {
  title?: string;
  content: string;
  image?: string;
  layout?: 'side-by-side' | 'text-only' | 'image-above' | 'full-width' | 'overlap';
  credentials?: string[];
  signature?: string;
  years_experience?: number;
  highlight_text?: string;
}

export function AboutBlock({ content, styles, theme, isRTL, className, locale = 'en' }: BlockRendererProps) {
  // Translation helper
  const t = (key: string, section: 'about' | 'common' = 'about') =>
    getBlockTranslation(section, key, locale);

  const {
    title,
    content: aboutContent = '',
    image,
    layout = 'side-by-side',
    credentials = [],
    signature,
    years_experience,
    highlight_text
  } = content as AboutContent;

  // Use translated default if no title provided
  const displayTitle = title || t('title');

  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const secondaryColor = theme?.colors.secondary || '#E8DDD4';
  const backgroundColor = theme?.colors.background || '#ffffff';
  const textColor = theme?.colors.text || '#1a1a1a';
  const isDark = backgroundColor.startsWith('#0') || backgroundColor.startsWith('#1') || backgroundColor === '#000000';

  // Don't render if no about content
  if (!aboutContent) {
    return null;
  }

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`relative overflow-hidden ${styles?.padding || 'py-12 sm:py-16 lg:py-20'} ${className || ''}`}
      style={{ backgroundColor: isDark ? backgroundColor : '#ffffff' }}
    >
      {/* Enhanced decorative background */}
      {!isDark && (
        <>
          {/* Gradient mesh */}
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(at 0% 0%, ${primaryColor}08 0px, transparent 50%),
                radial-gradient(at 100% 0%, ${secondaryColor}15 0px, transparent 50%),
                radial-gradient(at 100% 100%, ${primaryColor}05 0px, transparent 50%),
                linear-gradient(180deg, ${secondaryColor}08 0%, transparent 50%)
              `
            }}
          />

          {/* Floating decorative shapes */}
          <motion.div
            animate={{
              y: [0, -20, 0],
              rotate: [0, 5, 0],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute top-20 right-[5%] w-64 h-64 rounded-full opacity-[0.07] blur-3xl"
            style={{ backgroundColor: primaryColor }}
          />
          <motion.div
            animate={{
              y: [0, 15, 0],
              x: [0, -10, 0],
            }}
            transition={{
              duration: 12,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute bottom-20 left-[10%] w-80 h-80 rounded-full opacity-[0.05] blur-3xl"
            style={{ backgroundColor: secondaryColor }}
          />

          {/* Subtle grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage: `radial-gradient(${primaryColor} 1px, transparent 1px)`,
              backgroundSize: '40px 40px'
            }}
          />
        </>
      )}

      <div className={`relative mx-auto px-4 sm:px-6 lg:px-8 ${styles?.max_width ? `max-w-${styles.max_width}` : 'max-w-7xl'}`}>
        {/* Side by Side Layout - Enhanced */}
        {layout === 'side-by-side' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Image with enhanced frame */}
            <motion.div
              initial={{ opacity: 0, x: isRTL ? 50 : -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
              className={`relative ${isRTL ? 'lg:order-2' : ''}`}
            >
              {image ? (
                <div className="relative group">
                  {/* Animated decorative frame */}
                  <motion.div
                    animate={{ rotate: [3, 5, 3] }}
                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute -inset-4 rounded-3xl opacity-30"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                    }}
                  />
                  <motion.div
                    animate={{ rotate: [-2, -4, -2] }}
                    transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute -inset-4 rounded-3xl opacity-20"
                    style={{
                      background: `linear-gradient(225deg, ${secondaryColor} 0%, ${primaryColor} 100%)`
                    }}
                  />

                  {/* Border frame */}
                  <div
                    className="absolute -inset-1 rounded-2xl opacity-50"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor}40 0%, ${secondaryColor}60 50%, ${primaryColor}40 100%)`,
                      padding: '2px'
                    }}
                  />

                  <img
                    src={image}
                    alt={title}
                    className="relative w-full max-h-[400px] rounded-2xl shadow-xl object-cover aspect-[4/3] transition-transform duration-500 group-hover:scale-[1.01]"
                    style={{
                      borderRadius: theme?.borderRadius || '1rem',
                      boxShadow: `0 15px 30px -8px ${primaryColor}25`
                    }}
                  />

                  {/* Experience badge */}
                  {years_experience && (
                    <motion.div
                      initial={{ scale: 0, rotate: -10 }}
                      whileInView={{ scale: 1, rotate: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.4, type: "spring" }}
                      className="absolute -bottom-4 -right-4 w-20 h-20 rounded-xl flex flex-col items-center justify-center shadow-lg"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                        boxShadow: `0 10px 20px -6px ${primaryColor}40`
                      }}
                    >
                      <span className="text-2xl font-bold text-white">{years_experience}+</span>
                      <span className="text-[10px] font-medium text-white/80 uppercase tracking-wide">
                        {t('years', 'common')}
                      </span>
                    </motion.div>
                  )}
                </div>
              ) : (
                <div
                  className="relative w-full max-h-[400px] aspect-[4/3] rounded-2xl flex flex-col items-center justify-center shadow-lg overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor}20 0%, ${secondaryColor}40 100%)`,
                    borderRadius: theme?.borderRadius || '1rem'
                  }}
                >
                  {/* Decorative elements in placeholder */}
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-20" style={{ backgroundColor: primaryColor, transform: 'translate(30%, -30%)' }} />
                  <div className="absolute bottom-0 left-0 w-40 h-40 rounded-full opacity-15" style={{ backgroundColor: secondaryColor, transform: 'translate(-30%, 30%)' }} />

                  <div
                    className="w-24 h-24 rounded-full flex items-center justify-center mb-4"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor}30 0%, ${secondaryColor}40 100%)`,
                      border: `2px dashed ${primaryColor}40`
                    }}
                  >
                    <span className="text-5xl">👤</span>
                  </div>
                  <span className="text-sm font-medium" style={{ color: primaryColor }}>
                    {t('addPhoto')}
                  </span>
                </div>
              )}
            </motion.div>

            {/* Content - Enhanced */}
            <motion.div
              initial={{ opacity: 0, x: isRTL ? -50 : 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className={isRTL ? 'lg:order-1' : ''}
            >
              {/* Quote icon with gradient */}
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                whileInView={{ scale: 1, rotate: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3, type: "spring" }}
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-8"
                style={{
                  background: `linear-gradient(135deg, ${primaryColor}20 0%, ${secondaryColor}30 100%)`,
                  border: `1px solid ${primaryColor}15`
                }}
              >
                <Quote className="w-7 h-7" style={{ color: primaryColor }} />
              </motion.div>

              {/* Highlight text / tagline */}
              {highlight_text && (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-6"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}20 100%)`,
                    color: primaryColor
                  }}
                >
                  <Sparkles className="w-4 h-4" />
                  {highlight_text}
                </motion.p>
              )}

              {title && (
                <h2
                  className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-4 leading-tight"
                  style={{
                    fontFamily: theme?.fonts.heading,
                    color: isDark ? '#ffffff' : textColor
                  }}
                >
                  {title}
                </h2>
              )}

              <div
                className="prose prose-lg max-w-none leading-relaxed"
                style={{
                  fontFamily: theme?.fonts.body,
                  color: isDark ? '#9ca3af' : '#4b5563'
                }}
                dangerouslySetInnerHTML={{ __html: aboutContent.replace(/\n/g, '<br/>') }}
              />

              {/* Credentials as styled badges */}
              {credentials.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.4 }}
                  className="mt-10 flex flex-wrap gap-3"
                >
                  {credentials.map((credential, index) => (
                    <motion.span
                      key={index}
                      initial={{ opacity: 0, scale: 0.8 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.5 + index * 0.1 }}
                      whileHover={{ scale: 1.05, y: -2 }}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl cursor-default"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor}12 0%, ${secondaryColor}18 100%)`,
                        color: primaryColor,
                        border: `1px solid ${primaryColor}15`,
                        boxShadow: `0 4px 15px -5px ${primaryColor}15`
                      }}
                    >
                      <Award className="w-4 h-4" />
                      {credential}
                    </motion.span>
                  ))}
                </motion.div>
              )}

              {/* Signature with decorative line */}
              {signature && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.6 }}
                  className="mt-10 flex items-center gap-4"
                >
                  <div className="w-12 h-0.5 rounded-full" style={{ backgroundColor: primaryColor }} />
                  <p
                    className="text-2xl italic"
                    style={{
                      fontFamily: 'Georgia, serif',
                      color: isDark ? '#9ca3af' : '#6b7280'
                    }}
                  >
                    {signature}
                  </p>
                </motion.div>
              )}
            </motion.div>
          </div>
        )}

        {/* Text Only Layout - Enhanced */}
        {layout === 'text-only' && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-4xl mx-auto text-center"
          >
            {/* Decorative element */}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              whileInView={{ scale: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2, type: "spring" }}
              className="flex justify-center mb-10"
            >
              <div className="relative">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor}20 0%, ${secondaryColor}30 100%)`,
                    border: `1px solid ${primaryColor}15`
                  }}
                >
                  <Quote className="w-8 h-8" style={{ color: primaryColor }} />
                </div>
                {/* Decorative dots */}
                <div
                  className="absolute -top-2 -right-2 w-4 h-4 rounded-full"
                  style={{ backgroundColor: primaryColor, opacity: 0.3 }}
                />
                <div
                  className="absolute -bottom-1 -left-3 w-3 h-3 rounded-full"
                  style={{ backgroundColor: secondaryColor, opacity: 0.5 }}
                />
              </div>
            </motion.div>

            {/* Highlight text */}
            {highlight_text && (
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold mb-8"
                style={{
                  background: `linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}20 100%)`,
                  color: primaryColor
                }}
              >
                <Star className="w-4 h-4" />
                {highlight_text}
              </motion.p>
            )}

            {title && (
              <h2
                className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-8 leading-tight"
                style={{
                  fontFamily: theme?.fonts.heading,
                  color: isDark ? '#ffffff' : textColor
                }}
              >
                {title}
              </h2>
            )}

            <div
              className="prose prose-xl max-w-none mx-auto leading-relaxed"
              style={{
                fontFamily: theme?.fonts.body,
                color: isDark ? '#9ca3af' : '#4b5563'
              }}
              dangerouslySetInnerHTML={{ __html: aboutContent.replace(/\n/g, '<br/>') }}
            />

            {/* Enhanced credentials */}
            {credentials.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
                className="mt-12 flex flex-wrap justify-center gap-4"
              >
                {credentials.map((credential, index) => (
                  <motion.span
                    key={index}
                    initial={{ opacity: 0, scale: 0.8 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5 + index * 0.1 }}
                    whileHover={{ scale: 1.05, y: -3 }}
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-xl cursor-default"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor}12 0%, ${secondaryColor}18 100%)`,
                      color: primaryColor,
                      border: `1px solid ${primaryColor}15`,
                      boxShadow: `0 4px 20px -5px ${primaryColor}20`
                    }}
                  >
                    <CheckCircle className="w-4 h-4" />
                    {credential}
                  </motion.span>
                ))}
              </motion.div>
            )}

            {/* Signature */}
            {signature && (
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6 }}
                className="mt-12 flex items-center justify-center gap-4"
              >
                <div className="w-16 h-px" style={{ backgroundColor: `${primaryColor}30` }} />
                <p
                  className="text-2xl italic"
                  style={{
                    fontFamily: 'Georgia, serif',
                    color: isDark ? '#9ca3af' : '#6b7280'
                  }}
                >
                  {signature}
                </p>
                <div className="w-16 h-px" style={{ backgroundColor: `${primaryColor}30` }} />
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Image Above Layout */}
        {layout === 'image-above' && (
          <div className="max-w-4xl mx-auto">
            {image && (
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="mb-12"
              >
                <img
                  src={image}
                  alt={title}
                  className="w-full h-72 sm:h-96 object-cover rounded-2xl shadow-2xl"
                  style={{ borderRadius: theme?.borderRadius || '1rem' }}
                />
              </motion.div>
            )}

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1, duration: 0.6 }}
              className="text-center"
            >
              {title && (
                <h2
                  className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6"
                  style={{
                    fontFamily: theme?.fonts.heading,
                    color: isDark ? '#ffffff' : textColor
                  }}
                >
                  {title}
                </h2>
              )}

              <div
                className="prose prose-lg max-w-none leading-relaxed"
                style={{
                  fontFamily: theme?.fonts.body,
                  color: isDark ? '#9ca3af' : '#4b5563'
                }}
                dangerouslySetInnerHTML={{ __html: aboutContent.replace(/\n/g, '<br/>') }}
              />
            </motion.div>
          </div>
        )}

        {/* Full Width Layout */}
        {layout === 'full-width' && (
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            {image && (
              <div className="absolute inset-0 -mx-4 sm:-mx-6 lg:-mx-8">
                <img
                  src={image}
                  alt=""
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor}90 0%, ${secondaryColor}80 100%)`
                  }}
                />
              </div>
            )}

            <div className={`relative max-w-3xl mx-auto text-center py-20 ${image ? 'text-white' : ''}`}>
              {title && (
                <h2
                  className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-8"
                  style={{
                    fontFamily: theme?.fonts.heading,
                    color: image ? '#ffffff' : (isDark ? '#ffffff' : textColor)
                  }}
                >
                  {title}
                </h2>
              )}

              <div
                className="prose prose-xl max-w-none"
                style={{
                  fontFamily: theme?.fonts.body,
                  color: image ? 'rgba(255,255,255,0.9)' : (isDark ? '#9ca3af' : '#4b5563')
                }}
                dangerouslySetInnerHTML={{ __html: aboutContent.replace(/\n/g, '<br/>') }}
              />

              {signature && (
                <p
                  className="mt-10 text-2xl italic"
                  style={{
                    fontFamily: 'cursive',
                    color: image ? 'rgba(255,255,255,0.8)' : (isDark ? '#9ca3af' : '#6b7280')
                  }}
                >
                  — {signature}
                </p>
              )}
            </div>
          </motion.div>
        )}

        {/* Overlap Layout - NEW: Image overlapping a content card */}
        {layout === 'overlap' && (
          <div className="relative">
            {/* Background content card */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="relative ml-0 lg:ml-[200px] p-8 sm:p-12 lg:p-16 rounded-3xl"
              style={{
                background: isDark
                  ? 'rgba(31, 41, 55, 0.8)'
                  : `linear-gradient(135deg, ${secondaryColor}15 0%, ${primaryColor}08 100%)`,
                backdropFilter: 'blur(20px)',
                border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.3)' : `${primaryColor}15`}`,
                boxShadow: `0 25px 50px -12px ${primaryColor}15`
              }}
            >
              {/* Decorative elements */}
              <div
                className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 blur-2xl"
                style={{ backgroundColor: primaryColor }}
              />
              <div
                className="absolute bottom-0 left-1/2 w-40 h-40 rounded-full opacity-5 blur-3xl"
                style={{ backgroundColor: secondaryColor }}
              />

              <div className={`relative ${isRTL ? 'lg:pr-[180px]' : 'lg:pl-[180px]'}`}>
                {/* Quote with decorative styling */}
                <motion.div
                  initial={{ scale: 0 }}
                  whileInView={{ scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3, type: "spring" }}
                  className="absolute top-0 right-0 opacity-10"
                >
                  <Quote className="w-24 h-24" style={{ color: primaryColor }} />
                </motion.div>

                {/* Highlight badge */}
                {highlight_text && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-6"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                      color: '#ffffff'
                    }}
                  >
                    <Heart className="w-4 h-4" />
                    {highlight_text}
                  </motion.div>
                )}

                {title && (
                  <h2
                    className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 leading-tight"
                    style={{
                      fontFamily: theme?.fonts.heading,
                      color: isDark ? '#ffffff' : textColor
                    }}
                  >
                    {title}
                  </h2>
                )}

                <div
                  className="prose prose-lg max-w-none leading-relaxed"
                  style={{
                    fontFamily: theme?.fonts.body,
                    color: isDark ? '#9ca3af' : '#4b5563'
                  }}
                  dangerouslySetInnerHTML={{ __html: aboutContent.replace(/\n/g, '<br/>') }}
                />

                {/* Credentials as inline badges */}
                {credentials.length > 0 && (
                  <div className="mt-8 flex flex-wrap gap-3">
                    {credentials.map((credential, index) => (
                      <motion.span
                        key={index}
                        initial={{ opacity: 0, y: 10 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.4 + index * 0.1 }}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg"
                        style={{
                          backgroundColor: `${primaryColor}15`,
                          color: primaryColor
                        }}
                      >
                        <Star className="w-3.5 h-3.5" />
                        {credential}
                      </motion.span>
                    ))}
                  </div>
                )}

                {/* Signature */}
                {signature && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5 }}
                    className="mt-8 pt-6 border-t"
                    style={{ borderColor: `${primaryColor}15` }}
                  >
                    <p
                      className="text-xl italic"
                      style={{
                        fontFamily: 'Georgia, serif',
                        color: isDark ? '#9ca3af' : '#6b7280'
                      }}
                    >
                      — {signature}
                    </p>
                  </motion.div>
                )}
              </div>
            </motion.div>

            {/* Overlapping image */}
            <motion.div
              initial={{ opacity: 0, x: isRTL ? 50 : -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className={`hidden lg:block absolute top-1/2 -translate-y-1/2 ${isRTL ? 'right-0' : 'left-0'} w-[350px] z-10`}
            >
              {image ? (
                <div className="relative group">
                  {/* Gradient border */}
                  <div
                    className="absolute -inset-2 rounded-2xl opacity-60"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                    }}
                  />
                  <img
                    src={image}
                    alt={title}
                    className="relative w-full aspect-[3/4] object-cover rounded-xl shadow-2xl transition-transform duration-500 group-hover:scale-[1.02]"
                    style={{
                      boxShadow: `0 30px 60px -15px ${primaryColor}40`
                    }}
                  />

                  {/* Years badge */}
                  {years_experience && (
                    <motion.div
                      initial={{ scale: 0 }}
                      whileInView={{ scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.6, type: "spring" }}
                      className="absolute -bottom-4 -right-4 w-24 h-24 rounded-xl flex flex-col items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                        boxShadow: `0 10px 30px -5px ${primaryColor}50`
                      }}
                    >
                      <span className="text-2xl font-bold text-white">{years_experience}+</span>
                      <span className="text-xs text-white/80">{t('years', 'common')}</span>
                    </motion.div>
                  )}
                </div>
              ) : (
                <div
                  className="w-full aspect-[3/4] rounded-xl flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor}20 0%, ${secondaryColor}30 100%)`,
                    border: `2px dashed ${primaryColor}30`
                  }}
                >
                  <span className="text-6xl">👤</span>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </div>
    </section>
  );
}
