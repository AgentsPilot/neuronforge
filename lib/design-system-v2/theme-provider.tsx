// lib/design-system-v2/theme-provider.tsx
// Theme provider for V2 design system with dark mode support

'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { v2Tokens } from './tokens'
import { supabase } from '@/lib/supabaseClient'

type ThemeMode = 'light' | 'dark'

interface CustomTokens {
  colors?: Record<string, string>
  borderRadius?: Record<string, string>
  shadows?: Record<string, string>
  typography?: Record<string, string>
  spacing?: Record<string, string>
}

interface ThemeContextValue {
  tokens: typeof v2Tokens
  customTokens: CustomTokens
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggleMode: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

// Dark mode color overrides
const darkModeColors = {
  background: '#0F172A',      // Slate-900
  surface: '#1E293B',         // Slate-800
  surfaceHover: '#334155',    // Slate-700
  border: '#475569',          // Slate-600
  textPrimary: '#F1F5F9',     // Slate-100
  textSecondary: '#CBD5E1',   // Slate-300
  textMuted: '#94A3B8',       // Slate-400
  // Success colors for dark mode
  successBg: 'rgba(6, 95, 70, 0.15)',
  successBorder: 'rgba(5, 150, 105, 0.3)',
  successText: '#6EE7B7',
  successIcon: '#34D399',
  // Error colors for dark mode
  errorBg: 'rgba(153, 27, 27, 0.15)',
  errorBorder: 'rgba(220, 38, 38, 0.3)',
  errorText: '#FCA5A5',
  errorIcon: '#EF4444',
}

export function V2ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [mode, setMode] = useState<ThemeMode>('light')
  const [customTokens, setCustomTokens] = useState<CustomTokens>({})

  useEffect(() => {
    setMounted(true)

    // Load custom tokens from database
    const loadCustomTokens = async () => {
      try {
        const { data, error } = await supabase
          .from('system_settings_config')
          .select('value')
          .eq('key', 'v2_custom_tokens')
          .single()

        if (!error && data?.value) {
          setCustomTokens(data.value as CustomTokens)
        }
      } catch (err) {
        console.error('Error loading custom tokens:', err)
      }
    }

    loadCustomTokens()

    // Check localStorage for saved preference
    const savedMode = localStorage.getItem('v2-theme-mode') as ThemeMode
    if (savedMode) {
      setMode(savedMode)
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setMode(prefersDark ? 'dark' : 'light')
    }
  }, [])

