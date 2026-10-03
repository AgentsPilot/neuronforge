/**
 * OI-9: redaction on the logger the app actually imports.
 *
 * The other redaction tests build their own `pino({ redact: loggerConfig.redact })`,
 * so they passed for months while no server logger applied the list:
 * `@/lib/logger` resolves to `lib/logger.ts`, which shadows `lib/logger/index.ts`
 * and had no `redact` at all. This test goes through `createLogger` from
 * `@/lib/logger` and swaps only the sink, so the redaction it checks is the one
 * production runs.
 */

import path from 'path';
import pino from 'pino';
import { Writable } from 'stream';

import { clientLogger, createLogger } from '@/lib/logger';

function capture(logger: pino.Logger): () => Array<Record<string, unknown>> {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  // Own property on this child only: Pino reads the destination through this
  // symbol at write time, after its redaction has run.
  (logger as unknown as Record<symbol, unknown>)[pino.symbols.streamSym] = stream;
  return () => chunks.join('').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const SECRETS = {
  password: 'pw-hunter2',
  token: 'tok-abc',
  apiKey: 'sk-live-123',
  api_key: 'sk-live-456',
  authorization: 'Bearer xyz',
  cookie: 'sb-access=789',
  accessToken: 'at-111',
  refreshToken: 'rt-222',
  secret: 'whsec-333',
  signupCode: '481516',
  otp: '234223',
  idToken: 'eyJ.google.id',
  credential: 'eyJ.gis.cred',
  nonce: 'nonce-444',
};

describe('OI-9: the exported logger redacts', () => {
  it('`@/lib/logger` is lib/logger.ts, the module under test', () => {
    expect(require.resolve('@/lib/logger')).toBe(path.resolve(__dirname, '..', '..', 'logger.ts'));
  });

  it('censors every top-level path in the config', () => {
    const logger = createLogger({ module: 'redaction-test' });
    const lines = capture(logger);
    logger.info({ ...SECRETS, userId: 'u-1' }, 'top level');

    const [line] = lines();
    for (const key of Object.keys(SECRETS)) {
      expect(line[key]).toBe('[REDACTED]');
    }
    expect(line.userId).toBe('u-1');
    expect(line.module).toBe('redaction-test');
    expect(line.msg).toBe('top level');
    expect(JSON.stringify(line)).not.toMatch(/hunter2|sk-live|whsec|481516|eyJ|nonce-444|Bearer/);
  });

  it('censors the nested paths one level down', () => {
    const logger = createLogger({ module: 'redaction-test' });
    const lines = capture(logger);
    logger.warn(
      {
        body: {
          password: 'pw',
          token: 't',
          apiKey: 'k',
          signupCode: '111111',
          otp: '222222',
          idToken: 'id',
          credential: 'c',
          nonce: 'n',
          email: 'owner@example.com',
        },
      },
      'nested',
    );

    expect(lines()[0].body).toEqual({
      password: '[REDACTED]',
      token: '[REDACTED]',
      apiKey: '[REDACTED]',
      signupCode: '[REDACTED]',
      otp: '[REDACTED]',
      idToken: '[REDACTED]',
      credential: '[REDACTED]',
      nonce: '[REDACTED]',
      email: 'owner@example.com',
    });
  });

  it('censors request authorization and cookie headers', () => {
    const logger = createLogger({ route: '/api/x' });
    const lines = capture(logger);
    logger.info({ req: { headers: { authorization: 'Bearer abc', cookie: 'c=1', 'user-agent': 'jest' } } }, 'req');

    expect((lines()[0].req as { headers: unknown }).headers).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'user-agent': 'jest',
    });
  });

  it('leaves `code` readable (dbError.code / err.code is how operators find the constraint)', () => {
    const logger = createLogger({ service: 'redaction-test' });
    const lines = capture(logger);
    logger.error({ dbError: { code: '23514', message: 'violates check' }, code: 'P0001' }, 'db');

    const [line] = lines();
    expect(line.dbError).toEqual({ code: '23514', message: 'violates check' });
    expect(line.code).toBe('P0001');
  });

  it('applies to clientLogger when it runs on the server', () => {
    const lines = capture(clientLogger);
    clientLogger.info({ password: 'pw-client', token: 'tok-client' }, 'client');

    const [line] = lines();
    expect(line.password).toBe('[REDACTED]');
    expect(line.token).toBe('[REDACTED]');
  });
});
