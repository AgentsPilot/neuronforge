/**
 * E-1 (MX-1b QA carry-over; BUSINESS_OS_EXPORT_MX3_WORKPLAN.md §13.6 T-E1): the
 * status words of a module job live in four places, and an owner's history
 * breaks if they drift apart.
 *
 *   1. the database CHECK of migration 20261095 (the authority);
 *   2. `MODULE_JOB_STATUSES` (moduleExportPolicy.ts), the server mirror;
 *   3. `ExportHistoryStatus` (exportHistory.ts), the history line's type;
 *   4. `HISTORY_STATUSES` (lib/client/businessOsDataExport.ts), the browser's
 *      parse of the history: a word missing there makes the whole history
 *      unreadable for the owner.
 *
 * The same five words in the same order. 2 is imported; 1, 3 and 4 are read
 * as source (the client file is browser code, and a type has no runtime
 * value). A planted sixth word must fail the rule (negative control).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { MODULE_JOB_STATUSES } from '../moduleExportPolicy';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

const quotedWords = (list: string): string[] => Array.from(list.matchAll(/'([a-z_]+)'/g), (m) => m[1]);

export function checkStatuses(source: string): string[] {
  const match = source.match(/business_os_export_module_jobs_status_check\s+CHECK \(status IN \(([^)]*)\)\)/);
  if (!match) throw new Error('status CHECK not found');
  return quotedWords(match[1]);
}

export function historyTypeStatuses(source: string): string[] {
  const match = source.match(/export type ExportHistoryStatus\s*=\s*([^;]+);/);
  if (!match) throw new Error('ExportHistoryStatus not found');
  return quotedWords(match[1]);
}

export function clientStatuses(source: string): string[] {
  const match = source.match(/const HISTORY_STATUSES\s*=\s*\[([^\]]*)\]/);
  if (!match) throw new Error('HISTORY_STATUSES not found');
  return quotedWords(match[1]);
}

/** Every list, labelled, against the authority. Empty = in step. */
export function driftOf(lists: Record<string, readonly string[]>, authority: readonly string[]): string[] {
  return Object.entries(lists)
    .filter(([, words]) => words.join(',') !== authority.join(','))
    .map(([name, words]) => `${name}: ${words.join(',')}`);
}

const MIGRATION = read('supabase/migrations/20261095_business_os_export_requests.sql');
const HISTORY = read('lib/business-os/data-export/exportHistory.ts');
const CLIENT = read('lib/client/businessOsDataExport.ts');

describe('E-1: module job status words, in step everywhere (T-E1)', () => {
  const authority = checkStatuses(MIGRATION);

  it('the database CHECK holds the five words', () => {
    expect(authority).toEqual(['waiting', 'working', 'sent', 'failed', 'interrupted']);
  });

  it('the server mirror, the history type and the client parse are the same five, same order', () => {
    expect(
      driftOf(
        {
          MODULE_JOB_STATUSES: [...MODULE_JOB_STATUSES],
          ExportHistoryStatus: historyTypeStatuses(HISTORY),
          HISTORY_STATUSES: clientStatuses(CLIENT),
        },
        authority
      )
    ).toEqual([]);
  });

  it('negative control: a sixth word planted in the client list is caught', () => {
    const planted = CLIENT.replace(/const HISTORY_STATUSES\s*=\s*\[/, "const HISTORY_STATUSES = ['paused', ");
    expect(clientStatuses(planted)).toHaveLength(6);
    expect(driftOf({ HISTORY_STATUSES: clientStatuses(planted) }, authority)).toHaveLength(1);
  });

  it('negative control: a sixth word planted in the database CHECK is caught', () => {
    const planted = MIGRATION.replace("'interrupted')),", "'interrupted', 'paused')),");
    expect(driftOf({ MODULE_JOB_STATUSES: [...MODULE_JOB_STATUSES] }, checkStatuses(planted))).toHaveLength(1);
  });
});