  useEffect(() => {
    if (!mounted) return

    const root = document.documentElement
    const isDark = mode === 'dark'

    // Toggle dark class on html element
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    // Save preference
    localStorage.setItem('v2-theme-mode', mode)

    // Inject CSS variables into root, using custom tokens where available
    const colors = isDark ? {
      bg: customTokens.colors?.background || darkModeColors.background,
      surface: customTokens.colors?.surface || darkModeColors.surface,
      surfaceHover: customTokens.colors?.surfaceHover || darkModeColors.surfaceHover,
      border: customTokens.colors?.border || darkModeColors.border,
      textPrimary: customTokens.colors?.textPrimary || darkModeColors.textPrimary,
      textSecondary: customTokens.colors?.textSecondary || darkModeColors.textSecondary,
      textMuted: customTokens.colors?.textMuted || darkModeColors.textMuted,
    } : {
      bg: customTokens.colors?.background || v2Tokens.colors.background,
      surface: customTokens.colors?.surface || v2Tokens.colors.surface,
      surfaceHover: customTokens.colors?.surfaceHover || '#F9FAFB',
      border: customTokens.colors?.border || '#E5E7EB',
      textPrimary: customTokens.colors?.textPrimary || v2Tokens.colors.text.primary,
      textSecondary: customTokens.colors?.textSecondary || v2Tokens.colors.text.secondary,
      textMuted: customTokens.colors?.textMuted || v2Tokens.colors.text.muted,
    }

    // Colors
    root.style.setProperty('--v2-bg', colors.bg)
    root.style.setProperty('--v2-surface', colors.surface)
    root.style.setProperty('--v2-surface-hover', colors.surfaceHover)
    root.style.setProperty('--v2-border', colors.border)
    root.style.setProperty('--v2-primary', customTokens.colors?.primary || v2Tokens.colors.brand.primary)
    root.style.setProperty('--v2-primary-dark', customTokens.colors?.primaryDark || v2Tokens.colors.brand.primaryDark)
    root.style.setProperty('--v2-secondary', customTokens.colors?.secondary || v2Tokens.colors.brand.secondary)
    root.style.setProperty('--v2-text-primary', colors.textPrimary)
    root.style.setProperty('--v2-text-secondary', colors.textSecondary)
    root.style.setProperty('--v2-text-muted', colors.textMuted)

    // Success/Error colors
    const successColors = isDark ? {
      bg: customTokens.colors?.successBg || darkModeColors.successBg,
      border: customTokens.colors?.successBorder || darkModeColors.successBorder,
      text: customTokens.colors?.successText || darkModeColors.successText,
      icon: customTokens.colors?.successIcon || darkModeColors.successIcon,
    } : {
      bg: customTokens.colors?.successBg || v2Tokens.colors.success.bg,
      border: customTokens.colors?.successBorder || v2Tokens.colors.success.border,
      text: customTokens.colors?.successText || v2Tokens.colors.success.text,
      icon: customTokens.colors?.successIcon || v2Tokens.colors.success.icon,
    }

    const errorColors = isDark ? {
      bg: customTokens.colors?.errorBg || darkModeColors.errorBg,
      border: customTokens.colors?.errorBorder || darkModeColors.errorBorder,
      text: customTokens.colors?.errorText || darkModeColors.errorText,
      icon: customTokens.colors?.errorIcon || darkModeColors.errorIcon,
    } : {
      bg: customTokens.colors?.errorBg || v2Tokens.colors.error.bg,
      border: customTokens.colors?.errorBorder || v2Tokens.colors.error.border,
      text: customTokens.colors?.errorText || v2Tokens.colors.error.text,
      icon: customTokens.colors?.errorIcon || v2Tokens.colors.error.icon,
    }

    root.style.setProperty('--v2-success-bg', successColors.bg)
    root.style.setProperty('--v2-success-border', successColors.border)
    root.style.setProperty('--v2-success-text', successColors.text)
    root.style.setProperty('--v2-success-icon', successColors.icon)
    root.style.setProperty('--v2-error-bg', errorColors.bg)
    root.style.setProperty('--v2-error-border', errorColors.border)
    root.style.setProperty('--v2-error-text', errorColors.text)
    root.style.setProperty('--v2-error-icon', errorColors.icon)

    // Border radius
    root.style.setProperty('--v2-radius-panel', customTokens.borderRadius?.panel || v2Tokens.borderRadius.panel)
    root.style.setProperty('--v2-radius-card', customTokens.borderRadius?.card || v2Tokens.borderRadius.card)
    root.style.setProperty('--v2-radius-button', customTokens.borderRadius?.button || v2Tokens.borderRadius.button)
    root.style.setProperty('--v2-radius-input', customTokens.borderRadius?.input || v2Tokens.borderRadius.input)

    // Shadows (darker in dark mode, use custom if available)
    const cardShadow = customTokens.shadows?.card || (isDark
      ? '0 2px 16px rgba(0, 0, 0, 0.3)'
      : v2Tokens.shadows.card)
    const cardHoverShadow = customTokens.shadows?.cardHover || v2Tokens.shadows.cardHover
    const buttonShadow = customTokens.shadows?.button || (isDark
      ? '0 4px 16px rgba(99, 102, 241, 0.5)'
      : v2Tokens.shadows.button)

    root.style.setProperty('--v2-shadow-card', cardShadow)
    root.style.setProperty('--v2-shadow-card-hover', cardHoverShadow)
    root.style.setProperty('--v2-shadow-button', buttonShadow)

    // Spacing
    root.style.setProperty('--v2-spacing-panel', customTokens.spacing?.panel || v2Tokens.spacing.panel)
    root.style.setProperty('--v2-spacing-card', customTokens.spacing?.card || v2Tokens.spacing.card)
    root.style.setProperty('--v2-spacing-section', customTokens.spacing?.section || v2Tokens.spacing.section)

    // Typography
    root.style.setProperty('--v2-font-size-base', customTokens.typography?.fontSizeBase || v2Tokens.typography.fontSize.base)
    root.style.setProperty('--v2-font-size-lg', customTokens.typography?.fontSizeLg || v2Tokens.typography.fontSize.lg)
    root.style.setProperty('--v2-font-size-xl', customTokens.typography?.fontSizeXl || v2Tokens.typography.fontSize.xl)
  }, [mode, mounted, customTokens])

  const toggleMode = () => {
    setMode(prev => prev === 'light' ? 'dark' : 'light')
  }

  if (!mounted) {
    return null // Prevent SSR flash
  }

  return (
    <ThemeContext.Provider value={{ tokens: v2Tokens, customTokens, mode, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

/**
 * Hook to access theme tokens and mode
 */
export function useV2Theme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useV2Theme must be used within V2ThemeProvider')
  }
  return context
}
