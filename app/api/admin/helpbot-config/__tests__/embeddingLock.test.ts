/**
 * The HelpBot config PUT must never write `helpbot_embedding_model`.
 *
 * That key is shared with Business OS chat (EmbeddingService → PlanCache,
 * VerifiedQuestions). Changing it invalidates every stored vector, so it is a
 * data migration, not a setting (lib/business-os/llm/modelSettingsPolicy.ts).
 * Before this fix every save of the hidden HelpBot page rewrote it, because the
 * PUT's write set included it and the GET defaulted it.
 *
 * H-1..H-4 pin the behaviour; H-5 is a source guard so the key can never come
 * back into the write set.
 *
 * @see docs/workplans/ADMIN_HELPBOT_LOCK_AND_AUDIT_EMAIL_WORKPLAN.md
 */

import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

const KEY = 'helpbot_embedding_model';

const mockRequireAdmin = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

/** Every key written through SystemConfigService.set, in order. */
const mockWrittenKeys: string[] = [];
/** What the "database" holds for each key; a missing key means no row. */
const mockStored: Record<string, unknown> = {};
jest.mock('@/lib/services/SystemConfigService', () => ({
  SystemConfigService: {
    getByCategory: jest.fn(async () => []),
    getString: jest.fn(async (_db: unknown, key: string, fallback: string) =>
      key in mockStored ? String(mockStored[key]) : fallback
    ),
    // The real setMultiple loops over `set`; recording the key set it receives
    // is the same assertion without the loop.
    setMultiple: jest.fn(async (_db: unknown, updates: Record<string, unknown>) => {
      mockWrittenKeys.push(...Object.keys(updates));
    }),
  },
}));

const mockWarn = jest.fn();
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

import { PUT } from '../route';

/** A full config the page would have sent, with or without the embedding model. */
function config(embeddingModel?: string | null): Record<string, unknown> {
  const semantic: Record<string, unknown> = {
    enabled: true,
    cacheThreshold: 0.85,
    faqThreshold: 0.8,
    autoPromoteEnabled: false,
    autoPromoteThreshold: 10,
    autoPromoteMinThumbsUp: 3,
  };
  if (embeddingModel !== undefined) semantic.embeddingModel = embeddingModel;
  return {
    general: { model: 'llama-3.1-8b-instant', temperature: 0.2, maxTokens: 300 },
    input: { model: 'llama-3.1-8b-instant', temperature: 0.3, maxTokens: 400 },
    semantic,
    provider: 'groq',
    enabled: true,
    cacheEnabled: true,
    faqEnabled: true,
  };
}

function put(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/helpbot-config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockWrittenKeys.length = 0;
  for (const k of Object.keys(mockStored)) delete mockStored[k];
  mockWarn.mockClear();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockResolvedValue({ user: { id: 'admin-1' } });
});

describe('PUT /api/admin/helpbot-config — embedding model is locked', () => {
  it('H-1: a save without the field succeeds and never writes the key', async () => {
    mockStored[KEY] = 'text-embedding-3-small';
    const res = await PUT(put({ config: config() }));

    expect(res.status).toBe(200);
    expect(mockWrittenKeys.length).toBeGreaterThan(0);
    expect(mockWrittenKeys).not.toContain(KEY);
  });

  it('H-2: a save with a different value is a 400, logged, and writes nothing', async () => {
    mockStored[KEY] = 'text-embedding-3-small';
    const res = await PUT(put({ config: config('text-embedding-3-large') }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/embedding model cannot be changed/i);
    expect(body.error).toMatch(/Business OS/);
    expect(mockWrittenKeys).toEqual([]);
    expect(mockWarn).toHaveBeenCalledWith(
      { requestedEmbeddingModel: 'text-embedding-3-large', storedEmbeddingModel: 'text-embedding-3-small' },
      expect.stringMatching(/embedding model is locked/)
    );
  });

  it('H-3: a save with the stored value passes and still does not write the key', async () => {
    mockStored[KEY] = 'text-embedding-3-large';
    const res = await PUT(put({ config: config('text-embedding-3-large') }));

    expect(res.status).toBe(200);
    expect(mockWrittenKeys.length).toBeGreaterThan(0);
    expect(mockWrittenKeys).not.toContain(KEY);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('H-4: with no stored row, the comparison uses the same default EmbeddingService reads with', async () => {
    const same = await PUT(put({ config: config('text-embedding-3-small') }));
    expect(same.status).toBe(200);

    mockWrittenKeys.length = 0;
    const different = await PUT(put({ config: config('text-embedding-ada-002') }));
    expect(different.status).toBe(400);
    expect(mockWrittenKeys).toEqual([]);
  });

  it('the admin gate still answers first', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ success: false }, { status: 403 }));
    const res = await PUT(put({ config: config('text-embedding-3-large') }));

    expect(res.status).toBe(403);
    expect(mockWrittenKeys).toEqual([]);
  });
});

describe('H-5: source guard — the write set can never contain the embedding key', () => {
  const source = readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
  // Code only: comments may name the key while explaining why it is locked.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const putBody = code.slice(code.indexOf('export async function PUT'));

  it('the key literal appears exactly once in the file (the read-only constant)', () => {
    const occurrences = code.split(`'${KEY}'`).length - 1;
    expect(occurrences).toBe(1);
    expect(code).toMatch(new RegExp(`const HELPBOT_EMBEDDING_MODEL_KEY = '${KEY}'`));
  });

  it('the PUT never names the key as an object property, assignment or computed key', () => {
    expect(putBody).not.toMatch(new RegExp(`\\b${KEY}\\s*:`));
    expect(putBody).not.toMatch(/updates\s*(\.|\[)\s*['"]?helpbot_embedding/);
    expect(putBody).not.toMatch(/\[\s*HELPBOT_EMBEDDING_MODEL_KEY\s*\]/);
    // The constant is used in the PUT only to READ the stored value for the 400.
    const uses = putBody.match(/HELPBOT_EMBEDDING_MODEL_KEY/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(putBody).toMatch(/getString\(\s*supabase,\s*HELPBOT_EMBEDDING_MODEL_KEY/);
  });

  it('the PUT never assigns semantic.embeddingModel into the write set', () => {
    expect(putBody).not.toMatch(/:\s*config\.semantic\.embeddingModel/);
  });
});
