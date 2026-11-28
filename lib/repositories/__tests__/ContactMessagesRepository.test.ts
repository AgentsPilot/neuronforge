/**
 * Unit tests for `ContactMessagesRepository` (contact inbox standard), one
 * block per method, against an INJECTED Supabase double. They pin the query
 * each method builds, the never-throws contract, the one-query list with its
 * replies embed (ordered by the embed's alias, SA C-1), the quoted search
 * filter, and that no log line carries message content.
 */

const mockLogCalls: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => {
        mockLogCalls.push(args);
      };
    }
    logger.child = (...args: unknown[]) => {
      mockLogCalls.push(args);
      return logger;
    };
    return logger;
  };
  return { createLogger: () => make() };
});

// The repository's default client must never be constructed in a unit test.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ADMIN_MESSAGES_LIST_LIMIT,
  CONTACT_MESSAGE_COLUMNS,
  ContactMessagesRepository,
  MESSAGE_REPLY_COLUMNS,
  buildContactMessageSearchFilter,
} from '../ContactMessagesRepository';

type QueryResult = { data: unknown; error: unknown };
type Call = { method: string; args: unknown[] };

interface Recorder {
  queries: Array<{ table: string; calls: Call[] }>;
  results: QueryResult[];
  throwOnFrom?: Error;
}

function makeClient(recorder: Recorder): SupabaseClient {
  const CHAIN = ['select', 'insert', 'update', 'delete', 'eq', 'or', 'order', 'limit', 'single', 'maybeSingle'];
  return {
    from(table: string) {
      if (recorder.throwOnFrom) throw recorder.throwOnFrom;
      const query = { table, calls: [] as Call[] };
      recorder.queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of CHAIN) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(recorder.results.shift() ?? { data: null, error: null }).then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
}

function setup(results: QueryResult[] = []) {
  const recorder: Recorder = { queries: [], results };
  return { recorder, repo: new ContactMessagesRepository(makeClient(recorder)) };
}

const CTX = { correlationId: 'corr-1', adminId: 'admin-1' };
const ID = '11111111-1111-4111-8111-111111111111';

const callsOf = (recorder: Recorder, index = 0) => recorder.queries[index].calls;
const argsOf = (recorder: Recorder, method: string, index = 0) =>
  callsOf(recorder, index).filter((call) => call.method === method).map((call) => call.args);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: 'Dana Example',
    email: 'dana@example.com',
    message: 'Hello',
    status: 'unread',
    email_sent: false,
    created_at: '2026-11-27T10:00:00Z',
    subject: null,
    phone: null,
    company: null,
    priority: 'normal',
    source: 'contact_form',
    updated_at: null,
    admin_notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockLogCalls.length = 0;
});

describe('buildContactMessageSearchFilter', () => {
  it('quotes the value for every search column', () => {
    expect(buildContactMessageSearchFilter('dana')).toBe(
      ['name', 'email', 'message', 'subject', 'company'].map((c) => `${c}.ilike."%dana%"`).join(',')
    );
  });

  it.each([
    [',', '"%,%"'],
    ['(', '"%(%"'],
    [')', '"%)%"'],
    ['.', '"%.%"'],
    [':', '"%:%"'],
    ['"', '"%\\"%"'],
    ['\\', '"%\\\\\\\\%"'],
    ['%', '"%\\\\%%"'],
    ['_', '"%\\\\_%"'],
    ['*', '"%_%"'],
  ])('keeps %s inside the quoted value', (text, operand) => {
    const filter = buildContactMessageSearchFilter(text);
    expect(filter.startsWith(`name.ilike.${operand},email.ilike.${operand},`)).toBe(true);
    expect(filter.endsWith(`company.ilike.${operand}`)).toBe(true);
  });
});

