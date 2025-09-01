// lib/plugins/v2/core/UniversalPlugin.ts
import { PluginStrategy } from '../../pluginRegistry'
import { UniversalPluginConfig } from '../types'
import { UniversalOAuthHandler } from './UniversalOAuthHandler'
import { UniversalAPIClient } from './UniversalAPIClient'

export class UniversalPlugin implements PluginStrategy {
  public pluginKey: string
  public name: string
  private config: UniversalPluginConfig
  private oauthHandler: UniversalOAuthHandler

  constructor(config: UniversalPluginConfig) {
    this.config = config
    this.pluginKey = config.pluginKey
    this.name = config.name
    this.oauthHandler = new UniversalOAuthHandler(config)
  }

  async connect({ popup, userId }: { supabase: any; popup: Window; userId: string }): Promise<void> {
    return this.oauthHandler.connect(userId, popup)
  }

  async handleOAuthCallback({ code, state, supabase }: { code: string; state: string; supabase: any }): Promise<any> {
    return this.oauthHandler.handleCallback(code, state)
  }

  async run({ connection, userId, input_variables }: { 
    connection: any; 
    userId: string; 
    input_variables: Record<string, any> 
  }): Promise<any> {
    if (!connection?.access_token) {
      throw new Error(`${this.name} connection not available or expired`)
    }

    const client = new UniversalAPIClient(this.config, connection.access_token)
    const action = input_variables.action || 'default'

    if (!this.config.endpoints[action]) {
      throw new Error(`Action '${action}' not supported by ${this.name}`)
    }

    return client.callEndpoint(action, input_variables)
  }
}