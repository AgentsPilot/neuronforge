/**
 * The catalog is the source of truth for how Business OS LLM spend is named in
 * the ledger. Runtime behaviour is asserted here; the `@ts-expect-error` cases
 * are enforced by `tsc --noEmit` (Jest runs transpile-only under
 * isolatedModules and does not check them).
 */

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

jest.mock('@/lib/logger', () => ({
  createLogger: () => mockLogger,
}));

import {
  BOS_CHAT_FEATURE,
  BOS_FEATURE_FILTER_PREFIX,
  BOS_KNOWN_NON_CATALOG_COMPONENTS,
  BOS_LEGACY_FEATURES,
  BOS_LEGACY_FEATURES_FLAT,
  BOS_LEGACY_HELPER_LABEL,
  BOS_LLM_AREAS,
  BOS_LLM_CALLS,
  bosFeature,
  bosRowFilter,
  isBusinessOsFeature,
  isPlatformAccount,
  isPlatformAccountEnvIgnored,
  platformAccountIds,
  bosBriefingGroupId,
  buildBosCallContext,
  isUuid,
  newBosGroupId,
  toEmbeddingAttribution,
  uuidV5,
  type BosLlmAttribution,
} from '../callCatalog';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const G1 = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SYSTEM_ADMIN_USER_ID;
});

