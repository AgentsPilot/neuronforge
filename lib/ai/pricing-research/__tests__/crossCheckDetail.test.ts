/**
 * The cross-check in words (AI model price review slice 5; SA O-12, QA bug 2,
 * mutant X1). One case per verdict. The page shows these words in the source
 * cell (see `sourceCell.render.test.tsx` for X2).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));
jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({ aiModelPricingRepository: {} }));
jest.mock('@/lib/repositories/AiPriceProposalRepository', () => ({ aiPriceProposalRepository: {} }));
jest.mock('@/lib/repositories/AdminUserRepository', () => ({ adminUserRepository: {} }));
jest.mock('@/lib/ai/pricing-research/areaTags', () => ({ buildAreaTags: jest.fn(), modelKey: (provider: string, model: string) => `${provider}:${model}` }));

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import { crossCheckDetail } from '../comparisonModel';

forbidRealNetwork();

const READ = '2026-10-15T09:00:00.000Z';
const VALUE = 'input 0.165, cached input 0.0825, output 0.66 per 1M';

describe('crossCheckDetail', () => {
  it('agrees', () => {
    expect(
      crossCheckDetail({ cross_check_verdict: 'agrees', cross_check_value: VALUE, cross_check_diff_pct: 0, cross_check_fetched_at: READ })
    ).toBe(`agrees with the second price list, read 2026-10-15; second price list (LiteLLM): ${VALUE}`);
  });

  it('differs, with the largest gap (a number or the stored text)', () => {
    expect(
      crossCheckDetail({ cross_check_verdict: 'differs', cross_check_value: VALUE, cross_check_diff_pct: 10, cross_check_fetched_at: READ })
    ).toBe(`differs from the second price list by up to 10.00%, read 2026-10-15; second price list (LiteLLM): ${VALUE}`);
    expect(
      crossCheckDetail({ cross_check_verdict: 'differs', cross_check_value: VALUE, cross_check_diff_pct: '7.5', cross_check_fetched_at: READ })
    ).toContain('by up to 7.50%');
  });

  it('differs, without a gap (an official 0)', () => {
    expect(
      crossCheckDetail({ cross_check_verdict: 'differs', cross_check_value: 'input 0.02 per 1M', cross_check_diff_pct: null, cross_check_fetched_at: READ })
    ).toBe('differs from the second price list, read 2026-10-15; second price list (LiteLLM): input 0.02 per 1M');
  });

  it('not listed, with a retirement date only', () => {
    expect(
      crossCheckDetail({
        cross_check_verdict: 'not_listed',
        cross_check_value: 'retirement date 2026-10-23',
        cross_check_diff_pct: null,
        cross_check_fetched_at: READ,
      })
    ).toBe('not on the second price list, read 2026-10-15; second price list (LiteLLM): retirement date 2026-10-23');
    expect(crossCheckDetail({ cross_check_verdict: 'not_listed', cross_check_value: null, cross_check_diff_pct: null, cross_check_fetched_at: READ })).toBe(
      'not on the second price list, read 2026-10-15'
    );
  });

  it('unavailable', () => {
    expect(crossCheckDetail({ cross_check_verdict: 'unavailable', cross_check_value: null, cross_check_diff_pct: null, cross_check_fetched_at: READ })).toBe(
      'second price list could not be read, read 2026-10-15'
    );
  });

  it('not run: a manual line, or a record from before slice 5', () => {
    expect(crossCheckDetail({ cross_check_verdict: null, cross_check_value: null, cross_check_diff_pct: null, cross_check_fetched_at: null })).toBe('not run');
    expect(crossCheckDetail({ cross_check_verdict: null })).toBe('not run');
  });
});
