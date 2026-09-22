import {
  OTHER_USAGE_CATEGORY,
  USAGE_CATEGORIES,
  summariseUsageByCategory,
  usageCategoryForFeature,
} from '../usageCategories';
import { BOS_LLM_AREAS } from '@/lib/business-os/llm/callCatalog';

describe('usageCategoryForFeature', () => {
  it.each([
    // New Business OS area values
    ['business-os-chat', 'chat'],
    ['business-os-website', 'website'],
    ['business-os-insights', 'insights'],
    ['business-os-briefing', 'briefing'],
    ['business-os-intake', 'intake'],
    ['business-os-leads', 'leads'],
    // Legacy values written before the rename
    ['landing-page-generation', 'website'],
    ['health-summary-generation', 'insights'],
    ['insight-generation', 'insights'],
    ['correlated-insight-generation', 'insights'],
    ['business-os', 'briefing'],
    ['lead-reply', 'leads'],
    // Unchanged
    ['chat-v3', 'chat'],
    ['onboarding', 'help'],
    ['helpbot', 'help'],
    ['document-extraction', 'documents'],
  ])('maps %s to %s', (feature, category) => {
    expect(usageCategoryForFeature(feature)).toBe(category);
  });

  it('puts an unknown feature in other', () => {
    expect(usageCategoryForFeature('something-new')).toBe(OTHER_USAGE_CATEGORY);
    expect(usageCategoryForFeature('')).toBe(OTHER_USAGE_CATEGORY);
  });

  it('never puts a Business OS area in other', () => {
    for (const area of BOS_LLM_AREAS) {
      expect(usageCategoryForFeature(`business-os-${area}`)).not.toBe(OTHER_USAGE_CATEGORY);
    }
  });

  it('maps each feature to exactly one category', () => {
    const all = USAGE_CATEGORIES.flatMap((c) => c.features);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('summariseUsageByCategory', () => {
  it('sums tokens and calls per category exactly to the totals', () => {
    const byFeature = new Map([
      ['business-os-website', { tokens: 1234, calls: 3 }],
      ['landing-page-generation', { tokens: 999, calls: 1 }],
      ['business-os-insights', { tokens: 777, calls: 4 }],
      ['insight-generation', { tokens: 333, calls: 2 }],
      ['business-os', { tokens: 50, calls: 1 }],
      ['business-os-leads', { tokens: 17, calls: 1 }],
      ['unmapped-feature', { tokens: 5, calls: 1 }],
      ['business-os-chat', { tokens: 4001, calls: 9 }],
    ]);

    const result = summariseUsageByCategory(byFeature);

    const totalTokens = [...byFeature.values()].reduce((sum, v) => sum + v.tokens, 0);
    const totalCalls = [...byFeature.values()].reduce((sum, v) => sum + v.calls, 0);
    const summedTokens = [...result.values()].reduce((sum, v) => sum + v.tokens, 0);
    const summedCalls = [...result.values()].reduce((sum, v) => sum + v.calls, 0);

    expect(summedTokens).toBe(totalTokens);
    expect(summedCalls).toBe(totalCalls);

    expect(result.get('website')).toEqual({ tokens: 2233, calls: 4 });
    expect(result.get('insights')).toEqual({ tokens: 1110, calls: 6 });
    expect(result.get('briefing')).toEqual({ tokens: 50, calls: 1 });
    expect(result.get('leads')).toEqual({ tokens: 17, calls: 1 });
    expect(result.get('other')).toEqual({ tokens: 5, calls: 1 });
    expect(result.get('chat')).toEqual({ tokens: 4001, calls: 9 });
  });

  it('keeps first-seen category order and does not mutate the input', () => {
    const byFeature = new Map([
      ['helpbot', { tokens: 1, calls: 1 }],
      ['business-os-chat', { tokens: 2, calls: 1 }],
      ['onboarding', { tokens: 3, calls: 1 }],
    ]);

    const result = summariseUsageByCategory(byFeature);

    expect([...result.keys()]).toEqual(['help', 'chat']);
    expect(byFeature.get('helpbot')).toEqual({ tokens: 1, calls: 1 });
  });

  it('returns an empty map for no usage', () => {
    expect(summariseUsageByCategory(new Map()).size).toBe(0);
  });
});
