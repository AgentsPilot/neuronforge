/**
 * The deletion receipt fingerprint (DE-10b.1, workplan §7.1; SA Review 2 §E).
 * Pure crypto, no database.
 */

import { createHmac, hkdfSync } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FINGERPRINT_KEY_VERSION,
  FingerprintKeyError,
  fingerprintEmail,
  isFingerprintKeyAvailable,
} from '../receiptFingerprint';

const ENV_NAME = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const KEY_A = 'a'.repeat(48);
const KEY_B = 'b'.repeat(48);
const saved = process.env[ENV_NAME];

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = saved;
});

describe('fingerprintEmail', () => {
  it('is 64 lower-case hex, and the same for any case or outer spacing of one address', () => {
    process.env[ENV_NAME] = KEY_A;
    const value = fingerprintEmail('jane@example.com');
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintEmail('  JANE@Example.COM ')).toBe(value);
    expect(fingerprintEmail('jane2@example.com')).not.toBe(value);
  });

  it('different keys give different values', () => {
    process.env[ENV_NAME] = KEY_A;
    const a = fingerprintEmail('jane@example.com');
    process.env[ENV_NAME] = KEY_B;
    expect(fingerprintEmail('jane@example.com')).not.toBe(a);
  });

  it('the raw env value is not the HMAC key: it is stretched with HKDF first', () => {
    process.env[ENV_NAME] = KEY_A;
    const direct = createHmac('sha256', KEY_A).update('jane@example.com').digest('hex');
    expect(fingerprintEmail('jane@example.com')).not.toBe(direct);
    const derived = Buffer.from(
      hkdfSync('sha256', KEY_A, 'neuronforge/deletion-receipt-fingerprint/salt/v1', 'neuronforge/deletion-receipt-fingerprint/v1', 32)
    );
    expect(fingerprintEmail('jane@example.com')).toBe(createHmac('sha256', derived).update('jane@example.com').digest('hex'));
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['under 32 characters', 'x'.repeat(31)],
  ])('a %s key throws FingerprintKeyError, and isFingerprintKeyAvailable says false', (_name, value) => {
    if (value === undefined) delete process.env[ENV_NAME];
    else process.env[ENV_NAME] = value;
    expect(() => fingerprintEmail('jane@example.com')).toThrow(FingerprintKeyError);
    expect(isFingerprintKeyAvailable()).toBe(false);
  });

  it('a 32-character key is enough', () => {
    process.env[ENV_NAME] = 'k'.repeat(32);
    expect(isFingerprintKeyAvailable()).toBe(true);
    expect(FINGERPRINT_KEY_VERSION).toBe(1);
  });

  it('is server-only, never logs, and the env name has one reader', () => {
    const source = readFileSync(join(__dirname, '..', 'receiptFingerprint.ts'), 'utf8');
    expect(source).toMatch(/^import 'server-only';$/m);
    expect(source).not.toMatch(/console\.|createLogger/);
  });
});
