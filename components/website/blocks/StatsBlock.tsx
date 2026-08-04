'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  TrendingUp, Users, Star, Award, Clock, CheckCircle,
  Target, Zap, Heart, ThumbsUp, Calendar, DollarSign,
  Percent, BarChart2, Activity, Globe
} from 'lucide-react';
import type { BlockRendererProps, StatItem } from './types';

interface StatsContent {
  title?: string;
  subtitle?: string;
  stats: StatItem[];
  layout?: 'horizontal' | 'grid' | 'cards' | 'gradient';
  show_icons?: boolean;
  animate_numbers?: boolean;
}

// Icon mapping for stats
const iconMap: Record<string, React.ElementType> = {
  trending: TrendingUp,
  users: Users,
  star: Star,
  award: Award,
  clock: Clock,
  check: CheckCircle,
  target: Target,
  zap: Zap,
  heart: Heart,
  thumbs: ThumbsUp,
  calendar: Calendar,
  dollar: DollarSign,
  percent: Percent,
  chart: BarChart2,
  activity: Activity,
  globe: Globe
};

// Helper to extract numeric value from stat string
function extractNumber(value: string): { number: number; prefix: string; suffix: string } {
  const match = value.match(/^([^\d]*)(\d+(?:[.,]\d+)?)(.*)$/);
  if (match) {
    return {
      prefix: match[1] || '',
      number: parseFloat(match[2].replace(',', '')),
      suffix: match[3] || ''
    };
  }
  return { prefix: '', number: 0, suffix: value };
}

