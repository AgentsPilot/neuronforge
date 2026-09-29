/**
 * Invite-only signup, Slice 1b (SA R-3): the emailed sign-up code is redacted
 * by name, at the top level and one level down, while `code` (the SQLSTATE in
 * `dbError.code`, an auth error's `code`) stays readable, because operators
 * need it to tell which constraint fired.
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

describe('R-3: sign-up code redaction', () => {
  it('censors signupCode and otp at the top level and nested', () => {
    const { logger, lines } = capture();
    logger.info({ signupCode: '123456', otp: '654321', body: { signupCode: '111111', otp: '222222' } }, 'x');
    const [line] = lines();
    expect(line.signupCode).toBe('[REDACTED]');
    expect(line.otp).toBe('[REDACTED]');
    expect(line.body).toEqual({ signupCode: '[REDACTED]', otp: '[REDACTED]' });
    expect(JSON.stringify(line)).not.toMatch(/123456|654321|111111|222222/);
  });

  it('leaves `code` readable (dbError.code, err.code are how an operator finds the constraint)', () => {
    const { logger, lines } = capture();
    logger.info({ dbError: { code: '23514', message: 'violates check' } }, 'x');
    expect(lines()[0].dbError).toEqual({ code: '23514', message: 'violates check' });
  });

  it('still redacts password (the new account password never reaches a log line)', () => {
    const { logger, lines } = capture();
    logger.info({ password: 'hunter2hunter2', body: { password: 'x' } }, 'x');
    const [line] = lines();
    expect(line.password).toBe('[REDACTED]');
    expect((line.body as Record<string, unknown>).password).toBe('[REDACTED]');
  });
});
