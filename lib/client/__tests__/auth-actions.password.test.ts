/**
 * `signInWithPassword`: a rejected sign-in is logged WITHOUT the address (PII);
 * the log line carries only Supabase's status and error code.
 */

let signInAnswer: {
  data: { user: { id: string; email: string } | null };
  error: { message: string; status?: number; code?: string } | null;
} = { data: { user: null }, error: null };

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: async () => signInAnswer,
    },
  },
}));

const logs: unknown[][] = [];
jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logs.push(args);
  logger.child = () => logger;
  return { clientLogger: logger };
});

import { signInWithPassword } from '../auth-actions';

const EMAIL = 'owner@example.com';

beforeEach(() => {
  logs.length = 0;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200 }) as Response) as unknown as typeof fetch;
});

describe('signInWithPassword', () => {
  it('a rejection is logged with the auth status and code, never the address', async () => {
    signInAnswer = {
      data: { user: null },
      error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' },
    };
    expect(await signInWithPassword(EMAIL, 'wrong-password')).toEqual({ ok: false, error: 'Invalid login credentials' });
    const rejected = logs.find((args) => args[1] === 'Password sign-in rejected');
    expect(rejected?.[0]).toEqual({ authStatus: 400, authCode: 'invalid_credentials' });
    expect(JSON.stringify(logs)).not.toContain(EMAIL);
    expect(JSON.stringify(logs)).not.toContain('wrong-password');
  });
});
