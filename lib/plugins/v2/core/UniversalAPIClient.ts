export class UniversalAPIClient {
  private config: UniversalPluginConfig
  private accessToken: string

  constructor(config: UniversalPluginConfig, accessToken: string) {
    this.config = config
    this.accessToken = accessToken
  }

  async callEndpoint(endpointKey: string, params: Record<string, any> = {}): Promise<any> {
    const endpoint = this.config.endpoints[endpointKey]
    if (!endpoint) {
      throw new Error(`Endpoint '${endpointKey}' not found in plugin configuration`)
    }

    const url = this.buildUrl(endpoint, params)
    const headers = this.buildHeaders(endpoint)
    const body = this.buildBody(endpoint, params)

    const response = await fetch(url.toString(), {
      method: endpoint.method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`)
    }

    let data = await response.json()

    // Extract data using JSONPath if specified
    if (endpoint.response?.dataPath) {
      data = this.extractData(data, endpoint.response.dataPath)
    }

    // Transform data if specified
    if (endpoint.response?.transform) {
      data = this.transformData(data, endpoint.response.transform)
    }

    return data
  }

  private buildUrl(endpoint: EndpointConfig, params: Record<string, any>): URL {
    let path = endpoint.path
    const queryParams = new URLSearchParams()

    // Replace path parameters and collect query parameters
    if (endpoint.params) {
      Object.entries(endpoint.params).forEach(([key, paramConfig]) => {
        const value = params[key]
        if (value !== undefined) {
          switch (paramConfig.type) {
            case 'path':
              path = path.replace(`{${key}}`, encodeURIComponent(String(value)))
              break
            case 'query':
              queryParams.set(key, String(value))
              break
          }
        }
      })
    }

    const url = new URL(path, this.config.api.baseUrl)
    queryParams.forEach((value, key) => url.searchParams.set(key, value))
    
    return url
  }

  private buildHeaders(endpoint: EndpointConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...this.config.api.headers
    }

    if (endpoint.auth !== false) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }

    if (endpoint.body?.type === 'json') {
      headers['Content-Type'] = 'application/json'
    }

    // Add header parameters
    if (endpoint.params) {
      Object.entries(endpoint.params).forEach(([key, paramConfig]) => {
        if (paramConfig.type === 'header' && key in this.config.api.headers) {
          headers[key] = this.config.api.headers[key]
        }
      })
    }

    return headers
  }

  private buildBody(endpoint: EndpointConfig, params: Record<string, any>): any {
    if (!endpoint.body) return null

    switch (endpoint.body.type) {
      case 'json':
        return this.mapBodyFields(endpoint.body.fields, params)
      default:
        return null
    }
  }

  private mapBodyFields(fields: Record<string, any>, params: Record<string, any>): any {
    const body: any = {}
    
    Object.entries(fields).forEach(([bodyField, paramKey]) => {
      if (typeof paramKey === 'string' && params[paramKey] !== undefined) {
        body[bodyField] = params[paramKey]
      } else {
        body[bodyField] = paramKey // Direct value
      }
    })

    return body
  }

  private extractData(data: any, path: string): any {
    // Simple JSONPath implementation
    if (path.startsWith('$.')) {
      const keys = path.substring(2).split('.')
      let result = data
      
      for (const key of keys) {
        result = result?.[key]
      }
      
      return result
    }
    
    return data
  }

  private transformData(data: any, transform: string): any {
    // Simple transformation functions
    switch (transform) {
      case 'flatten':
        return Array.isArray(data) ? data.flat() : data
      case 'count':
        return Array.isArray(data) ? data.length : 0
      default:
        return data
    }
  }
}