describe('listForAdmin', () => {
  it('reads messages and replies in ONE query, newest first, replies ordered by the embed alias', async () => {
    const { recorder, repo } = setup([{ data: [row({ replies: [] })], error: null }]);
    const result = await repo.listForAdmin(CTX, { status: 'all', search: '' });

    expect(result.error).toBeNull();
    expect(recorder.queries).toHaveLength(1);
    expect(recorder.queries[0].table).toBe('contact_messages');
    expect(argsOf(recorder, 'select')).toEqual([
      [`${CONTACT_MESSAGE_COLUMNS}, replies:message_replies(${MESSAGE_REPLY_COLUMNS})`],
    ]);
    expect(argsOf(recorder, 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['created_at', { referencedTable: 'replies', ascending: true }],
    ]);
    expect(argsOf(recorder, 'limit')).toEqual([[ADMIN_MESSAGES_LIST_LIMIT]]);
    expect(ADMIN_MESSAGES_LIST_LIMIT).toBe(500);
  });

  it("adds no status filter for 'all' and no search filter for ''", async () => {
    const { recorder, repo } = setup([{ data: [], error: null }]);
    await repo.listForAdmin(CTX, { status: 'all', search: '' });
    expect(argsOf(recorder, 'eq')).toEqual([]);
    expect(argsOf(recorder, 'or')).toEqual([]);
  });

  it('filters by status and searches through the quoted filter', async () => {
    const { recorder, repo } = setup([{ data: [], error: null }]);
    await repo.listForAdmin(CTX, { status: 'unread', search: 'a,b)' });
    expect(argsOf(recorder, 'eq')).toEqual([['status', 'unread']]);
    expect(argsOf(recorder, 'or')).toEqual([[buildContactMessageSearchFilter('a,b)')]]);
  });

  it('turns a missing or non-array replies value into []', async () => {
    const { repo } = setup([{ data: [row({ replies: null }), row({ id: 'b' })], error: null }]);
    const result = await repo.listForAdmin(CTX, { status: 'all', search: '' });
    expect(result.data?.map((r) => r.replies)).toEqual([[], []]);
  });

  it('keeps only literal matches when the search contains *', async () => {
    const { repo } = setup([
      { data: [row({ id: 'a', message: 'price 5*3' }), row({ id: 'b', message: 'price 5x3' })], error: null },
    ]);
    const result = await repo.listForAdmin(CTX, { status: 'all', search: '5*3' });
    expect(result.data?.map((r) => r.id)).toEqual(['a']);
  });

  it('returns { data: null, error } on a database error and when the client throws', async () => {
    const failing = setup([{ data: null, error: new Error('db down') }]);
    expect(await failing.repo.listForAdmin(CTX, { status: 'all', search: '' })).toEqual({
      data: null,
      error: expect.any(Error),
    });

    const recorder: Recorder = { queries: [], results: [], throwOnFrom: new Error('boom') };
    const throwing = new ContactMessagesRepository(makeClient(recorder));
    expect((await throwing.listForAdmin(CTX, { status: 'all', search: '' })).data).toBeNull();
  });

  it('never logs the search text or any message content', async () => {
    const { repo } = setup([{ data: [row()], error: null }]);
    await repo.listForAdmin(CTX, { status: 'all', search: 'secret-term' });
    const logged = JSON.stringify(mockLogCalls);
    expect(logged).not.toContain('secret-term');
    expect(logged).not.toContain('dana@example.com');
    expect(logged).not.toContain('Dana Example');
  });
});

