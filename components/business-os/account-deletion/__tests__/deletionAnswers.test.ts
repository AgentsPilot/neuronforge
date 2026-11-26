/**
 * The answer maps of the deletion request and Keep my account (DL-2a; DL-2
 * workplan §5.4, §5.5, §12 T-1; DL-1b hand-overs CR-6 and CR-8). Every row
 * of both tables, and every server refusal code given an outcome.
 */

import fs from 'fs';
import path from 'path';
import { keepOutcome, NETWORK_FAILURE, parseBlockers, requestOutcome } from '../deletionAnswers';
import { CLOSURE_REQUEST_REFUSAL_STATUS } from '@/lib/business-os/account-deletion/closureRequest';
import { CLOSURE_KEEP_REFUSAL_STATUS } from '@/lib/business-os/account-deletion/closureKeep';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const DICTS = [en, he, es] as unknown as Array<Record<string, string>>;
const fail = (error: string, extra: Record<string, unknown> = {}) => ({ success: false, error, ...extra });

describe('requestOutcome (§5.4)', () => {
  it.each<[string, number | typeof NETWORK_FAILURE, unknown, unknown]>([
    ['200 pending', 200, { success: true, data: { status: 'pending', planEndsOn: '2026-11-26T10:00:00.000Z', renewalWasOn: true } }, { kind: 'recorded' }],
    ['200 grace', 200, { success: true, data: { status: 'grace', lockAt: '2026-12-01T22:00:00.000Z', lockTimezone: 'UTC' } }, { kind: 'recorded' }],
    ['200 unreadable', 200, { success: true, data: { redirect: '/account-deleted' } }, { kind: 'unconfirmed' }],
    ['409 already_requested pending', 409, fail('already_requested', { data: { status: 'pending' } }), { kind: 'already' }],
    ['409 already_requested status null (CR-6)', 409, fail('already_requested', { data: { status: null } }), { kind: 'already' }],
    ['409 already_requested no data', 409, fail('already_requested'), { kind: 'already' }],
    ['409 blocked', 409, fail('blocked', { blockers: [{ code: 'payment_failed' }] }), { kind: 'blocked', blockers: [{ code: 'payment_failed' }] }],
    ['409 plan_change_pending', 409, fail('plan_change_pending'), { kind: 'message', key: 'settings.account_delete.plan_change_pending' }],
    ['409 plan_state_changed', 409, fail('plan_state_changed'), { kind: 'message', key: 'settings.account_delete.plan_state_changed' }],
    ['400 statement_mismatch', 400, fail('statement_mismatch'), { kind: 'message', key: 'settings.account_delete.mismatch' }],
    ['400 invalid_body', 400, fail('invalid_body'), { kind: 'message', key: 'settings.account_delete.try_again' }],
    ['413 body_too_large', 413, fail('body_too_large'), { kind: 'message', key: 'settings.account_delete.try_again' }],
    ['429', 429, fail('Too many requests'), { kind: 'message', key: 'settings.account_delete.too_many' }],
    ['404 not_found (switch off)', 404, fail('not_found'), { kind: 'message', key: 'settings.account_delete.not_available' }],
    ['503 not_available', 503, fail('not_available'), { kind: 'message', key: 'settings.account_delete.not_available' }],
    ['503 try_again', 503, fail('try_again'), { kind: 'message', key: 'settings.account_delete.try_again' }],
    ['503 try_again + requesting (P-8)', 503, fail('try_again', { data: { status: 'requesting' } }), { kind: 'unconfirmed' }],
    ['502 stripe_error + outcomeUnknown', 502, fail('stripe_error', { outcomeUnknown: true }), { kind: 'unconfirmed' }],
    ['502 stripe_error', 502, fail('stripe_error'), { kind: 'message', key: 'settings.account_delete.try_again' }],
    ['500 request_failed', 500, fail('request_failed'), { kind: 'unconfirmed' }],
    ['500 unknown', 500, fail('Internal server error'), { kind: 'unconfirmed' }],
    ['a network failure', NETWORK_FAILURE, null, { kind: 'unconfirmed' }],
    ['401', 401, fail('Unauthorized'), { kind: 'message', key: 'plan.refusal.signed_out' }],
    ['an unknown 4xx', 422, fail('whatever'), { kind: 'message', key: 'settings.account_delete.try_again' }],
    ['a body that is not JSON', 502, null, { kind: 'unconfirmed' }],
  ])('%s', (_name, status, body, expected) => {
    expect(requestOutcome(status, body)).toEqual(expected);
  });

  it('the request route has exactly the refusal codes the map covers (a new one must be added to the table above)', () => {
    expect(Object.keys(CLOSURE_REQUEST_REFUSAL_STATUS).sort()).toEqual(
      ['already_requested', 'blocked', 'not_available', 'plan_change_pending', 'plan_state_changed', 'request_failed', 'stripe_error', 'try_again'].sort()
    );
  });

  it('blocked with an unknown or empty list still names a blocker (SA N-1)', () => {
    expect(requestOutcome(409, fail('blocked', { blockers: [{ code: 'brand_new' }] }))).toEqual({ kind: 'blocked', blockers: [{ code: 'contact_support' }] });
    expect(parseBlockers(undefined)).toEqual([{ code: 'contact_support' }]);
  });
});