describe('buildBosCallContext', () => {
  it('maps area → feature, call name → component, group → sessionId', () => {
    const context = buildBosCallContext({
      userId: U1,
      area: 'insights',
      callName: 'insight_content',
      groupId: G1,
    });

    expect(context).toStrictEqual({
      userId: U1,
      feature: 'business-os-insights',
      component: 'insight_content',
      sessionId: G1,
    });
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('preserves extra fields such as the repair marking', () => {
    const context = buildBosCallContext(
      { userId: U1, area: 'chat', callName: 'planner', groupId: G1 },
      { activity_type: 'repair' }
    );

    expect(context.activity_type).toBe('repair');
    expect(context.component).toBe('planner');
  });

  it('never lets extras override the attribution keys at runtime', () => {
    const hostile = {
      activity_type: 'plan',
      userId: 'someone-else',
      feature: 'helpbot',
      component: 'x',
      sessionId: 'y',
    };
    // A cast is needed only because the type forbids exactly this; the test is
    // that the runtime spread order holds even if a caller forces it.
    const context = buildBosCallContext(
      { userId: U1, area: 'chat', callName: 'analysis', groupId: G1 },
      hostile as unknown as { activity_type: string }
    );

    expect(context).toMatchObject({
      userId: U1,
      feature: 'business-os-chat',
      component: 'analysis',
      sessionId: G1,
      activity_type: 'plan',
    });
  });

  it('allows chat with no turn id, recording no group', () => {
    const context = buildBosCallContext({
      userId: U1,
      area: 'chat',
      callName: 'planner',
      groupId: undefined,
    });

    expect(context.sessionId).toBeUndefined();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it.each(['system', 'unknown', '', 'not-a-uuid'])(
    'logs an error for invalid account %p and still returns the context unchanged',
    (userId) => {
      const context = buildBosCallContext({
        userId,
        area: 'website',
        callName: 'full_site',
        groupId: G1,
        correlationId: 'corr-1',
      });

      expect(context.userId).toBe(userId);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error.mock.calls[0][0]).toMatchObject({
        area: 'website',
        callName: 'full_site',
        correlationId: 'corr-1',
        groupId: G1,
      });
    }
  );

  it('logs an error for the all-zero placeholder and for the system admin account', () => {
    process.env.SYSTEM_ADMIN_USER_ID = U2;

    buildBosCallContext({ userId: '00000000-0000-0000-0000-000000000000', area: 'leads', callName: 'reply_recommendation', groupId: G1 });
    buildBosCallContext({ userId: U2, area: 'leads', callName: 'reply_recommendation', groupId: G1 });

    expect(mockLogger.error).toHaveBeenCalledTimes(2);
  });

  it('names the grouping id when there is no correlation id', () => {
    buildBosCallContext({ userId: 'system', area: 'insights', callName: 'health_summary', groupId: G1 });

    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ groupId: G1, correlationId: undefined });
  });

  it('warns when a grouping id is present but not a UUID', () => {
    buildBosCallContext({ userId: U1, area: 'chat', callName: 'analysis', groupId: 'corr-not-uuid' });

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('rejects mismatched area and call names at compile time', () => {
    // @ts-expect-error: full_site is a website call, not a chat call
    const wrongArea: BosLlmAttribution = {
      userId: U1,
      area: 'chat',
      callName: 'full_site',
      groupId: G1,
    };

    // @ts-expect-error: a non-chat area requires a grouping id
    const missingGroup: BosLlmAttribution = { userId: U1, area: 'intake', callName: 'form_generation', groupId: undefined };

    // @ts-expect-error: the account is required
    const missingUser: BosLlmAttribution = { area: 'leads', callName: 'reply_recommendation', groupId: G1 };

    buildBosCallContext(
      { userId: U1, area: 'chat', callName: 'planner', groupId: G1 },
      // @ts-expect-error: extras may not carry an attribution key
      { feature: 'helpbot' }
    );

    expect([wrongArea, missingGroup, missingUser]).toHaveLength(3);
  });
});

describe('bosFeature', () => {
  it('keeps the chat label byte-identical to the value telemetry has always used', () => {
    expect(BOS_CHAT_FEATURE).toBe('business-os-chat');
  });

  it('prefixes every area the same way the builder records it', () => {
    for (const area of BOS_LLM_AREAS) {
      expect(bosFeature(area)).toBe(`business-os-${area}`);
    }
  });
});

describe('BOS_LLM_CALLS', () => {
  it('keeps call names unique within each area', () => {
    for (const names of Object.values(BOS_LLM_CALLS)) {
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('splits verified-question lookup from store', () => {
    expect(BOS_LLM_CALLS.chat).toContain('verified_question_embedding');
    expect(BOS_LLM_CALLS.chat).toContain('verified_question_store_embedding');
  });
});

describe('toEmbeddingAttribution', () => {
  it('carries account, feature, turn and call name from a built context', () => {
    const context = buildBosCallContext({
      userId: U1,
      area: 'chat',
      callName: 'plan_cache_store_embedding',
      groupId: G1,
    });

    expect(toEmbeddingAttribution(context)).toStrictEqual({
      userId: U1,
      feature: 'business-os-chat',
      turnId: G1,
      callName: 'plan_cache_store_embedding',
    });
  });
});

describe('uuidV5', () => {
  it('matches the published RFC vector (DNS namespace, python.org)', () => {
    expect(uuidV5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '886313e1-3b8a-5372-9b90-0c9aee199e5d'
    );
  });

  it('sets version nibble 5 and variant bits 10xx', () => {
    const id = bosBriefingGroupId(U1, '2026-09-17');
    expect(id[14]).toBe('5');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('rejects a namespace that is not a UUID', () => {
    expect(() => uuidV5('x', 'nope')).toThrow();
  });
});

describe('bosBriefingGroupId', () => {
  it('is deterministic for the same account and date', () => {
    expect(bosBriefingGroupId(U1, '2026-09-17')).toBe(bosBriefingGroupId(U1, '2026-09-17'));
  });

  it('differs by date and by account', () => {
    const base = bosBriefingGroupId(U1, '2026-09-17');
    expect(bosBriefingGroupId(U1, '2026-09-18')).not.toBe(base);
    expect(bosBriefingGroupId(U2, '2026-09-17')).not.toBe(base);
  });

  it('is a valid UUID', () => {
    expect(isUuid(bosBriefingGroupId(U1, '2026-09-17'))).toBe(true);
  });
});

describe('newBosGroupId', () => {
  it('returns a fresh valid UUID each time', () => {
    const a = newBosGroupId();
    const b = newBosGroupId();
    expect(isUuid(a)).toBe(true);
    expect(isUuid(b)).toBe(true);
    expect(a).not.toBe(b);
  });
});

// ─── Layer 1.1 shared constants (FR-4 to FR-6, AC-4, AC-5) ────────────────────

const ZERO = '00000000-0000-0000-0000-000000000000';

describe('platform account (FR-5)', () => {
  it('is only the all-zero id when SYSTEM_ADMIN_USER_ID is unset', () => {
    expect(platformAccountIds()).toEqual([ZERO]);
    expect(isPlatformAccount(ZERO)).toBe(true);
    expect(isPlatformAccount(U1)).toBe(false);
    expect(isPlatformAccountEnvIgnored()).toBe(false);
  });

  it('adds SYSTEM_ADMIN_USER_ID when it is a UUID, read at call time', () => {
    process.env.SYSTEM_ADMIN_USER_ID = U2;
    expect(platformAccountIds()).toEqual([ZERO, U2]);
    expect(isPlatformAccount(U2)).toBe(true);
    expect(isPlatformAccountEnvIgnored()).toBe(false);
  });

  it('lower-cases the env id and compares case-insensitively', () => {
    const upper = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    process.env.SYSTEM_ADMIN_USER_ID = upper;
    expect(platformAccountIds()).toEqual([ZERO, upper.toLowerCase()]);
    expect(isPlatformAccount(upper.toLowerCase())).toBe(true);
    expect(isPlatformAccount(upper)).toBe(true);
    expect(isPlatformAccount(ZERO.toUpperCase())).toBe(true);
  });

  it('does not repeat the all-zero id when the env is set to it', () => {
    process.env.SYSTEM_ADMIN_USER_ID = ZERO;
    expect(platformAccountIds()).toEqual([ZERO]);
  });

  it('leaves out a non-UUID env value and says so (WC-9)', () => {
    process.env.SYSTEM_ADMIN_USER_ID = 'not-a-uuid';
    expect(platformAccountIds()).toEqual([ZERO]);
    expect(isPlatformAccountEnvIgnored()).toBe(true);
  });

  it('agrees with isPlatformAccount for every id it returns, env set or unset', () => {
    for (const env of [undefined, U2]) {
      if (env) process.env.SYSTEM_ADMIN_USER_ID = env;
      else delete process.env.SYSTEM_ADMIN_USER_ID;
      for (const id of platformAccountIds()) expect(isPlatformAccount(id)).toBe(true);
    }
  });

  it('makes the builder log an error for an upper-case spelling of the system id', () => {
    process.env.SYSTEM_ADMIN_USER_ID = U2;
    buildBosCallContext({ userId: U2.toUpperCase(), area: 'leads', callName: 'reply_recommendation', groupId: G1 });
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });
});

describe('Business OS feature values (FR-4)', () => {
  it('flattens the per-area legacy lists in area order', () => {
    expect(BOS_LEGACY_FEATURES_FLAT).toEqual(BOS_LLM_AREAS.flatMap((a) => [...BOS_LEGACY_FEATURES[a]]));
    expect(new Set(BOS_LEGACY_FEATURES_FLAT).size).toBe(BOS_LEGACY_FEATURES_FLAT.length);
  });

  it('never lists a current value as a legacy value', () => {
    for (const area of BOS_LLM_AREAS) {
      for (const other of BOS_LLM_AREAS) {
        expect(BOS_LEGACY_FEATURES[area] as readonly string[]).not.toContain(bosFeature(other));
      }
    }
  });

  it('builds the row filter from the constants', () => {
    expect(bosRowFilter()).toEqual({ featurePrefix: BOS_FEATURE_FILTER_PREFIX, features: BOS_LEGACY_FEATURES_FLAT });
    for (const area of BOS_LLM_AREAS) expect(bosFeature(area).startsWith(BOS_FEATURE_FILTER_PREFIX)).toBe(true);
  });

  it('recognises current, legacy and misspelled Business OS values, and nothing else', () => {
    for (const area of BOS_LLM_AREAS) expect(isBusinessOsFeature(bosFeature(area))).toBe(true);
    for (const legacy of BOS_LEGACY_FEATURES_FLAT) expect(isBusinessOsFeature(legacy)).toBe(true);
    expect(isBusinessOsFeature('business-os-webiste')).toBe(true);
    expect(isBusinessOsFeature('onboarding')).toBe(false);
    expect(isBusinessOsFeature('chat-v3')).toBe(false);
    expect(isBusinessOsFeature('')).toBe(false);
  });
});

describe('known non-catalog components (FR-6)', () => {
  it('keys each entry by its component, in a real area, and is not a catalog call name', () => {
    for (const [key, entry] of Object.entries(BOS_KNOWN_NON_CATALOG_COMPONENTS)) {
      expect(entry.component).toBe(key);
      expect(BOS_LLM_AREAS).toContain(entry.area);
      expect((BOS_LLM_CALLS[entry.area] as readonly string[]).includes(entry.component)).toBe(false);
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('exempts the plan-cache row from the call-name flag only, and the intent parser from both', () => {
    expect([...BOS_KNOWN_NON_CATALOG_COMPONENTS.BizQLPlanCache.exemptFrom]).toEqual(['unknown_call_name']);
    expect([...BOS_KNOWN_NON_CATALOG_COMPONENTS.IntentParser.exemptFrom].sort()).toEqual([
      'missing_group_id',
      'unknown_call_name',
    ]);
  });

  it('pins the legacy helper label', () => {
    expect(BOS_LEGACY_HELPER_LABEL).toEqual({ feature: 'onboarding', component: 'simple-complete' });
  });
});
