// types/settings.ts

export interface UserProfile {
  id: string
  full_name?: string
  avatar_url?: string
  plan?: string
  company?: string
  job_title?: string
  timezone?: string
  language?: string
  created_at?: string
  updated_at?: string
}

export interface UserPreferences {
  user_id: string
  theme: 'light' | 'dark' | 'system'
  sidebar_collapsed: boolean
  compact_mode: boolean
  data_retention_days: number
  analytics_enabled: boolean
  telemetry_enabled: boolean
  default_model: string
  max_tokens: number
  temperature: number
  auto_save_conversations: boolean
  show_timestamps: boolean
  enable_sounds: boolean
  keyboard_shortcuts: boolean
  debug_mode: boolean
  beta_features: boolean
}

export interface NotificationSettings {
  user_id: string
  email_enabled: boolean
  email_frequency: 'immediate' | 'daily' | 'weekly' | 'never'
  email_agent_updates: boolean
  email_system_alerts: boolean
  email_security_alerts: boolean
  email_marketing: boolean
  push_enabled: boolean
  push_agent_updates: boolean
  push_system_alerts: boolean
  push_mentions: boolean
  desktop_enabled: boolean
  desktop_agent_updates: boolean
  desktop_system_alerts: boolean
  inapp_enabled: boolean
  inapp_sounds: boolean
  inapp_popups: boolean
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
}

export interface PluginConnection {
  id: string
  plugin_key: string
  plugin_name: string
  username?: string
  email?: string
  status: 'active' | 'expired' | 'error' | 'disabled'
  connected_at: string
  last_used?: string
  profile_data?: any
}