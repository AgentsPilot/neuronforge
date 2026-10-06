/**
 * What no render test can reach on the jobs & queues page (admin
 * reorganisation slice 5; SA SC-7(g), SC-8, C-21 pattern):
 *   - client files import only `import type` from lib/admin/jobs, and nothing
 *     from the registry, a repository or a server module at runtime;
 *   - green classes live in exactly one constant, GREEN_STYLE;
 *   - no action verbs, no POST, no console, no "OK".
 *
 * Amended deliberately by ADMIN_BOS_CLEANUP slice 7d (SA W7D-2, OP-3), in the
 * narrowest form: `page.tsx` keeps every rule; `JobsQueuesView.tsx` keeps every
 * rule except that the word "Drain" may appear exactly once, in its header
 * sentence; the one action lives in the new `DrainNowDialog.tsx`, which may
 * make exactly one POST, to the literal drain URL, and nothing else.
 *
 * Amended by ADMIN_BOS_CLEANUP slice 7a (SA OP-11, W7A-10), narrowly: the page
 * and view rules are unchanged; the new read-only `QueueItemsPanel.tsx` joins
 * the read-only file set with EVERY original rule, plus a one-GET pin; the
 * moved formatters (`jobsFormat.ts`) join the console and import checks.
 *
 * Amended by ADMIN_BOS_CLEANUP slice 7b (SA OP-15, §2.8), narrowly: `page.tsx`
 * keeps every rule; the view keeps every rule except that its header sentence
 * now also says one item can be cancelled (still one "Drain", no capital-C
 * "Cancel", one fetch); the panel keeps EVERY read-only rule plus one counted
 * allowance, the `<CancelQueueItemDialog` element in its Cancellable cell; the
 * new `CancelQueueItemDialog.tsx` owns one POST, to the literal action URL,
 * with a pinned body, and is the only file here allowed the word "Cancel"
 * besides the drain dialog.
 *
 * Amended by ADMIN_BOS_CLEANUP slice 7c (SA OP-16, W7C-13), narrowly:
 * `page.tsx` keeps every rule; the view keeps every rule except that its
 * header sentence now also says a recently failed item can be retried (still
 * one "Drain", no capital-C "Cancel", no "Retry" word, one fetch); the panel
 * keeps EVERY read-only rule plus one more counted allowance, exactly one
 * `<RetryQueueItemDialog` element, as the allowed branch of its Re-send cell
 * (the second-to-last cell); the new `RetryQueueItemDialog.tsx` owns one POST,
 * to the literal action URL, with a pinned body that carries no time, owner or
 * account, and never says "Cancel", "Requeue" or "Drain".
 */

import * as fs from 'fs';
import * as path from 'path';

const PAGE = 'app/admin/jobs-queues/page.tsx';
const VIEW = 'app/admin/components/jobs/JobsQueuesView.tsx';
const DIALOG = 'app/admin/components/jobs/DrainNowDialog.tsx';
const PANEL = 'app/admin/components/jobs/QueueItemsPanel.tsx';
const CANCEL_DIALOG = 'app/admin/components/jobs/CancelQueueItemDialog.tsx';
const RETRY_DIALOG = 'app/admin/components/jobs/RetryQueueItemDialog.tsx';
const FORMAT = 'app/admin/components/jobs/jobsFormat.ts';
/** The read-only files: every original rule applies (W7D-2; the panel since slice 7a). */
const FILES = [PAGE, VIEW, PANEL];
/** Every client file on the page: client-only, C-21 imports, no console, no "OK". */
const CLIENT_FILES = [PAGE, VIEW, DIALOG, PANEL, CANCEL_DIALOG, RETRY_DIALOG];
const VIEW_HEADER_SENTENCE =
  "Each queue has a Drain now button; a waiting, failed or orphaned item can be cancelled, and a recently failed item can be retried, from its queue's list; everything else here is read-only.";
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function runtimeImports(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/import\s+(?!type\b)[^'"]*?from\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of code.matchAll(/import\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  return found;
}

const GREEN_PREFIXES = ['bg', 'text', 'border', 'from', 'to', 'via', 'shadow', 'outline', 'decoration', 'divide', 'ring', 'fill', 'stroke'];
const GREEN_CLASS = new RegExp(`(?<![\\w-])(?:${GREEN_PREFIXES.join('|')})-(?:green|emerald)-`);

describe('the jobs & queues client files', () => {
  it.each(CLIENT_FILES)('%s is a client component', (file) => {
    expect(read(file).trimStart().startsWith("'use client'")).toBe(true);
  });

  it.each(CLIENT_FILES)('%s imports no registry, repository, read or server module at runtime (C-21)', (file) => {
    for (const spec of runtimeImports(codeOf(read(file)))) {
      expect(spec).not.toMatch(/^@\/lib\/(repositories|cron|business-os|supabase)/);
      expect(spec).not.toMatch(/lib\/admin\/(jobs|health|readUnderDeadline)/);
      expect(spec).not.toMatch(/server-only/);
    }
  });

  it.each(FILES)('%s has no action button, no POST, no console and never says "OK"', (file) => {
    // The view's one allowance (W7D-2): its header sentence names the button.
    // Its presence and count are pinned in the slice 7d block below.
    const code = codeOf(read(file)).replace(VIEW_HEADER_SENTENCE, '');
    expect(code).not.toMatch(/\b(Retry|Requeue|Cancel|Drain)\b/);
    expect(code).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/);
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/\bOK\b/);
  });

  it('green lives in exactly one constant, GREEN_STYLE (SC-7(g))', () => {
    const code = codeOf(read('app/admin/components/jobs/JobsQueuesView.tsx'));
    const decl = code.match(/const GREEN_STYLE = '([^']*)';/);
    expect(decl?.[1]).toMatch(GREEN_CLASS);
    expect(code.replace(decl![0], '')).not.toMatch(GREEN_CLASS);
    expect(code.match(/\bGREEN_STYLE\b/g)).toHaveLength(2); // the declaration and TONE_CLASSES.green
    expect(codeOf(read('app/admin/jobs-queues/page.tsx'))).not.toMatch(GREEN_CLASS);
  });
});

