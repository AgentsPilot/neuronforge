/**
 * Invite-only signup, Slice 3b (T-3b-15, AC-9): the Google ID token, the GIS
 * `credential` that carries it and the sign-in nonce are redacted by name, at
 * the top level and one level down. Nothing logs them on purpose; this pins
 * the backstop.
 */

import pino from 'pino';
import { Writable } from 'stream';

import { loggerConfig } from '../config';

function capture(): { logger: pino.Logger; lines: () => Array<Record<string, unknown>> } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const logger = pino({ redact: loggerConfig.redact, level: 'info' }, stream);
  return {
    logger,
    lines: () => chunks.join('').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
  };
}

const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6ImFAZ21haWwuY29tIn0.c2lnbmF0dXJl';
const NONCE = 'n'.repeat(43);

describe('Slice 3b: Google ID token, credential and nonce redaction', () => {
  it('censors idToken, credential and nonce at the top level', () => {
    const { logger, lines } = capture();
    logger.info({ idToken: ID_TOKEN, credential: ID_TOKEN, nonce: NONCE }, 'x');
    const [line] = lines();
    expect(line.idToken).toBe('[REDACTED]');
    expect(line.credential).toBe('[REDACTED]');
    expect(line.nonce).toBe('[REDACTED]');
    expect(JSON.stringify(line)).not.toContain(ID_TOKEN);
    expect(JSON.stringify(line)).not.toContain(NONCE);
  });

  it('censors them one level down (a logged request body)', () => {
    const { logger, lines } = capture();
    logger.info({ body: { token: 'invite', idToken: ID_TOKEN, nonce: NONCE }, response: { credential: ID_TOKEN } }, 'x');
    const [line] = lines();
    expect(line.body).toEqual({ token: '[REDACTED]', idToken: '[REDACTED]', nonce: '[REDACTED]' });
    expect(line.response).toEqual({ credential: '[REDACTED]' });
    expect(JSON.stringify(line)).not.toContain(ID_TOKEN);
  });
});
