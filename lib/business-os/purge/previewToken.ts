// lib/business-os/purge/previewToken.ts
//
// The signed preview → commit token (purge AC-29; admin delete AD-2a T1, SA-3,
// parent plan C-6 … C-12, SA AC2-5). A destructive commit must present a token
// that a preview minted for THIS actor, THIS target, THESE parameters, a few
// minutes ago. Surface-agnostic on purpose: purge slice 5 calls the same
// `mintPreviewToken` / `verifyPreviewToken` with `surface: 'customer'` and
// `actorId = targetId`, and its own `gateVersion`.
//
// ── Key (C-6, SA T-6 / AC2-5) ───────────────────────────────────────────────
// HKDF-SHA256 from `SUPABASE_SERVICE_ROLE_KEY` with a fixed salt and a
// versioned `info`. The raw env value is NEVER the HMAC key (a unit test pins
// it). No new env var. Absent, or under 32 characters → `PreviewTokenKeyError`,
// which the commit route answers 500 `token_key_unavailable` and the preview
// as "no token" (C-7). NEVER "no token needed".
// If the rotation (B-1) moves to Supabase's new secret-key format and the env
// var NAME changes, `KEY_ENV` below must follow, or every commit 500s (fails
// closed, but needs a code change). Recorded in `supabase/held/README.md`.
//
// ── Honest limits (workplan §2.2) ───────────────────────────────────────────
//   * binds actor + target + parameters + time, NOT a session;
//   * NOT single-use: a replay within the TTL re-runs every check and takes the
//     RPC's advisory lock (SA T-5, stateless by decision);
//   * only as secret as the service-role key. Today that key is public, which
//     is why the feature ships inactive. Rotating it rotates the derived key.
//
// ── Never logged, never persisted client-side (C-12, AC2-5) ────────────────
// Nothing here logs. Callers log `tokenDigest(token)` (a short sha256 prefix),
// never the token. The client holds it in component state only (AD-2b guard).

import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'crypto';

import { canonicalJson } from './canonicalJson';
import type { ConfirmKind } from './confirmation';
import type { PurgeLevel, PurgeOptions } from './types';

/** The env var the derived key comes from. See the rotation note above. */
const KEY_ENV = 'SUPABASE_SERVICE_ROLE_KEY';
const MIN_IKM_LENGTH = 32;
const HKDF_SALT = 'agentpilot/purge-preview-token/salt/v1';
const HKDF_INFO = 'agentpilot/purge-preview-token/v1';

/** Payload format version. */
export const PREVIEW_TOKEN_VERSION = 1 as const;
/** SA-3: at most 10 minutes from mint to commit. */
export const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;
/** The clock-skew allowance, at most 30 s. */
export const PREVIEW_TOKEN_CLOCK_SKEW_MS = 30 * 1000;
/** Generous for a ~400-byte payload; the route schema caps the input at 4096. */
const MAX_TOKEN_LENGTH = 4096;

export type PreviewTokenSurface = 'admin' | 'customer' | 'internal';

export interface PreviewTokenPayload {
  v: typeof PREVIEW_TOKEN_VERSION;
  surface: PreviewTokenSurface;
  actorId: string;
  targetId: string;
  level: PurgeLevel;
  options: PurgeOptions;
  /** What the preview told the caller to type. A name ↔ email flip voids the token (AC2-5). */
  confirmKind: ConfirmKind;
  /** Per surface. Bumping it voids every outstanding token (C-11). */
  gateVersion: number;
  /** `SchemaReconciler`'s fingerprint at preview; recomputed and compared at commit (SA-3). */
  schemaFingerprint: string;
  /** The preview's correlation id, carried into the commit's audit rows (FR-A11). */
  correlationId: string;
  /** Epoch ms. */
  iat: number;
  /** Epoch ms; `exp - iat` ≤ the TTL. */
  exp: number;
}

export type PreviewTokenInput = Omit<PreviewTokenPayload, 'v' | 'iat' | 'exp'>;

/** The key cannot be derived. A 500, never "no token needed" (C-7). */
export class PreviewTokenKeyError extends Error {
  constructor() {
    super('The preview-token signing key is unavailable');
    this.name = 'PreviewTokenKeyError';
  }
}

/** Each mismatch is its own code (AC-A6), so a refusal says exactly what changed. */
export type PreviewTokenMismatch =
  | 'token_malformed'
  | 'token_signature'
  | 'token_expired'
  | 'token_version'
  | 'token_gate_version'
  | 'token_surface'
  | 'token_actor'
  | 'token_target'
  | 'token_level'
  | 'token_options';

export type PreviewTokenVerification =
  | { ok: true; payload: PreviewTokenPayload }
  | { ok: false; code: PreviewTokenMismatch };

/** What the verifier requires the token to say. `confirmKind` and the fingerprint need fresh reads, so the caller compares those. */
export interface PreviewTokenExpectation {
  surface: PreviewTokenSurface;
  actorId: string;
  targetId: string;
  level: PurgeLevel;
  options: PurgeOptions;
  gateVersion: number;
}

