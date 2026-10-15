// lib/design-system-v2/V2ThemeScript.tsx

import { V2_THEME_STORAGE_KEY } from './themeMode';

/**
 * Puts `.dark` on `<html>` before first paint (performance slice TH-1).
 *
 * The same decision `V2ThemeProvider` makes after mount, and nothing else: any
 * non-empty stored value is used as-is (so only `'dark'` means dark), otherwise
 * the OS preference. If storage throws, it does nothing and the page paints
 * light, exactly as before. A parity test pins it to the provider.
 *
 * WHERE IT MUST BE RENDERED: in a segment layout that mounts the provider,
 * first in the tree (after `OwnerDirScript`), outside every provider. Never in
 * `app/layout.tsx`: public pages must never get `.dark`. Guards G-1..G-3.
 *
 * The body is a build-time constant: no props, no request data.
 */
export const V2_THEME_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(V2_THEME_STORAGE_KEY)});var d=m?m==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export function V2ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: V2_THEME_SCRIPT }} />;
}
