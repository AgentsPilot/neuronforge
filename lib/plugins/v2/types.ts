export interface UniversalPluginConfig {
  pluginKey: string
  name: string
  description: string
  version: string
  oauth: {
    authUrl: string
    tokenUrl: string
    scopes: string[]
    clientIdEnvVar: string
    clientSecretEnvVar: string
    redirectPath?: string
    customParams?: Record<string, string>
  }
  api: {
    baseUrl: string
    version?: string
    headers?: Record<string, string>
  }
  endpoints: Record<string, EndpointConfig>
  features?: {
    supportsRefresh?: boolean
    requiresUserConsent?: boolean
    customAuthFlow?: boolean
  }
}

export interface EndpointConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  params?: Record<string, ParameterConfig>
  body?: BodyConfig
  response?: ResponseConfig
  auth?: boolean
}

export interface ParameterConfig {
  type: 'query' | 'path' | 'header'
  required?: boolean
  transform?: string // e.g., "encodeURIComponent", "JSON.stringify"
}

export interface BodyConfig {
  type: 'json' | 'form' | 'multipart'
  fields: Record<string, any>
}

export interface ResponseConfig {
  dataPath?: string // JSONPath to extract data
  transform?: string // transformation function name
}