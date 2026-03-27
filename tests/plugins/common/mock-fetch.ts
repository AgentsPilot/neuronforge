/**
 * Global fetch mock helper for plugin executor tests.
 *
 * Intercepts all fetch() calls so that executor code paths (URL construction,
 * header building, body serialization, response parsing) are fully exercised
 * without any real HTTP traffic.
 */

// Store for tracking fetch invocations
let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
let originalFetch: typeof global.fetch;
let mockInstalled = false;

// ---------- Response Builders ----------

function buildResponse(body: unknown, status: number, statusText = ''): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText || (status >= 200 && status < 300 ? 'OK' : 'Error'),
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => bodyStr,
    clone: () => buildResponse(body, status, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob([bodyStr]),
    formData: async () => new FormData(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    bytes: async () => new Uint8Array(),
  } as Response;
}

// ---------- Public API ----------

/**
 * Mock fetch to return a single successful JSON response.
 */
export function mockFetchSuccess(responseBody: unknown, statusCode = 200): void {
  installMock((url, opts) => {
    fetchCalls.push({ url: url as string, options: opts as RequestInit });
    return Promise.resolve(buildResponse(responseBody, statusCode));
  });
}

/**
 * Mock fetch to return an error response.
 */
export function mockFetchError(status: number, errorBody: unknown): void {
  installMock((url, opts) => {
    fetchCalls.push({ url: url as string, options: opts as RequestInit });
    return Promise.resolve(buildResponse(errorBody, status));
  });
}

/**
 * Mock fetch to return responses in sequence.
 * Each call to fetch() consumes the next response in the array.
 * If calls exceed the array length, the last response is reused.
 */
export function mockFetchSequence(
  responses: Array<{ body: unknown; status?: number }>
): void {
  let callIndex = 0;
  installMock((url, opts) => {
    fetchCalls.push({ url: url as string, options: opts as RequestInit });
    const idx = Math.min(callIndex, responses.length - 1);
    callIndex++;
    const r = responses[idx];
    return Promise.resolve(buildResponse(r.body, r.status ?? 200));
  });
}

/**
 * Get the most recent fetch invocation.
 */
export function getLastFetchCall(): { url: string; options?: RequestInit } | undefined {
  return fetchCalls[fetchCalls.length - 1];
}

/**
 * Get all fetch invocations recorded since the mock was installed.
 */
export function getAllFetchCalls(): Array<{ url: string; options?: RequestInit }> {
  return [...fetchCalls];
}

/**
 * Restore the original global.fetch and clear recorded calls.
 * Safe to call even if no mock was installed.
 */
export function restoreFetch(): void {
  if (mockInstalled && originalFetch) {
    global.fetch = originalFetch;
    mockInstalled = false;
  }
  fetchCalls = [];
}

/**
 * Reset the recorded call list without uninstalling the mock.
 */
export function resetFetchCalls(): void {
  fetchCalls = [];
}

// ---------- Internal ----------

function installMock(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  if (!mockInstalled) {
    originalFetch = global.fetch;
    mockInstalled = true;
  }
  fetchCalls = [];
  global.fetch = handler as typeof global.fetch;
}
