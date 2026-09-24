/**
 * Payload fixtures for the Business OS AI admin screen's rendering tests.
 *
 * These deliberately name models and temperatures — a test that could not say
 * "the payload said gpt-4o-mini and the screen showed gpt-4o-mini" would not be
 * testing anything. The literal gate excludes tests for exactly this reason.
 */

import type { AreaView, CallView, SettingIssue } from '@/app/admin/business-os-llm/types';

export function call(over: Partial<CallView> = {}): CallView {
  return {
    callName: 'insight_content',
    resolved: { enabled: true, provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3 },
    provenance: { enabled: 'default', provider: 'default', model: 'default', temperature: 'default' },
    issues: [],
    locks: { switchable: true, lockedTemperature: null, temperatureNotApplicable: false },
    defaults: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3 },
    ...over,
  };
}

export function issue(over: Partial<SettingIssue> = {}): SettingIssue {
  return {
    area: 'insights',
    callName: 'insight_content',
    level: 'call',
    field: 'model',
    kind: 'rejected',
    reason: 'unpriced_model: no active price row for openai/gpt-nope',
    ...over,
  };
}

export function area(over: Partial<AreaView> = {}): AreaView {
  return {
    area: 'insights',
    key: 'bos_llm_area_insights',
    switchable: true,
    configuredEnabled: true,
    rowPresent: true,
    storedRow: { model: 'gpt-4o-mini' },
    updatedAt: '2026-09-21T10:14:08.000Z',
    lastChangedBy: { kind: 'not_recorded', at: '2026-09-21T10:14:08.000Z' },
    calls: [call()],
    areaIssues: [],
    temperatureBounds: { min: 0, max: 2 },
    modelOptions: {
      byCall: { insight_content: [{ provider: 'openai', model: 'gpt-4o-mini' }] },
      allowedProvidersByCall: { insight_content: ['openai'] },
      cacheAgeMs: 1000,
      cacheTtlMs: 3_600_000,
    },
    ...over,
  };
}

/** A `fetch` stub that answers the settings read and the ledger check. */
export function stubFetch(handlers: {
  settings?: unknown;
  ledger?: { status: number; body: unknown };
}) {
  return jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/ledger')) {
      const ledger = handlers.ledger ?? { status: 500, body: { success: false } };
      return {
        ok: ledger.status >= 200 && ledger.status < 300,
        status: ledger.status,
        json: async () => ledger.body,
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: handlers.settings }),
    } as Response;
  });
}
