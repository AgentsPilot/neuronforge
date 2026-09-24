/**
 * T1-2 / T1-3 (Layer 2 Step 1) — the code-owned policy.
 *
 * Two things are proven here:
 *   1. The policy covers the catalog exactly, and its locks say what DEC-5
 *      says (T1-3).
 *   2. Every code default would pass the guardrails, which is what makes
 *      "the default is never checked at runtime" (RC-W7b) safe.
 *
 * The type-level fixtures (T1-2) are compiled, not run: `typecheck:bos-llm`
 * fails on a `@ts-expect-error` that stops firing (TS2578), so they are a real
 * gate even though Jest transpiles without diagnostics.
 */

// The REAL pricing module is used here on purpose: with the database read
// returning nothing, `getPricing` falls through to the in-code FALLBACK_PRICING
// table, so "every code default is priced" is proven against the table we
// actually ship, not against a mock.
const mockListActive = jest.fn();
jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: { listActive: (...args: unknown[]) => mockListActive(...args) },
}));

const mockGetImageGenerationConfig = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  return {
    ...actual,
    systemConfigRepository: {
      getByKeys: jest.fn(),
      getByKey: jest.fn(),
      getImageGenerationConfig: (...args: unknown[]) => mockGetImageGenerationConfig(...args),
    },
  };
});

import * as fs from 'fs';
import * as path from 'path';

import { BOS_LLM_AREAS, BOS_LLM_CALLS, type BosLlmArea } from '../callCatalog';
import { checkModelAcceptable, resolveBosLlmSettings, validateAreaRow } from '../modelSettings';
import {
  ALLOWED_PROVIDERS_LAYER2,
  BOS_LLM_AREA_KEY_PREFIX,
  BOS_LLM_AREA_KEYS,
  BOS_LLM_AREA_LOCKS,
  BOS_LLM_CALL_POLICY,
  BOS_LLM_SETTINGS_CATEGORY,
  BOS_LLM_SETTINGS_EXCLUDED_CALLS,
  BOS_LLM_SETTINGS_EXCLUSION_REASON,
  bosLlmAreaKey,
  bosLlmExcludedCallNames,
  bosLlmSettingsCallNames,
  getBosLlmCallPolicy,
  IMAGE_PRICE_REQUIRED_QUALITIES,
  type BosLlmCallPolicy,
  type BosLlmCallPolicyMap,
} from '../modelSettingsPolicy';
import { IMAGE_FALLBACK_PRICING, IMAGE_GENERATION_CONFIG_DEFAULTS } from '@/lib/repositories/SystemConfigRepository';

const ROOT = path.resolve(__dirname, '../../../..');

beforeEach(() => {
  mockListActive.mockReset();
  mockGetImageGenerationConfig.mockReset();
  mockListActive.mockResolvedValue({ data: [], error: null });
  mockGetImageGenerationConfig.mockResolvedValue({
    ...IMAGE_GENERATION_CONFIG_DEFAULTS,
    sizes: { ...IMAGE_GENERATION_CONFIG_DEFAULTS.sizes },
    pricesUsd: {},
  });
});

// ---------------------------------------------------------------------------
// T1-2: type-level fixtures. Compiled, never executed.
// ---------------------------------------------------------------------------

function typeFixtures(): unknown {
  // @ts-expect-error — 'insight_contnet' is a typo, not a catalogue call name
  void resolveBosLlmSettings('insights', 'insight_contnet');
  // @ts-expect-error — 'planner' belongs to chat, not to insights
  void resolveBosLlmSettings('insights', 'planner');
  // @ts-expect-error — the four chat embeddings are excluded from settings (DEC-3)
  void resolveBosLlmSettings('chat', 'plan_cache_lookup_embedding');

  const incomplete: BosLlmCallPolicyMap = {
    ...BOS_LLM_CALL_POLICY,
    // @ts-expect-error — a policy map that omits a catalogue call does not type-check
    insights: {
      insight_content: BOS_LLM_CALL_POLICY.insights.insight_content,
      correlated_insight: BOS_LLM_CALL_POLICY.insights.correlated_insight,
    },
  };
  return incomplete;
}

it('keeps the type-level fixtures compiled (T1-2)', () => {
  expect(typeof typeFixtures).toBe('function');
});

// ---------------------------------------------------------------------------
// T1-3: the policy covers the catalog and matches DEC-4 / DEC-5
// ---------------------------------------------------------------------------

