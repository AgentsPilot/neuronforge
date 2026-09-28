/**
 * Payload fixtures for the Business OS AI admin screen's rendering tests.
 *
 * These deliberately name models and temperatures — a test that could not say
 * "the payload said gpt-4o-mini and the screen showed gpt-4o-mini" would not be
 * testing anything. The literal gate excludes tests for exactly this reason.
 */

import type {
  AreaView,
  CallView,
  ExcludedCallView,
  ProvenanceLevel,
  SettingIssue,
} from '@/app/admin/business-os-llm/types';

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
    // FR-9. Defaulted so that every existing render test keeps a well-formed
    // payload: TypeScript would not tell us (the screen is outside
    // `typecheck:bos-llm` by design), the tests would simply throw on
    // `area.excludedCalls.length`.
    excludedCalls: [],
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

// ---------------------------------------------------------------------------
// The seed-derived fixture (FR-6, AC-13 … AC-15)
// ---------------------------------------------------------------------------

/**
 * All eight areas and all 22 configurable calls, as production actually
 * resolves them.
 *
 * ── Why it is hand-built, and why that is safe ───────────────────────────
 * The marker ACs are about a DISTRIBUTION — "35 of 44 fields carry no marker",
 * "zero `c`" — and a distribution asserted against a fixture invented to match
 * it is vacuous. So this one is derived, field by field, from
 * `supabase/migrations/20261003_seed_bos_llm_area_settings.sql` read against
 * `modelSettingsPolicy.ts:166-228` and the resolver's provenance rules
 * (`modelSettings.ts:596-691`), and `assertSeedDerivedShape()` below asserts
 * the derivation BEFORE any AC consumes it. A mis-built fixture fails loudly
 * instead of making AC-13 … AC-15 green for the wrong reason.
 *
 * Two of the eight rows could have differed from the seed's literal values in
 * production (`chat.calls.analysis.enabled` copies the legacy
 * `bizchat_analysis_enabled`, and `leads.enabled` copies
 * `lead_reply_recommender_enabled`). Both were read from production on
 * 2026-09-24 with `npm run bos:llm-settings -- get <area>`: both are `true`,
 * and both areas took the seed's fallback model. So the values below are
 * corroborated, not merely assumed — which is what makes "zero `c` today" and
 * "zero off chips today" statements about production.
 *
 * ── The derivation, row by row ───────────────────────────────────────────
 * Every area row sets `provider`, `model` and (except images) `temperature` at
 * area level, so every call resolves BOTH rendered fields from the stored row
 * unless the policy owns the field. The exceptions are exactly these:
 *
 *   model, call-level (5)      chat/planner, chat/analysis   (row `calls.*.model`)
 *                              website/full_site, website/landing_page
 *                              intake/question_inference
 *   temperature, call-level (4) insights/correlated_insight, insights/health_summary
 *                              website/testimonial_enhance, intake/question_inference
 *   temperature, default (2)   chat/planner            — policy `{ locked: 0 }`
 *                              images/image_generation — policy `not_applicable`
 *
 * Onboarding's four extractors are NOT a `default` case: the row stores
 * `temperature: NULL` explicitly and `readField` uses `hasOwnProperty`, so
 * "send none" resolves at AREA level. Seeding a number there would change
 * behaviour — the null IS the correct stored value (F-8).
 *
 * → 22 calls × 2 rendered fields = 44. Stored-row = 42. `*` = 9 (a SUBSET of
 *   the 42 — a call-level value is a stored value). `c` = 0. Unmarked = 35.
 */
function seedCall(
  callName: string,
  model: string,
  temperature: number | null,
  over: {
    modelFrom?: ProvenanceLevel;
    temperatureFrom?: ProvenanceLevel;
    defaults?: CallView['defaults'];
    locks?: Partial<CallView['locks']>;
    enabledFrom?: ProvenanceLevel;
  } = {}
): CallView {
  return {
    callName,
    resolved: { enabled: true, provider: 'openai', model, temperature },
    provenance: {
      enabled: over.enabledFrom ?? 'default',
      // S1-8 forces the provider's provenance to `default` whenever the model
      // came out equal to the code default. It is never marked (AC-6), so the
      // value here only has to be honest, not load-bearing.
      provider: 'default',
      model: over.modelFrom ?? 'area',
      temperature: over.temperatureFrom ?? 'area',
    },
    issues: [],
    locks: {
      switchable: true,
      lockedTemperature: null,
      temperatureNotApplicable: false,
      ...over.locks,
    },
    defaults: over.defaults ?? { provider: 'openai', model, temperature },
  };
}

function seedArea(name: string, calls: CallView[], over: Partial<AreaView> = {}): AreaView {
  return area({
    area: name,
    key: `bos_llm_area_${name}`,
    calls,
    modelOptions: {
      byCall: Object.fromEntries(
        calls.map((c) => [c.callName, [{ provider: 'openai', model: c.resolved.model }]])
      ),
      allowedProvidersByCall: Object.fromEntries(calls.map((c) => [c.callName, ['openai']])),
      cacheAgeMs: 1000,
      cacheTtlMs: 3_600_000,
    },
    ...over,
  });
}

