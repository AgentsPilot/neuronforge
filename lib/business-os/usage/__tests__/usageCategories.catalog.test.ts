/**
 * The usage-card categories are built from the catalog (Layer 1.1 FR-4, AC-4,
 * AC-10). These are the STATIC rules: they can only change with a code change,
 * so they are unit tests, not runtime checks in the verification report.
 *
 * `usageCategories.test.ts` is deliberately left unedited as the regression
 * guard that the mapping did not change.
 */

import {
  OTHER_USAGE_CATEGORY,
  USAGE_CATEGORIES,
  bosCategoryFeatures,
  summariseUsageByCategory,
  usageCategoryForFeature,
} from '../usageCategories';
import {
  BOS_LEGACY_FEATURES,
  BOS_LEGACY_FEATURES_FLAT,
  BOS_LEGACY_HELPER_LABEL,
  BOS_LLM_AREAS,
  bosFeature,
  bosRowFilter,
  isBusinessOsFeature,
} from '@/lib/business-os/llm/callCatalog';

describe('usage categories from the catalog', () => {
  it.each(BOS_LLM_AREAS.map((area) => [area]))(
    'maps every %s value, current and legacy, to its own category',
    (area) => {
      expect(usageCategoryForFeature(bosFeature(area))).toBe(area);
      for (const legacy of BOS_LEGACY_FEATURES[area]) {
        expect(usageCategoryForFeature(legacy)).toBe(area);
      }
    }
  );

  it('builds each area category from the current value followed by its legacy values', () => {
    for (const area of BOS_LLM_AREAS) {
      const category = USAGE_CATEGORIES.find((c) => c.key === area);
      expect(category).toBeDefined();
      expect(bosCategoryFeatures(area)).toEqual([bosFeature(area), ...BOS_LEGACY_FEATURES[area]]);
      for (const feature of bosCategoryFeatures(area)) expect(category?.features).toContain(feature);
    }
  });

  it('maps the legacy helper label feature (onboarding) to help', () => {
    expect(usageCategoryForFeature(BOS_LEGACY_HELPER_LABEL.feature)).toBe('help');
  });
});

/*
 * Layer 1.5 (FR-6, FR-20, AC-5): the onboarding and images areas each get
 * exactly one category line, and an EMPTY legacy list. The legacy `onboarding`
 * feature value must stay a non-Business-OS `help` value, or Check 2 fails.
 */
describe('Layer 1.5 areas: onboarding and images', () => {
  it('sends the new Business OS values to their own categories', () => {
    expect(usageCategoryForFeature('business-os-onboarding')).toBe('onboarding');
    expect(usageCategoryForFeature('business-os-images')).toBe('images');
  });

  it('has exactly one category line per new area', () => {
    for (const area of ['onboarding', 'images'] as const) {
      const lines = USAGE_CATEGORIES.filter((c) => c.key === area);
      expect(lines).toHaveLength(1);
      expect(lines[0].features).toEqual([bosFeature(area)]);
    }
  });

  it('gives both new areas an empty legacy list', () => {
    expect(BOS_LEGACY_FEATURES.onboarding).toEqual([]);
    expect(BOS_LEGACY_FEATURES.images).toEqual([]);
  });

  it('keeps the legacy onboarding value out of the Business OS row filter (Check 2)', () => {
    expect(BOS_LEGACY_FEATURES_FLAT).not.toContain('onboarding');
    expect(bosRowFilter().features).not.toContain('onboarding');
    expect(isBusinessOsFeature('onboarding')).toBe(false);
    expect(isBusinessOsFeature('business-os-onboarding')).toBe(true);
    expect(isBusinessOsFeature('business-os-images')).toBe(true);
  });

  it('puts no Business OS value in other', () => {
    for (const area of BOS_LLM_AREAS) {
      for (const feature of bosCategoryFeatures(area)) {
        expect(usageCategoryForFeature(feature)).not.toBe(OTHER_USAGE_CATEGORY);
      }
    }
  });
});

describe('summariseUsageByCategory with an image row (Layer 1.5 FR-14, AC-10)', () => {
  it('adds one call and zero tokens to images, and changes no other category', () => {
    const base = new Map([
      ['business-os-chat', { tokens: 1000, calls: 2 }],
      ['business-os-onboarding', { tokens: 800, calls: 3 }],
    ]);
    const withImage = new Map([...base, ['business-os-images', { tokens: 0, calls: 1 }]]);

    const before = summariseUsageByCategory(base);
    const after = summariseUsageByCategory(withImage);

    expect(after.get('images')).toEqual({ tokens: 0, calls: 1 });
    expect(after.get('chat')).toEqual(before.get('chat'));
    expect(after.get('onboarding')).toEqual({ tokens: 800, calls: 3 });
    expect(after.has(OTHER_USAGE_CATEGORY)).toBe(false);
  });
});
