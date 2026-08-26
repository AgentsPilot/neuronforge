'use client';

import { motion } from 'framer-motion';
import { Mail, Phone, MapPin, Facebook, Instagram, Linkedin, Twitter } from 'lucide-react';
import type { BlockRendererProps } from './types';

interface FooterContent {
  company_name: string;
  tagline?: string;
  email?: string;
  phone?: string;
  address?: string;
  copyright_year?: number;
  social_links?: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
  };
  menu_items?: Array<{
    label: string;
    anchor: string;
  }>;
  show_powered_by?: boolean;
}

// Localized labels
const LABELS = {
  en: {
    allRightsReserved: 'All rights reserved',
    poweredBy: 'Powered by',
    quickLinks: 'Quick Links',
    contact: 'Contact',
  },
  es: {
    allRightsReserved: 'Todos los derechos reservados',
    poweredBy: 'Desarrollado por',
    quickLinks: 'Enlaces Rápidos',
    contact: 'Contacto',
  },
  he: {
    allRightsReserved: 'כל הזכויות שמורות',
    poweredBy: 'מופעל על ידי',
    quickLinks: 'קישורים מהירים',
    contact: 'יצירת קשר',
  },
};

export function FooterBlock({ content, styles, theme, locale, isRTL, className }: BlockRendererProps) {
  const {
    company_name,
    tagline,
    email,
    phone,
    address,
    copyright_year = new Date().getFullYear(),
    social_links,
    menu_items = [],
    show_powered_by = false,
  } = content as FooterContent;

  const labels = LABELS[locale] || LABELS.en;
  const primaryColor = theme?.colors?.primary || '#4F46E5';
  const textColor = theme?.colors?.text || '#1a1a1a';
  const bgColor = theme?.colors?.background || '#ffffff';

  // Determine if we're using a dark background
  const isDark = bgColor.startsWith('#0') || bgColor.startsWith('#1') || bgColor === '#000000';
  const footerBgColor = isDark ? '#0f172a' : '#f8fafc';
  const footerTextColor = isDark ? '#94a3b8' : '#64748b';
  const footerHeadingColor = isDark ? '#f1f5f9' : '#1e293b';

  const hasContactInfo = email || phone || address;
  const hasSocialLinks = social_links && Object.values(social_links).some(Boolean);
  const hasMenuItems = menu_items.length > 0;

  const handleNavClick = (anchor: string) => {
    const element = document.querySelector(anchor);
    if (element) {
      const headerOffset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });
    }
  };

  return (
    <footer
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-12 sm:py-16'} ${className || ''}`}
      style={{ backgroundColor: footerBgColor }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Main Footer Content */}
        <div className={`grid gap-8 ${hasContactInfo || hasMenuItems ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-1'}`}>
          {/* Company Info */}
          <div className={hasContactInfo || hasMenuItems ? '' : 'text-center'}>
            <motion.h3
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-xl font-bold mb-3"
              style={{
                fontFamily: 'var(--website-font-heading)',
                color: primaryColor
              }}
            >
              {company_name}
            </motion.h3>
            {tagline && (
              <p
                className="text-sm leading-relaxed max-w-xs"
                style={{
                  fontFamily: 'var(--website-font-body)',
                  color: footerTextColor
                }}
              >
                {tagline}
              </p>
            )}

            {/* Social Links */}
            {hasSocialLinks && (
              <div className="flex gap-3 mt-4">
                {social_links?.facebook && (
                  <a
                    href={social_links.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                    style={{
                      backgroundColor: `${primaryColor}15`,
                      color: primaryColor
                    }}
                  >
                    <Facebook className="w-4 h-4" />
                  </a>
                )}
                {social_links?.instagram && (
                  <a
                    href={social_links.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                    style={{
                      backgroundColor: `${primaryColor}15`,
                      color: primaryColor
                    }}
                  >
                    <Instagram className="w-4 h-4" />
                  </a>
                )}
                {social_links?.linkedin && (
                  <a
                    href={social_links.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                    style={{
                      backgroundColor: `${primaryColor}15`,
                      color: primaryColor
                    }}
                  >
                    <Linkedin className="w-4 h-4" />
                  </a>
                )}
                {social_links?.twitter && (
                  <a
                    href={social_links.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                    style={{
                      backgroundColor: `${primaryColor}15`,
                      color: primaryColor
                    }}
                  >
                    <Twitter className="w-4 h-4" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Quick Links */}
          {hasMenuItems && (
            <div>
              <h4
                className="text-sm font-semibold uppercase tracking-wider mb-4"
                style={{ color: footerHeadingColor }}
              >
                {labels.quickLinks}
              </h4>
              <ul className="space-y-2">
                {menu_items.map((item, index) => (
                  <li key={index}>
                    <button
                      onClick={() => handleNavClick(item.anchor)}
                      className="text-sm transition-colors hover:underline"
                      style={{
                        color: footerTextColor,
                        fontFamily: 'var(--website-font-body)'
                      }}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Contact Info */}
          {hasContactInfo && (
            <div className={hasMenuItems ? '' : 'lg:col-span-2'}>
              <h4
                className="text-sm font-semibold uppercase tracking-wider mb-4"
                style={{ color: footerHeadingColor }}
              >
                {labels.contact}
              </h4>
              <ul className="space-y-3">
                {email && (
                  <li className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${primaryColor}15` }}
                    >
                      <Mail className="w-4 h-4" style={{ color: primaryColor }} />
                    </div>
                    <a
                      href={`mailto:${email}`}
                      className="text-sm transition-colors hover:underline"
                      style={{
                        color: footerTextColor,
                        fontFamily: 'var(--website-font-body)'
                      }}
                    >
                      {email}
                    </a>
                  </li>
                )}
                {phone && (
                  <li className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${primaryColor}15` }}
                    >
                      <Phone className="w-4 h-4" style={{ color: primaryColor }} />
                    </div>
                    <a
                      href={`tel:${phone}`}
                      className="text-sm transition-colors hover:underline"
                      style={{
                        color: footerTextColor,
                        fontFamily: 'var(--website-font-body)'
                      }}
                      dir="ltr"
                    >
                      {phone}
                    </a>
                  </li>
                )}
                {address && (
                  <li className="flex items-start gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${primaryColor}15` }}
                    >
                      <MapPin className="w-4 h-4" style={{ color: primaryColor }} />
                    </div>
                    <span
                      className="text-sm"
                      style={{
                        color: footerTextColor,
                        fontFamily: 'var(--website-font-body)'
                      }}
                    >
                      {address}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* Bottom Bar */}
        <div
          className="mt-10 pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ borderColor: isDark ? '#1e293b' : '#e2e8f0' }}
        >
          <p
            className="text-sm"
            style={{
              color: footerTextColor,
              fontFamily: 'var(--website-font-body)'
            }}
          >
            © {copyright_year} {company_name}. {labels.allRightsReserved}.
          </p>

          {show_powered_by && (
            <p
              className="text-xs"
              style={{ color: footerTextColor }}
            >
              {labels.poweredBy}{' '}
              <a
                href="https://agentspilot.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
                style={{ color: primaryColor }}
              >
                AgentsPilot
              </a>
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
