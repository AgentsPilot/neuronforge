// lib/design-system-v2/V2CustomTokensStyle.tsx

import { buildV2CustomTokenCss, type V2CustomTokens } from './customTokens';

/**
 * The platform's custom design tokens as CSS, in the HTML (performance slice
 * TH-1, TH-2 folded in). With it, the brand colours an admin set are on screen
 * from the first frame; the provider later writes the same values inline.
 *
 * `tokens` comes from `readV2CustomTokens` (server-validated). The builder
 * re-checks every value against the allow-list and its grammar, so this
 * component cannot inject CSS even if handed something else. Renders nothing
 * when there is nothing valid.
 *
 * WHERE IT MUST BE RENDERED: next to `V2ThemeScript`, in a segment layout that
 * mounts the provider, outside every provider. Never in `app/layout.tsx`.
 */
export function V2CustomTokensStyle({ tokens }: { tokens: V2CustomTokens }) {
  const css = buildV2CustomTokenCss(tokens);
  if (!css) return null;
  return <style data-v2-custom-tokens="" dangerouslySetInnerHTML={{ __html: css }} />;
}