function deriveKey(): Buffer {
  const ikm = process.env[KEY_ENV];
  if (typeof ikm !== 'string' || ikm.length < MIN_IKM_LENGTH) throw new PreviewTokenKeyError();
  return Buffer.from(hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, 32));
}

/** True when a signing key can be derived. For the preview's "can I offer a token?" decision. */
export function isPreviewTokenKeyAvailable(): boolean {
  try {
    deriveKey();
    return true;
  } catch {
    return false;
  }
}

function sign(segment: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(segment).digest();
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

/** Only the three known option keys, as booleans: what is signed is exactly what runs. */
function pickOptions(o: PurgeOptions): PurgeOptions {
  return { integrations: o.integrations === true, agents: o.agents === true, activityHistory: o.activityHistory === true };
}

/**
 * Mint a token. Throws `PreviewTokenKeyError` when no key can be derived.
 * Wire format: `base64url(canonical payload).base64url(hmac)` (C-10).
 */
export function mintPreviewToken(input: PreviewTokenInput, now: number = Date.now()): string {
  const key = deriveKey();
  const payload: PreviewTokenPayload = {
    v: PREVIEW_TOKEN_VERSION,
    surface: input.surface,
    actorId: input.actorId.toLowerCase(),
    targetId: input.targetId.toLowerCase(),
    level: input.level,
    options: pickOptions(input.options),
    confirmKind: input.confirmKind,
    gateVersion: input.gateVersion,
    schemaFingerprint: input.schemaFingerprint,
    correlationId: input.correlationId,
    iat: now,
    exp: now + PREVIEW_TOKEN_TTL_MS,
  };
  const segment = b64url(canonicalJson(payload));
  return `${segment}.${b64url(sign(segment, key))}`;
}

function isPayloadShape(p: unknown): p is PreviewTokenPayload {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  const o = r.options as Record<string, unknown> | undefined;
  return (
    typeof r.v === 'number' &&
    typeof r.surface === 'string' &&
    typeof r.actorId === 'string' &&
    typeof r.targetId === 'string' &&
    typeof r.level === 'string' &&
    !!o &&
    typeof o === 'object' &&
    typeof o.integrations === 'boolean' &&
    typeof o.agents === 'boolean' &&
    typeof o.activityHistory === 'boolean' &&
    (r.confirmKind === 'business name' || r.confirmKind === 'account email') &&
    typeof r.gateVersion === 'number' &&
    typeof r.schemaFingerprint === 'string' &&
    typeof r.correlationId === 'string' &&
    typeof r.iat === 'number' &&
    typeof r.exp === 'number'
  );
}

/**
 * Verify a token against what the server expects, in the order of workplan
 * §2.2: signature → expiry → version / gateVersion → surface → actor → target
 * → level → options. Throws `PreviewTokenKeyError` when no key can be
 * derived (the caller answers 500); every other failure is a code.
 */
export function verifyPreviewToken(
  token: string,
  expected: PreviewTokenExpectation,
  now: number = Date.now(),
): PreviewTokenVerification {
  const key = deriveKey();
  const fail = (code: PreviewTokenMismatch): PreviewTokenVerification => ({ ok: false, code });

  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return fail('token_malformed');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return fail('token_malformed');
  const [segment, sigText] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || !/^[A-Za-z0-9_-]+$/.test(sigText)) return fail('token_malformed');

  // C-8: constant-time compare, with a length guard (timingSafeEqual throws on unequal lengths).
  const presented = Buffer.from(sigText, 'base64url');
  const computed = sign(segment, key);
  if (presented.length !== computed.length || !timingSafeEqual(presented, computed)) return fail('token_signature');

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return fail('token_malformed');
  }
  if (!isPayloadShape(payload)) return fail('token_malformed');

  // Expiry, with at most the skew allowance either side. A lifetime longer
  // than the TTL is not something this module mints: malformed.
  if (payload.exp - payload.iat > PREVIEW_TOKEN_TTL_MS || payload.exp < payload.iat) return fail('token_malformed');
  if (now > payload.exp + PREVIEW_TOKEN_CLOCK_SKEW_MS) return fail('token_expired');
  if (payload.iat > now + PREVIEW_TOKEN_CLOCK_SKEW_MS) return fail('token_expired');

  if (payload.v !== PREVIEW_TOKEN_VERSION) return fail('token_version');
  if (payload.gateVersion !== expected.gateVersion) return fail('token_gate_version');
  if (payload.surface !== expected.surface) return fail('token_surface');
  if (payload.actorId !== expected.actorId.toLowerCase()) return fail('token_actor');
  if (payload.targetId !== expected.targetId.toLowerCase()) return fail('token_target');
  if (payload.level !== expected.level) return fail('token_level');
  if (canonicalJson(payload.options) !== canonicalJson(pickOptions(expected.options))) return fail('token_options');

  return { ok: true, payload };
}

/** A short, non-reversible handle for logs (C-12). Never log the token itself. */
export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}
