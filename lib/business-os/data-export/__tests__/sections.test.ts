/**
 * The export section model (DE-1, BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md §6.1).
 *
 * Pinned: sections come out in registry order with `status`, `row_count` and
 * `rows`; a reader that returns `{ ok: false }` or throws gives a `failed`
 * section with no error text in it (FR-E12, SA C-3); `account_identity` is
 * always there; the registry's ids are unique and complete; the provider
 * profile allow-list; the file name.
 *
 * The two repositories are mocked: their own reads are pinned in
 * lib/repositories/__tests__/userDataExportReads.test.ts.
 */

const mockFindProfile = jest.fn();
const mockListConnections = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: { findForUserDataExport: (...args: unknown[]) => mockFindProfile(...args) },
}));
jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({
  pluginConnectionRepository: { listForUserDataExport: (...args: unknown[]) => mockListConnections(...args) },
}));

import {
  EXPORT_SECTIONS,
  accountProfile,
  runExportSections,
  type AnyExportSectionDefinition,
  type ExportContext,
  type ExportSectionId,
} from '@/lib/business-os/data-export/sections';
import { buildExportPayload, exportFileName } from '@/lib/business-os/data-export/payload';

const USER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const CTX: ExportContext = { userId: USER, authUser: { id: USER, email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' } };

function recordingLogger() {
  const lines: Array<{ fields: Record<string, unknown>; msg: string }> = [];
  return { lines, logger: { error: (fields: Record<string, unknown>, msg: string) => lines.push({ fields, msg }) } };
}

const CONNECTION = {
  user_id: USER,
  plugin_key: 'google-mail',
  plugin_name: 'Gmail',
  username: 'Ada',
  email: 'a@example.com',
  scope: 'gmail.readonly',
  status: 'disconnected',
  connected_at: null,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  last_used: null,
  disconnected_at: '2026-03-02T00:00:00Z',
  profile_data: { name: 'Ada', token: 'never-exported' },
};

beforeEach(() => {
  mockFindProfile.mockReset();
  mockListConnections.mockReset();
  mockFindProfile.mockResolvedValue({ data: { id: USER, full_name: 'Ada' }, error: null });
  mockListConnections.mockResolvedValue({ data: [CONNECTION], error: null });
});

describe('runExportSections', () => {
  it('all readers ok: sections in registry order, status ok, row_count = rows', async () => {
    const { logger, lines } = recordingLogger();
    const sections = await runExportSections(CTX, EXPORT_SECTIONS, logger);
    expect(sections.map((s) => s.id)).toEqual(['account_identity', 'user_profile', 'plugin_connections']);
    for (const s of sections) {
      expect(s.status).toBe('ok');
      expect(s.row_count).toBe(s.rows.length);
      expect(s.group).toBe('account');
      expect(s.gdpr_role).toBe('controller');
    }
    expect(sections[0].rows).toEqual([{ id: USER, email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' }]);
    expect(sections[1].rows).toEqual([{ id: USER, full_name: 'Ada' }]);
    // Disconnected connections are kept (SA Q-7); connected_at falls back to created_at.
    expect(sections[2].rows).toEqual([
      {
        plugin_key: 'google-mail',
        plugin_name: 'Gmail',
        account_username: 'Ada',
        account_email: 'a@example.com',
        account_profile: { name: 'Ada' },
        scope: 'gmail.readonly',
        status: 'disconnected',
        connected_at: '2026-02-01T00:00:00Z',
        last_updated: '2026-03-01T00:00:00Z',
        last_used: null,
        disconnected_at: '2026-03-02T00:00:00Z',
      },
    ]);
    expect(lines).toEqual([]);
    // The readers are keyed on the session's id.
    expect(mockFindProfile).toHaveBeenCalledWith(USER);
    expect(mockListConnections).toHaveBeenCalledWith(USER);
  });

  it('no profile row is ok with 0 rows, not failed (SA Q-4)', async () => {
    mockFindProfile.mockResolvedValue({ data: null, error: null });
    const { logger } = recordingLogger();
    const sections = await runExportSections(CTX, EXPORT_SECTIONS, logger);
    expect(sections[1]).toEqual({ id: 'user_profile', group: 'account', gdpr_role: 'controller', status: 'ok', row_count: 0, rows: [] });
  });

  it('a repository error gives that section failed with no rows; the others are unaffected', async () => {
    mockListConnections.mockResolvedValue({ data: null, error: new Error('relation secret_table does not exist') });
    const { logger } = recordingLogger();
    const sections = await runExportSections(CTX, EXPORT_SECTIONS, logger);
    expect(sections[2]).toEqual({ id: 'plugin_connections', group: 'account', gdpr_role: 'controller', status: 'failed', row_count: 0, rows: [] });
    expect(sections[0].status).toBe('ok');
    expect(sections[1].status).toBe('ok');
    expect(JSON.stringify(sections)).not.toContain('secret_table');
  });

  it('a reader that throws gives failed, logged at error with { err, sectionId }, no error text in the output', async () => {
    const throwing: AnyExportSectionDefinition = {
      id: 'user_profile',
      group: 'account',
      gdprRole: 'controller',
      read: async () => {
        throw new Error('boom secret detail');
      },
    };
    const { logger, lines } = recordingLogger();
    const sections = await runExportSections(CTX, [EXPORT_SECTIONS[0], throwing], logger);
    expect(sections[1]).toEqual({ id: 'user_profile', group: 'account', gdpr_role: 'controller', status: 'failed', row_count: 0, rows: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('Data export section read threw');
    expect(lines[0].fields.sectionId).toBe('user_profile');
    expect(lines[0].fields.err).toBeInstanceOf(Error);
    expect(JSON.stringify(sections)).not.toContain('boom');
  });

  it('account_identity is ok with the auth fields even when every other section fails', async () => {
    mockFindProfile.mockRejectedValue(new Error('down'));
    mockListConnections.mockResolvedValue({ data: null, error: new Error('down') });
    const { logger } = recordingLogger();
    const sections = await runExportSections(CTX, EXPORT_SECTIONS, logger);
    expect(sections.map((s) => [s.id, s.status])).toEqual([
      ['account_identity', 'ok'],
      ['user_profile', 'failed'],
      ['plugin_connections', 'failed'],
    ]);
    expect(sections[0].rows).toEqual([CTX.authUser]);
  });
});

describe('the registry (guard; DE-2 extends this against the descriptors)', () => {
  // Every ExportSectionId, written out: adding an id to the union without a
  // definition (or the reverse) fails here.
  const ALL_IDS: Record<ExportSectionId, true> = { account_identity: true, user_profile: true, plugin_connections: true };

  it('ids are unique and every ExportSectionId has exactly one definition', () => {
    const ids = EXPORT_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(ALL_IDS).sort());
  });

  it('every section has a group and a GDPR role', () => {
    for (const s of EXPORT_SECTIONS) {
      expect(['account']).toContain(s.group);
      expect(['controller', 'processor']).toContain(s.gdprRole);
    }
  });

  it('none of the sections DE-1 removed is back (DX-1, BQ-SA-1)', () => {
    const ids: string[] = EXPORT_SECTIONS.map((s) => s.id);
    for (const removed of ['agents', 'agent_executions', 'agent_configurations', 'subscriptions', 'transactions', 'audit_logs']) {
      expect(ids).not.toContain(removed);
    }
  });
});

describe('accountProfile (moved from the route, same cases)', () => {
  it('keeps allow-listed strings and string arrays only', () => {
    expect(
      accountProfile({
        displayName: 'Ada Owner',
        businessPhones: ['+1 555 0100'],
        jobTitle: 'Founder',
        token: 'secret-profile-token',
        id: 'provider-user-id',
        sub: 'provider-subject',
        address: { street: 'nested-street' },
        locale: { language: 'nested-locale' },
        nickname: ['mixed-array-value', 5],
        brandNewProviderField: 'unknown-key-value',
      })
    ).toEqual({ displayName: 'Ada Owner', businessPhones: ['+1 555 0100'], jobTitle: 'Founder' });
  });

  it('gives {} for a value that is not an object', () => {
    expect([null, 'a string', ['name'], 5].map(accountProfile)).toEqual([{}, {}, {}, {}]);
  });
});

describe('payload', () => {
  it('exportFileName: agentpilot-data-export-<UTC date>.json, no user id', () => {
    const name = exportFileName(new Date('2026-07-15T23:30:00.000Z'));
    expect(name).toBe('agentpilot-data-export-2026-07-15.json');
    expect(name).not.toContain(USER);
  });

  it('buildExportPayload: format_version 2, provider and per-group controller, counts and failed list', async () => {
    mockListConnections.mockResolvedValue({ data: null, error: new Error('down') });
    const { logger } = recordingLogger();
    const sections = await runExportSections(CTX, EXPORT_SECTIONS, logger);
    const payload = buildExportPayload({ userId: USER, now: new Date('2026-07-15T12:00:00.000Z'), sections, durationMs: 7 });
    expect(payload.export_metadata).toEqual({
      format_version: 2,
      user_id: USER,
      export_date: '2026-07-15T12:00:00.000Z',
      export_format: 'JSON',
      gdpr_article: 'Article 15 (Right to Access) & Article 20 (Data Portability)',
      provider: 'AgentPilot',
      groups: {
        account: {
          gdpr_role: 'controller',
          controller: 'AgentPilot',
          description: 'Your own account details. AgentPilot is the controller of this data.',
        },
      },
    });
    expect(payload.summary.section_counts).toEqual({ account_identity: 1, user_profile: 1, plugin_connections: 0 });
    expect(payload.summary.failed_sections).toEqual(['plugin_connections']);
    expect(payload.summary.export_duration_ms).toBe(7);
    expect(JSON.stringify(payload)).not.toContain('NeuronForge');
  });
});
