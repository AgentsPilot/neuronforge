// components/business-os/OwnerDirScript.tsx

import { isOwnerLanguage, ownerDir, type OwnerLanguage } from '@/lib/business-os/ownerLanguage';

/**
 * Puts the owner's language and direction on `<html>` before first paint
 * (performance business round BR-1a, SA pattern P-2).
 *
 * A sibling of `components/public/PublicDirScript`, NOT a reuse of it: that one
 * also sets `data-public-surface` and `colorScheme`, and `data-public-surface`
 * switches on the public theme CSS. Owner pages get `lang` and `dir`, nothing
 * else.
 *
 * WHERE IT MUST BE RENDERED
 *
 * First in the layout, OUTSIDE `V2ThemeProvider` and `UserProvider`.
 * `V2ThemeProvider` renders `null` until it mounts, so anything inside it never
 * reaches the server HTML — this script would simply not exist there. The guard
 * test pins the position (SA RC-2).
 *
 * It runs while the HTML is parsed. On a client-side navigation React inserts it
 * without executing it; the provider's own `dir`/`lang` effect covers that case,
 * as it did before.
 *
 * The value is server-resolved (never client-supplied), checked again here
 * against the closed list, and serialised with `JSON.stringify`.
 */
export function OwnerDirScript({ language }: { language: OwnerLanguage }) {
  const lang: OwnerLanguage = isOwnerLanguage(language) ? language : 'en';
  const script = `document.documentElement.lang=${JSON.stringify(lang)};document.documentElement.dir=${JSON.stringify(ownerDir(lang))};`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