// Animated counter component
function AnimatedNumber({
  value,
  duration = 2000,
  isInView
}: {
  value: string;
  duration?: number;
  isInView: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const { number, prefix, suffix } = extractNumber(value);

  useEffect(() => {
    if (!isInView || number === 0) {
      setDisplayValue(value);
      return;
    }

    let startTime: number;
    let animationFrame: number;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const currentNumber = Math.floor(number * easeOut);

      // Format with commas if original had them
      const formatted = value.includes(',')
        ? currentNumber.toLocaleString()
        : currentNumber.toString();

      setDisplayValue(`${prefix}${formatted}${suffix}`);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        setDisplayValue(value);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [isInView, value, number, prefix, suffix, duration]);

  return <>{displayValue}</>;
}

export function StatsBlock({ content, styles, theme, isRTL, className }: BlockRendererProps) {
  const {
    title,
    subtitle,
    stats = [],
    layout = 'horizontal',
    show_icons = true,
    animate_numbers = true
  } = content as StatsContent;

  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const secondaryColor = theme?.colors.secondary || '#E8DDD4';
  const backgroundColor = theme?.colors.background || '#ffffff';
  const columns = styles?.columns || stats.length;

  // Determine if dark theme
  const isDark = backgroundColor.startsWith('#0') || backgroundColor.startsWith('#1') || backgroundColor === '#000000';

  // Get icon for stat based on label
  const getStatIcon = (label: string, index: number) => {
    const lowerLabel = label.toLowerCase();
    if (lowerLabel.includes('client') || lowerLabel.includes('customer') || lowerLabel.includes('user')) return Users;
    if (lowerLabel.includes('rating') || lowerLabel.includes('star') || lowerLabel.includes('review')) return Star;
    if (lowerLabel.includes('award') || lowerLabel.includes('winner')) return Award;
    if (lowerLabel.includes('year') || lowerLabel.includes('experience')) return Clock;
    if (lowerLabel.includes('project') || lowerLabel.includes('complete')) return CheckCircle;
    if (lowerLabel.includes('goal') || lowerLabel.includes('target')) return Target;
    if (lowerLabel.includes('fast') || lowerLabel.includes('quick') || lowerLabel.includes('speed')) return Zap;
    if (lowerLabel.includes('satisfaction') || lowerLabel.includes('happy')) return Heart;
    if (lowerLabel.includes('recommend')) return ThumbsUp;
    if (lowerLabel.includes('appointment') || lowerLabel.includes('booking')) return Calendar;
    if (lowerLabel.includes('save') || lowerLabel.includes('revenue') || lowerLabel.includes('price')) return DollarSign;
    if (lowerLabel.includes('percent') || lowerLabel.includes('rate') || lowerLabel.includes('success')) return Percent;
    if (lowerLabel.includes('growth') || lowerLabel.includes('increase')) return TrendingUp;
    if (lowerLabel.includes('country') || lowerLabel.includes('global') || lowerLabel.includes('location')) return Globe;

    // Default icons based on index
    const defaults = [TrendingUp, Users, Star, Award, CheckCircle, Target];
    return defaults[index % defaults.length];
  };

  // Check if using default gradient background
  const hasCustomBackground = styles?.background && !styles.background.includes('from-blue-600');
  const useGradientBg = !hasCustomBackground;

  return (
    <section
      ref={ref}
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`relative overflow-hidden ${styles?.padding || 'py-16 sm:py-24'} ${className || ''}`}
      style={useGradientBg ? {
        background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
      } : undefined}
    >
      {/* Decorative background elements */}
      {useGradientBg && (
        <>
          {/* Floating shapes */}
          <motion.div
            animate={{
              y: [0, -15, 0],
              rotate: [0, 5, 0],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute top-10 right-[10%] w-40 h-40 rounded-full opacity-20 blur-2xl"
            style={{ backgroundColor: '#ffffff' }}
          />
          <motion.div
            animate={{
              y: [0, 15, 0],
              rotate: [0, -5, 0],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute bottom-10 left-[5%] w-60 h-60 rounded-full opacity-15 blur-3xl"
            style={{ backgroundColor: '#ffffff' }}
          />

          {/* Subtle pattern overlay */}
          <div
            className="absolute inset-0 opacity-5"
            style={{
              backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 1px)',
              backgroundSize: '24px 24px'
            }}
          />
        </>
      )}

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || subtitle) && (
          <div className="text-center mb-16">
            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className={`text-3xl sm:text-4xl lg:text-5xl font-bold ${useGradientBg ? 'text-white' : (styles?.text_color || 'text-gray-900')}`}
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
                className={`mt-4 text-lg max-w-2xl mx-auto ${useGradientBg ? 'text-white/80' : 'text-gray-600'}`}
                style={{ fontFamily: 'var(--website-font-body)' }}
              >
                {subtitle}
              </motion.p>
            )}
          </div>
        )}

        {/* Horizontal Layout - Enhanced */}
        {layout === 'horizontal' && (
          <div className={`grid grid-cols-2 lg:grid-cols-${columns} gap-8 lg:gap-12`}>
            {stats.map((stat, index) => {
              const IconComponent = getStatIcon(stat.label, index);
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1, duration: 0.5 }}
                  whileHover={{ scale: 1.05, y: -5 }}
                  className="relative text-center group"
                >
                  {/* Divider line (except last item) */}
                  {index < stats.length - 1 && (
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-16 bg-white/20 hidden lg:block" />
                  )}

                  {/* Icon */}
                  {show_icons && (
                    <motion.div
                      initial={{ scale: 0 }}
                      whileInView={{ scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.1 + 0.2, type: "spring" }}
                      className="mx-auto mb-4 w-14 h-14 rounded-2xl flex items-center justify-center bg-white/10 backdrop-blur-sm group-hover:bg-white/20 transition-colors"
                    >
                      <IconComponent className="w-7 h-7 text-white" />
                    </motion.div>
                  )}

                  <p
                    className={`text-4xl sm:text-5xl lg:text-6xl font-bold ${useGradientBg ? 'text-white' : (styles?.text_color || 'text-gray-900')}`}
                    style={{ fontFamily: 'var(--website-font-heading)' }}
                  >
                    {animate_numbers ? (
                      <AnimatedNumber value={stat.value} isInView={isInView} />
                    ) : (
                      stat.value
                    )}
                  </p>
                  <p
                    className={`mt-3 text-sm sm:text-base font-medium ${useGradientBg ? 'text-white/80' : 'text-gray-500'}`}
                    style={{ fontFamily: 'var(--website-font-body)' }}
                  >
                    {stat.label}
                  </p>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Grid Layout - Enhanced with gradient backgrounds */}
        {layout === 'grid' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat, index) => {
              const IconComponent = getStatIcon(stat.label, index);
              // Rotate through gradient angles for variety
              const gradientAngles = [135, 225, 45, 315];
              const angle = gradientAngles[index % gradientAngles.length];

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  whileInView={{ opacity: 1, scale: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{
                    scale: 1.03,
                    boxShadow: `0 20px 40px -15px ${primaryColor}40`
                  }}
                  className="relative text-center p-8 rounded-2xl overflow-hidden group cursor-default"
                  style={{
                    background: `linear-gradient(${angle}deg, ${primaryColor}15 0%, ${secondaryColor}20 100%)`,
                    borderRadius: theme?.borderRadius || '1rem',
                    border: `1px solid ${primaryColor}15`
                  }}
                >
                  {/* Hover gradient overlay */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    style={{
                      background: `linear-gradient(${angle}deg, ${primaryColor}25 0%, ${secondaryColor}30 100%)`
                    }}
                  />

                  <div className="relative z-10">
                    {/* Icon with gradient background */}
                    {show_icons && (
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        whileInView={{ scale: 1, rotate: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: index * 0.1 + 0.2, type: "spring", stiffness: 200 }}
                        className="mx-auto mb-4 w-12 h-12 rounded-xl flex items-center justify-center"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                        }}
                      >
                        <IconComponent className="w-6 h-6 text-white" />
                      </motion.div>
                    )}

                    <p
                      className="text-3xl sm:text-4xl font-bold"
                      style={{ fontFamily: 'var(--website-font-heading)', color: primaryColor }}
                    >
                      {animate_numbers ? (
                        <AnimatedNumber value={stat.value} isInView={isInView} />
                      ) : (
                        stat.value
                      )}
                    </p>
                    <p
                      className="mt-2 font-semibold text-gray-800 dark:text-white"
                      style={{ fontFamily: 'var(--website-font-heading)' }}
                    >
                      {stat.label}
                    </p>
                    {stat.description && (
                      <p
                        className="mt-2 text-sm text-gray-500 dark:text-gray-400"
                        style={{ fontFamily: 'var(--website-font-body)' }}
                      >
                        {stat.description}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Cards Layout - Enhanced with glassmorphism */}
        {layout === 'cards' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat, index) => {
              const IconComponent = getStatIcon(stat.label, index);

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30, rotateX: -10 }}
                  whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1, duration: 0.5 }}
                  whileHover={{
                    y: -8,
                    boxShadow: `0 25px 50px -12px ${primaryColor}30`
                  }}
                  className="relative p-8 text-center overflow-hidden group"
                  style={{
                    backgroundColor: isDark ? 'rgba(31, 41, 55, 0.8)' : 'rgba(255, 255, 255, 0.9)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    borderRadius: theme?.borderRadius || '1.25rem',
                    border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.4)' : 'rgba(229, 231, 235, 0.8)'}`,
                    boxShadow: '0 10px 40px -10px rgba(0, 0, 0, 0.1)'
                  }}
                >
                  {/* Top accent line */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1 opacity-80 group-hover:opacity-100 transition-opacity"
                    style={{
                      background: `linear-gradient(90deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                    }}
                  />

                  {/* Decorative corner gradient */}
                  <div
                    className="absolute -top-20 -right-20 w-40 h-40 rounded-full opacity-0 group-hover:opacity-30 transition-opacity duration-500"
                    style={{ backgroundColor: primaryColor }}
                  />

                  <div className="relative z-10">
                    {/* Icon */}
                    {show_icons && (
                      <motion.div
                        initial={{ scale: 0 }}
                        whileInView={{ scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: index * 0.1 + 0.2, type: "spring" }}
                        className="mx-auto mb-5 w-14 h-14 rounded-2xl flex items-center justify-center"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor}15 0%, ${secondaryColor}20 100%)`,
                          border: `1px solid ${primaryColor}20`
                        }}
                      >
                        <IconComponent className="w-7 h-7" style={{ color: primaryColor }} />
                      </motion.div>
                    )}

                    <p
                      className="text-3xl sm:text-4xl lg:text-5xl font-bold"
                      style={{ fontFamily: 'var(--website-font-heading)', color: primaryColor }}
                    >
                      {animate_numbers ? (
                        <AnimatedNumber value={stat.value} isInView={isInView} />
                      ) : (
                        stat.value
                      )}
                    </p>
                    <p
                      className={`mt-3 font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}
                      style={{ fontFamily: 'var(--website-font-heading)' }}
                    >
                      {stat.label}
                    </p>
                    {stat.description && (
                      <p
                        className="mt-2 text-sm text-gray-500 dark:text-gray-400"
                        style={{ fontFamily: 'var(--website-font-body)' }}
                      >
                        {stat.description}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Gradient Layout - NEW: Each stat has its own gradient card */}
        {layout === 'gradient' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat, index) => {
              const IconComponent = getStatIcon(stat.label, index);
              // Different gradient for each card
              const gradients = [
                `linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor}dd 100%)`,
                `linear-gradient(135deg, ${secondaryColor} 0%, ${primaryColor}80 100%)`,
                `linear-gradient(135deg, ${primaryColor}cc 0%, ${secondaryColor} 100%)`,
                `linear-gradient(135deg, ${secondaryColor}ee 0%, ${primaryColor}90 100%)`
              ];

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1, type: "spring" }}
                  whileHover={{
                    scale: 1.05,
                    rotate: index % 2 === 0 ? 2 : -2
                  }}
                  className="relative p-8 text-center overflow-hidden rounded-2xl"
                  style={{
                    background: gradients[index % gradients.length],
                    borderRadius: theme?.borderRadius || '1.25rem',
                    boxShadow: `0 20px 40px -15px ${primaryColor}50`
                  }}
                >
                  {/* Decorative circle */}
                  <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
                  <div className="absolute -top-10 -left-10 w-24 h-24 rounded-full bg-white/5" />

                  <div className="relative z-10">
                    {/* Icon */}
                    {show_icons && (
                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        whileInView={{ y: 0, opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: index * 0.1 + 0.1 }}
                        className="mx-auto mb-4 w-12 h-12 rounded-xl flex items-center justify-center bg-white/20 backdrop-blur-sm"
                      >
                        <IconComponent className="w-6 h-6 text-white" />
                      </motion.div>
                    )}

                    <p
                      className="text-4xl sm:text-5xl font-bold text-white"
                      style={{ fontFamily: 'var(--website-font-heading)' }}
                    >
                      {animate_numbers ? (
                        <AnimatedNumber value={stat.value} isInView={isInView} />
                      ) : (
                        stat.value
                      )}
                    </p>
                    <p
                      className="mt-3 font-semibold text-white/90"
                      style={{ fontFamily: 'var(--website-font-heading)' }}
                    >
                      {stat.label}
                    </p>
                    {stat.description && (
                      <p
                        className="mt-2 text-sm text-white/70"
                        style={{ fontFamily: 'var(--website-font-body)' }}
                      >
                        {stat.description}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
