'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Star, Quote, Sparkles } from 'lucide-react';
import type { BlockRendererProps, TestimonialItem } from './types';
import { getBlockTranslation } from '@/lib/i18n/website-block-translations';

interface TestimonialsContent {
  title?: string;
  subtitle?: string;
  testimonials: TestimonialItem[];
  layout?: 'carousel' | 'grid' | 'single' | 'masonry' | 'spotlight';
}

export function TestimonialsBlock({ content, styles, theme, isRTL, className, locale = 'en' }: BlockRendererProps) {
  const t = (key: string, section: 'testimonials' | 'common' = 'testimonials') =>
    getBlockTranslation(section, key, locale);

  const {
    title = t('whatClientsSay'),
    subtitle,
    testimonials = [],
    layout = 'carousel'
  } = content as TestimonialsContent;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const secondaryColor = theme?.colors.secondary || '#E8DDD4';
  const backgroundColor = theme?.colors.background || '#ffffff';
  const textColor = theme?.colors.text || '#1a1a1a';
  const isDark = backgroundColor.startsWith('#0') || backgroundColor.startsWith('#1') || backgroundColor === '#000000';
  const columns = styles?.columns || 3;

  // Auto-play carousel
  useEffect(() => {
    if (layout !== 'carousel' || !isAutoPlaying || testimonials.length <= 1) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % testimonials.length);
    }, 5000);

    return () => clearInterval(timer);
  }, [layout, isAutoPlaying, testimonials.length]);

  const next = () => {
    setIsAutoPlaying(false);
    setCurrentIndex((prev) => (prev + 1) % testimonials.length);
  };

  const prev = () => {
    setIsAutoPlaying(false);
    setCurrentIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  const renderStars = (rating: number = 5) => (
    <div className="flex gap-1">
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.1 }}
        >
          <Star
            className="w-5 h-5"
            fill={i < rating ? '#FBBF24' : 'none'}
            stroke={i < rating ? '#FBBF24' : '#D1D5DB'}
          />
        </motion.div>
      ))}
    </div>
  );

  // Card style helper
  const getCardStyle = () => ({
    backgroundColor: isDark ? 'rgba(31, 41, 55, 0.6)' : 'rgba(255, 255, 255, 0.9)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderColor: isDark ? 'rgba(75, 85, 99, 0.3)' : 'rgba(229, 231, 235, 0.8)',
    borderRadius: theme?.borderRadius || '1.5rem'
  });

  const TestimonialCard = ({ testimonial, index, featured = false }: { testimonial: TestimonialItem; index: number; featured?: boolean }) => (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1 }}
      whileHover={{ y: -5, transition: { duration: 0.3 } }}
      className={`group relative overflow-hidden border ${featured ? 'p-10' : 'p-8'}`}
      style={getCardStyle()}
    >
      {/* Decorative gradient corner */}
      <div
        className="absolute top-0 right-0 w-32 h-32 opacity-10 group-hover:opacity-20 transition-opacity"
        style={{
          background: `radial-gradient(circle at top right, ${primaryColor} 0%, transparent 70%)`
        }}
      />

      {/* Large decorative quote */}
      <div
        className="absolute top-6 right-6 opacity-10 group-hover:opacity-20 transition-opacity"
        style={{ color: primaryColor }}
      >
        <Quote className={featured ? 'w-20 h-20' : 'w-16 h-16'} />
      </div>

      {/* Content */}
      <div className="relative">
        {testimonial.rating && (
          <div className="mb-5">
            {renderStars(testimonial.rating)}
          </div>
        )}

        <p
          className={`leading-relaxed mb-8 ${featured ? 'text-xl lg:text-2xl' : 'text-base lg:text-lg'}`}
          style={{
            fontFamily: theme?.fonts.body,
            color: isDark ? '#e5e7eb' : '#374151'
          }}
        >
          &ldquo;{testimonial.quote}&rdquo;
        </p>

        {/* Author */}
        <div className="flex items-center gap-4">
          {testimonial.image ? (
            <div
              className="relative"
              style={{
                padding: '3px',
                background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                borderRadius: '50%'
              }}
            >
              <img
                src={testimonial.image}
                alt={testimonial.author}
                className="w-14 h-14 rounded-full object-cover border-2"
                style={{ borderColor: isDark ? '#1f2937' : '#ffffff' }}
              />
            </div>
          ) : (
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold"
              style={{
                background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`
              }}
            >
              {testimonial.author.charAt(0)}
            </div>
          )}
          <div>
            <p
              className="font-bold text-lg"
              style={{
                fontFamily: theme?.fonts.heading,
                color: isDark ? '#ffffff' : textColor
              }}
            >
              {testimonial.author}
            </p>
            {(testimonial.role || testimonial.company) && (
              <p
                className="text-sm"
                style={{ color: isDark ? '#9ca3af' : '#6b7280' }}
              >
                {testimonial.role}{testimonial.role && testimonial.company ? ` ${t('at', 'common')} ` : ''}{testimonial.company}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom accent line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`
        }}
      />
    </motion.div>
  );

  return (
    <section
      id="testimonials"
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`relative overflow-hidden ${styles?.padding || 'py-24 sm:py-32'} ${className || ''}`}
      style={{
        backgroundColor: isDark ? backgroundColor : '#f8fafc'
      }}
    >
      {/* Decorative background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Gradient orbs */}
        <div
          className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full opacity-20 blur-3xl"
          style={{ backgroundColor: primaryColor }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: secondaryColor }}
        />

        {/* Dot pattern */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `radial-gradient(${primaryColor} 1.5px, transparent 1.5px)`,
            backgroundSize: '30px 30px'
          }}
        />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        {(title || subtitle) && (
          <div className="text-center mb-16 sm:mb-20">
            {/* Badge */}
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
              <span>{t('clientStories')}</span>
            </motion.div>

            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="text-3xl sm:text-4xl lg:text-5xl font-bold"
                style={{
                  fontFamily: theme?.fonts.heading,
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
                  fontFamily: theme?.fonts.body,
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

        {/* Carousel Layout - Enhanced */}
        {layout === 'carousel' && testimonials.length > 0 && (
          <div className="relative max-w-4xl mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, x: isRTL ? -100 : 100 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: isRTL ? 100 : -100 }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                className="relative overflow-hidden border p-10 sm:p-14"
                style={getCardStyle()}
              >
                {/* Large decorative quote */}
                <div
                  className="absolute -top-4 -left-4 opacity-10"
                  style={{ color: primaryColor }}
                >
                  <Quote className="w-32 h-32" />
                </div>

                {/* Background gradient */}
                <div
                  className="absolute inset-0 opacity-5"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                  }}
                />

                <div className="relative text-center">
                  {testimonials[currentIndex].rating && (
                    <div className="flex justify-center mb-6">
                      {renderStars(testimonials[currentIndex].rating)}
                    </div>
                  )}

                  <p
                    className="text-xl sm:text-2xl lg:text-3xl leading-relaxed mb-10"
                    style={{
                      fontFamily: theme?.fonts.body,
                      color: isDark ? '#e5e7eb' : '#374151'
                    }}
                  >
                    &ldquo;{testimonials[currentIndex].quote}&rdquo;
                  </p>

                  {/* Author with gradient border avatar */}
                  <div className="flex items-center justify-center gap-5">
                    {testimonials[currentIndex].image ? (
                      <div
                        className="relative"
                        style={{
                          padding: '4px',
                          background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                          borderRadius: '50%'
                        }}
                      >
                        <img
                          src={testimonials[currentIndex].image}
                          alt={testimonials[currentIndex].author}
                          className="w-16 h-16 rounded-full object-cover border-3"
                          style={{ borderColor: isDark ? '#1f2937' : '#ffffff' }}
                        />
                      </div>
                    ) : (
                      <div
                        className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`
                        }}
                      >
                        {testimonials[currentIndex].author.charAt(0)}
                      </div>
                    )}
                    <div className={`text-${isRTL ? 'right' : 'left'}`}>
                      <p
                        className="font-bold text-xl"
                        style={{
                          fontFamily: theme?.fonts.heading,
                          color: isDark ? '#ffffff' : textColor
                        }}
                      >
                        {testimonials[currentIndex].author}
                      </p>
                      {(testimonials[currentIndex].role || testimonials[currentIndex].company) && (
                        <p style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>
                          {testimonials[currentIndex].role}
                          {testimonials[currentIndex].role && testimonials[currentIndex].company ? ` ${t('at', 'common')} ` : ''}
                          {testimonials[currentIndex].company}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            {testimonials.length > 1 && (
              <>
                <button
                  onClick={prev}
                  className="absolute start-0 top-1/2 -translate-y-1/2 -translate-x-4 sm:-translate-x-16 w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110"
                  style={{
                    backgroundColor: isDark ? 'rgba(31, 41, 55, 0.9)' : 'rgba(255, 255, 255, 0.95)',
                    boxShadow: `0 10px 40px ${primaryColor}20`,
                    border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.3)' : 'rgba(229, 231, 235, 0.8)'}`
                  }}
                  aria-label="Previous testimonial"
                >
                  {isRTL ? <ChevronRight className="w-6 h-6" style={{ color: primaryColor }} /> : <ChevronLeft className="w-6 h-6" style={{ color: primaryColor }} />}
                </button>
                <button
                  onClick={next}
                  className="absolute end-0 top-1/2 -translate-y-1/2 translate-x-4 sm:translate-x-16 w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110"
                  style={{
                    backgroundColor: isDark ? 'rgba(31, 41, 55, 0.9)' : 'rgba(255, 255, 255, 0.95)',
                    boxShadow: `0 10px 40px ${primaryColor}20`,
                    border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.3)' : 'rgba(229, 231, 235, 0.8)'}`
                  }}
                  aria-label="Next testimonial"
                >
                  {isRTL ? <ChevronLeft className="w-6 h-6" style={{ color: primaryColor }} /> : <ChevronRight className="w-6 h-6" style={{ color: primaryColor }} />}
                </button>

                {/* Progress dots */}
                <div className="flex justify-center gap-3 mt-10">
                  {testimonials.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setIsAutoPlaying(false);
                        setCurrentIndex(index);
                      }}
                      className="relative h-2 rounded-full transition-all duration-300 overflow-hidden"
                      style={{
                        width: index === currentIndex ? '2rem' : '0.5rem',
                        backgroundColor: index === currentIndex ? 'transparent' : (isDark ? '#374151' : '#d1d5db')
                      }}
                      aria-label={`Go to testimonial ${index + 1}`}
                    >
                      {index === currentIndex && (
                        <motion.div
                          layoutId="testimonial-dot"
                          className="absolute inset-0 rounded-full"
                          style={{
                            background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`
                          }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Grid Layout */}
        {layout === 'grid' && (
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${columns} gap-6 sm:gap-8`}>
            {testimonials.map((testimonial, index) => (
              <TestimonialCard key={index} testimonial={testimonial} index={index} />
            ))}
          </div>
        )}

        {/* Single Featured Layout */}
        {layout === 'single' && testimonials.length > 0 && (
          <div className="max-w-4xl mx-auto">
            <TestimonialCard testimonial={testimonials[0]} index={0} featured />
          </div>
        )}

        {/* Masonry Layout */}
        {layout === 'masonry' && (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-6 space-y-6">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="break-inside-avoid mb-6">
                <TestimonialCard testimonial={testimonial} index={index} />
              </div>
            ))}
          </div>
        )}

        {/* Spotlight Layout - New premium layout */}
        {layout === 'spotlight' && testimonials.length > 0 && (
          <div className="space-y-8">
            {/* Featured testimonial */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="relative overflow-hidden border p-12 lg:p-16"
              style={getCardStyle()}
            >
              {/* Large quote decoration */}
              <div
                className="absolute -top-10 -left-10 opacity-5"
                style={{ color: primaryColor }}
              >
                <Quote className="w-48 h-48" />
              </div>

              {/* Background gradient */}
              <div
                className="absolute inset-0 opacity-5"
                style={{
                  background: `linear-gradient(135deg, ${primaryColor} 0%, transparent 50%, ${secondaryColor} 100%)`
                }}
              />

              <div className="relative grid lg:grid-cols-3 gap-10 items-center">
                {/* Author - left side */}
                <div className="lg:col-span-1 text-center lg:text-left">
                  {testimonials[0].image ? (
                    <div
                      className="inline-block mb-6"
                      style={{
                        padding: '5px',
                        background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                        borderRadius: '50%'
                      }}
                    >
                      <img
                        src={testimonials[0].image}
                        alt={testimonials[0].author}
                        className="w-24 h-24 lg:w-32 lg:h-32 rounded-full object-cover border-4"
                        style={{ borderColor: isDark ? '#1f2937' : '#ffffff' }}
                      />
                    </div>
                  ) : (
                    <div
                      className="inline-flex w-24 h-24 lg:w-32 lg:h-32 rounded-full items-center justify-center text-white text-4xl font-bold mb-6"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`
                      }}
                    >
                      {testimonials[0].author.charAt(0)}
                    </div>
                  )}
                  <h3
                    className="text-2xl font-bold mb-2"
                    style={{
                      fontFamily: theme?.fonts.heading,
                      color: isDark ? '#ffffff' : textColor
                    }}
                  >
                    {testimonials[0].author}
                  </h3>
                  {(testimonials[0].role || testimonials[0].company) && (
                    <p style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>
                      {testimonials[0].role}
                      {testimonials[0].role && testimonials[0].company ? ` ${t('at', 'common')} ` : ''}
                      {testimonials[0].company}
                    </p>
                  )}
                  {testimonials[0].rating && (
                    <div className="flex justify-center lg:justify-start mt-4">
                      {renderStars(testimonials[0].rating)}
                    </div>
                  )}
                </div>

                {/* Quote - right side */}
                <div className="lg:col-span-2">
                  <p
                    className="text-2xl lg:text-3xl leading-relaxed"
                    style={{
                      fontFamily: theme?.fonts.body,
                      color: isDark ? '#e5e7eb' : '#374151'
                    }}
                  >
                    &ldquo;{testimonials[0].quote}&rdquo;
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Other testimonials */}
            {testimonials.length > 1 && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {testimonials.slice(1).map((testimonial, index) => (
                  <TestimonialCard key={index} testimonial={testimonial} index={index} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