export const SEED_EXCLUDED_REASON =
  'Not configurable here — changing an embedding model invalidates every stored vector (the plan ' +
  'cache and the verified questions), so it is a data migration, not a setting. These calls keep ' +
  'the shared helpbot_embedding_model key, and chat’s area switch still stops them, because the ' +
  'gate runs at chat route entry.';

export const SEED_EXCLUDED_CALL_NAMES = [
  'plan_cache_lookup_embedding',
  'plan_cache_store_embedding',
  'verified_question_embedding',
  'verified_question_store_embedding',
];

export function seedExcludedCalls(): ExcludedCallView[] {
  return SEED_EXCLUDED_CALL_NAMES.map((callName) => ({
    callName,
    reason: SEED_EXCLUDED_REASON,
  }));
}

export function seedDerivedAreas(): AreaView[] {
  return [
    seedArea(
      'chat',
      [
        // Row: calls.planner.model = 'gpt-4o-mini' (the legacy stored value,
        // equal to the code default). Temperature is policy-locked at 0 and is
        // deliberately NOT written by the seed.
        seedCall('planner', 'gpt-4o-mini', 0, {
          modelFrom: 'call',
          temperatureFrom: 'default',
          locks: { switchable: false, lockedTemperature: 0 },
        }),
        // Row: calls.analysis = { model, enabled: true }. The area temperature
        // 0 applies.
        seedCall('analysis', 'gpt-4o-mini', 0, { modelFrom: 'call', enabledFrom: 'call' }),
      ],
      { excludedCalls: seedExcludedCalls() }
    ),
    seedArea('insights', [
      seedCall('insight_content', 'gpt-4o-mini', 0.3),
      seedCall('correlated_insight', 'gpt-4o-mini', 0.4, {
        temperatureFrom: 'call',
        defaults: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4 },
      }),
      seedCall('health_summary', 'gpt-4o-mini', 0.5, {
        temperatureFrom: 'call',
        defaults: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.5 },
      }),
    ]),
    seedArea('briefing', [seedCall('daily_narration', 'gpt-4o-mini', 0.3)]),
    seedArea('website', [
      seedCall('full_site', 'gpt-4o', 0.7, { modelFrom: 'call' }),
      seedCall('landing_page', 'gpt-4o', 0.7, { modelFrom: 'call' }),
      seedCall('field_regenerate', 'gpt-4o-mini', 0.7),
      seedCall('testimonial_enhance', 'gpt-4o-mini', 0.5, {
        temperatureFrom: 'call',
        defaults: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.5 },
      }),
      seedCall('hero_content', 'gpt-4o-mini', 0.7),
      seedCall('about_content', 'gpt-4o-mini', 0.7),
      seedCall('faq_content', 'gpt-4o-mini', 0.7),
      seedCall('features_content', 'gpt-4o-mini', 0.7),
    ]),
    seedArea('intake', [
      seedCall('form_generation', 'gpt-4o', 0.3),
      // The one call with BOTH rendered fields set on the call itself.
      seedCall('question_inference', 'gpt-4o-mini', 0.2, {
        modelFrom: 'call',
        temperatureFrom: 'call',
      }),
    ]),
    seedArea('leads', [seedCall('reply_recommendation', 'gpt-4o-mini', 0.2)]),
    // `temperature: NULL` in the row is "send none", and it resolves at AREA
    // level — not `default`. Onboarding can never be switched off.
    seedArea(
      'onboarding',
      [
        seedCall('business_story_extraction', 'gpt-4o', null, { locks: { switchable: false } }),
        seedCall('client_workflow_extraction', 'gpt-4o', null, { locks: { switchable: false } }),
        seedCall('client_tracking_extraction', 'gpt-4o', null, { locks: { switchable: false } }),
        seedCall('adjustment_intent_extraction', 'gpt-4o', null, { locks: { switchable: false } }),
      ],
      { switchable: false }
    ),
    seedArea('images', [
      seedCall('image_generation', 'gpt-image-1', null, {
        temperatureFrom: 'default',
        locks: { temperatureNotApplicable: true },
      }),
    ]),
  ];
}

/**
 * The fixture's own shape, asserted before any AC consumes it (R-2).
 *
 * Returns the counts so a caller can assert them; throws nothing itself — the
 * caller's `expect` produces the failure message.
 */
export function seedDerivedShape(areas: AreaView[] = seedDerivedAreas()) {
  const calls = areas.flatMap((a) => a.calls);
  const rendered = calls.flatMap((c) => [
    { call: c, field: 'model' as const, level: c.provenance.model },
    { call: c, field: 'temperature' as const, level: c.provenance.temperature },
  ]);
  const policyOwnedTemperature = calls.filter(
    (c) => c.locks.lockedTemperature !== null || c.locks.temperatureNotApplicable
  ).length;

  return {
    areas: areas.length,
    calls: calls.length,
    renderedFields: rendered.length,
    fromStoredRow: rendered.filter((f) => f.level !== 'default').length,
    callLevel: rendered.filter((f) => f.level === 'call').length,
    policyOwnedTemperature,
    /** A `default` field that is NOT policy-owned: the only case that earns a `c`. */
    configurableCodeDefaults: rendered.filter(
      (f) =>
        f.level === 'default' &&
        !(
          f.field === 'temperature' &&
          (f.call.locks.lockedTemperature !== null || f.call.locks.temperatureNotApplicable)
        )
    ).length,
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
