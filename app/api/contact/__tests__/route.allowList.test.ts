/**
 * PROD-1b (A7), workplan 11.3: the contact route sends through its own Gmail
 * transport, so it applies the recipient guard itself, once per send (SA-E3).
 * The message is always saved; `emailSent` keeps today's meaning (both sends
 * happened).
 */

import { NextRequest } from 'next/server';

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'g-1' });
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));

const mockInsertSingle = jest.fn();
const mockUpdateEq = jest.fn().mockResolvedValue({ error: null });
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: mockInsertSingle }) }),
      update: () => ({ eq: mockUpdateEq }),
    }),
  }),
}));

const mockLogged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(args);
  logger.child = () => logger;
  return { createLogger: () => logger, logger };
});

import { POST } from '../route';

const ENV = { ...process.env };
const VISITOR = 'visitor.person@customer.example';

function setEnv(vercelEnv: string | undefined, list: string | undefined): void {
  process.env = { ...ENV };
  delete process.env.VERCEL_ENV;
  delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
  if (vercelEnv !== undefined) process.env.VERCEL_ENV = vercelEnv;
  if (list !== undefined) process.env.EMAIL_RECIPIENT_ALLOWLIST = list;
}

function post(): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/contact', {
      method: 'POST',
      body: JSON.stringify({ name: 'Visitor', email: VISITOR, message: 'Hello there' }),
    })
  );
}

const recipientsSent = (): string[] => mockSendMail.mock.calls.map((call) => (call[0] as { to: string }).to);

beforeEach(() => {
  mockLogged.length = 0;
  mockInsertSingle.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
});

afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
});

describe('POST /api/contact and the recipient guard', () => {
  it('production, list absent: both sends, emailSent true (unchanged)', async () => {
    setEnv('production', undefined);
    const response = await post();
    expect(response.status).toBe(200);
    expect((await response.json()).emailSent).toBe(true);
    expect(recipientsSent()).toEqual([VISITOR, 'hello@agentpilot.ai']);
    expect(mockUpdateEq).toHaveBeenCalled();
  });

  it('non-production, list unset: saved, nothing sent, emailSent false, no address logged', async () => {
    setEnv('preview', undefined);
    const response = await post();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.emailSent).toBe(false);
    expect(mockInsertSingle).toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockUpdateEq).not.toHaveBeenCalled();
    expect(JSON.stringify(mockLogged)).not.toContain('customer.example');
    expect(mockLogged.filter((args) => args[1] === 'Email not sent: recipient not on the allow-list')).toHaveLength(2);
  });

  it('production with the list set, visitor not listed: only the team notification goes (SA-E1)', async () => {
    setEnv('production', 'hello@agentpilot.ai');
    const body = await (await post()).json();
    expect(recipientsSent()).toEqual(['hello@agentpilot.ai']);
    expect(body.emailSent).toBe(false);
  });

  it('non-production, both listed: both sent, emailSent true', async () => {
    setEnv('preview', '@customer.example hello@agentpilot.ai');
    const body = await (await post()).json();
    expect(recipientsSent()).toEqual([VISITOR, 'hello@agentpilot.ai']);
    expect(body.emailSent).toBe(true);
  });
});