describe('keepOutcome (§5.5)', () => {
  const ok = (renewal: string, extra: Record<string, unknown> = {}) => ({ success: true, data: { kept: true, from: 'pending', renewal, ...extra } });
  const planEnd = 'November 26, 2026';

  it.each<[string, number | typeof NETWORK_FAILURE, unknown, string | null, unknown]>([
    ['200 restored', 200, ok('restored'), planEnd, { kept: true, message: { key: 'account_closure.kept.restored' }, reread: true }],
    ['200 not_restored_by_choice', 200, ok('not_restored_by_choice'), planEnd, { kept: true, message: { key: 'account_closure.kept.not_restored_by_choice', vars: { planEnd } }, reread: true }],
    ['200 not_restored_by_choice, no date', 200, ok('not_restored_by_choice'), null, { kept: true, message: { key: 'account_closure.kept.not_restored_by_choice_nodate' }, reread: true }],
    ['200 not_needed', 200, { success: true, data: { kept: true, from: 'grace', renewal: 'not_needed' } }, planEnd, { kept: true, message: { key: 'account_closure.kept.not_needed' }, reread: true }],
    ['200 failed', 200, ok('failed', { code: 'payment_failed_contact_us', planEndsOn: null }), planEnd, { kept: true, message: { key: 'account_closure.kept.failed' }, reread: true }],
    ['200 unknown', 200, ok('unknown'), planEnd, { kept: true, message: { key: 'account_closure.kept.unknown' }, reread: true }],
    ['200 unreadable (still kept)', 200, { success: true }, planEnd, { kept: true, message: { key: 'account_closure.kept.generic' }, reread: true }],
    ['409 state_changed + kept (CR-8)', 409, fail('state_changed', { data: { status: 'kept' } }), planEnd, { kept: true, message: { key: 'account_closure.kept.generic' }, reread: true }],
    ['409 state_changed + locked', 409, fail('state_changed', { data: { status: 'locked' } }), planEnd, { kept: false, message: null, reread: true }],
    ['409 state_changed + null', 409, fail('state_changed', { data: { status: null } }), planEnd, { kept: false, message: null, reread: true }],
    ['409 nothing_to_keep', 409, fail('nothing_to_keep'), planEnd, { kept: false, message: { key: 'account_closure.nothing_to_keep' }, reread: true }],
    ['409 request_in_progress', 409, fail('request_in_progress', { data: { status: 'requesting' } }), planEnd, { kept: false, message: { key: 'account_closure.requesting_body' }, reread: false }],
    ['409 locked', 409, fail('locked', { data: { status: 'locked' } }), planEnd, { kept: false, message: { key: 'account_closure.locked_body' }, reread: false }],
    ['429', 429, fail('Too many requests'), planEnd, { kept: false, message: { key: 'settings.account_delete.too_many' }, reread: false }],
    ['401', 401, fail('Unauthorized'), planEnd, { kept: false, message: { key: 'plan.refusal.signed_out' }, reread: false }],
    ['503 try_again', 503, fail('try_again'), planEnd, { kept: false, message: { key: 'account_closure.keep_failed' }, reread: false }],
    ['500', 500, fail('Internal server error'), planEnd, { kept: false, message: { key: 'account_closure.keep_failed' }, reread: false }],
    ['400 invalid_body', 400, fail('invalid_body'), planEnd, { kept: false, message: { key: 'account_closure.keep_failed' }, reread: false }],
    ['a network failure', NETWORK_FAILURE, null, planEnd, { kept: false, message: { key: 'account_closure.keep_failed' }, reread: false }],
  ])('%s', (_name, status, body, end, expected) => {
    expect(keepOutcome(status, body, { planEnd: end })).toEqual(expected);
  });

  it('every Keep refusal code is mapped', () => {
    expect(Object.keys(CLOSURE_KEEP_REFUSAL_STATUS).sort()).toEqual(['locked', 'nothing_to_keep', 'request_in_progress', 'state_changed', 'try_again']);
  });
});

