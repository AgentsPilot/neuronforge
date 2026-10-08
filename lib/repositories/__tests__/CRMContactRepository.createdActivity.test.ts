/**
 * Every contact gets the first entry on its own timeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `20260722_crm_contact_creation_activity.sql` defined a trigger to write a
 * `contact_created` activity on every `crm_contacts` INSERT. The trigger is not
 * live. Measured read-only on production 2026-10-08: 14 of 20 contacts had no
 * creation entry, the one contact predating the API route's own write had none,
 * and no contact had two -- which it would, had both the trigger and the route
 * written one.
 *
 * `/api/crm/contacts` was the only one of about ten creation paths that wrote
 * the entry in application code. The other nine trusted the trigger and
 * recorded nothing, so a contact typed in by hand had a timeline that began at
 * the beginning and one that arrived from a website booking, an intake form or
 * a newsletter did not.
 *
 * The fix puts it in `CRMContactRepository.create`, the single method all ten
 * paths already call, and removes the route's write in the same change. Both
 * halves matter: the write alone leaves nine paths silent, and leaving the
 * route's copy in place double-logs.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { CRMContactRepository } from '../CRMContactRepository';

type Row = Record<string, unknown>;

const CONTACT = {
  id: 'c-1',
  user_id: 'u-1',
  stage: 'lead',
  source: 'website_booking',
  created_at: '2026-10-08T09:00:00.000Z',
};

/**
 * A client that answers the three tables `create` touches and records what was
 * written, so a second write shows up as a second row rather than as a pass.
 */
function makeClient(opts: {
  contact?: Row | null;
  contactError?: unknown;
  language?: string | null;
  activityError?: unknown;
} = {}) {
  const activities: Row[] = [];
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      if (table === 'crm_contacts') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: opts.contact === undefined ? CONTACT : opts.contact,
                error: opts.contactError ?? null,
              }),
            }),
          }),
        };
      }
      if (table === 'business_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.language === undefined ? { language: 'en' } : { language: opts.language },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'crm_activities') {
        return {
          insert: async (row: Row) => {
            activities.push(row);
            return { data: null, error: opts.activityError ?? null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
  return { repo: new CRMContactRepository(client), activities, tables };
}

beforeEach(() => jest.clearAllMocks());

describe('the entry is written, once, for every path', () => {
  it('writes exactly one contact_created activity', async () => {
    const { repo, activities } = makeClient();
    const result = await repo.create({ user_id: 'u-1' });

    expect(result.error).toBeNull();
    expect(activities).toHaveLength(1);
    expect(activities[0].activity_type).toBe('contact_created');
  });

  it('files it against the contact that was just created, not the request', async () => {
    const { repo, activities } = makeClient();
    await repo.create({ user_id: 'u-1' });

    expect(activities[0]).toMatchObject({
      user_id: 'u-1',
      contact_id: 'c-1',
      source_entity_id: 'c-1',
      auto_logged: true,
      source_capability: 'crm',
    });
  });

  it('dates the entry to the contact\'s creation, so it sorts to the beginning', async () => {
    // The timeline is ordered by activity_date. Stamped "now" instead, a
    // backfilled or imported contact would claim to have arrived today.
    const { repo, activities } = makeClient();
    await repo.create({ user_id: 'u-1' });

    expect(activities[0].activity_date).toBe(CONTACT.created_at);
  });

  it('carries the facts as JSON, which is what the drawer re-translates', async () => {
    const { repo, activities } = makeClient();
    await repo.create({ user_id: 'u-1' });

    expect(JSON.parse(String(activities[0].description))).toEqual({
      kind: 'contact_created',
      source: 'website_booking',
      stage: 'lead',
    });
  });
});

describe('the sentence', () => {
  it('names where they came from when that is known', async () => {
    const { repo, activities } = makeClient();
    await repo.create({ user_id: 'u-1' });

    expect(activities[0].title).toBe('Contact added from website_booking');
  });

  it('says nothing about it when it is not', async () => {
    // "Added from unknown" is worse than saying nothing.
    const { repo, activities } = makeClient({ contact: { ...CONTACT, source: null } });
    await repo.create({ user_id: 'u-1' });

    expect(activities[0].title).toBe('Contact added');
  });

  it('is written in the business\'s language, because the drawer renders it as-is', async () => {
    const { repo, activities } = makeClient({ language: 'he', contact: { ...CONTACT, source: null } });
    await repo.create({ user_id: 'u-1' });

    expect(activities[0].title).toBe('איש קשר נוסף');
  });

  it('falls back to English when the business has no language set', async () => {
    const { repo, activities } = makeClient({ language: null, contact: { ...CONTACT, source: null } });
    await repo.create({ user_id: 'u-1' });

    expect(activities[0].title).toBe('Contact added');
  });
});

describe('a timeline entry is worth less than the contact', () => {
  it('a failed activity write still returns the saved contact', async () => {
    const { repo, activities } = makeClient({ activityError: new Error('db down') });
    const result = await repo.create({ user_id: 'u-1' });

    expect(activities).toHaveLength(1); // attempted
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ id: 'c-1' });
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it('and does not report the contact as failed', async () => {
    // The route turns a non-null error into a 500. A missing timeline line must
    // never cost the caller the contact they just saved.
    const { repo } = makeClient({ activityError: new Error('db down') });
    const result = await repo.create({ user_id: 'u-1' });

    expect(result.data).not.toBeNull();
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  it('writes no activity when the contact itself could not be created', async () => {
    const { repo, activities, tables } = makeClient({ contact: null, contactError: new Error('nope') });
    const result = await repo.create({ user_id: 'u-1' });

    expect(result.error).not.toBeNull();
    expect(activities).toHaveLength(0);
    expect(tables).not.toContain('crm_activities');
  });
});

describe('nothing else writes it, or the entry doubles', () => {
  const read = (p: string) =>
    fs
      .readFileSync(path.join(process.cwd(), p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it('strips comments first, or it fails on its own explanation', () => {
    const raw = fs.readFileSync(path.join(process.cwd(), 'app/api/crm/contacts/route.ts'), 'utf8');
    expect(raw).toContain('double-log');
    expect(read('app/api/crm/contacts/route.ts')).not.toContain('double-log');
  });

  it('the contacts route does not write a contact_created activity', () => {
    expect(read('app/api/crm/contacts/route.ts')).not.toContain('contact_created');
  });

  it('nor does the CRM plugin executor', () => {
    expect(read('lib/server/crm-plugin-executor.ts')).not.toContain('contact_created');
  });

  it('and the retired trigger is dropped, so a fresh database matches production', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261045_retire_crm_contact_created_trigger.sql'),
      'utf8'
    );
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS log_crm_contact_created_trigger ON crm_contacts/i);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS log_crm_contact_created\(\)/i);
  });
});
