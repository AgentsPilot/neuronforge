/**
 * lib/encryptCredentials.ts fails closed when ENCRYPTION_SECRET is unset.
 *
 * The secret is read on every call (no module-level read, no cache), so each
 * test sets or clears the variable after import and the behaviour follows.
 */

import { encryptCredentials, decryptCredentials } from '@/lib/encryptCredentials';

const ORIGINAL = process.env.ENCRYPTION_SECRET;
const SAMPLE = { username: 'user@example.com', password: 'p4ss' };

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ENCRYPTION_SECRET;
  else process.env.ENCRYPTION_SECRET = ORIGINAL;
});

describe('encryptCredentials fails closed', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('E-1 %s: encrypt and decrypt throw, naming the variable only', (_label, value) => {
    process.env.ENCRYPTION_SECRET = 'value-a';
    const cipher = encryptCredentials(SAMPLE);

    if (value === undefined) delete process.env.ENCRYPTION_SECRET;
    else process.env.ENCRYPTION_SECRET = value;

    expect(() => encryptCredentials(SAMPLE)).toThrow('ENCRYPTION_SECRET must be set');
    expect(() => decryptCredentials(cipher)).toThrow('ENCRYPTION_SECRET must be set');
  });

  it('E-2 set: a round trip returns the input', () => {
    process.env.ENCRYPTION_SECRET = 'value-a';
    expect(decryptCredentials(encryptCredentials(SAMPLE))).toEqual(SAMPLE);
  });

  it('E-3 no cache: encrypt under A, decrypt under B throws, decrypt under A succeeds', () => {
    process.env.ENCRYPTION_SECRET = 'value-a';
    const cipher = encryptCredentials(SAMPLE);

    process.env.ENCRYPTION_SECRET = 'value-b';
    expect(() => decryptCredentials(cipher)).toThrow();

    process.env.ENCRYPTION_SECRET = 'value-a';
    expect(decryptCredentials(cipher)).toEqual(SAMPLE);
  });
});
