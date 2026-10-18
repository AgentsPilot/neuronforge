/**
 * The keyed fingerprint of an email, for the deletion receipt (data export
 * DE-10b.1; requirement §5.2, SA Review 2 §E "Fingerprint").
 *
 * A receipt must answer "was jane@example.com deleted?" without holding the
 * address. So it holds `HMAC-SHA256(key, lower(btrim(email)))`: the same
 * address always gives the same value, and without the key nobody can test a
 * guess. The key never reaches the database: this module computes the value
 * and the cleanup function stores it.
 *
 * ── Key ────────────────────────────────────────────────────────────────────
 * `DELETION_RECEIPT_FINGERPRINT_KEY`, server-only, at least 32 characters. The
 * raw env value is NEVER the HMAC key: it is stretched with HKDF-SHA256 and its
 * own salt and info string (the `previewToken.ts` precedent; a unit test pins
 * it). Missing or short → `FingerprintKeyError`, and every delete answers 503
 * `not_configured` (fails closed, SA C2-5). Rotating the key needs a new
 * `FINGERPRINT_KEY_VERSION`; old receipts keep the version they were made with.
 *
 * Never log the email, the key or a fingerprint.
 *
 * @module lib/business-os/account-deletion/receiptFingerprint
 */

import 'server-only';
import { createHmac, hkdfSync } from 'crypto';

/** The env var the key comes from. Set in Vercel Production and Preview (runbook). */
const KEY_ENV = 'DELETION_RECEIPT_FINGERPRINT_KEY';
const MIN_KEY_LENGTH = 32;
const HKDF_SALT = 'neuronforge/deletion-receipt-fingerprint/salt/v1';
const HKDF_INFO = 'neuronforge/deletion-receipt-fingerprint/v1';

/** Stored on every receipt. Bump it, and keep the old key for lookups, when the key rotates. */
export const FINGERPRINT_KEY_VERSION = 1;

export class FingerprintKeyError extends Error {
  constructor() {
    super('The deletion receipt fingerprint key is not configured');
    this.name = 'FingerprintKeyError';
  }
}

function deriveKey(): Buffer {
  const raw = process.env[KEY_ENV];
  const ikm = typeof raw === 'string' ? raw.trim() : '';
  if (ikm.length < MIN_KEY_LENGTH) throw new FingerprintKeyError();
  return Buffer.from(hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, 32));
}

/** True when a key can be derived. The routes answer 503 `not_configured` otherwise. */
export function isFingerprintKeyAvailable(): boolean {
  try {
    deriveKey();
    return true;
  } catch {
    return false;
  }
}

/** The same rule the database uses for a login email: trimmed, lower case. */
export function normaliseEmailForFingerprint(email: string): string {
  return email.trim().toLowerCase();
}

/** 64 lower-case hex characters. Throws `FingerprintKeyError` when no key can be derived. */
export function fingerprintEmail(email: string): string {
  return createHmac('sha256', deriveKey()).update(normaliseEmailForFingerprint(email), 'utf8').digest('hex');
}
