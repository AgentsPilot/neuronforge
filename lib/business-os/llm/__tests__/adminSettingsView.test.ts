/**
 * The admin screen's read model — slice 1.
 *
 * The tests that matter most here are S1-T11 and S1-T11b, which pin R-1's two
 * guards SEPARATELY. `admin_users.user_id` is nullable until an admin first
 * signs in, and each guard is wrong to remove in a different way:
 *
 *   - without the build-side skip, the map carries a `null` key, and every
 *     unattributed row renders as that admin's email;
 *   - without the lookup-side null-first branch, a null `updated_by` renders as
 *     a raw id labelled unresolved — the string `null` on screen.
 *
 * A single combined test would pass with only one of them present.
 */

import type { SystemSettingsConfig } from '@/lib/repositories/types';

const getByKeys = jest.fn();
const getImageGenerationConfig = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  // Spread the real module: `modelSettingsPolicy` reads
  // `IMAGE_GENERATION_CONFIG_DEFAULTS` from here at import time, so replacing
  // the whole module wholesale breaks the policy map before a test can run.
  ...jest.requireActual('@/lib/repositories/SystemConfigRepository'),
  systemConfigRepository: {
    getByKeys: (...a: unknown[]) => getByKeys(...a),
    getImageGenerationConfig: () => getImageGenerationConfig(),
  },
}));

const listActive = jest.fn();
jest.mock('@/lib/repositories/AdminUserRepository', () => ({
  adminUserRepository: { listActive: () => listActive() },
}));

jest.mock('@/lib/business-os/llm/modelOptions', () => ({
  // The option builder has its own suite (`modelOptions.test.ts`); here it is
  // stubbed so these cases are about the view's own shaping.
  newModelOptionsContext: jest.fn(async () => ({
    candidates: [],
    cacheAgeMs: 0,
    cacheTtlMs: 3_600_000,
    guardrails: { price: new Map(), imageConfig: null },
  })),
  buildAreaModelOptions: jest.fn(async () => ({
    byCall: {},
    allowedProvidersByCall: {},
    cacheAgeMs: 0,
    cacheTtlMs: 3_600_000,
  })),
}));

import {
  buildAdminSettingsView,
  lastChangedByFor,
} from '@/lib/business-os/llm/adminSettingsView';
import { validateAreaRow } from '@/lib/business-os/llm/modelSettings';
import { bosLlmAreaKey } from '@/lib/business-os/llm/modelSettingsPolicy';
import { BOS_LLM_AREAS } from '@/lib/business-os/llm/callCatalog';

function row(overrides: Partial<SystemSettingsConfig> & { key: string }): SystemSettingsConfig {
  return {
    id: 'row-id',
    value: {},
    category: 'business_os_llm',
    description: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-21T10:14:08.360Z',
    updated_by: null,
    ...overrides,
  } as SystemSettingsConfig;
}

const BOUND_ADMIN = {
  id: 'a1',
  user_id: '11111111-1111-1111-1111-111111111111',
  email: 'bound@example.com',
  granted_by: null,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
};

/** The case R-1 is about: active, but never signed in, so no user id. */
const UNBOUND_ADMIN = { ...BOUND_ADMIN, id: 'a2', user_id: null, email: 'unbound@example.com' };

beforeEach(() => {
  jest.clearAllMocks();
  getByKeys.mockResolvedValue({ data: [], error: null });
  listActive.mockResolvedValue({ data: [BOUND_ADMIN], error: null });
  getImageGenerationConfig.mockResolvedValue({ sizes: {}, pricesUsd: {} });
});

