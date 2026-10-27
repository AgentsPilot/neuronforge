// lib/design-system-v2/theme-provider.tsx
// Theme provider for V2 design system with dark mode support

'use client'

import React, { createContext, startTransition, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { v2Tokens } from './tokens'
import { V2_THEME_STORAGE_KEY } from './themeMode'
import { sanitizeV2CustomTokens, type V2CustomTokens } from './customTokens'
import { clientLogger } from '@/lib/logger/client'

type ThemeMode = 'light' | 'dark'

/*
 * SA RC-1 (TH-1): both effects run as layout effects in the browser, so a
 * client-side entry into an owner segment (sign-in redirect, an in-app link)
 * sets `.dark` and every variable before the first paint. On the server React
 * does not run effects at all; `useEffect` there only avoids the SSR warning.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const NO_CUSTOM_TOKENS: V2CustomTokens = Object.freeze({})

/** The one route the provider may call, and only to correct an unknown render (SA RC-16). */
export const V2_CUSTOM_TOKENS_CORRECTION_PATH = '/api/design-system/v2-custom-tokens'

const logger = clientLogger.child({ module: 'V2ThemeProvider' })

interface ThemeContextValue {
  tokens: typeof v2Tokens
  customTokens: V2CustomTokens
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

/**
 * `customTokens` are the platform's custom design tokens, read and validated on
 * the server by the mounting layout (`readV2CustomTokens`), which also inlines
 * them as CSS (`V2CustomTokensStyle`). The provider no longer reads the
 * database from the browser (TH-1, TH-2 folded in). Because they arrive as a
 * prop, the first effect run already writes the custom values, so the inlined
 * CSS is never overwritten by defaults.
 *
 * `customTokensKnown` is false only when the server rendered without knowing
 * the tokens (a cold instance whose first read missed its deadline). Then, and
 * only then, the provider asks `V2_CUSTOM_TOKENS_CORRECTION_PATH` once and
 * applies the answer: the same "defaults, then the right colours a moment
 * later" as before TH-1, on that rare path only (SA RC-16). It defaults to
 * `true`, so a layout that forgot it can never cause a fetch per page.
 */
export function V2ThemeProvider({
  children,
  customTokens: serverCustomTokens = NO_CUSTOM_TOKENS,
  customTokensKnown = true,
}: {
  children: React.ReactNode
  customTokens?: V2CustomTokens
  customTokensKnown?: boolean
}) {
  const [mounted, setMounted] = useState(false)
  const [mode, setMode] = useState<ThemeMode>('light')
  // Set only by the RC-16 correction; otherwise the server value is used.
  const [correctedTokens, setCorrectedTokens] = useState<V2CustomTokens | null>(null)
  const customTokens = correctedTokens ?? serverCustomTokens

  /*
   * Writes the theme onto <html>: the dark class, the saved choice, and every
   * `--v2-*` variable (custom tokens first, defaults otherwise). Called from the
   * mount effect and from the mode effect below.
   */
  const applyTheme = (themeMode: ThemeMode) => {
    const root = document.documentElement
    const isDark = themeMode === 'dark'

    // Toggle dark class on html element
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    // Save preference
    localStorage.setItem(V2_THEME_STORAGE_KEY, themeMode)

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

    /*
     * The SOLID amber and green, beside the bg/border/text/icon sets above.
     *
     * Written here as well as in `v2-theme-tokens.css` because the guard holds
     * the two to be identical: the sheet is what paints before hydration and
     * this is what paints after, and a token in one but not the other is a
     * colour that changes at hydration.
     *
     * The same value in both modes — amber and green read on either ground —
     * which is why there is no `isDark` branch. They are not customisable
     * today; when they become so they take a `customTokens.colors?.…` on the
     * left exactly as the pairs above do.
     */
    root.style.setProperty('--v2-warning', '#F59E0B')
    root.style.setProperty('--v2-success', '#10B981')

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * THE STATUS FAMILY, WHICH NOTHING SET AT RUNTIME.
     *
     * These twelve were declared only in `app/v2/globals-v2.css`, and that
     * stylesheet is imported by `/v2` and `/business-os/crm` — not by
     * `/business-os`, where the advisor card lives. So on the dashboard every
     * one of them was UNDEFINED.
     *
     * An undefined custom property with no fallback makes the whole declaration
     * invalid, which fails quietly in both directions at once:
     *
     *   color       falls back to the inherited colour, so the advisor's "if I
     *               handle it" line rendered as muted grey on a dark card and an
     *               owner reported they could not read it
     *   background  resolves to nothing, so the panel lost its tint and the two
     *               outcomes looked identical
     *
     * Set here rather than by importing the stylesheet into one more layout: the
     * provider is the only thing guaranteed to run on every page that uses these
     * tokens, and it already owns `--v2-success-*` and `--v2-error-*` for
     * exactly that reason. A stylesheet import fixes one route and leaves the
     * next one to be discovered by a user.
     *
     * Values mirror `globals-v2.css` deliberately. Where both are present the
     * stylesheet's `:root` loses to this inline style, so they must not drift —
     * `statusTokensMatchStylesheet.guard.test.ts` holds them together.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const statusColors = isDark
      ? {
          successBg: '#1E293B', successBorder: '#15803D', successText: '#86EFAC',
          executingBg: '#1E293B', executingBorder: '#1E40AF', executingText: '#93C5FD',
          errorBg: '#1E293B', errorBorder: '#991B1B', errorText: '#FCA5A5',
          warningBg: '#1E293B', warningBorder: '#92400E', warningText: '#FDE68A',
        }
      : {
          successBg: '#F0FDF4', successBorder: '#BBF7D0', successText: '#15803D',
          executingBg: '#EFF6FF', executingBorder: '#BFDBFE', executingText: '#1E40AF',
          errorBg: '#FEF2F2', errorBorder: '#FECACA', errorText: '#991B1B',
          warningBg: '#FFFBEB', warningBorder: '#FDE68A', warningText: '#92400E',
        }

    root.style.setProperty('--v2-status-success-bg', statusColors.successBg)
    root.style.setProperty('--v2-status-success-border', statusColors.successBorder)
    root.style.setProperty('--v2-status-success-text', statusColors.successText)
    root.style.setProperty('--v2-status-executing-bg', statusColors.executingBg)
    root.style.setProperty('--v2-status-executing-border', statusColors.executingBorder)
    root.style.setProperty('--v2-status-executing-text', statusColors.executingText)
    root.style.setProperty('--v2-status-error-bg', statusColors.errorBg)
    root.style.setProperty('--v2-status-error-border', statusColors.errorBorder)
    root.style.setProperty('--v2-status-error-text', statusColors.errorText)
    root.style.setProperty('--v2-status-warning-bg', statusColors.warningBg)
    root.style.setProperty('--v2-status-warning-border', statusColors.warningBorder)
    root.style.setProperty('--v2-status-warning-text', statusColors.warningText)

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
  }

  useIsomorphicLayoutEffect(() => {
    // Check localStorage for saved preference, otherwise the system preference.
    // V2ThemeScript makes the same decision before paint (parity test T-S2).
    const savedMode = localStorage.getItem(V2_THEME_STORAGE_KEY) as ThemeMode
    const initialMode: ThemeMode = savedMode
      ? savedMode
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    // Written to the DOM here, in the layout phase, so a client-side entry into
    // an owner segment has the right theme before its first paint (SA RC-1).
    applyTheme(initialMode)

    // The context state follows as a transition. A synchronous update here, on
    // the hydration commit, would reach the children's Suspense boundary while
    // it is still dehydrated and force React to discard the server HTML and
    // client-render the whole page (found by T-P2). A transition lets React
    // hydrate the boundary first. Nothing visible depends on it: the DOM above
    // is already right.
    startTransition(() => {
      setMode(initialMode)
      setMounted(true)
    })
    // Deps: mount only; customTokens changes are handled by the effect below
  }, [])

  useIsomorphicLayoutEffect(() => {
    // Kept (TH-1): before `mounted`, `mode` is still the initial 'light', and
    // running would strip the `.dark` that V2ThemeScript and the mount effect
    // set, and persist 'light'.
    if (!mounted) return
    applyTheme(mode)
    // Deps: applyTheme reads only mode and customTokens
  }, [mode, mounted, customTokens])

  /*
   * RC-16: the browser correction, for an UNKNOWN server render only. One
   * request, no-store; the answer is sanitized again here (defence in depth)
   * and applied through the mode effect above (applyTheme). Any failure keeps
   * the defaults silently, which is today's outcome for a failed read. Nothing
   * is written after unmount. A plain effect: nothing is painted from it.
   */
  useEffect(() => {
    if (customTokensKnown) return
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(V2_CUSTOM_TOKENS_CORRECTION_PATH, { cache: 'no-store', signal: controller.signal })
        if (!res.ok) {
          if (!cancelled) logger.warn({ status: res.status }, 'Custom tokens correction unavailable; keeping the defaults')
          return
        }
        const body: unknown = await res.json()
        if (cancelled) return
        const data = (body as { success?: unknown; data?: unknown } | null)
        if (!data || data.success !== true) return
        setCorrectedTokens(sanitizeV2CustomTokens(data.data))
      } catch (err) {
        if (!cancelled) logger.warn({ err }, 'Custom tokens correction failed; keeping the defaults')
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [customTokensKnown])

  const toggleMode = () => {
    setMode(prev => prev === 'light' ? 'dark' : 'light')
  }

  // Stable unless something a consumer can see changed, so `mounted` flipping
  // does not re-render every consumer.
  const value = useMemo(
    () => ({ tokens: v2Tokens, customTokens, mode, setMode, toggleMode }),
    // Deps: toggleMode only calls the stable setMode
    [customTokens, mode]
  )

  /*
   * The children render on the server now (TH-1): the theme reaches the first
   * frame through V2ThemeScript and the stylesheets, not through this provider.
   *
   * The Suspense boundary is a fail-soft net (SA Q-2 / RC-5, workplan §5 Q5):
   * page code under these layouts never ran on the server before, so if it
   * throws during server render the boundary falls back to a client render of
   * that subtree, which is exactly the old behaviour, instead of a 500. It is
   * NOT a pass condition: any such fallback is a defect to fix. Do not widen the
   * fallback beyond `null` without SA.
   */
  return (
    <ThemeContext.Provider value={value}>
      <Suspense fallback={null}>{children}</Suspense>
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