describe('every key either map can return exists in en, he and es', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'deletionAnswers.ts'), 'utf8');
  const keys = Array.from(new Set(Array.from(source.matchAll(/'((?:settings\.account_delete|account_closure|plan\.refusal)\.[a-z_.]+)'/g)).map((m) => m[1])));

  it('found the keys (not vacuous)', () => {
    expect(keys.length).toBeGreaterThan(15);
  });

  it.each(keys)('%s', (key) => {
    for (const dictionary of DICTS) expect(typeof dictionary[key]).toBe('string');
  });
});

describe('SA W-5: client bundle safety', () => {
  const dir = path.join(__dirname, '..');
  const clientFiles = ['deletionAnswers.ts', 'DeleteAccountDrawer.tsx', 'ClosurePendingPanel.tsx', 'KeepAccountButton.tsx', 'copyLine.tsx']
    .map((name) => path.join(dir, name))
    .concat([path.join(process.cwd(), 'hooks', 'useAccountClosure.ts'), path.join(process.cwd(), 'components', 'business-os', 'purge', 'DangerZonePanel.tsx')]);

  /**
   * SA CR-3: every `import … from` and `export … from` statement, single-line or multi-line,
   * with either quote; and a side-effect `import '…'`. CRLF-safe ([\s\S] spans both).
   */
  const moduleStatements = (code: string): string[] =>
    code.match(/^(?:import|export)\b[^;]*?\bfrom\s*['"][^'"]+['"];?|^import\s*['"][^'"]+['"];?/gm) ?? [];
  const specifierOf = (statement: string) => /['"]([^'"]+)['"];?$/.exec(statement)?.[1] ?? '';

  it.each(clientFiles)('%s imports the closure modules by type only, and no repository, deps file or date helper', (file) => {
    const code = fs.readFileSync(file, 'utf8');
    const statements = moduleStatements(code);
    // Floor: a scan that matches nothing would pass vacuously. Each file imports at least React or a module.
    expect(statements.length).toBeGreaterThanOrEqual(1);
    // Every line that starts an import also produced a statement (no form the pattern misses).
    expect(statements.filter((s) => s.startsWith('import')).length).toBe((code.match(/^import\b/gm) ?? []).length);
    for (const statement of statements) {
      const specifier = specifierOf(statement);
      if (/account-deletion\/(closureRequest|closureKeep)$/.test(specifier)) expect(statement).toMatch(/^(import|export) type /);
      expect(specifier).not.toMatch(/lib\/repositories|Deps$|closureDates|closureStatusView|businessDay/);
    }
  });

  it('the scan sees the drawer re-export and a multi-line type import (not vacuous)', () => {
    const drawer = moduleStatements(fs.readFileSync(path.join(dir, 'DeleteAccountDrawer.tsx'), 'utf8'));
    expect(drawer.some((s) => /^export \{ parseBlockers \} from '\.\/deletionAnswers'/.test(s))).toBe(true);
    const planted = "import type {\n  ClosureRequestRefusalCode,\n} from \"@/lib/business-os/account-deletion/closureRequest\";\nexport { x } from '@/lib/repositories/Foo';";
    const found = moduleStatements(planted);
    expect(found.map(specifierOf)).toEqual(['@/lib/business-os/account-deletion/closureRequest', '@/lib/repositories/Foo']);
  });

  it('negative control: a value import of closureRequest is caught', () => {
    const [statement] = moduleStatements("import { CLOSURE_REQUEST_REFUSAL_STATUS } from '@/lib/business-os/account-deletion/closureRequest';");
    expect(statement).not.toMatch(/^(import|export) type /);
  });
});
