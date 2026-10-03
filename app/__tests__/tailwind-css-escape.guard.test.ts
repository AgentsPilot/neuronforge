/**
 * Guard: no tracked file may hold a CSS escape Tailwind cannot decode.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * On 2026-10-02 `next build` failed on PR #173 with
 *
 *   Syntax error: tailwindcss: app/globals.css Invalid code point 10378938
 *
 * The cause was a workplan doc, not the stylesheet. Tailwind 4 reads every
 * file it scans for class candidates and decodes CSS escapes in them: a
 * backslash followed by 1-6 hex digits becomes `String.fromCodePoint(hex)`. A
 * Windows path quoted in the doc had a folder whose name started `9e5eba32-`,
 * so the backslash before it read as the escape for 0x9E5EBA - past U+10FFFF -
 * and `fromCodePoint` threw. The error names the stylesheet, which sent the
 * investigation the wrong way.
 *
 * ── Two halves ─────────────────────────────────────────────────────────────
 * 1. app/globals.css now excludes the non-rendering trees with `@source not`,
 *    mirroring what .github/ci/non-deploying-change.sh treats as
 *    non-deploying. That half matters most: a PR touching only those paths
 *    skips the Build check, so before this a bad escape there merged green and
 *    broke someone else's build later. The second test below keeps the two
 *    lists in step.
 * 2. Every file still scanned can hold the same text - a log line, a fixture,
 *    a nested .md prompt under lib/. The first test finds it by file and line,
 *    which the build error never does.
 *
 * It scans ALL tracked text files, excluded trees included, so a doc that
 * would only be harmless today does not become a build break the day an
 * exclusion is removed. The clean tree has no hits, so this costs nothing.
 *
 * ── What counts as bad ─────────────────────────────────────────────────────
 * The decoder below copies Tailwind's own (tailwindcss/dist/lib.js):
 *
 *   /\\([\dA-Fa-f]{1,6}[\t\n\f\r ]?|[\S\s])/g
 *
 * It consumes an escape and its target as a pair, so an escaped backslash
 * (two backslashes, as a Windows path is written inside a JSON or TS string)
 * is safe and is not reported. A hex run above 0x10FFFF is what throws.
 * Surrogates (0xD800-0xDFFF) do not throw today - CSS decodes them to U+FFFD -
 * but they are never meaningful in a class name, so they are reported too.
 *
 * Fix a hit by writing the path with forward slashes, doubling the backslash,
 * or putting a non-hex character after it.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const BACKSLASH = String.fromCharCode(92);
const MAX_CODE_POINT = 0x10ffff;

// Same shape as Tailwind's decoder; see the header.
const CSS_ESCAPE = /\\([0-9A-Fa-f]{1,6}|[\s\S])/g;

type BadEscape = { line: number; text: string; codePoint: number };

function isUndecodable(codePoint: number): boolean {
  return codePoint > MAX_CODE_POINT || (codePoint >= 0xd800 && codePoint <= 0xdfff);
}

function findBadEscapes(text: string): BadEscape[] {
  const found: BadEscape[] = [];
  for (const match of text.matchAll(CSS_ESCAPE)) {
    const body = match[1];
    if (!/^[0-9A-Fa-f]+$/.test(body)) continue;
    const codePoint = parseInt(body, 16);
    if (!isUndecodable(codePoint)) continue;
    const index = match.index ?? 0;
    let line = 1;
    for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
    found.push({ line, text: text.slice(index, index + 16), codePoint });
  }
  return found;
}

function trackedFiles(): string[] {
  // No fallback on purpose: if git is unavailable the guard must fail, not
  // pass having scanned nothing.
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

describe('findBadEscapes (the detector itself)', () => {
  const bs = BACKSLASH;

  it('flags the path that broke PR #173', () => {
    const doc = `see C:${bs}Users${bs}Temp${bs}9e5eba32-0b51-4b${bs}scratchpad`;
    expect(findBadEscapes(doc)).toEqual([expect.objectContaining({ line: 1, codePoint: 0x9e5eba })]);
  });

  it('flags the first value past U+10FFFF and surrogates, and passes the last valid one', () => {
    expect(findBadEscapes(`${bs}110000`)).toHaveLength(1);
    expect(findBadEscapes(`${bs}d800 ${bs}dfff`)).toHaveLength(2);
    expect(findBadEscapes(`${bs}10ffff ${bs}e9 ${bs}d7ff ${bs}e000`)).toHaveLength(0);
  });

  it('treats an escaped backslash as a pair, like Tailwind', () => {
    expect(findBadEscapes(`C:${bs}${bs}Users${bs}${bs}9e5eba32`)).toHaveLength(0);
    // Three backslashes: a pair, then a live escape.
    expect(findBadEscapes(`${bs}${bs}${bs}9e5eba`)).toHaveLength(1);
  });

  it('reports the right line', () => {
    expect(findBadEscapes(`a\nb\nc ${bs}ffffff`)[0].line).toBe(3);
  });
});

describe('Tailwind CSS escape guard', () => {
  it('no tracked text file holds a CSS escape Tailwind cannot decode', () => {
    const files = trackedFiles();
    // A broken `git ls-files` must not look like a clean tree.
    expect(files.length).toBeGreaterThan(1000);

    const hits: string[] = [];
    for (const file of files) {
      let buf: Buffer;
      try {
        buf = fs.readFileSync(path.join(ROOT, file));
      } catch {
        continue; // deleted in the working tree but still in the index
      }
      if (buf.indexOf(92) === -1 || buf.indexOf(0) !== -1) continue; // no backslash, or binary
      for (const bad of findBadEscapes(buf.toString('utf8'))) {
        hits.push(`${file}:${bad.line}  ${JSON.stringify(bad.text)}  -> U+${bad.codePoint.toString(16).toUpperCase()}`);
      }
    }

    if (hits.length) {
      throw new Error(
        `Tailwind would fail \`next build\` with "Invalid code point" on these (it scans repo files for ` +
          `class names and decodes backslash-hex as CSS escapes). Use forward slashes, double the ` +
          `backslash, or break the hex run:\n  ${hits.join('\n  ')}`,
      );
    }
  }, 60_000);

  it('app/globals.css excludes every path the Build check skips', () => {
    const skipRule = fs.readFileSync(path.join(ROOT, '.github/ci/non-deploying-change.sh'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8');

    // Every skip arm of the case statement: a pattern list of `dir/*` entries
    // whose body is empty (just `;;`), e.g. `docs/*|scripts/*|.claude/*)`.
    // Reading all of them, not the first, means a path added as its own arm
    // is still held to the same rule.
    const arms = [...skipRule.matchAll(/^\s*((?:[\w.-]+\/\*\|)*[\w.-]+\/\*)\)\s*\n\s*;;/gm)];
    const dirs = arms.flatMap((arm) => arm[1].split('|').map((p) => p.replace(/\/\*$/, '')));
    // If this fails, the rule was rewritten: re-derive the parse.
    expect(dirs).toContain('docs');

    const expected = dirs.map((d) => `@source not "../${d}";`);
    // Root-level markdown is skipped by its own `*.md)` arm.
    if (/^\s*\*\.md\)\s*$/m.test(skipRule)) expected.push('@source not "../*.md";');

    for (const line of expected) expect(css).toContain(line);
  });
});
