/**
 * The shared pending-line schema (SA RR-1, C-12).
 */

import { isOfficialSourceUrl } from '../officialSources';
import { ManualEntryBodySchema, PendingLineSchema, latestAllowedCheckedOn, unitKeyOf } from '../pendingLineSchema';

const today = new Date().toISOString().slice(0, 10);

const token = {
  kind: 'token',
  provider: 'openai',
  model_name: 'example-model-1.5',
  input_per_1m: '0.075',
  output_per_1m: '0.3',
  source_url: 'https://developers.openai.com/api/docs/pricing',
  checked_on: today,
};

const image = {
  kind: 'image',
  provider: 'openai',
  model_name: 'example-image-model',
  image_size: '1024x1024',
  image_quality: 'high',
  price_per_image: '0.167',
  source_url: 'https://platform.openai.com/docs/guides/image-generation',
  checked_on: today,
};

describe('PendingLineSchema', () => {
  it('accepts a token line and an image line', () => {
    expect(PendingLineSchema.safeParse(token).success).toBe(true);
    expect(PendingLineSchema.safeParse({ ...token, cached_input_per_1m: '0.0375' }).success).toBe(true);
    expect(PendingLineSchema.safeParse(image).success).toBe(true);
  });

  it('refuses a JSON number for a price (no float ever reaches the database)', () => {
    expect(PendingLineSchema.safeParse({ ...token, input_per_1m: 0.075 }).success).toBe(false);
  });

  it('refuses more than 9 decimals, more than 6 integer digits, signs and exponents', () => {
    for (const bad of ['0.0000000001', '1000000', '-1', '+1', '1e-7', '.5', '1.', '']) {
      expect(PendingLineSchema.safeParse({ ...token, input_per_1m: bad }).success).toBe(false);
    }
  });

  it('refuses a non-official, non-https or look-alike source', () => {
    for (const url of [
      'http://developers.openai.com/api/docs/pricing',
      'https://openai.com.example.net/pricing',
      'https://evil-openai.com/pricing',
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
      'https://platform.claude.com/docs/en/about-claude/pricing',
      'not a url at all',
    ]) {
      expect(PendingLineSchema.safeParse({ ...token, source_url: url }).success).toBe(false);
    }
    expect(PendingLineSchema.safeParse({ ...token, provider: 'anthropic', source_url: 'https://platform.claude.com/docs/en/about-claude/pricing' }).success).toBe(true);
  });

  it('CR-1: refuses what new URL() would forgive but the database CHECK refuses', () => {
    const tab = String.fromCharCode(9);
    for (const url of [
      ' https://developers.openai.com/api',
      'HTTPS://developers.openai.com/api',
      'https:developers.openai.com/api',
      `https://developers.openai.com/api${tab}pricing`,
      'https://developers.openai.com/api pricing',
    ]) {
      const result = PendingLineSchema.safeParse({ ...token, source_url: url });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.message)).toContain('Paste the full https address with no spaces');
      }
    }
  });

  it('refuses an unknown provider and a malformed model id', () => {
    expect(PendingLineSchema.safeParse({ ...token, provider: 'acme' }).success).toBe(false);
    for (const model of ['Example', 'a b', 'model--x', '-model', 'x']) {
      expect(PendingLineSchema.safeParse({ ...token, model_name: model }).success).toBe(false);
    }
  });

  it('refuses a future date beyond tomorrow (UTC) and a non-date', () => {
    expect(PendingLineSchema.safeParse({ ...token, checked_on: latestAllowedCheckedOn() }).success).toBe(true);
    expect(PendingLineSchema.safeParse({ ...token, checked_on: '2999-01-01' }).success).toBe(false);
    expect(PendingLineSchema.safeParse({ ...token, checked_on: '2026-02-30' }).success).toBe(false);
    expect(PendingLineSchema.safeParse({ ...token, checked_on: '14/10/2026' }).success).toBe(false);
  });

  it('latestAllowedCheckedOn is UTC today plus one day', () => {
    expect(latestAllowedCheckedOn(new Date('2026-10-14T23:30:00Z'))).toBe('2026-10-15');
    expect(latestAllowedCheckedOn(new Date('2026-12-31T00:00:00Z'))).toBe('2027-01-01');
  });

  it('an image line needs size and quality; a token line takes neither', () => {
    expect(PendingLineSchema.safeParse({ ...image, image_size: undefined }).success).toBe(false);
    expect(PendingLineSchema.safeParse({ ...token, image_size: '1024x1024' }).success).toBe(false);
  });
});

describe('ManualEntryBodySchema (C-12: strict)', () => {
  it('takes lines only: no admin id, creator, state or snapshot', () => {
    expect(ManualEntryBodySchema.safeParse({ lines: [token] }).success).toBe(true);
    for (const extra of [{ admin_user_id: 'x' }, { created_by: 'x' }, { state: 'applied' }]) {
      expect(ManualEntryBodySchema.safeParse({ lines: [token], ...extra }).success).toBe(false);
    }
    for (const extra of [{ current_basis: 'table' }, { flags: ['new_model'] }, { state: 'applied' }]) {
      expect(ManualEntryBodySchema.safeParse({ lines: [{ ...token, ...extra }] }).success).toBe(false);
    }
  });

  it('needs 1 to 50 lines', () => {
    expect(ManualEntryBodySchema.safeParse({ lines: [] }).success).toBe(false);
    expect(ManualEntryBodySchema.safeParse({ lines: Array(51).fill(token) }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('unitKeyOf separates token and image units', () => {
    expect(unitKeyOf({ provider: 'openai', model_name: 'm', kind: 'token' })).toBe('openai|m|token||');
    expect(unitKeyOf({ provider: 'openai', model_name: 'm', kind: 'image', image_size: '1x1', image_quality: 'low' })).toBe(
      'openai|m|image|1x1|low'
    );
  });

  it('isOfficialSourceUrl refuses credentials and ports', () => {
    expect(isOfficialSourceUrl('openai', 'https://user:pw@developers.openai.com/x')).toBe(false);
    expect(isOfficialSourceUrl('openai', 'https://developers.openai.com:8443/x')).toBe(false);
    expect(isOfficialSourceUrl('openai', 'https://DEVELOPERS.openai.com/x')).toBe(true);
  });
});