describe('policy coverage (T1-3, FR-3)', () => {
  it('gives every catalogue call either a policy or the embeddings exclusion', () => {
    for (const area of BOS_LLM_AREAS) {
      for (const callName of BOS_LLM_CALLS[area] as readonly string[]) {
        const excluded = (BOS_LLM_SETTINGS_EXCLUDED_CALLS as readonly string[]).includes(callName);
        const policy = getBosLlmCallPolicy(area, callName);
        expect([excluded, Boolean(policy)]).toContain(true);
        expect(excluded && policy).toBeFalsy();
      }
    }
  });

  it('excludes exactly the four chat embeddings (DEC-3)', () => {
    expect([...BOS_LLM_SETTINGS_EXCLUDED_CALLS].sort()).toEqual(
      [
        'plan_cache_lookup_embedding',
        'plan_cache_store_embedding',
        'verified_question_embedding',
        'verified_question_store_embedding',
      ].sort()
    );
  });

  /**
   * FR-14 / RC-7 — the exclusion reason has exactly ONE home.
   *
   * The sentence used to be the doc-block prose on
   * `BOS_LLM_SETTINGS_EXCLUDED_CALLS`. The admin screen now renders it to an
   * operator and the client may not import this module (FR-6), so it had to
   * become a constant on the wire. Promoting it while leaving the original
   * prose in place would have re-created the very drift the constant exists to
   * prevent — inside one file — so the comment is now a POINTER, and this test
   * says so.
   */
  const policySource = fs.readFileSync(
    path.join(ROOT, 'lib/business-os/llm/modelSettingsPolicy.ts'),
    'utf8'
  );

  describe('FR-14: the exclusion reason is authored once', () => {
    it('states the mechanism, and opens with what the reader needs first', () => {
      expect(BOS_LLM_SETTINGS_EXCLUSION_REASON.startsWith('Not configurable here')).toBe(true);
      expect(BOS_LLM_SETTINGS_EXCLUSION_REASON).toContain('invalidates every stored vector');
      expect(BOS_LLM_SETTINGS_EXCLUSION_REASON).toContain('data migration, not a setting');
      expect(BOS_LLM_SETTINGS_EXCLUSION_REASON).toContain('helpbot_embedding_model');
      expect(BOS_LLM_SETTINGS_EXCLUSION_REASON).toContain('area switch still stops them');
    });

    it('leaves no second wording of it beside the constant', () => {
      // The distinctive clause of the superseded comment. One occurrence only:
      // the constant itself.
      const occurrences = (policySource.match(/invalidates every stored vector/g) ?? []).length;
      expect(occurrences).toBe(1);
      expect(policySource).not.toContain('The four chat embeddings keep the shared');
    });

    it('records that the wording names chat, and must be revisited if that changes (R-6)', () => {
      expect(policySource).toMatch(/If a non-chat call is ever excluded/);
    });
  });

  /**
   * FR-9 / W-5 — the derivation is generic, by data rather than by an area
   * check. The exclusion list happens to be typed to chat today; nothing here
   * assumes it, and nothing has to be edited the day it stops being true.
   */
  describe('FR-9: the excluded call names of an area', () => {
    it('is chat’s four, in catalog order, and empty everywhere else', () => {
      expect(bosLlmExcludedCallNames('chat')).toEqual([
        'plan_cache_lookup_embedding',
        'plan_cache_store_embedding',
        'verified_question_embedding',
        'verified_question_store_embedding',
      ]);
      for (const area of BOS_LLM_AREAS.filter((a) => a !== 'chat')) {
        expect({ area, excluded: bosLlmExcludedCallNames(area) }).toEqual({ area, excluded: [] });
      }
    });

    it('partitions each area’s catalogue exactly — nothing lost, nothing counted twice', () => {
      for (const area of BOS_LLM_AREAS) {
        expect(
          [...bosLlmSettingsCallNames(area), ...bosLlmExcludedCallNames(area)].sort()
        ).toEqual([...BOS_LLM_CALLS[area]].sort());
      }
    });

    it('derives from the per-NAME predicate, never from an area comparison', () => {
      const at = policySource.indexOf('export function bosLlmExcludedCallNames');
      expect(at).toBeGreaterThan(-1);
      const body = policySource.slice(at, policySource.indexOf('\n}', at));
      expect(body).toContain('isExcludedFromBosLlmSettings');
      expect(body).not.toMatch(/'chat'/);
    });
  });

  it('allows only OpenAI, everywhere (DEC-4)', () => {
    for (const area of BOS_LLM_AREAS) {
      for (const callName of bosLlmSettingsCallNames(area)) {
        expect(getBosLlmCallPolicy(area, callName)!.allowedProviders).toEqual(['openai']);
        expect(getBosLlmCallPolicy(area, callName)!.default.provider).toBe('openai');
      }
    }
  });

  it('locks what DEC-5 locks, and nothing else', () => {
    expect(BOS_LLM_AREA_LOCKS.onboarding.switchable).toBe(false);
    for (const area of BOS_LLM_AREAS) {
      if (area !== 'onboarding') expect(BOS_LLM_AREA_LOCKS[area].switchable).toBe(true);
    }

    // The planner: no switch of its own, temperature pinned at 0 (F-6).
    expect(BOS_LLM_CALL_POLICY.chat.planner.switchable).toBe(false);
    expect(BOS_LLM_CALL_POLICY.chat.planner.temperature).toEqual({ locked: 0 });
    expect(BOS_LLM_CALL_POLICY.chat.analysis.switchable).toBe(true);

    // Onboarding: never switchable, and no temperature at all today (F-7).
    for (const callName of bosLlmSettingsCallNames('onboarding')) {
      const policy = getBosLlmCallPolicy('onboarding', callName)!;
      expect(policy.switchable).toBe(false);
      expect(policy.default.temperature).toBeNull();
    }

    // Switchable since Step 3, which shipped their ★ off paths (RC-W8b).
    // EVERY website call can now be switched off — the kill switch is whole.
    for (const callName of bosLlmSettingsCallNames('website')) {
      expect({ callName, switchable: getBosLlmCallPolicy('website', callName)!.switchable }).toEqual({
        callName,
        switchable: true,
      });
    }

    // Images take no temperature.
    expect(BOS_LLM_CALL_POLICY.images.image_generation.temperature).toBe('not_applicable');
    expect(BOS_LLM_CALL_POLICY.images.image_generation.kind).toBe('image');
  });

  /**
   * The guard that replaced the change script's "PARTIAL SWITCH" warning
   * (S1-7, closed in Step 3).
   *
   * A call with `switchable: false` inside an area that CAN be switched off is
   * a call that keeps spending after `set <area> --enabled false` — unless
   * something else stops it. Between Steps 2 and 3 three website calls were
   * exactly that, and the script warned about them at runtime.
   *
   * Step 3 removed the last of them, so the honest statement is now an
   * allow-list of two: the four onboarding extractors (in an area that can
   * never be switched off at all) and the chat planner (stopped by the chat
   * area gate at the entry of all three chat routes). Anything else added to
   * this set is a half-built kill switch, and it fails here rather than being
   * discovered by an operator whose costs did not fall.
   */
  it('leaves no call that keeps spending when its area is switched off (S1-7)', () => {
    const unswitchable: string[] = [];
    for (const area of BOS_LLM_AREAS) {
      // An area that cannot be switched off has no "area off" state to leak.
      if (!BOS_LLM_AREA_LOCKS[area].switchable) continue;
      for (const callName of bosLlmSettingsCallNames(area)) {
        if (!getBosLlmCallPolicy(area, callName)!.switchable) unswitchable.push(`${area}/${callName}`);
      }
    }

    // Exactly one, and it is stopped at route entry instead (D-27).
    expect(unswitchable.sort()).toEqual(['chat/planner']);
  });

  /**
   * D-54, SA's ruling: the site-level `'openai'` is DELIBERATE, not an
   * oversight, and this is what keeps it safe.
   *
   * Nineteen call sites pass the literal `'openai'` / `PROVIDERS.OPENAI` to the
   * factory; two (the chat planner and the analysis service) pass
   * `settings.provider`; one (images) goes through `getOpenAI()` and cannot
   * take a provider at all. SA ruled: do not retrofit — the divergence is
   * inert, because `allowedProviders` is `['openai']` for every call, so the
   * resolver can never produce anything else for the two sites that do read it.
   *
   * The boundary suites' `getProviderArgs` assertion cannot guard this: it sees
   * `'openai'` either way and cannot tell a literal from a resolved value. So
   * the guard has to be here, on the thing the ruling actually depends on —
   * the moment ANY call is allowed a second provider, the nineteen literal
   * sites would silently keep using OpenAI while the row said otherwise, and
   * this test fails first.
   */
  it('keeps every call OpenAI-only, which is what makes the literal sites safe (D-54)', () => {
    expect(ALLOWED_PROVIDERS_LAYER2).toEqual(['openai']);
    for (const area of BOS_LLM_AREAS) {
      for (const callName of bosLlmSettingsCallNames(area)) {
        expect({ call: `${area}/${callName}`, allowed: getBosLlmCallPolicy(area, callName)!.allowedProviders }).toEqual({
          call: `${area}/${callName}`,
          allowed: ['openai'],
        });
      }
    }
  });

  it('flags the two calls that send a sampling penalty (N-1, Q-3)', () => {
    const withPenalty: string[] = [];
    for (const area of BOS_LLM_AREAS) {
      for (const callName of bosLlmSettingsCallNames(area)) {
        if (getBosLlmCallPolicy(area, callName)!.sendsSamplingPenalty) withPenalty.push(`${area}/${callName}`);
      }
    }
    expect(withPenalty.sort()).toEqual(['chat/analysis', 'chat/planner']);
  });

  it('references the image default rather than copying a model name (N-8)', () => {
    expect(BOS_LLM_CALL_POLICY.images.image_generation.default.model).toBe(
      IMAGE_GENERATION_CONFIG_DEFAULTS.model
    );
  });

  it('builds the eight keys from the catalog, in area order', () => {
    expect(BOS_LLM_AREA_KEYS).toEqual(BOS_LLM_AREAS.map((area) => `${BOS_LLM_AREA_KEY_PREFIX}${area}`));
    expect(BOS_LLM_AREA_KEYS).toHaveLength(8);
    expect(bosLlmAreaKey('leads')).toBe('bos_llm_area_leads');
    expect(BOS_LLM_SETTINGS_CATEGORY).toBe('business_os_llm');
  });

  it('uses the same reserved prefix as the admin route that refuses these keys (S-8)', () => {
    // The route must NOT import this module — it would pull the whole route
    // into the typecheck:bos-llm scope for one string — so the two constants
    // are kept in step here instead.
    const source = fs.readFileSync(
      path.join(ROOT, 'app/api/admin/system-config/route.ts'),
      'utf8'
    );
    const match = source.match(/const RESERVED_KEY_PREFIX = '([^']+)'/);
    expect(match?.[1]).toBe(BOS_LLM_AREA_KEY_PREFIX);
  });
});

