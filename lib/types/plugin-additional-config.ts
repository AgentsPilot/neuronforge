// lib/types/plugin-additional-config.ts

/**
 * Represents a single field in the additional configuration form
 */
export interface AdditionalConfigField {
  key: string
  label: string
  description?: string
  type: 'text'
  required: boolean
  placeholder?: string
}

/**
 * Configuration for additional plugin information collection
 */
export interface AdditionalConfig {
  enabled: boolean
  fields: AdditionalConfigField[]
}

/**
 * Structured plugin profile data with separation between auth and additional info
 */
export interface PluginProfileData {
  auth?: Record<string, any>
  additional?: Record<string, any>
}

/**
 * Result from additional config API operations
 */
export interface AdditionalConfigResult {
  success: boolean
  data?: Record<string, any>
  error?: string
}
