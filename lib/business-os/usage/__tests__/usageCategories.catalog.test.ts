/**
 * The usage-card categories are built from the catalog (Layer 1.1 FR-4, AC-4,
 * AC-10). These are the STATIC rules: they can only change with a code change,
 * so they are unit tests, not runtime checks in the verification report.
 *
 * `usageCategories.test.ts` is deliberately left unedited as the regression
 * guard that the mapping did not change.
 */

import { USAGE_CATEGORIES, bosCategoryFeatures, usageCategoryForFeature } from '../usageCategories';
import {
  BOS_LEGACY_FEATURES,
  BOS_LEGACY_HELPER_LABEL,
  BOS_LLM_AREAS,
  bosFeature,
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
