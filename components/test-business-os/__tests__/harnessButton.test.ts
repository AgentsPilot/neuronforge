/**
 * The harness button look (TC-1 follow-up): one shared helper, and every
 * button on /test-business-os takes a className (so none falls back to
 * Tailwind preflight's bare, cursor-less native button).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { harnessButton } from '@/components/test-business-os/harnessButton';

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const HARNESS_FILES = [
  'app/test-business-os/page.tsx',
  ...readdirSync(join(ROOT, 'components/test-business-os'))
    .filter((n) => n.endsWith('.tsx'))
    .map((n) => `components/test-business-os/${n}`),
  ...readdirSync(join(ROOT, 'components/test-business-os/llm-usage'))
    .filter((n) => n.endsWith('.tsx'))
    .map((n) => `components/test-business-os/llm-usage/${n}`),
];

/** Every `<button …>` opening tag in a file (attributes contain no `>` in these files except `=>`). */
function buttonTags(source: string): string[] {
  const tags: string[] = [];
  const re = /<button\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    let i = match.index;
    let depth = 0;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(source.slice(match.index, i + 1));
  }
  return tags;
}

describe('harnessButton', () => {
  it('gives every variant a pointer, rounded border, hover and a dimmed disabled state', () => {
    for (const variant of ['primary', 'secondary', 'success', 'danger'] as const) {
      const cls = harnessButton(variant);
      expect(cls).toContain('cursor-pointer');
      expect(cls).toContain('rounded-md');
      expect(cls).toContain('border');
      expect(cls).toMatch(/enabled:hover:bg-/);
      expect(cls).toContain('disabled:opacity-50');
      expect(cls).toContain('disabled:cursor-not-allowed');
    }
  });

  it('makes danger red and distinct from primary', () => {
    expect(harnessButton('danger')).toContain('bg-red-600');
    expect(harnessButton('danger')).not.toEqual(harnessButton('primary'));
  });

  it('defaults to secondary, small', () => {
    expect(harnessButton()).toEqual(harnessButton('secondary', 'sm'));
  });
});

describe('harness buttons are styled', () => {
  it('finds the harness files', () => {
    expect(HARNESS_FILES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(HARNESS_FILES)('%s: every <button> has a className', (file) => {
    // The tab switcher keeps its own tab look (navigation, not an action).
    for (const tag of buttonTags(read(file)).filter((t) => !t.includes('key={tab.id}'))) {
      expect(tag).toMatch(/className=/);
    }
  });

  it('the destructive confirm "Yes, take credits" uses the danger variant', () => {
    const panel = read('components/test-business-os/TestCreditsPanel.tsx');
    expect(panel).toMatch(/className=\{harnessButton\('danger'\)\}>\s*\{busy \? 'Taking…' : 'Yes, take credits'\}/);
  });
});
