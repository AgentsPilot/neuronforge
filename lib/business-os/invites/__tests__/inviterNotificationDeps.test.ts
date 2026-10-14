/**
 * The shared production wiring of `notifyInviter` (plan payments P-5b.1,
 * workplan §3.2; SA C-8, C-10): the same lookups the redemption built inline,
 * each keyed only by the id it is given; the audit and the logger are the
 * caller's, untouched; nothing from the entitlements module.
 */

const calls: string[] = [];

jest.mock('server-only', () => ({}));
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: async () => {
    calls.push('send');
    return { sent: true, provider: 'resend' };
  },
  platformSenderAddress: () => 'notifications@agentspilot.ai',
}));
jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: {
    findUserIdentity: async (id: string) => {
      calls.push(`identity:${id}`);
      return { data: { email: 'champion@example.org' }, error: null };
    },
  },
}));
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({
      isAdminById: async (id: string) => {
        calls.push(`admin:${id}`);
        return true;
      },
    }),
  },
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findLanguage: async (id: string) => {
      calls.push(`profile:${id}`);
      return { data: 'he', error: null };
    },
  },
}));
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: {
    findPreferredLanguage: async (id: string) => {
      calls.push(`preference:${id}`);
      return { data: 'en', error: null };
    },
  },
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { buildInviterNotificationDeps } from '../inviterNotificationDeps';

const ID = '44444444-4444-4444-8444-444444444444';
const SOURCE = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'inviterNotificationDeps.ts'), 'utf8');

beforeEach(() => {
  calls.length = 0;
});

describe('buildInviterNotificationDeps (C-10: a move, the audit stays the caller\'s)', () => {
  it('each lookup is keyed only on the id it is given', async () => {
    const deps = buildInviterNotificationDeps({ logger: { info: jest.fn(), warn: jest.fn() }, audit: jest.fn() });
    await deps.findUserIdentity(ID);
    await deps.isActiveAdmin(ID);
    await deps.findProfileLanguage(ID);
    await deps.findPreferredLanguage(ID);
    expect(calls).toEqual([`identity:${ID}`, `admin:${ID}`, `profile:${ID}`, `preference:${ID}`]);
    expect(deps.senderAddress()).toBe('notifications@agentspilot.ai');
    expect(deps.platformUrl('/x')).toMatch(/\/x$/);
  });

  it('hands back the caller\'s audit and logger, unwrapped, and sets no deadline override', () => {
    const audit = jest.fn();
    const logger = { info: jest.fn(), warn: jest.fn() };
    const deps = buildInviterNotificationDeps({ logger, audit });
    expect(deps.audit).toBe(audit);
    expect(deps.logger).toBe(logger);
    expect(deps).not.toHaveProperty('deadlineMs');
  });

  it('the service-role reads are commented as an intentional RLS bypass, for both callers (C-10)', () => {
    expect(SOURCE).toMatch(/INTENTIONAL SERVICE-ROLE READS \(RLS bypass\)/);
    expect(SOURCE).toMatch(/N-2 \(P-5b\.1\)/);
  });

  it('imports nothing from the entitlements module (C-8) and never names the lineage entity (C-2)', () => {
    // Import specifiers only: the header comment names the module on purpose.
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*business-os\/entitlements|import\s*\(\s*['"][^'"]*business-os\/entitlements/);
    expect(SOURCE).not.toMatch(/business_os_account_lineage/);
  });
});