describe('S1-T11: R-1 guard 1 — the id→email map (build side), on its own', () => {
  it('never keys the map by a null user_id, so an unattributed row cannot match an admin', async () => {
    listActive.mockResolvedValue({ data: [UNBOUND_ADMIN, BOUND_ADMIN], error: null });
    getByKeys.mockResolvedValue({
      data: [row({ key: bosLlmAreaKey('leads'), updated_by: null })],
      error: null,
    });

    const { areas } = await buildAdminSettingsView();
    const leads = areas.find((a) => a.area === 'leads')!;

    // The bug this prevents: `null === null` matching and rendering
    // unbound@example.com against a row nobody is recorded against.
    expect(leads.lastChangedBy).toEqual({
      kind: 'not_recorded',
      at: '2026-09-21T10:14:08.360Z',
    });
    expect(JSON.stringify(leads.lastChangedBy)).not.toContain('unbound@example.com');
  });

  it('still resolves a bound admin from the same list', async () => {
    listActive.mockResolvedValue({ data: [UNBOUND_ADMIN, BOUND_ADMIN], error: null });
    getByKeys.mockResolvedValue({
      data: [row({ key: bosLlmAreaKey('leads'), updated_by: BOUND_ADMIN.user_id })],
      error: null,
    });

    const { areas } = await buildAdminSettingsView();

    expect(areas.find((a) => a.area === 'leads')!.lastChangedBy).toEqual({
      kind: 'admin',
      at: '2026-09-21T10:14:08.360Z',
      email: 'bound@example.com',
    });
  });
});

describe('S1-T11b: R-1 guard 2 — the lookup (null answered first), on its own', () => {
  // Fed a map that DOES contain a null key, which is what the build side would
  // produce without guard 1. Guard 2 must still not consult it.
  const poisonedMap = new Map<string, string>([
    [null as unknown as string, 'unbound@example.com'],
    [BOUND_ADMIN.user_id, 'bound@example.com'],
  ]);

  it('answers a null updated_by before any lookup', () => {
    const result = lastChangedByFor(
      row({ key: bosLlmAreaKey('leads'), updated_by: null }),
      poisonedMap
    );

    expect(result).toEqual({ kind: 'not_recorded', at: '2026-09-21T10:14:08.360Z' });
  });

  it('never renders the literal string null, blank, or "unknown"', () => {
    const rendered = JSON.stringify(
      lastChangedByFor(row({ key: bosLlmAreaKey('leads'), updated_by: null }), poisonedMap)
    );

    expect(rendered).not.toContain('"null"');
    expect(rendered.toLowerCase()).not.toContain('unknown');
    expect(rendered).not.toContain('""');
  });
});

describe('RC-1: FR-14 renders three row states, and keeps them apart', () => {
  it('no stored row is not the same state as a row with no actor', () => {
    const noRow = lastChangedByFor(undefined, new Map());
    const noActor = lastChangedByFor(row({ key: bosLlmAreaKey('leads'), updated_by: null }), new Map());

    expect(noRow).toEqual({ kind: 'no_row' });
    expect(noActor.kind).toBe('not_recorded');
    // Collapsing these into one blank would hide the more interesting fact:
    // the screen always attributes, so a row with no actor is de-facto a
    // break-glass change.
    expect(noRow.kind).not.toBe(noActor.kind);
  });

  it('an id matching no bound active admin renders raw and labelled', () => {
    const result = lastChangedByFor(
      row({ key: bosLlmAreaKey('leads'), updated_by: '99999999-9999-9999-9999-999999999999' }),
      new Map([[BOUND_ADMIN.user_id, 'bound@example.com']])
    );

    expect(result).toEqual({
      kind: 'unresolved',
      at: '2026-09-21T10:14:08.360Z',
      userId: '99999999-9999-9999-9999-999999999999',
    });
  });

  it('a failed admin list degrades to unresolved rather than failing the page', async () => {
    listActive.mockResolvedValue({ data: null, error: new Error('down') });
    getByKeys.mockResolvedValue({
      data: [row({ key: bosLlmAreaKey('leads'), updated_by: BOUND_ADMIN.user_id })],
      error: null,
    });

    const { areas } = await buildAdminSettingsView();

    expect(areas.find((a) => a.area === 'leads')!.lastChangedBy.kind).toBe('unresolved');
  });
});

