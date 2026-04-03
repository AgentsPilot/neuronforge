/**
 * Thin HTTP client wrapper over native fetch.
 *
 * Adds cookie forwarding, correlation IDs, and verbose logging
 * for simulator HTTP calls to the local API server.
 */

import type { HttpRequestOptions, HttpResponse, SimulatorLogger } from './types';

export class HttpClient {
  private logger: SimulatorLogger;

  constructor(logger: SimulatorLogger) {
    this.logger = logger;
  }

  async request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const correlationId = options.correlationId || crypto.randomUUID();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
      ...options.headers,
    };

    if (options.cookieHeader) {
      headers['Cookie'] = options.cookieHeader;
    }

    this.logger.debug(`HTTP ${options.method} ${options.url}`, {
      correlationId,
      hasBody: !!options.body,
      hasCookies: !!options.cookieHeader,
    });

    if (options.body) {
      this.logger.debug('Request body', { body: options.body as Record<string, unknown> });
    }

    const startTime = Date.now();

    const response = await fetch(options.url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const duration = Date.now() - startTime;
    let data: T;

    try {
      data = await response.json() as T;
    } catch {
      // If JSON parsing fails, return empty object
      data = {} as T;
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    this.logger.debug(`HTTP ${response.status} in ${duration}ms`, {
      url: options.url,
      status: response.status,
      duration,
    });

    if (!response.ok) {
      this.logger.debug('Response body (error)', { data: data as Record<string, unknown> });
    }

    return {
      status: response.status,
      ok: response.ok,
      data,
      headers: responseHeaders,
    };
  }

  async post<T = unknown>(
    url: string,
    body: unknown,
    cookieHeader?: string,
  ): Promise<HttpResponse<T>> {
    return this.request<T>({
      method: 'POST',
      url,
      body,
      cookieHeader,
    });
  }
}
