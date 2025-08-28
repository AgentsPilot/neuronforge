// hooks/useTheme.ts
'use client'

import { useState, useEffect } from 'react'

type Theme = 'light' | 'dark' | 'system'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('system')

  // Apply theme to entire document
  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement
    
    // Remove existing classes
    root.classList.remove('dark', 'light')
    
    let shouldBeDark = false
    
    if (newTheme === 'dark') {
      shouldBeDark = true
    } else if (newTheme === 'system') {
      shouldBeDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    
    if (shouldBeDark) {
      root.classList.add('dark')
      root.style.setProperty('--background', '#0a0a0a')
      root.style.setProperty('--foreground', '#ededed')
    } else {
      root.style.setProperty('--background', '#ffffff')
      root.style.setProperty('--foreground', '#171717')
    }
    
    // Store in localStorage
    localStorage.setItem('app-theme', newTheme)
    
    console.log(`Theme applied: ${newTheme}, Dark class: ${root.classList.contains('dark')}`)
  }

  // Load theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('app-theme') as Theme || 'system'
    setTheme(savedTheme)
    applyTheme(savedTheme)
  }, [])

  // Listen for system theme changes
  useEffect(() => {
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = () => applyTheme('system')
      
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme])

  const changeTheme = (newTheme: Theme) => {
    setTheme(newTheme)
    applyTheme(newTheme)
  }

  return {
    theme,
    setTheme: changeTheme,
    isDark: theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  }
}