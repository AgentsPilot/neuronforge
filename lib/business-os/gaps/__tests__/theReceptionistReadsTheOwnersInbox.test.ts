/**
 * The receptionist is only offered when it would read the owner's own mailbox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Found on a live account, 2026-11-13. The owner signs in as
 * `eomer3@walla.co.il`, their business receives mail there, and their
 * google-mail connection is `eomer3@gmail.com` — whatever account the browser
 * was signed into when they connected it.
 *
 * `pluginsRequired` was satisfied: a mailbox IS connected. So the agent
 * installed, went active, and ran every five minutes against a personal Gmail
 * no client has ever written to. Every run completed without error. From the
 * owner's side it looked like an agent that never triggered.
 *
 * The rule compares two addresses rather than checking a domain, and the
 * Workspace case below is why: a supported business on Google Workspace has a
 * custom domain, and a list of allowed domains would block exactly the
 * businesses this product is for.
 */

const findActiveByUser = jest.fn();
const maybeSingle = jest.fn();

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));

jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({
  pluginConnectionRepository: { findActiveByUser: (...args: unknown[]) => findActiveByUser(...args) },
}));

import { automationApplies } from '../automationApplies';

const USER = 'a7afd16a-a8d2-416b-81d5-6710954e332f';

/** The receptionist, reduced to the one field this rule reads. */
const RECEPTIONIST = { id: 'draft_client_replies', requires: 'mail_reaches_owner_inbox' } as never;

const ownerEmailIs = (email: string | null) =>
  maybeSingle.mockResolvedValue({ data: email === null ? null : { email }, error: null });

const connected = (...mailboxes: { plugin_key: string; email: string | null }[]) =>
  findActiveByUser.mockResolvedValue({ data: mailboxes, error: null });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the message, which every mail agent shares', () => {
  const read = (locale: string) =>
    require('fs').readFileSync(
      require('path').join(process.cwd(), 'lib', 'business-os', 'translations', `${locale}.ts`),
      'utf8'
    );

  it.each([
    ['en', 'This mailbox is not supported yet.'],
    ['he', 'תיבת הדואר הזו עדיין לא נתמכת.'],
    ['es', 'Este buzón aún no es compatible.'],
  ])('leads with the verdict in %s', (locale, opening) => {
    const line = read(locale)
      .split('\n')
      .find((l: string) => l.includes("'automation.requires.mail_reaches_owner_inbox'"));

    expect(line).toBeTruthy();
    expect(line).toContain(opening);
  });

  it('is one key, so every agent refused this way says the same thing', () => {
    /* Two automations declare the requirement today and both resolve the same
       copy. A second wording would be the thing that drifts. */
    const catalog = require('fs').readFileSync(
      require('path').join(process.cwd(), 'lib', 'business-os', 'automations', 'catalog.ts'),
      'utf8'
    );
    expect((catalog.match(/requires: 'mail_reaches_owner_inbox',/g) ?? []).length).toBe(2);
  });
});

describe('the case that was found', () => {
  it('refuses when the connected mailbox is not the business address', async () => {
    ownerEmailIs('eomer3@walla.co.il');
    connected({ plugin_key: 'google-mail', email: 'eomer3@gmail.com' });

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(false);
  });
});

describe('what must keep working', () => {
  it('allows the matching mailbox', async () => {
    ownerEmailIs('owner@gmail.com');
    connected({ plugin_key: 'google-mail', email: 'owner@gmail.com' });

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(true);
  });

  it('allows a Google Workspace custom domain, which a domain check would block', async () => {
    ownerEmailIs('dana@theirfirm.co.il');
    connected({ plugin_key: 'google-mail', email: 'dana@theirfirm.co.il' });

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(true);
  });

  it('allows Outlook on the same terms', async () => {
    ownerEmailIs('dana@theirfirm.co.il');
    connected({ plugin_key: 'outlook', email: 'DANA@TheirFirm.co.il' });

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(true);
  });

  it('matches on one of several connected mailboxes', async () => {
    ownerEmailIs('owner@theirfirm.com');
    connected(
      { plugin_key: 'google-mail', email: 'personal@gmail.com' },
      { plugin_key: 'outlook', email: 'owner@theirfirm.com' }
    );

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(true);
  });

  it('ignores non-mail connections entirely', async () => {
    ownerEmailIs('owner@theirfirm.com');
    connected(
      { plugin_key: 'google-calendar', email: 'personal@gmail.com' },
      { plugin_key: 'google-mail', email: 'owner@theirfirm.com' }
    );

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(true);
  });
});

describe('what it must never do: lock an owner out on a fact we do not have', () => {
  it('allows when no business email is set', async () => {
    ownerEmailIs(null);
    connected({ plugin_key: 'google-mail', email: 'whoever@gmail.com' });

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(true);
  });

  it('allows when no mailbox is connected, which is a different gate’s question', async () => {
    ownerEmailIs('owner@walla.co.il');
    connected();

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(true);
  });

  it('allows when the profile cannot be read', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    connected({ plugin_key: 'google-mail', email: 'whoever@gmail.com' });

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(true);
  });

  it('allows when the connections cannot be read', async () => {
    ownerEmailIs('owner@walla.co.il');
    findActiveByUser.mockResolvedValue({ data: null, error: { message: 'boom' } });

    expect(await automationApplies(USER, RECEPTIONIST)).toBe(true);
  });
});
