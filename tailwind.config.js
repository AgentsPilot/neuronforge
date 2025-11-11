/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // V2 Design System Tokens
      colors: {
        v2: {
          bg: 'var(--v2-bg, #F5F5F7)',
          surface: 'var(--v2-surface, #FFFFFF)',
          primary: 'var(--v2-primary, #6366F1)',
          'primary-dark': 'var(--v2-primary-dark, #4F46E5)',
          secondary: 'var(--v2-secondary, #8B5CF6)',
          'text-primary': 'var(--v2-text-primary, #1F2937)',
          'text-secondary': 'var(--v2-text-secondary, #6B7280)',
          'text-muted': 'var(--v2-text-muted, #9CA3AF)',
        },
      },
      borderRadius: {
        'v2-panel': 'var(--v2-radius-panel, 24px)',
        'v2-card': 'var(--v2-radius-card, 16px)',
        'v2-button': 'var(--v2-radius-button, 12px)',
      },
      boxShadow: {
        'v2-card': 'var(--v2-shadow-card, 0 2px 16px rgba(0, 0, 0, 0.06))',
        'v2-button': 'var(--v2-shadow-button, 0 4px 16px rgba(99, 102, 241, 0.3))',
      },
    },
  },
}