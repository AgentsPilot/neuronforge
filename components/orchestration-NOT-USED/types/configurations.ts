// Configuration Field Interface
export interface ConfigurationField {
  id: string
  type: 'email' | 'text' | 'textarea' | 'select' | 'url' | 'checkbox'
  label: string
  placeholder?: string
  required: boolean
  description?: string
  testable?: boolean
  options?: string[]
}

// Plugin Connection Status
export type PluginConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// Configuration Data
export interface ConfigurationData {
  [key: string]: any
}