describe('updateForAdmin', () => {
  it('writes only status, admin_notes and updated_at, by id, and returns the row', async () => {
    const { recorder, repo } = setup([{ data: row({ status: 'read' }), error: null }]);
    const sneaky = { status: 'read', admin_notes: 'n', email: 'x@y.z', email_sent: true } as unknown as {
      status: 'read';
      admin_notes: string;
    };
    const result = await repo.updateForAdmin(CTX, ID, sneaky);

    expect(result.data?.status).toBe('read');
    const [[values]] = argsOf(recorder, 'update') as [[Record<string, unknown>]];
    expect(Object.keys(values).sort()).toEqual(['admin_notes', 'status', 'updated_at']);
    expect(typeof values.updated_at).toBe('string');
    expect(argsOf(recorder, 'eq')).toEqual([['id', ID]]);
    expect(argsOf(recorder, 'select')).toEqual([[CONTACT_MESSAGE_COLUMNS]]);
    expect(argsOf(recorder, 'maybeSingle')).toEqual([[]]);
  });

  it('leaves out a field that was not given', async () => {
    const { recorder, repo } = setup([{ data: row(), error: null }]);
    await repo.updateForAdmin(CTX, ID, { admin_notes: '' });
    const [[values]] = argsOf(recorder, 'update') as [[Record<string, unknown>]];
    expect(Object.keys(values).sort()).toEqual(['admin_notes', 'updated_at']);
    expect(values.admin_notes).toBe('');
  });

  it('returns { data: null, error: null } when no row has that id', async () => {
    const { repo } = setup([{ data: null, error: null }]);
    expect(await repo.updateForAdmin(CTX, ID, { status: 'read' })).toEqual({ data: null, error: null });
  });

  it('returns the error on a database error', async () => {
    const { repo } = setup([{ data: null, error: new Error('db down') }]);
    const result = await repo.updateForAdmin(CTX, ID, { status: 'read' });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('deleteForAdmin', () => {
  it('deletes by id and reports deleted: true when a row went', async () => {
    const { recorder, repo } = setup([{ data: [{ id: ID }], error: null }]);
    expect(await repo.deleteForAdmin(CTX, ID)).toEqual({ data: { deleted: true }, error: null });
    expect(callsOf(recorder).map((c) => c.method)).toEqual(['delete', 'eq', 'select']);
    expect(argsOf(recorder, 'eq')).toEqual([['id', ID]]);
  });

  it('reports deleted: false when no row had that id', async () => {
    const { repo } = setup([{ data: [], error: null }]);
    expect(await repo.deleteForAdmin(CTX, ID)).toEqual({ data: { deleted: false }, error: null });
  });

  it('returns the error on a database error', async () => {
    const { repo } = setup([{ data: null, error: new Error('db down') }]);
    expect((await repo.deleteForAdmin(CTX, ID)).error).toBeInstanceOf(Error);
  });
});

describe('createFromContactForm', () => {
  it('inserts exactly the form fields with the server-set defaults and returns the id', async () => {
    const { recorder, repo } = setup([{ data: { id: ID }, error: null }]);
    const result = await repo.createFromContactForm({ name: 'Dana', email: 'dana@example.com', message: 'Hi' });

    expect(result).toEqual({ data: { id: ID }, error: null });
    expect(argsOf(recorder, 'insert')).toEqual([
      [
        {
          name: 'Dana',
          email: 'dana@example.com',
          message: 'Hi',
          status: 'unread',
          email_sent: false,
          source: 'contact_form',
        },
      ],
    ]);
    expect(argsOf(recorder, 'select')).toEqual([['id']]);
  });

  it('returns the error on a database error', async () => {
    const { repo } = setup([{ data: null, error: new Error('db down') }]);
    const result = await repo.createFromContactForm({ name: 'Dana', email: 'dana@example.com', message: 'Hi' });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(JSON.stringify(mockLogCalls)).not.toContain('dana@example.com');
  });
});

describe('markEmailSent', () => {
  it('sets email_sent by id with no select', async () => {
    const { recorder, repo } = setup([{ data: null, error: null }]);
    expect(await repo.markEmailSent(ID)).toEqual({ data: true, error: null });
    const [[values]] = argsOf(recorder, 'update') as [[Record<string, unknown>]];
    expect(values.email_sent).toBe(true);
    expect(argsOf(recorder, 'eq')).toEqual([['id', ID]]);
    expect(argsOf(recorder, 'select')).toEqual([]);
  });

  it('returns the error on a database error', async () => {
    const { repo } = setup([{ data: null, error: new Error('db down') }]);
    expect((await repo.markEmailSent(ID)).error).toBeInstanceOf(Error);
  });
});
