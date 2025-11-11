// lib/design-system-v2/tokens.ts
// V2 Design tokens matching mockup color scheme

export const v2Tokens = {
  /**
   * Color Palette - Mockup Style
   */
  colors: {
    // Backgrounds
    background: '#F5F5F7',        // Light gray page background
    surface: '#FFFFFF',           // White panels/cards

    // Brand Colors (Indigo/Purple)
    brand: {
      primary: '#6366F1',         // Indigo-500 (primary buttons, links)
      primaryDark: '#4F46E5',     // Indigo-600 (hover states)
      primaryLight: '#818CF8',    // Indigo-400 (light accents)
      secondary: '#8B5CF6',       // Purple-500 (secondary accents)
      secondaryDark: '#7C3AED',   // Purple-600
      secondaryLight: '#A78BFA',  // Purple-400
    },

    // Text Colors
    text: {
      primary: '#1F2937',         // Gray-800 (main text)
      secondary: '#6B7280',       // Gray-500 (secondary text)
      muted: '#9CA3AF',           // Gray-400 (muted text)
      inverse: '#FFFFFF',         // White text on dark backgrounds
    },

    // Status Colors
    success: {
      DEFAULT: '#10B981',         // Green-500
      light: '#D1FAE5',           // Green-100 (background)
      dark: '#059669',            // Green-600
      bg: '#ECFDF5',              // Success message background
      border: '#BBF7D0',          // Success message border
      text: '#065F46',            // Success message text
      icon: '#059669',            // Success icon color
    },

    warning: {
      DEFAULT: '#F59E0B',         // Amber-500
      light: '#FEF3C7',           // Amber-100
      dark: '#D97706',            // Amber-600
    },

    error: {
      DEFAULT: '#EF4444',         // Red-500
      light: '#FEE2E2',           // Red-100
      dark: '#DC2626',            // Red-600
      bg: '#FEF2F2',              // Error message background
      border: '#FECACA',          // Error message border
      text: '#991B1B',            // Error message text
      icon: '#DC2626',            // Error icon color
    },

    info: {
      DEFAULT: '#3B82F6',         // Blue-500
      light: '#DBEAFE',           // Blue-100
      dark: '#2563EB',            // Blue-600
    },

    // Neutral Grays
    neutral: {
      50: '#F9FAFB',
      100: '#F3F4F6',
      200: '#E5E7EB',
      300: '#D1D5DB',
      400: '#9CA3AF',
      500: '#6B7280',
      600: '#4B5563',
      700: '#374151',
      800: '#1F2937',
      900: '#111827',
    },
  },

  /**
   * Typography
   */
  typography: {
    fontFamily: {
      sans: 'var(--font-geist-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
      mono: 'var(--font-geist-mono, "SF Mono", Monaco, "Courier New", monospace)',
    },
    fontSize: {
      xs: '0.75rem',      // 12px
      sm: '0.875rem',     // 14px
      base: '1rem',       // 16px
      lg: '1.125rem',     // 18px
      xl: '1.25rem',      // 20px
      '2xl': '1.5rem',    // 24px
      '3xl': '1.875rem',  // 30px
      '4xl': '2.25rem',   // 36px
      '5xl': '3rem',      // 48px
    },
    fontWeight: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
    lineHeight: {
      none: '1',
      tight: '1.25',
      snug: '1.375',
      normal: '1.5',
      relaxed: '1.625',
      loose: '2',
    },
  },

  /**
   * Spacing Scale
   */
  spacing: {
    panel: '32px',       // Main panel padding
    card: '24px',        // Card padding
    section: '24px',     // Section spacing
    component: '16px',   // Component spacing
    element: '12px',     // Element spacing
    compact: '8px',      // Compact spacing
  },

  /**
   * Border Radius
   */
  borderRadius: {
    none: '0',
    sm: '4px',
    base: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '32px',
    full: '9999px',
    // Mockup-specific
    panel: '24px',
    card: '16px',
    button: '12px',
    input: '12px',
    badge: '9999px',
  },

  /**
   * Shadows
   */
  shadows: {
    none: 'none',
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    // Mockup-specific
    card: '0 2px 16px rgba(0, 0, 0, 0.06)',
    cardHover: '0 8px 24px rgba(0, 0, 0, 0.12)',
    button: '0 4px 16px rgba(99, 102, 241, 0.3)',
    buttonHover: '0 8px 24px rgba(99, 102, 241, 0.4)',
  },

  /**
   * Z-Index Scale
   */
  zIndex: {
    base: 0,
    dropdown: 1000,
    sticky: 1020,
    fixed: 1030,
    modal: 1040,
    popover: 1050,
    tooltip: 1060,
  },

  /**
   * Transitions
   */
  transitions: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    base: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    slower: '500ms cubic-bezier(0.4, 0, 0.2, 1)',
  },

  /**
   * Breakpoints
   */
  breakpoints: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
} as const

/**
 * CSS Gradient Strings
 */
export const v2Gradients = {
  // Primary brand gradient (buttons, CTAs)
  primary: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',

  // Card hover gradient
  card: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',

  // Background gradients
  backgroundSubtle: 'linear-gradient(to bottom right, #F5F5F7, #FFFFFF)',

  // Success gradient
  success: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',

  // Warning gradient
  warning: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',

  // Error gradient
  error: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
} as const

/**
 * Type exports for TypeScript
 */
export type V2Tokens = typeof v2Tokens
export type V2Gradients = typeof v2Gradients
