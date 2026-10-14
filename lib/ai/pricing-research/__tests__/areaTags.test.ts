/**
 * RR-3 area tags: resolved-first, from live settings, no typed model list.
 * Model names are built here, never written as model literals.
 */

const mockGetByKeys = jest.fn();
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  ...jest.requireActual('@/lib/repositories/SystemConfigRepository'),
  systemConfigRepository: { getByKeys: (...args: unknown[]) => mockGetByKeys(...args) },
}));

const mockValidateAreaRow = jest.fn();
jest.mock('@/lib/business-os/llm/modelSettings', () => ({
  validateAreaRow: (...args: unknown[]) => mockValidateAreaRow(...args),
}));

import { BOS_LLM_AREAS } from '@/lib/business-os/llm/callCatalog';
import { bosLlmAreaKey, bosLlmExcludedCallNames, bosLlmSettingsCallNames } from '@/lib/business-os/llm/modelSettingsPolicy';

import { buildAreaTags, EMBEDDING_MODEL_SETTING_KEY } from '../areaTags';

const textModel = ['example', 'text', 'model'].join('-');
const otherModel = ['example', 'other', 'model'].join('-');
const defaultModel = ['example', 'default', 'model'].join('-');
const imageModel = ['example', 'image', 'model'].join('-');
const embeddingModel = ['example', 'embedding', 'model'].join('-');

type Resolved = { callName: string; provider: string; model: string; defaultModel: string; enabled: boolean };

function validationFor(area: string, overrides: Partial<Resolved> = {}): { resolved: Map<string, Resolved> } {
  const resolved = new Map<string, Resolved>();
  const names = [...bosLlmSettingsCallNames(area as never), ...bosLlmExcludedCallNames(area as never)];
  for (const callName of names) {
    resolved.set(callName, {
      callName,
      provider: 'openai',
      model: area === 'images' ? imageModel : textModel,
      defaultModel: area === 'images' ? imageModel : defaultModel,
      enabled: true,
      ...overrides,
    });
  }
  return { resolved };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetByKeys.mockResolvedValue({ data: [], error: null });
  mockValidateAreaRow.mockImplementation(async (area: string) => validationFor(area));
});

it('reads every area row and the embedding setting in one query, and resolves each area with validateAreaRow', async () => {
  await buildAreaTags();
  expect(mockGetByKeys).toHaveBeenCalledTimes(1);
  expect(mockGetByKeys.mock.calls[0][0]).toEqual([...BOS_LLM_AREAS.map(bosLlmAreaKey), EMBEDDING_MODEL_SETTING_KEY]);
  expect(mockValidateAreaRow.mock.calls.map((call) => call[0])).toEqual([...BOS_LLM_AREAS]);
});

it('passes each stored area row to the resolver unchanged', async () => {
  const stored = { model: otherModel };
  mockGetByKeys.mockResolvedValue({ data: [{ key: bosLlmAreaKey('chat'), value: stored }], error: null });
  await buildAreaTags();
  expect(mockValidateAreaRow).toHaveBeenCalledWith('chat', stored);
});

it('tags the RESOLVED model with every area that uses it', async () => {
  const result = await buildAreaTags();
  const tags = result.tagsByModel.get(`openai:${textModel}`) ?? [];
  expect(tags.map((tag) => tag.area)).toEqual(BOS_LLM_AREAS.filter((area) => area !== 'images'));
  expect(result.tagsByModel.get(`openai:${imageModel}`)?.map((tag) => tag.area)).toEqual(['images']);
});

it('resolved-first: a stored value the resolver rejected tags the model actually used', async () => {
  // The row asks for otherModel; the resolver refused it and resolved textModel.
  mockGetByKeys.mockResolvedValue({ data: [{ key: bosLlmAreaKey('chat'), value: { model: otherModel } }], error: null });
  const result = await buildAreaTags();
  expect(result.tagsByModel.has(`openai:${otherModel}`)).toBe(false);
  expect(result.tagsByModel.get(`openai:${textModel}`)?.some((tag) => tag.area === 'chat')).toBe(true);
});

it('ignores calls excluded from the settings (the embedding calls of chat)', async () => {
  const excluded = bosLlmExcludedCallNames('chat');
  expect(excluded.length).toBeGreaterThan(0);
  const result = await buildAreaTags();
  const chat = result.tagsByModel.get(`openai:${textModel}`)?.find((tag) => tag.area === 'chat');
  for (const name of excluded) expect(chat?.callNames).not.toContain(name);
});

it('a switched-off area is tagged with enabled false', async () => {
  mockValidateAreaRow.mockImplementation(async (area: string) => validationFor(area, area === 'leads' ? { enabled: false } : {}));
  const result = await buildAreaTags();
  expect(result.tagsByModel.get(`openai:${textModel}`)?.find((tag) => tag.area === 'leads')?.enabled).toBe(false);
});

it('catalogue defaults join the coverage set; image models and their defaults stay in the image set', async () => {
  const result = await buildAreaTags();
  expect([...result.defaultModelKeys]).toEqual([`openai:${defaultModel}`]);
  expect([...result.imageModelKeys]).toEqual([`openai:${imageModel}`]);
});

it('embeddings: the setting is tagged "embeddings (chat)"', async () => {
  mockGetByKeys.mockResolvedValue({ data: [{ key: EMBEDDING_MODEL_SETTING_KEY, value: JSON.stringify(embeddingModel) }], error: null });
  const result = await buildAreaTags();
  expect(result.embedding).toEqual({ status: 'set', provider: 'openai', model: embeddingModel });
  expect(result.tagsByModel.get(`openai:${embeddingModel}`)).toEqual([
    { area: 'embeddings', label: 'embeddings (chat)', callNames: ['embeddings'], enabled: true },
  ]);
});

it('embeddings: an absent setting is "not set (service default applies)" with no tag and no guessed model (C-6)', async () => {
  const result = await buildAreaTags();
  expect(result.embedding).toEqual({ status: 'not_set', label: 'not set (service default applies)' });
  for (const tags of result.tagsByModel.values()) expect(tags.some((tag) => tag.area === 'embeddings')).toBe(false);
});

it('a settings read failure throws (the route answers 500)', async () => {
  mockGetByKeys.mockResolvedValue({ data: null, error: new Error('boom') });
  await expect(buildAreaTags()).rejects.toThrow('boom');
});
