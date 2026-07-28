'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ChevronRight } from 'lucide-react';
import type { BlockRendererProps } from './types';

export interface HeaderMenuItem {
  label: string;
  anchor: string;
  icon?: string;
}

interface HeaderContent {
  logo_text: string;
  logo_url?: string;
  menu_items: HeaderMenuItem[];
  cta_button?: { text: string; link: string };
  sticky?: boolean;
  style?: 'solid' | 'transparent' | 'blur';
  layout?: 'standard' | 'minimal' | 'centered';
}

export function HeaderBlock({ content, styles, theme, isRTL, className }: BlockRendererProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const {
    logo_text,
    logo_url,
    menu_items = [],
    cta_button,
    sticky = true,
    style = 'solid',
    layout = 'standard'
  } = content as HeaderContent;

  const primaryColor = theme?.colors?.primary || '#4F46E5';
  const textColor = theme?.colors?.text || '#1a1a1a';
  const bgColor = theme?.colors?.background || '#ffffff';

  // Handle scroll for sticky header styling
  useEffect(() => {
    if (!sticky) return;

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [sticky]);

  // Close mobile menu on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleNavClick = (anchor: string) => {
    setIsOpen(false);
    // Smooth scroll to section
    const element = document.querySelector(anchor);
    if (element) {
      const headerOffset = 80; // Account for sticky header height
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  // Get background styles based on style variant
  const getHeaderBackground = () => {
    if (style === 'transparent' && !isScrolled) {
      return 'bg-transparent';
    }
    if (style === 'blur') {
      return isScrolled
        ? 'bg-white/90 dark:bg-slate-950/90 backdrop-blur-md'
        : 'bg-white/70 dark:bg-slate-950/70 backdrop-blur-sm';
    }
    // solid
    return isScrolled
      ? 'bg-white dark:bg-slate-950 shadow-sm'
      : 'bg-white dark:bg-slate-950';
  };

  const getTextColor = () => {
    if (style === 'transparent' && !isScrolled) {
      return 'text-white';
    }
    return 'text-gray-900 dark:text-white';
  };

  return (
    <>
      <header
        dir={isRTL ? 'rtl' : 'ltr'}
        className={`
          ${sticky ? 'fixed top-0 left-0 right-0 z-50' : 'relative'}
          ${getHeaderBackground()}
          transition-all duration-300
          ${styles?.padding || 'py-4'}
          ${className || ''}
        `}
        style={style === 'solid' ? { backgroundColor: bgColor } : undefined}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`flex items-center ${layout === 'centered' ? 'justify-center' : 'justify-between'}`}>

            {/* Logo */}
            <div className={`flex items-center ${layout === 'centered' ? `absolute ${isRTL ? 'right-4 sm:right-6 lg:right-8' : 'left-4 sm:left-6 lg:left-8'}` : ''}`}>
              <a href="#" className="flex items-center gap-3">
                {logo_url && (
                  <img
                    src={logo_url}
                    alt={logo_text}
                    className="h-8 sm:h-10 w-auto"
                  />
                )}
                {logo_text && (
                  <span
                    className={`text-xl sm:text-2xl font-bold ${getTextColor()}`}
                    style={{
                      fontFamily: theme?.fonts?.heading,
                      color: style === 'transparent' && !isScrolled ? undefined : primaryColor
                    }}
                  >
                    {logo_text}
                  </span>
                )}
              </a>
            </div>

            {/* Desktop Navigation - Centered for 'centered' layout */}
            <nav className="hidden md:flex items-center gap-1 lg:gap-2">
              {menu_items.map((item, index) => (
                <button
                  key={index}
                  onClick={() => handleNavClick(item.anchor)}
                  className={`
                    px-3 lg:px-4 py-2 rounded-lg text-sm font-medium
                    transition-colors duration-200
                    ${getTextColor()}
                    hover:bg-gray-100 dark:hover:bg-slate-800
                  `}
                  style={{ fontFamily: theme?.fonts?.body }}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            {/* CTA Button - Desktop */}
            <div className={`hidden md:flex items-center ${layout === 'centered' ? `absolute ${isRTL ? 'left-4 sm:left-6 lg:left-8' : 'right-4 sm:right-6 lg:right-8'}` : ''}`}>
              {cta_button && (
                <a
                  href={cta_button.link}
                  onClick={(e) => {
                    if (cta_button.link.startsWith('#')) {
                      e.preventDefault();
                      handleNavClick(cta_button.link);
                    }
                  }}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 hover:shadow-lg"
                  style={{
                    backgroundColor: primaryColor,
                    fontFamily: theme?.fonts?.body
                  }}
                >
                  {cta_button.text}
                </a>
              )}
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className={`md:hidden p-2 rounded-lg ${getTextColor()} hover:bg-gray-100 dark:hover:bg-slate-800`}
              aria-label={isOpen ? 'Close menu' : 'Open menu'}
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </header>

      {/* Spacer for sticky header */}
      {sticky && <div className="h-16 sm:h-20" />}

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={() => setIsOpen(false)}
            />

            {/* Mobile Menu Panel */}
            <motion.div
              initial={{ x: isRTL ? '-100%' : '100%' }}
              animate={{ x: 0 }}
              exit={{ x: isRTL ? '-100%' : '100%' }}
              transition={{ type: 'tween', duration: 0.3 }}
              className={`
                fixed top-0 ${isRTL ? 'left-0' : 'right-0'} bottom-0 w-80 max-w-[85vw]
                bg-white dark:bg-slate-950 z-50 md:hidden
                shadow-2xl
              `}
              style={{ backgroundColor: bgColor }}
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              {/* Mobile Menu Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  {logo_url && (
                    <img src={logo_url} alt={logo_text} className="h-8 w-auto" />
                  )}
                  {logo_text && (
                    <span
                      className="text-xl font-bold"
                      style={{
                        fontFamily: theme?.fonts?.heading,
                        color: primaryColor
                      }}
                    >
                      {logo_text}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Mobile Menu Items */}
              <nav className="p-4">
                <div className="space-y-1">
                  {menu_items.map((item, index) => (
                    <motion.button
                      key={index}
                      initial={{ opacity: 0, x: isRTL ? -20 : 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => handleNavClick(item.anchor)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-base font-medium text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                      style={{ fontFamily: theme?.fonts?.body }}
                    >
                      <span>{item.label}</span>
                      <ChevronRight className={`w-4 h-4 text-gray-400 ${isRTL ? 'rotate-180' : ''}`} />
                    </motion.button>
                  ))}
                </div>

                {/* Mobile CTA Button */}
                {cta_button && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: menu_items.length * 0.05 + 0.1 }}
                    className="mt-6 pt-6 border-t border-gray-200 dark:border-slate-800"
                  >
                    <a
                      href={cta_button.link}
                      onClick={(e) => {
                        if (cta_button.link.startsWith('#')) {
                          e.preventDefault();
                          handleNavClick(cta_button.link);
                        }
                      }}
                      className="block w-full px-4 py-3 rounded-lg text-center text-base font-semibold text-white transition-all duration-200 hover:opacity-90"
                      style={{
                        backgroundColor: primaryColor,
                        fontFamily: theme?.fonts?.body
                      }}
                    >
                      {cta_button.text}
                    </a>
                  </motion.div>
                )}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
