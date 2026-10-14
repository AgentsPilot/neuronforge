/**
 * Where each provider publishes its OFFICIAL prices (MP-FR-3, SA RR-1).
 *
 * Config data, not model names (CLAUDE.md rule 5 is about models): a price may
 * only be recorded with a source URL on its provider's own domain. Third-party
 * aggregators are never a source; they are only the cross-check (slice 5).
 *
 * Hosts match EXACTLY (no suffix match), so `openai.com.example.net` and
 * `evil-openai.com` are refused. The server never fetches a manual-entry URL;
 * it only checks where it points.
 *
 * Providers are the ones present in `ai_model_pricing` (measured 2026-10-14:
 * openai, anthropic, google, kimi). Adding one is a reviewed code change.
 */

export const OFFICIAL_PRICE_HOSTS = {
  openai: ['developers.openai.com', 'platform.openai.com', 'openai.com'],
  anthropic: ['platform.claude.com', 'docs.claude.com', 'docs.anthropic.com', 'www.anthropic.com', 'anthropic.com'],
  google: ['ai.google.dev', 'cloud.google.com'],
  kimi: ['platform.kimi.ai', 'platform.moonshot.ai', 'platform.moonshot.cn'],
} as const satisfies Record<string, readonly string[]>;

export type PriceProvider = keyof typeof OFFICIAL_PRICE_HOSTS;

export const PRICE_PROVIDERS = Object.keys(OFFICIAL_PRICE_HOSTS) as [PriceProvider, ...PriceProvider[]];

export function isPriceProvider(value: string): value is PriceProvider {
  return Object.prototype.hasOwnProperty.call(OFFICIAL_PRICE_HOSTS, value);
}

/** True only for an https URL whose host is on the provider's official list. */
export function isOfficialSourceUrl(provider: string, url: string): boolean {
  if (!isPriceProvider(provider)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password || parsed.port) return false;
  const hosts: readonly string[] = OFFICIAL_PRICE_HOSTS[provider];
  return hosts.includes(parsed.hostname.toLowerCase());
}
