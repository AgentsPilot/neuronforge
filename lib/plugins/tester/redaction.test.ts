// lib/plugins/tester/redaction.test.ts
import { redactSensitive, REDACTED } from './redaction';

describe('redactSensitive (FR8 Phase B acceptance criterion)', () => {
  it('redacts sensitive keys wholesale', () => {
    const out = redactSensitive({
      Authorization: 'Bearer abc.def.ghi',
      access_token: 'ya29.some-token',
      refresh_token: 'r-token',
      client_secret: 'shh',
      cookie: 'session=1',
      apiKey: 'k',
      password: 'p',
    });
    expect(out).toEqual({
      Authorization: REDACTED,
      access_token: REDACTED,
      refresh_token: REDACTED,
      client_secret: REDACTED,
      cookie: REDACTED,
      apiKey: REDACTED,
      password: REDACTED,
    });
  });

  it('scrubs credential-shaped string values under benign keys', () => {
    const out = redactSensitive({
      note: 'header was Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig here',
      gtoken: 'ya29.a0Ae4-longtoken',
    });
    expect(out.note).toContain(REDACTED);
    expect(out.note).not.toContain('eyJhbGci');
    expect(out.gtoken).toBe(REDACTED);
  });

  it('preserves ordinary business data untouched', () => {
    const input = {
      file_id: '1AbCdEf',
      max_results: 10,
      recipients: { to: ['a@example.com'], cc: [] },
      flag: true,
    };
    expect(redactSensitive(input)).toEqual(input);
  });

  it('handles nested and array structures', () => {
    const out = redactSensitive({
      items: [{ access_token: 'ya29.x', name: 'ok' }],
      headers: { authorization: 'Bearer z' },
    });
    expect(out.items[0].access_token).toBe(REDACTED);
    expect(out.items[0].name).toBe('ok');
    expect(out.headers.authorization).toBe(REDACTED);
  });

  it('never mutates the input object', () => {
    const input = { access_token: 'ya29.x' };
    const copy = { ...input };
    redactSensitive(input);
    expect(input).toEqual(copy);
  });

  it('passes through null/undefined/primitives safely', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive('plain')).toBe('plain');
  });
});
