/**
 * Which Business OS areas use each model TODAY (MP-FR-2 amendment, SA RR-3).
 *
 * Live data only, never a typed model list (CLAUDE.md rule 5):
 *   - per area of `BOS_LLM_AREAS`, the area row is read through
 *     `systemConfigRepository` and resolved by `validateAreaRow`, the SAME
 *     resolver `/admin/business-os-llm` uses. Each configurable call's
 *     RESOLVED model is tagged (resolved-first: when the resolver rejected a
 *     stored value, the tag goes to the model the call actually uses);
 *   - embeddings: the `helpbot_embedding_model` setting, tagged
 *     "embeddings (chat)". When it is absent the service's own default applies
 *     and is NOT guessed here (SA C-6): "not set (service default applies)";
 *   - images: the images area's resolved model (it is one of the areas).
 *
 * The catalogue's default model of each call is also returned, because the
 * coverage set includes it (SA finding 9).
 *
 * Tags describe today's settings; past charges may have used other models.
 */

import 'server-only';

import { BOS_LLM_AREAS, type BosLlmArea } from '@/lib/business-os/llm/callCatalog';
import { validateAreaRow } from '@/lib/business-os/llm/modelSettings';
import { bosLlmAreaKey, bosLlmSettingsCallNames } from '@/lib/business-os/llm/modelSettingsPolicy';
import { systemConfigRepository } from '@/lib/repositories/SystemConfigRepository';

/** The setting `EmbeddingService` reads. A key name, not a model name. */
export const EMBEDDING_MODEL_SETTING_KEY = 'helpbot_embedding_model';
/** The provider `EmbeddingService` sends embeddings through. */
const EMBEDDING_PROVIDER = 'openai';

export interface AreaTag {
  /** A Business OS area, or `embeddings`. */
  area: BosLlmArea | 'embeddings';
  label: string;
  /** The calls of that area resolving to this model. */
  callNames: string[];
  /** False when every one of those calls is switched off today. */
  enabled: boolean;
}

export type EmbeddingSettingState =
  | { status: 'set'; provider: string; model: string }
  | { status: 'not_set'; label: string };

export interface AreaTagResult {
  /** Key `provider:model` → tags. */
  tagsByModel: Map<string, AreaTag[]>;
  /** The resolved and default models of the images area, `provider:model`. */
  imageModelKeys: Set<string>;
  /** Every catalogue default of the token areas, `provider:model` (coverage set). */
  defaultModelKeys: Set<string>;
  embedding: EmbeddingSettingState;
}

export function modelKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function addTag(
  tagsByModel: Map<string, AreaTag[]>,
  key: string,
  area: AreaTag['area'],
  label: string,
  callName: string,
  enabled: boolean
): void {
  const tags = tagsByModel.get(key) ?? [];
  const existing = tags.find((tag) => tag.area === area);
  if (existing) {
    existing.callNames.push(callName);
    existing.enabled = existing.enabled || enabled;
  } else {
    tags.push({ area, label, callNames: [callName], enabled });
  }
  tagsByModel.set(key, tags);
}

function asSettingText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (text.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text);
      text = typeof parsed === 'string' ? parsed.trim() : '';
    } catch {
      return null;
    }
  }
  return text.length > 0 ? text : null;
}

export async function buildAreaTags(): Promise<AreaTagResult> {
  const keys = [...BOS_LLM_AREAS.map(bosLlmAreaKey), EMBEDDING_MODEL_SETTING_KEY];
  const { data, error } = await systemConfigRepository.getByKeys(keys);
  if (error) throw error;
  const valueByKey = new Map<string, unknown>((data ?? []).map((row) => [row.key, row.value]));

  const tagsByModel = new Map<string, AreaTag[]>();
  const imageModelKeys = new Set<string>();
  const defaultModelKeys = new Set<string>();

  for (const area of BOS_LLM_AREAS) {
    const validation = await validateAreaRow(area, valueByKey.get(bosLlmAreaKey(area)));
    const configurable = new Set(bosLlmSettingsCallNames(area));
    for (const resolved of validation.resolved.values()) {
      if (!configurable.has(resolved.callName)) continue;
      const key = modelKey(resolved.provider, resolved.model);
      const defaultKey = modelKey(resolved.provider, resolved.defaultModel);
      addTag(tagsByModel, key, area, area, resolved.callName, resolved.enabled);
      // Image models are priced per image, not per token, so they and their
      // catalogue defaults belong to the image rows only.
      if (area === 'images') {
        imageModelKeys.add(key);
        imageModelKeys.add(defaultKey);
      } else {
        defaultModelKeys.add(defaultKey);
      }
    }
  }

  const embeddingModel = asSettingText(valueByKey.get(EMBEDDING_MODEL_SETTING_KEY));
  let embedding: EmbeddingSettingState;
  if (embeddingModel) {
    embedding = { status: 'set', provider: EMBEDDING_PROVIDER, model: embeddingModel };
    addTag(tagsByModel, modelKey(EMBEDDING_PROVIDER, embeddingModel), 'embeddings', 'embeddings (chat)', 'embeddings', true);
  } else {
    embedding = { status: 'not_set', label: 'not set (service default applies)' };
  }

  return { tagsByModel, imageModelKeys, defaultModelKeys, embedding };
}