describe('S1-T3 / S1-T6: the payload', () => {
  it('covers all eight areas and survives JSON (RC-2a: no Map leaks as {})', async () => {
    const { areas } = await buildAdminSettingsView();

    expect(areas.map((a) => a.area)).toEqual([...BOS_LLM_AREAS]);

    const roundTripped = JSON.parse(JSON.stringify(areas));
    for (const area of roundTripped) {
      expect(area.calls.length).toBeGreaterThan(0);
      for (const call of area.calls) {
        // A `Map` through JSON.stringify becomes `{}` silently. Provenance
        // must arrive as real, readable fields.
        expect(Object.keys(call.provenance).sort()).toEqual([
          'enabled',
          'model',
          'provider',
          'temperature',
        ]);
      }
    }
  });

  it('matches validateAreaRow field for field — the same function the script prints', async () => {
    const { areas } = await buildAdminSettingsView();

    for (const area of areas) {
      const validation = await validateAreaRow(area.area, null);
      for (const call of area.calls) {
        const expected = validation.resolved.get(call.callName)!;
        expect(call.resolved).toEqual({
          enabled: expected.enabled,
          provider: expected.provider,
          model: expected.model,
          temperature: expected.temperature ?? null,
        });
      }
    }
  });

  it('an area with no row is not an error state and carries no attribution', async () => {
    const { areas } = await buildAdminSettingsView();

    for (const area of areas) {
      expect(area.rowPresent).toBe(false);
      expect(area.lastChangedBy).toEqual({ kind: 'no_row' });
      expect(area.storedRow).toBeNull();
    }
  });

  it('never renders a not-set temperature as 0', async () => {
    const { areas } = await buildAdminSettingsView();

    const images = areas.find((a) => a.area === 'images')!;
    const imageCall = images.calls.find((c) => c.callName === 'image_generation')!;

    // The image call sends no temperature at all. `null` is the wire form of
    // "not set"; 0 would be a different instruction to the provider.
    expect(imageCall.resolved.temperature).toBeNull();
    expect(imageCall.locks.temperatureNotApplicable).toBe(true);
  });

  it('carries the locks the UI must render disabled', async () => {
    const { areas } = await buildAdminSettingsView();

    expect(areas.find((a) => a.area === 'onboarding')!.switchable).toBe(false);

    const planner = areas.find((a) => a.area === 'chat')!.calls.find((c) => c.callName === 'planner')!;
    expect(planner.locks.switchable).toBe(false);
    expect(planner.locks.lockedTemperature).toBe(0);
  });
});

describe('S1-T4: provenance', () => {
  async function provenanceFor(value: unknown, area: 'leads' = 'leads') {
    getByKeys.mockResolvedValue({ data: [row({ key: bosLlmAreaKey(area), value })], error: null });
    const { areas } = await buildAdminSettingsView();
    return areas.find((a) => a.area === area)!;
  }

  it('reports default when nothing is configured', async () => {
    const leads = await provenanceFor({});
    expect(leads.calls[0].provenance.model).toBe('default');
  });

  it('reports area for an area-level value', async () => {
    const leads = await provenanceFor({ model: 'gpt-4o' });
    for (const call of leads.calls) expect(call.provenance.model).toBe('area');
  });

  it('reports call for a call-level override', async () => {
    const leads = await provenanceFor({ calls: { reply_recommendation: { model: 'gpt-4o' } } });
    const call = leads.calls.find((c) => c.callName === 'reply_recommendation')!;
    expect(call.provenance.model).toBe('call');
  });

  it('reports AREA when the call-level value was refused and fell through', async () => {
    // The case the route could never get right from the stored row alone: the
    // row SETS a call-level model, but the guardrails refuse it, so what is
    // actually in force came from the area.
    const leads = await provenanceFor({
      model: 'gpt-4o',
      calls: { reply_recommendation: { model: 'not-a-priced-model-at-all' } },
    });
    const call = leads.calls.find((c) => c.callName === 'reply_recommendation')!;

    expect(call.resolved.model).toBe('gpt-4o');
    expect(call.provenance.model).toBe('area');
    expect(call.issues.some((i) => i.field === 'model' && i.kind === 'rejected')).toBe(true);
  });

  it('attaches issues to the call they affected', async () => {
    const leads = await provenanceFor({
      calls: { reply_recommendation: { temperature: 1.5 } },
    });
    const call = leads.calls.find((c) => c.callName === 'reply_recommendation')!;

    expect(call.issues.some((i) => i.field === 'temperature' && i.reason.length > 0)).toBe(true);
    // Another call of the same area must not inherit it.
    const other = leads.calls.find((c) => c.callName !== 'reply_recommendation');
    if (other) expect(other.issues).toHaveLength(0);
  });
});
