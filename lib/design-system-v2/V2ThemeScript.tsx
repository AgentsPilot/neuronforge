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

/**
 * LIGHT, whatever is stored and whatever the OS says. Reads nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOR ONBOARDING, AND NOT AS A DEFAULT BUT AS THE ANSWER.
 *
 * Two facts decide this. The onboarding screens are the most illustrated in the
 * product — the plan panel, the chips, the brand mixes described at the top of
 * `onboarding-chat/page.tsx` — and they are composed light. And there is no
 * theme control anywhere in that flow, so the owner cannot act on the theme
 * they are given.
 *
 * A default would not have been enough. `v2-theme-mode` is a DEVICE key by
 * deliberate design (see `PERSON_SCOPED_STORAGE_KEYS`, where theme keys are
 * excluded on the grounds that they identify nobody), so it survives sign-out:
 * the second owner to onboard on a browser inherits the first one's dark mode.
 * Reported exactly that way. Reading the key at all is therefore the bug.
 *
 * The owner's real preference is NOT touched: nothing here writes, and the
 * provider is told not to persist in this mode either. Leaving onboarding
 * restores whatever they had.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const V2_THEME_SCRIPT_FORCE_LIGHT = `(function(){try{document.documentElement.classList.remove('dark');}catch(e){}})();`;

/** Whose theme a segment paints: the owner's, or light regardless. */
export type ThemeSegmentMode = 'owner' | 'light';

/**
 * @param mode defaults to `'owner'`, which is every segment but onboarding.
 *        Both bodies are build-time constants: the prop selects one, and
 *        neither carries props or request data.
 *
 * Whichever is chosen, `V2ThemeProvider` must be given the SAME value in that
 * layout, or it reverses the decision after mount: the parity test covers both
 * pairings.
 */
export function V2ThemeScript({ mode = 'owner' }: { mode?: ThemeSegmentMode } = {}) {
  const body = mode === 'light' ? V2_THEME_SCRIPT_FORCE_LIGHT : V2_THEME_SCRIPT;
  return <script dangerouslySetInnerHTML={{ __html: body }} />;
}
