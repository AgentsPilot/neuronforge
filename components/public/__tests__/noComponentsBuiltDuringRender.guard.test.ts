/**
 * No public-portal component may build another component while rendering.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PREVENTS
 *
 * `IntakePanel` chose its wrapper like this:
 *
 *     const Shell = embedded
 *       ? ({ children }) => <div>{children}</div>
 *       : ({ children }) => <PublicCard>{children}</PublicCard>;
 *
 * Correct-looking, and it made the intake form unusable. React compares element
 * types by IDENTITY, and those arrows are rebuilt on every render — so each
 * keystroke, which sets `responses` and re-renders, looked like `<Shell>` being
 * swapped for a different component. React unmounted the entire form and
 * mounted a fresh one between characters.
 *
 * What the client saw: the field lost focus after one letter, and the page
 * jumped to the bottom as the browser landed on a newly mounted document. A
 * client could not fill in the form at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Nothing throws, nothing warns, and no render test fails: the output is
 * identical markup. Only typing into it reveals the fault, and the portal's
 * forms are exactly where a client types. The cost of the mistake is a form
 * nobody can complete; the cost of the rule is declaring two components at
 * module scope.
 *
 * Hooks are deliberately NOT matched — `const Submit = useCallback(...)` is a
 * stable reference and fine. What is caught is a Capitalised binding assigned
 * an arrow that returns markup, inside a function body.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const PORTAL = join(__dirname, '..');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : filesUnder(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** A Capitalised binding assigned an arrow that renders, inside a function. */
function componentsBuiltDuringRender(source: string): Array<{ line: number; text: string }> {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const found: Array<{ line: number; text: string }> = [];

  lines.forEach((line, index) => {
    const indented = line.length - line.trimStart().length > 0;
    if (!indented) return;

    /* `useMemo`, `useCallback` and friends return a stable reference. */
    if (/=\s*use[A-Z]/.test(line)) return;

    if (!/^\s*(const|let)\s+[A-Z][A-Za-z0-9]*\s*(:[^=]+)?=/.test(line)) return;

    /* Look ahead a few lines: the arrow and its markup may wrap. */
    const window = lines.slice(index, index + 4).join('\n');
    if (!window.includes('=>')) return;
    if (!/<[A-Za-z]/.test(window) && !window.includes('children')) return;

    found.push({ line: index + 1, text: line.trim().slice(0, 100) });
  });

  return found;
}

describe('the public portal never rebuilds a component mid-render', () => {
  const files = filesUnder(PORTAL);

  it('is actually reading the portal', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some(f => f.endsWith('IntakePanel.tsx'))).toBe(true);
  });

  it('declares every component at module scope', () => {
    const offenders = files.flatMap(file =>
      componentsBuiltDuringRender(readFileSync(file, 'utf8')).map(
        hit => `${file.slice(file.indexOf('components/'))}:${hit.line}  ${hit.text}`
      )
    );

    expect(offenders).toEqual([]);
  });

  it('catches the shape that caused it, so the rule is not vacuous', () => {
    /*
     * The exact code that broke the intake form. A guard that passes because it
     * matches nothing is worse than no guard, so the detector is tested too.
     */
    const regression = [
      'export function Panel({ embedded }) {',
      '  const Shell = embedded',
      '    ? ({ children }) => <div>{children}</div>',
      '    : ({ children }) => <PublicCard>{children}</PublicCard>;',
      '  return <Shell>…</Shell>;',
      '}',
    ].join('\n');

    expect(componentsBuiltDuringRender(regression)).toHaveLength(1);
  });

  it('allows a hook-stabilised reference', () => {
    const fine = [
      'export function Panel() {',
      '  const Row = useCallback(({ children }) => <li>{children}</li>, []);',
      '  return <Row />;',
      '}',
    ].join('\n');

    expect(componentsBuiltDuringRender(fine)).toEqual([]);
  });
});
