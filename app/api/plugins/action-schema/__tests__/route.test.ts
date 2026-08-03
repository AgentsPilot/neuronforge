/**
 * GET /api/plugins/action-schema — read-only, unauthenticated, metadata-only endpoint
 * (SA decision Q1). Covers: happy path (plugin + single action, and all-actions),
 * invalid query (400 Zod), unknown plugin (404), unknown action (404).
 */

const getPluginDefinition = jest.fn();
const getActionDefinition = jest.fn();

jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: async () => ({
      getPluginDefinition: (p: string) => getPluginDefinition(p),
      getActionDefinition: (p: string, a: string) => getActionDefinition(p, a),
    }),
  },
}));

import { NextRequest } from 'next/server';
import { GET } from '../route';

const DELETE_FILE_DEF = {
  description: 'Move a file to Trash',
  parameters: { type: 'object', required: ['file_id'], properties: { file_id: { type: 'string' } } },
  required_params: ['file_id'],
  optional_params: [],
  capability: 'delete',
  idempotent: true,
  rules: {
    confirmations: {
      confirm_trash: { condition: 'file_id != null', action: 'confirm', message: 'Move to Trash?' },
    },
  },
  output_schema: { type: 'object', properties: {} },
};

const PLUGIN_DEF = {
  actions: { delete_file: DELETE_FILE_DEF, list_files: { ...DELETE_FILE_DEF, capability: 'read' } },
};

function makeRequest(qs = '') {
  return new NextRequest(`http://localhost/api/plugins/action-schema${qs}`, { method: 'GET' });
}

describe('GET /api/plugins/action-schema', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when plugin is missing (Zod)', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(getPluginDefinition).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown plugin', async () => {
    getPluginDefinition.mockReturnValue(undefined);
    const res = await GET(makeRequest('?plugin=nope'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 404 for an unknown action on a known plugin', async () => {
    getPluginDefinition.mockReturnValue(PLUGIN_DEF);
    getActionDefinition.mockReturnValue(undefined);
    const res = await GET(makeRequest('?plugin=google-drive&action=ghost'));
    expect(res.status).toBe(404);
  });

  it('returns a single action schema block (happy path)', async () => {
    getPluginDefinition.mockReturnValue(PLUGIN_DEF);
    getActionDefinition.mockReturnValue(DELETE_FILE_DEF);

    const res = await GET(makeRequest('?plugin=google-drive&action=delete_file'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action_count).toBe(1);
    expect(body.actions[0].name).toBe('delete_file');
    expect(body.actions[0].required_params).toEqual(['file_id']);
    expect(body.actions[0].capability).toBe('delete');
    expect(body.actions[0].rules.confirmations.confirm_trash.action).toBe('confirm');
  });

  it('returns all actions when action is omitted', async () => {
    getPluginDefinition.mockReturnValue(PLUGIN_DEF);

    const res = await GET(makeRequest('?plugin=google-drive'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action_count).toBe(2);
    expect(body.actions.map((a: { name: string }) => a.name).sort()).toEqual([
      'delete_file',
      'list_files',
    ]);
    expect(getActionDefinition).not.toHaveBeenCalled();
  });

  it('never leaks user data — response keys are metadata-only', async () => {
    getPluginDefinition.mockReturnValue(PLUGIN_DEF);
    getActionDefinition.mockReturnValue(DELETE_FILE_DEF);
    const res = await GET(makeRequest('?plugin=google-drive&action=delete_file'));
    const body = await res.json();
    const keys = Object.keys(body.actions[0]);
    expect(keys).not.toContain('access_token');
    expect(keys).not.toContain('connection');
    expect(keys).not.toContain('user_id');
  });
});