describe('slice 7d: the one action, and nothing more (SA W7D-2)', () => {
  it('page.tsx never says "Drain" and makes no request', () => {
    const code = codeOf(read(PAGE));
    expect(code).not.toMatch(/\bDrain\b/);
    expect(code).not.toMatch(/fetch\(/);
  });

  it('JobsQueuesView.tsx says "Drain" exactly once, in its header sentence', () => {
    const code = codeOf(read(VIEW));
    expect(code).toContain(VIEW_HEADER_SENTENCE);
    expect(code.match(/\bDrain\b/g)).toHaveLength(1);
  });

  it('JobsQueuesView.tsx still has exactly one fetch: the jobs GET', () => {
    const code = codeOf(read(VIEW));
    expect(code.match(/fetch\(/g)).toHaveLength(1);
    expect(code).toContain("fetch('/api/admin/jobs-queues', { cache: 'no-store' })");
  });

  it('DrainNowDialog.tsx makes exactly one POST, with one fetch, to the literal drain URL', () => {
    const code = codeOf(read(DIALOG));
    expect(code.match(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g)).toEqual(["method: 'POST'"]);
    const fetches = [...code.matchAll(/fetch\(\s*([^,)]*)/g)].map((m) => m[1].trim());
    expect(fetches).toEqual(["'/api/admin/jobs-queues/drain'"]);
  });

  it('DrainNowDialog.tsx builds the body from queue and reason only', () => {
    const code = codeOf(read(DIALOG));
    expect(code.match(/JSON\.stringify\(/g)).toHaveLength(1);
    expect(code).toMatch(/body:\s*JSON\.stringify\(\{\s*queue:\s*queueId,\s*reason:\s*reason\.trim\(\)\s*\}\)/);
  });

  it('DrainNowDialog.tsx: no Retry or Requeue, no green, never "OK"; Cancel is allowed in this file only', () => {
    const code = codeOf(read(DIALOG));
    expect(code).not.toMatch(/\b(Retry|Requeue)\b/);
    expect(code).not.toMatch(GREEN_CLASS);
    expect(code).not.toMatch(/\bOK\b/);
    expect(code).not.toMatch(/console\./);
    expect(code).toMatch(/\bCancel\b/);
  });
});

describe('slice 7a: the item list is read-only (SA OP-11, W7A-10)', () => {
  it('QueueItemsPanel.tsx makes exactly one request: a GET to the items route', () => {
    const code = codeOf(read(PANEL));
    const fetches = [...code.matchAll(/fetch\(\s*([^,)]*)/g)].map((m) => m[1].trim());
    expect(fetches).toHaveLength(1);
    expect(fetches[0].startsWith('`/api/admin/jobs-queues/items?')).toBe(true);
    // No method key at all: the default, a GET.
    expect(code).not.toMatch(/\bmethod\s*:/);
    expect(code).not.toMatch(/\bbody\s*:/);
  });

  it('QueueItemsPanel.tsx builds the query from queue, state and page only', () => {
    const code = codeOf(read(PANEL));
    expect(code.match(/new URLSearchParams\(/g)).toHaveLength(1);
    expect(code).toMatch(/new URLSearchParams\(\{\s*queue:\s*queueId,\s*state:\s*tab,\s*page:\s*String\(page\)\s*\}\)/);
    expect(code).not.toMatch(/\.(append|set)\(/);
  });

  it('QueueItemsPanel.tsx: no green; its only buttons are the four tabs and Previous / Next; nothing clickable in a cell', () => {
    const code = codeOf(read(PANEL));
    expect(code).not.toMatch(GREEN_CLASS);
    // One <button> mapped over the four tabs, plus Previous and Next.
    expect(code.match(/<button\b/g)).toHaveLength(3);
    expect(code).toMatch(/TABS\.map\(/);
    for (const cell of code.match(/<td\b[^>]*>/g) ?? []) expect(cell).not.toMatch(/onClick/);
    expect(code).not.toMatch(/<td\b[^>]*>\s*<button/);
  });

  it('jobsFormat.ts: no imports at all, no console', () => {
    const code = codeOf(read(FORMAT));
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\brequire\(/);
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/\bOK\b/);
  });
});

describe('slice 7b: one item action, and nothing more (SA OP-15, §2.8)', () => {
  it('QueueItemsPanel.tsx: exactly one <CancelQueueItemDialog element, as the allowed branch of the last cell', () => {
    const code = codeOf(read(PANEL));
    expect(code.match(/<CancelQueueItemDialog\b/g)).toHaveLength(1);
    const cells = [...code.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    expect(cells.length).toBeGreaterThan(5);
    const last = cells[cells.length - 1];
    expect(last).toMatch(/^\s*\{\s*item\.cancel\.allowed\s*\?\s*\(?\s*<CancelQueueItemDialog\b/);
    for (const cell of cells.slice(0, -1)) expect(cell).not.toMatch(/CancelQueueItemDialog/);
    // Slice 7c: and never in the Re-send cell's retry dialog's place.
    expect(last).not.toMatch(/RetryQueueItemDialog/);
  });

  it('the allowance is a decision, not a regex accident: the identifier does not match \bCancel\b', () => {
    expect('CancelQueueItemDialog').not.toMatch(/\bCancel\b/);
    expect('<CancelQueueItemDialog />').not.toMatch(/\b(Retry|Requeue|Cancel|Drain)\b/);
  });

  it('JobsQueuesView.tsx passes the refresh to the panel, and never names the cancel dialog', () => {
    const code = codeOf(read(VIEW));
    expect(code).toMatch(/<QueueItemsPanel\b[^>]*\bonChanged=\{onDrained\}/);
    expect(code).not.toMatch(/CancelQueueItemDialog/);
  });

  it('CancelQueueItemDialog.tsx makes exactly one POST, with one fetch, to the literal action URL', () => {
    const code = codeOf(read(CANCEL_DIALOG));
    expect(code.match(/method:\s*['"](POST|PUT|PATCH|DELETE|GET)['"]/g)).toEqual(["method: 'POST'"]);
    const fetches = [...code.matchAll(/fetch\(\s*([^,)]*)/g)].map((m) => m[1].trim());
    expect(fetches).toEqual(["'/api/admin/jobs-queues/items/action'"]);
  });

  it('CancelQueueItemDialog.tsx builds the body from the row and the trimmed reason only (no account id can be added)', () => {
    const code = codeOf(read(CANCEL_DIALOG));
    expect(code.match(/JSON\.stringify\(/g)).toHaveLength(1);
    expect(code).toMatch(
      /body:\s*JSON\.stringify\(\{\s*queue:\s*queueId,\s*itemId:\s*item\.id,\s*action:\s*'cancel',\s*expected:\s*\{\s*status:\s*item\.status,\s*attempts:\s*item\.attempts\s*\},\s*reason:\s*reason\.trim\(\),?\s*\}\)/
    );
    expect(code).not.toMatch(/\b(userId|accountId|ownerUserId|user_id)\b/);
  });

  it('CancelQueueItemDialog.tsx: no Retry, Requeue or Drain; no green; never "OK"; no console; "Cancel" allowed here', () => {
    const code = codeOf(read(CANCEL_DIALOG));
    expect(code).not.toMatch(/\b(Retry|Requeue|Drain)\b/);
    expect(code).not.toMatch(GREEN_CLASS);
    expect(code).not.toMatch(/\bOK\b/);
    expect(code).not.toMatch(/console\./);
    expect(code).toMatch(/\bCancel item\b/);
  });

  it('CancelQueueItemDialog.tsx never renders server text: no error or details field is read from a response', () => {
    const code = codeOf(read(CANCEL_DIALOG));
    expect(code).not.toMatch(/\.(error|details|message)\b(?!\s*\()/);
  });
});

describe('slice 7c: one more item action, and nothing more (SA OP-16, W7C-13)', () => {
  it('QueueItemsPanel.tsx: exactly one <RetryQueueItemDialog element, as the allowed branch of the Re-send (second-to-last) cell', () => {
    const code = codeOf(read(PANEL));
    expect(code.match(/<RetryQueueItemDialog\b/g)).toHaveLength(1);
    const cells = [...code.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const resend = cells[cells.length - 2];
    expect(resend).toMatch(/^\s*\{\s*item\.retry\.allowed\s*\?\s*\(?\s*<RetryQueueItemDialog\b/);
    cells.forEach((cell, index) => {
      if (index !== cells.length - 2) expect(cell).not.toMatch(/RetryQueueItemDialog/);
    });
  });

  it('the allowance is a decision, not a regex accident: the identifier does not match \bRetry\b', () => {
    expect('RetryQueueItemDialog').not.toMatch(/\bRetry\b/);
    expect('<RetryQueueItemDialog />').not.toMatch(/\b(Retry|Requeue|Cancel|Drain)\b/);
  });

  it('JobsQueuesView.tsx never names the retry dialog; its header says retry without the word "Retry"', () => {
    const code = codeOf(read(VIEW));
    expect(code).not.toMatch(/RetryQueueItemDialog/);
    expect(VIEW_HEADER_SENTENCE).toMatch(/can be retried/);
    expect(VIEW_HEADER_SENTENCE).not.toMatch(/\b(Retry|Cancel|Requeue)\b/);
    expect(VIEW_HEADER_SENTENCE.match(/\bDrain\b/g)).toHaveLength(1);
  });

  it('RetryQueueItemDialog.tsx makes exactly one POST, with one fetch, to the literal action URL', () => {
    const code = codeOf(read(RETRY_DIALOG));
    expect(code.match(/method:\s*['"](POST|PUT|PATCH|DELETE|GET)['"]/g)).toEqual(["method: 'POST'"]);
    const fetches = [...code.matchAll(/fetch\(\s*([^,)]*)/g)].map((m) => m[1].trim());
    expect(fetches).toEqual(["'/api/admin/jobs-queues/items/action'"]);
  });

  it('RetryQueueItemDialog.tsx builds the body from the row and the trimmed reason only: no time, owner or account', () => {
    const code = codeOf(read(RETRY_DIALOG));
    expect(code.match(/JSON\.stringify\(/g)).toHaveLength(1);
    const body = code.match(
      /body:\s*JSON\.stringify\(\{\s*queue:\s*queueId,\s*itemId:\s*item\.id,\s*action:\s*'retry',\s*expected:\s*\{\s*status:\s*item\.status,\s*attempts:\s*item\.attempts\s*\},\s*reason:\s*reason\.trim\(\),?\s*\}\)/
    );
    expect(body).not.toBeNull();
    expect(body![0]).not.toMatch(/\b(userId|accountId|ownerUserId|user_id|nextAttemptAt|retryAt|scheduled\w*)\b/);
    expect(code).not.toMatch(/\b(userId|accountId|ownerUserId|user_id)\b/);
  });

  it('RetryQueueItemDialog.tsx: no Cancel, Requeue or Drain; no green; never "OK"; no console; "Retry item" present', () => {
    const code = codeOf(read(RETRY_DIALOG));
    expect(code).not.toMatch(/\b(Cancel|Requeue|Drain)\b/);
    expect(code).not.toMatch(GREEN_CLASS);
    expect(code).not.toMatch(/\bOK\b/);
    expect(code).not.toMatch(/console\./);
    expect(code).toMatch(/\bRetry item\b/);
  });

  it('RetryQueueItemDialog.tsx never renders server text: no error or details field is read from a response', () => {
    const code = codeOf(read(RETRY_DIALOG));
    expect(code).not.toMatch(/\.(error|details|message)\b(?!\s*\()/);
    expect(code).not.toMatch(/['"](error|details|message)['"]/);
  });

  it('CancelQueueItemDialog.tsx is untouched by 7c: it still never says Retry', () => {
    expect(codeOf(read(CANCEL_DIALOG))).not.toMatch(/\bRetry\b/);
  });
});
