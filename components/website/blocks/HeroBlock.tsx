'use client';

import { motion } from 'framer-motion';
import { resolveBlockLayout } from '@/lib/website-builder/pageTheme';
import { ArrowRight, Sparkles, Star, Users, Award, Play } from 'lucide-react';
import { resolveBookingAction } from './bookingAction';
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

export function HeroBlock({ content, styles, theme, isRTL, className, locale = 'en', isPreview, onOpenBooking, bookingUrl }: BlockRendererProps) {
  const t = (key: string, section: 'hero' | 'common' = 'hero') =>
    getBlockTranslation(section, key, locale);
  const {
    headline,
    subheadline,
    cta_text: rawCtaText,
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

  /*
   * The fallback label read the LINK to guess its own words —
   * `cta_link.includes('booking')`. So the moment the hero stopped pointing at
   * `#booking` the button silently became "Get started", and any future change
   * of destination would rename the button again as a side effect.
   *
   * Generation now writes both the words and the destination together, so this
   * is only the fallback for content that carries no label at all.
   */
  const cta_text = rawCtaText || t('learnMore', 'common');

  /*
   * The hero's main button starts a booking, like the header's and the pricing
   * card's — it does not merely scroll.
   *
   * It was a plain anchor to `cta_link`, so on a generated landing page the
   * "order now" button moved the page down while the identical-looking button
   * in the pricing section opened the booking dialog. `HeaderBlock` and
   * `CTABlock` were already converted; the hero was the one left behind, and it
   * was not even handed `isPreview` / `onOpenBooking` / `bookingUrl` to do it
   * with.
   *
   * Preview opens the dialog, a published page follows `bookingUrl`, and a page
   * that can take no booking at all falls back to the link it always had.
   */
  /*
   * The editor's hero image field wrote `content.image` while this reads
   * `content.background_image`, so a picture saved there never appeared. Both
   * are read now, which brings back every hero image already chosen without
   * anyone regenerating a page.
   */
  const heroImage = background_image || (content as { image?: string }).image;

  const heroBooking = resolveBookingAction({
    isPreview,
    onOpenBooking,
    bookingUrl,
    fallbackHref: cta_link,
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE FOUR HEROES.
   *
   * `styles.layout` is written by the generator from the archetype. It is the
   * single biggest difference between two sites built from the same content,
   * and until now every business got the same one: centred, with an animated
   * glow behind it.
   *
   *   centered    content centred over a gradient glow. Loud, product-shaped.
   *   stacked     content aligned to the reading edge, full width, no glow.
   *               Quiet and typographic — the whole of Stone's opening.
   *   split       content one side, the business's own photograph the other.
   *   full-bleed  the photograph IS the hero, content over a scrim.
   *
   * `styles.alignment` still wins where a page carries one, because somebody
   * set it by hand in the editor.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const layout = (resolveBlockLayout('hero', theme?.layouts, styles?.layout) as
    'stacked' | 'split' | 'centered' | 'full-bleed') || 'centered';

  /** Only the centred hero keeps the glow and the floating shapes. */
  const decorated = layout === 'centered';
  /** Two columns, with a real image beside the words rather than behind them. */
  const split = layout === 'split' && Boolean(heroImage);
  /** The photograph, at full height, with the words over it. */
  const fullBleed = layout === 'full-bleed' && Boolean(heroImage);

  const alignment = styles?.alignment || (layout === 'stacked' || split ? 'left' : 'center');
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
        backgroundImage: `url(${heroImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      };
    }
    if (background_type === 'solid') {
      return { backgroundColor };
    }
    /*
     * Default: a mesh gradient, routed through a custom property so a
     * composition can replace it with its own flat ground.
     *
     * All three mockups open on flat paper or flat night — the wash is what
     * makes a generated page read as generated. An inline value cannot be
     * overridden by a rule, but a custom property READ by one can, and the
     * fallback keeps every uncomposed hero exactly as it is today.
     */
    if (isDark) {
      const mesh = `
          radial-gradient(at 40% 20%, ${primaryColor}40 0px, transparent 50%),
          radial-gradient(at 80% 0%, ${secondaryColor}30 0px, transparent 50%),
          radial-gradient(at 0% 80%, ${primaryColor}30 0px, transparent 50%),
          linear-gradient(180deg, ${backgroundColor} 0%, ${backgroundColor} 100%)
        `;
      return { background: `var(--apc-band, ${mesh})` };
    }
    return {
      background: `var(--apc-band, ${generateGradient(primaryColor, secondaryColor, 'mesh')})`
    };
  };

  // Gradient text style
  const gradientTextStyle = gradient_text ? {
    color: 'var(--ap-text)'
  } : {};

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec relative overflow-hidden ${styles?.padding || 'py-16 sm:py-20 lg:py-24'} ${background_value || ''} ${className || ''}`}
      style={{
        ...getBackgroundStyle(),
        // A full-bleed hero is the photograph; it needs the height to be one.
        ...(fullBleed
          ? {
              backgroundImage: `url(${heroImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              minHeight: 'min(78vh, 720px)',
              display: 'flex',
              alignItems: 'center',
            }
          : {}),
      }}
    >
      {/* Decorative elements. Only the centred hero has them: on a quiet,
          type-led opening a floating blurred circle is the one thing that makes
          it look generated. */}
      {decorated && background_type !== 'image' && (
        <>
          {/* Animated floating shapes - smaller for compact layout */}
          <motion.div
            animate={{
              y: [0, -15, 0],
              scale: [1, 1.03, 1],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="apc-decor absolute top-10 right-[10%] w-48 h-48 rounded-full opacity-25 blur-3xl"
            style={{ backgroundColor: primaryColor }}
          />
          <motion.div
            animate={{
              y: [0, 15, 0],
              scale: [1, 0.97, 1],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="apc-decor absolute bottom-10 left-[5%] w-64 h-64 rounded-full opacity-20 blur-3xl"
            style={{ backgroundColor: secondaryColor }}
          />
          <motion.div
            animate={{
              x: [0, 8, 0],
              y: [0, -8, 0],
            }}
            transition={{
              duration: 12,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="apc-decor absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full opacity-10 blur-3xl"
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
              className="apc-decor w-12 h-12 rounded-full opacity-15 border-4"
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
            className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[300px] opacity-30"
            style={{
              background: `radial-gradient(ellipse at center top, ${primaryColor}20 0%, transparent 70%)`
            }}
          />
        </>
      )}

      {/* Overlay for image backgrounds */}
      {(background_type === 'image' || fullBleed) && (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.6) 100%)`
          }}
        />
      )}

      <div
        className={`relative mx-auto px-4 sm:px-6 lg:px-8 w-full ${
          split ? 'max-w-7xl grid gap-10 lg:gap-16 items-center lg:grid-cols-2' : 'max-w-5xl'
        }`}
      >
      {/* The photograph, beside the words rather than behind them. First in the
          DOM so it sits at the inline start — which puts it on the left in
          English and the right in Hebrew, without a direction branch. */}
      {split && (
        <motion.div
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7 }}
          className="order-first lg:order-none w-full"
          style={{
            aspectRatio: '4 / 5',
            backgroundImage: `url(${heroImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}

      <div className={`flex flex-col w-full ${alignmentClasses[alignment]}`}>
        {/* Badge */}
        {badge && (
          <motion.span
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="apc-eyebrow inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold mb-8 shadow-lg backdrop-blur-sm"
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
          data-apc="headline"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-bold tracking-tight leading-[1.15]"
          style={{
            fontFamily: 'var(--ap-font-heading)',
            /*
             * The archetype's own display size, not a fixed Tailwind ramp.
             *
             * `--ap-scale-h1` is a clamp() PublicThemeStyle writes from
             * theme.scale, so it already spans phone to desktop — which is what
             * the four responsive classes here were doing, identically for every
             * template. Stone asks for 64px and Lumen for 58px; both rendered at
             * whatever `xl:text-6xl` happened to be.
             */
            fontSize: 'var(--ap-scale-h1)',
            color: background_type === 'image' || fullBleed ? '#ffffff' : 'var(--ap-text)',
            ...gradientTextStyle
          }}
        >
          {headline}
        </motion.h1>

        {subheadline && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="apc-lede mt-4 sm:mt-6 max-w-2xl leading-relaxed"
            style={{
              fontFamily: 'var(--ap-font-body)',
              // Same reasoning as the headline above.
              fontSize: 'var(--ap-scale-h3)',
              color: background_type === 'image' || fullBleed ? 'rgba(255,255,255,.86)' : 'var(--ap-text-muted)'
            }}
          >
            {subheadline}
          </motion.p>
        )}

        {/* CTA Buttons */}
        {(cta_text || secondary_cta_text) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="apc-cta-row mt-8 sm:mt-10 flex flex-col sm:flex-row gap-3"
          >
            {cta_text && (
              // Same button either way — a real <button> when it opens the
              // dialog, an anchor when it navigates. Only the element differs.
              (() => {
                const ctaClassName = "apc-btn apc-btn--solid group relative inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold overflow-hidden transition-all duration-300";
                // `--ap-on-brand` rather than white: Lumen's acid lime needs a
                // black label and Aster's indigo needs a white one.
                const ctaStyle = { color: 'var(--ap-on-brand)', backgroundColor: 'var(--ap-brand)' };
                const ctaInner = (<>
                {/* Button gradient background */}
                <span
                  className="apc-decor absolute inset-0 transition-opacity duration-300"
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
                  }}
                />
                {/* Shimmer effect */}
                <span
                  className="apc-decor absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)`,
                    transform: 'translateX(-100%)',
                    animation: 'shimmer 2s infinite'
                  }}
                />
                {/* Shadow glow */}
                <span
                  className="apc-decor absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-xl"
                  style={{ backgroundColor: primaryColor }}
                />
                <span className="relative flex items-center gap-2">
                  {cta_text}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
                </>);

                return heroBooking.kind === 'open' ? (
                  <button type="button" onClick={heroBooking.onClick} className={ctaClassName} style={ctaStyle}>
                    {ctaInner}
                  </button>
                ) : (
                  <a href={heroBooking.href} className={ctaClassName} style={ctaStyle}>
                    {ctaInner}
                  </a>
                );
              })()
            )}
            {secondary_cta_text && (
              <a
                href={secondary_cta_link || '#services'}
                className="apc-btn group inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold backdrop-blur-sm transition-all duration-300 hover:scale-[1.02]"
                style={
                  background_type === 'image'
                    ? {
                        border: '2px solid rgba(255,255,255,0.3)',
                        color: 'white',
                        backgroundColor: 'rgba(255,255,255,0.1)',
                      }
                    : undefined
                }
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
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="apc-trust mt-8 sm:mt-10 flex flex-wrap items-center justify-center gap-4 sm:gap-8"
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
                  style={{ color: 'var(--ap-text-muted)' }}
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
                  className="apc-icon w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <Users className="w-4 h-4" style={{ color: primaryColor }} />
                </div>
                <span
                  className="text-sm font-medium"
                  style={{ color: 'var(--ap-text-muted)' }}
                >
                  {trust_indicators.clients_count} {t('clientsServed', 'common')}
                </span>
              </div>
            )}

            {/* Awards */}
            {trust_indicators.awards && trust_indicators.awards.length > 0 && (
              <div className="flex items-center gap-2">
                <div
                  className="apc-icon w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <Award className="w-4 h-4" style={{ color: primaryColor }} />
                </div>
                <span
                  className="text-sm font-medium"
                  style={{ color: 'var(--ap-text-muted)' }}
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
          transition={{ duration: 0.8, delay: 0.5 }}
          className={`mt-10 w-20 h-0.5 rounded-full hidden sm:block ${alignment === 'center' ? 'mx-auto' : ''}`}
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${primaryColor}50 50%, transparent 100%)`
          }}
        />
      </div>
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
