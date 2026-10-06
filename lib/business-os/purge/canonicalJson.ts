// lib/business-os/purge/canonicalJson.ts
//
// Canonical JSON (parent purge plan C-9; admin delete AD-2a T1): one byte
// string per value, whatever order its keys were written in. The preview token
// signs this form, and the commit compares options in it, so `{ a, b }` and
// `{ b, a }` are the same parameters and cannot produce two different tokens.
//
// Rules: object keys sorted by code unit (not `localeCompare`, which may treat
// characters as ignorable), recursively; array order kept (it is meaningful);
// numbers, strings, booleans and null as `JSON.stringify` writes them. Values
// JSON cannot represent faithfully (undefined, functions, symbols, bigint,
// NaN / Infinity) THROW rather than being silently dropped or turned into
// `null`: a token that signs a different value than the caller passed would
// be a quiet mismatch.

export type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => encode(v, `${path}[${i}]`)).join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`canonicalJson: only plain objects are supported, at ${path}`);
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort(); // default sort = code-unit order
      return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(record[k], `${path}.${k}`)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
}

/** The canonical JSON text of `value`. Throws on a value JSON cannot represent. */
export function canonicalJson(value: unknown): string {
  return encode(value, '$');
}
