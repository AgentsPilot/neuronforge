/**
 * PROD-1 S3.3c (lean): the admin alert sent when the allow-list blocks an email.
 * Both lazy dependencies are mocked, so nothing here reaches a database or a provider.
 */

const listAdminEmails = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ listAdminEmails }) },
}));

const sendEmail = jest.fn();
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  platformSenderAddress: () => undefined,
}));

const warn = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn, info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  ALERT_THROTTLE_MS,
  alertBlockedEmail,
  isBlockedEmailAlertOn,
  maskRecipient,
  resetBlockedEmailAlertThrottle,
} from '@/lib/email/blockedEmailAlert';

const ENV = { ...process.env };
const LIST = 'admin@team.example, @team.example';

function onVercel(vercelEnv: string, list: string | null = LIST): void {
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = vercelEnv;
  if (list === null) delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
  else process.env.EMAIL_RECIPIENT_ALLOWLIST = list;
}

beforeEach(() => {
  process.env = { ...ENV };
  resetBlockedEmailAlertThrottle();
  listAdminEmails.mockReset().mockResolvedValue(['admin@team.example']);
  sendEmail.mockReset().mockResolvedValue({ sent: true, provider: 'smtp' });
  warn.mockReset();
});

afterAll(() => {
  process.env = { ...ENV };
  jest.restoreAllMocks();
});

const blocked = { source: 'gmail', action: 'send_email', recipients: ['Jane Client <jane.client@customer.example>'] };

describe('maskRecipient', () => {
  it('keeps the first letter and the domain only', () => {
    expect(maskRecipient('jane.client@customer.example')).toBe('j***@customer.example');
    expect(maskRecipient('Jane <JANE@Customer.Example>')).toBe('j***@customer.example');
  });

  it('hides the first character of a short local part', () => {
    expect(maskRecipient('jo@customer.example')).toBe('***@customer.example');
  });

  it('never keeps an invisible or symbol first character', () => {
    expect(maskRecipient('‮evil@customer.example')).toBe('***@customer.example');
    expect(maskRecipient('​zed@customer.example')).toBe('***@customer.example');
    expect(maskRecipient('+tag@customer.example')).toBe('***@customer.example');
  });

  it('keeps a non-ASCII letter', () => {
    expect(maskRecipient('éloise@customer.example')).toBe('é***@customer.example');
  });

  it('says unreadable for anything not address-shaped', () => {
    expect(maskRecipient('')).toBe('(unreadable)');
    expect(maskRecipient('not an address')).toBe('(unreadable)');
  });
});

describe('when it is on', () => {
  it('is off without VERCEL=1, so local runs and Jest send nothing', async () => {
    process.env.VERCEL_ENV = 'preview';
    delete process.env.VERCEL;
    expect(isBlockedEmailAlertOn()).toBe(false);
    await alertBlockedEmail(blocked);
    expect(listAdminEmails).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('is off on production while the list is unset (guard off)', async () => {
    onVercel('production', null);
    expect(isBlockedEmailAlertOn()).toBe(false);
    await alertBlockedEmail(blocked);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('is on for a preview deployment, and on production once the list is set', () => {
    onVercel('preview');
    expect(isBlockedEmailAlertOn()).toBe(true);
    onVercel('production');
    expect(isBlockedEmailAlertOn()).toBe(true);
  });
});

describe('the alert', () => {
  it('emails each allowed admin once, masked, with the environment, source and what to do', async () => {
    onVercel('preview');
    listAdminEmails.mockResolvedValue(['admin@team.example', 'ADMIN@team.example ']);
    await alertBlockedEmail(blocked);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const params = sendEmail.mock.calls[0][0];
    expect(params).toEqual(
      expect.objectContaining({ kind: 'transactional', to: ['admin@team.example'], redactRecipientInLogs: true })
    );
    expect(params.subject).toBe('[preview] An email was blocked by the allow-list (gmail)');
    expect(params.text).toContain('Recipients: j***@customer.example');
    expect(params.text).toContain('EMAIL_RECIPIENT_ALLOWLIST');
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain('jane.client');
  });

  it('only sends to admins who are themselves on the allow-list', async () => {
    onVercel('preview');
    listAdminEmails.mockResolvedValue(['admin@team.example', 'boss@elsewhere.example']);
    await alertBlockedEmail(blocked);
    expect(sendEmail.mock.calls.map((call) => call[0].to)).toEqual([['admin@team.example']]);
  });

  it('sends nothing and logs one line when no admin is on the allow-list', async () => {
    onVercel('preview', 'someone@team.example');
    listAdminEmails.mockResolvedValue(['boss@elsewhere.example']);
    await alertBlockedEmail(blocked);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { source: 'gmail' },
      'Blocked-email alert not sent: no admin address is on the allow-list'
    );
  });

  it('lists only the refused recipients, at most ten, with a count of the rest', async () => {
    onVercel('preview');
    const many = Array.from({ length: 12 }, (_, i) => `client@d${String(i).padStart(2, '0')}.example`);
    await alertBlockedEmail({ source: 'email_transport', action: 'transactional', recipients: ['admin@team.example', ...many] });
    const text: string = sendEmail.mock.calls[0][0].text;
    expect(text).toContain('c***@d00.example');
    expect(text).toContain('c***@d09.example');
    expect(text).not.toContain('d10.example');
    expect(text).toContain('and 2 more');
    // The allowed recipient in the same send is not listed.
    expect(text).not.toContain('a***@team.example');
  });

  it('escapes the html body', async () => {
    onVercel('preview');
    await alertBlockedEmail({ source: '<b>x</b>', action: 'send_email', recipients: [] });
    expect(sendEmail.mock.calls[0][0].html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(sendEmail.mock.calls[0][0].text).toContain('Recipients: not checked');
  });
});

describe('throttle and failures', () => {
  it('alerts at most once per source in ten minutes, and separately per source', async () => {
    onVercel('preview');
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await alertBlockedEmail(blocked);
    await alertBlockedEmail(blocked);
    await alertBlockedEmail({ ...blocked, source: 'outlook' });
    expect(sendEmail).toHaveBeenCalledTimes(2);

    now.mockReturnValue(1_000_000 + ALERT_THROTTLE_MS);
    await alertBlockedEmail(blocked);
    expect(sendEmail).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });

  it('never throws when the admin list or the send fails', async () => {
    onVercel('preview');
    listAdminEmails.mockRejectedValue(new Error('db down'));
    await expect(alertBlockedEmail(blocked)).resolves.toBeUndefined();

    resetBlockedEmailAlertThrottle();
    listAdminEmails.mockResolvedValue(['admin@team.example']);
    sendEmail.mockRejectedValue(new Error('smtp down'));
    await expect(alertBlockedEmail(blocked)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('logs a failed send without an address', async () => {
    onVercel('preview');
    sendEmail.mockResolvedValue({ sent: false, provider: 'none' });
    await alertBlockedEmail(blocked);
    expect(warn).toHaveBeenCalledWith({ source: 'gmail', provider: 'none' }, 'Blocked-email alert send failed');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('@');
  });
});
