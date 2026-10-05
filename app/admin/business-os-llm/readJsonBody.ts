/**
 * Reads a route's JSON body without ever throwing (Gap B slice B2a, QA-B2a-2).
 *
 * A proxy or platform error page (an HTML 502, an HTML 404) is not JSON. Parsing
 * it with `response.json()` throws a parser message ("Unexpected token '<'…")
 * that the Activity tab and its drawer would otherwise show to the admin as if
 * it were the route's own error. NULL means "no readable body": the caller
 * shows its own fallback words instead.
 */

export interface ApiBody {
  success?: unknown;
  error?: unknown;
  data?: unknown;
}

export async function readJsonBody(response: Response): Promise<ApiBody | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ApiBody) : null;
  } catch {
    return null;
  }
}
