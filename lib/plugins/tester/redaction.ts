// lib/plugins/tester/redaction.ts
//
// PURE, defensive client-side redaction for the FR8 side console (Phase B).
//
// The Level-1 console is safe BY CONSTRUCTION — it only ever holds the assembled
// business parameters and the normalized ExecutionResult, so no OAuth token, bearer
// header, or secret is on this path. This helper is belt-and-suspenders: even so,
// before any console entry is rendered or copied we strip anything credential-shaped.
// (The hard security guarantee for any future Level-2 raw-capture path is server-side
// redaction — F2 — this client pass never substitutes for that.)

/** Keys that must never survive into a rendered/copied console entry. */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /authorization/i,
  /^bearer$/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /\bid[_-]?token\b/i,
  /client[_-]?secret/i,
  /\bapi[_-]?key\b/i,
  /^secret$/i,
  /^password$/i,
  /\bcookie\b/i,
  /set-cookie/i,
];

/** String value shapes that look like credentials even under a benign key. */
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-]+/i, // "Bearer eyJ..."
  /\bya29\.[A-Za-z0-9._\-]+/, // Google OAuth access tokens
  /\beyJ[A-Za-z0-9._\-]{10,}/, // JWT-shaped tokens
];

export const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function redactStringValue(value: string): string {
  let out = value;
  for (const re of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

/**
 * Recursively redact a value: sensitive keys are replaced wholesale, credential-shaped
 * string values are scrubbed. Depth-bounded to avoid pathological/cyclic structures.
 * Returns a NEW structure — never mutates the input.
 */
export function redactSensitive<T>(value: T, depth = 0): T {
  if (depth > 12 || value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return redactStringValue(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactSensitive(v, depth + 1)) as unknown as T;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactSensitive(val, depth + 1);
      }
    }
    return out as unknown as T;
  }

  return value;
}
