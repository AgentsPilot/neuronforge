/**
 * LF-1 (Admin Layout Follow-ups §4, AC-1.1, SA-C13, SQ-8): information text on
 * Health, Scheduled jobs & queues, Audit trail and the Business OS AI Activity
 * tab is `text-slate-400` (the standard's T-5 colour). `text-slate-500` measured
 * 3.07:1 on Health and 4.16:1 on Jobs, below WCAG AA 4.5:1, so it and the
 * darker `text-slate-600` are refused here, under any variant prefix.
 *
 * Folders are WALKED, not listed, so a component added later is covered. One
 * named exclusion: the old `audit-trail/BusinessAccountPicker.tsx`, which the
 * Audit trail page no longer mounts and Finance still imports (F-112); its
 * slate-500 lines belong to the finance adoption slice.
 *
 * Borders (`border-slate-600`), underline decoration (`decoration-slate-500`)
 * and placeholders are not text and are not refused. Comments are stripped
 * first, so prose about the rule cannot trip it.
 *
 * The rule uses character classes only (no backslash escapes), per the repo's
 * Tailwind-scan hazard note.
 */

import * as fs from 'fs';
import * as path from 'path';

import { stripComments } from '@/tests/helpers/source-scan';

/** `text-slate-500` or `text-slate-600` as a whole class, any prefix (`hover:`) or opacity suffix. */
const DIM_TEXT = /(^|[^a-zA-Z0-9-])text-slate-[56]00([^0-9]|$)/;

const toRelative = (full: string) => path.relative(process.cwd(), full).split(path.sep).join('/');

/** Every non-test `.ts` / `.tsx` file under `dir`, recursively. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__snapshots__') continue;
      found.push(...walk(relative));
      continue;
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    found.push(toRelative(path.join(process.cwd(), relative)));
  }
  return found.sort();
}

/** A line break, spelled without an escape (no backslash in this file, per the Tailwind-scan note). */
const NEWLINE = String.fromCharCode(10);

const EXCLUDED = ['app/admin/audit-trail/BusinessAccountPicker.tsx'];

/**
 * Businesses (LF-4b, requirement §4, SA C8): the whole folder is walked. One
 * named exclusion: the AD-1 "Delete…" dialog, whose entry is hidden
 * (`SHOW_AD1_DELETE_ENTRY = false`); its two slate-500 lines go to slate-400 in
 * the slice that shows the entry (finding LF4B-F2). The walk test asserts the
 * file still exists, so a rename cannot leave a stale exclusion.
 */
const BUSINESSES_EXCLUDED = ['app/admin/users/components/DeleteBusinessDialog.tsx'];

const PAGES: Record<string, string[]> = {
  Health: ['app/admin/page.tsx', ...walk('app/admin/components/health')],
  'Scheduled jobs & queues': ['app/admin/jobs-queues/page.tsx', ...walk('app/admin/components/jobs')],
  'Audit trail': walk('app/admin/audit-trail').filter((relative) => !EXCLUDED.includes(relative)),
  'Business OS AI Activity': walk('app/admin/business-os-llm/components/activity'),
  Businesses: walk('app/admin/users').filter((relative) => !BUSINESSES_EXCLUDED.includes(relative)),
};

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('LF-1 contrast guard: the rule itself', () => {
  it('catches planted slate-500 and slate-600 text, with or without a prefix or opacity', () => {
    expect(DIM_TEXT.test('<p className="text-xs text-slate-500">')).toBe(true);
    expect(DIM_TEXT.test('<span className="text-slate-600">')).toBe(true);
    expect(DIM_TEXT.test("'hover:text-slate-500'")).toBe(true);
    expect(DIM_TEXT.test('className="text-slate-500/80"')).toBe(true);
    expect(DIM_TEXT.test('text-slate-500')).toBe(true);
  });

  it('passes slate-400 text, borders, decoration and placeholders', () => {
    expect(DIM_TEXT.test('<p className="text-xs text-slate-400">')).toBe(false);
    expect(DIM_TEXT.test('className="rounded border border-slate-600"')).toBe(false);
    expect(DIM_TEXT.test('className="underline decoration-slate-500"')).toBe(false);
    expect(DIM_TEXT.test('className="placeholder-slate-500"')).toBe(false);
    expect(DIM_TEXT.test('className="context-slate-500"')).toBe(false);
  });

  it('ignores the rule named in a comment', () => {
    expect(DIM_TEXT.test(stripComments(['// was text-slate-500 before LF-1', 'const a = 1;'].join(NEWLINE)))).toBe(false);
  });
});

describe('LF-1 contrast guard: the walk', () => {
  it('found the files each page is built from (guards the scan)', () => {
    expect(PAGES.Health).toEqual(
      expect.arrayContaining(['app/admin/page.tsx', 'app/admin/components/health/HealthTile.tsx']),
    );
    expect(PAGES['Scheduled jobs & queues']).toEqual(
      expect.arrayContaining([
        'app/admin/jobs-queues/page.tsx',
        'app/admin/components/jobs/JobsQueuesView.tsx',
        'app/admin/components/jobs/QueueItemsPanel.tsx',
        'app/admin/components/jobs/DrainNowDialog.tsx',
        'app/admin/components/jobs/CancelQueueItemDialog.tsx',
        'app/admin/components/jobs/RetryQueueItemDialog.tsx',
        // LF-4c: the reconcile moved here from Businesses.
        'app/admin/components/jobs/ReconcileTopUpsDialog.tsx',
        'app/admin/components/jobs/reconcileCopy.ts',
      ]),
    );
    expect(PAGES['Audit trail']).toContain('app/admin/audit-trail/page.tsx');
    expect(PAGES['Audit trail']).not.toContain('app/admin/audit-trail/BusinessAccountPicker.tsx');
    expect(PAGES['Business OS AI Activity']).toEqual(
      expect.arrayContaining([
        'app/admin/business-os-llm/components/activity/ActivityDrillDown.tsx',
        'app/admin/business-os-llm/components/activity/AuditSummaryLine.tsx',
        'app/admin/business-os-llm/components/activity/DeletedAccountsBucket.tsx',
        'app/admin/business-os-llm/components/activity/RecordStateMarker.tsx',
      ]),
    );
    expect(PAGES.Businesses).toEqual(
      expect.arrayContaining([
        'app/admin/users/page.tsx',
        'app/admin/users/components/CreditsBlock.tsx',
        'app/admin/users/components/BoostBlock.tsx',
        'app/admin/users/components/CreditsLeftCell.tsx',
      ]),
    );
    for (const excluded of BUSINESSES_EXCLUDED) {
      expect(PAGES.Businesses).not.toContain(excluded);
      expect(fs.existsSync(path.join(process.cwd(), excluded))).toBe(true);
    }
    for (const files of Object.values(PAGES)) {
      for (const file of files) expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
      expect(files.some((file) => file.includes('/__tests__/'))).toBe(false);
    }
  });
});

describe.each(Object.keys(PAGES))('LF-1 contrast guard: %s', (page) => {
  it.each(PAGES[page])('%s has no slate-500 or slate-600 text', (relative) => {
    const lines = stripComments(read(relative)).split(NEWLINE);
    const dim = lines
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter(({ text }) => DIM_TEXT.test(text));
    expect({ file: relative, dim }).toEqual({ file: relative, dim: [] });
  });
});