// ---------------------------------------------------------------------------
// T1-3: every code default passes the guardrails (RC-W7b)
// ---------------------------------------------------------------------------

describe('code defaults are themselves valid (T1-3, RC-W7b)', () => {
  it('accepts every code default against the guardrails, shortcut bypassed', async () => {
    for (const area of BOS_LLM_AREAS) {
      for (const callName of bosLlmSettingsCallNames(area)) {
        const policy = getBosLlmCallPolicy(area, callName) as BosLlmCallPolicy;
        // eslint-disable-next-line no-await-in-loop
        const check = await checkModelAcceptable(area, callName, 'openai', policy.default.model);
        expect({ area, callName, check }).toEqual({ area, callName, check: { ok: true } });
      }
    }
  });

  it('accepts the default temperature and provider of every call through a row', async () => {
    for (const area of BOS_LLM_AREAS) {
      for (const callName of bosLlmSettingsCallNames(area)) {
        const policy = getBosLlmCallPolicy(area, callName) as BosLlmCallPolicy;
        const call: Record<string, unknown> = { model: policy.default.model, provider: 'openai' };
        if (policy.temperature === 'free') call.temperature = policy.default.temperature;

        // eslint-disable-next-line no-await-in-loop
        const validation = await validateAreaRow(area, { calls: { [callName]: call } });
        expect({ area, callName, rejected: validation.rejected }).toEqual({ area, callName, rejected: [] });
      }
    }
  });

  it('prices every default image size at low, medium and high (RC-5, V-7)', () => {
    const model = IMAGE_GENERATION_CONFIG_DEFAULTS.model;
    for (const size of Object.values(IMAGE_GENERATION_CONFIG_DEFAULTS.sizes)) {
      for (const quality of IMAGE_PRICE_REQUIRED_QUALITIES) {
        expect(IMAGE_FALLBACK_PRICING[`${model}:${size}:${quality}`]).toBeGreaterThan(0);
      }
    }
  });

  it('reads no pricing at all for a value equal to the code default (RC-W7b)', async () => {
    const area: BosLlmArea = 'insights';
    await validateAreaRow(area, { model: 'gpt-4o-mini', temperature: 0.3 });
    expect(mockListActive).not.toHaveBeenCalled();
  });
});
