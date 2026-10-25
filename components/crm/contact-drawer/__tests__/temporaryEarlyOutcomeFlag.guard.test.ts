/**
 * The temporary flag that opens both outcomes before a session's hour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME` exists so the money path — held →
 * invoice → refund — can be walked without waiting weeks for a session to come
 * due. It is meant to be deleted.
 *
 * This file is what makes deleting it safe: it pins the flag to ONE reader and
 * ONE clause, so removal is three deletions and not an archaeology exercise.
 * If it ever spreads, these tests fail and say where.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

const flags = read('lib/utils/featureFlags.ts');
const actions = read('components/crm/contact-drawer/MeetingRowActions.tsx');

describe('it is off unless somebody turns it on', () => {
  it('reads an env var and nothing else', () => {
    expect(flags).toContain('NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME');
    expect(flags).toContain('return parseBooleanFlag(flag);');
  });

  it('is not named like a hook — CLAUDE.md', () => {
    /* A `use…` prefix makes every call site a react-hooks lint error and tells
       the next reader that hook rules apply when they do not. */
    expect(flags).toContain('export function isEarlySessionOutcomeEnabled()');
    expect(flags).not.toContain('useEarlySessionOutcome');
  });
});

describe('it opens both outcomes, and only those', () => {
  it('feeds the one gate both controls hang off', () => {
    /*
     * `awaiting` decides the primary "mark held" button AND the no-show item
     * behind the ⋯. One clause, both actions — which is why the flag needs no
     * second mention anywhere.
     */
    const gate = actions.slice(actions.indexOf('const awaiting ='));
    expect(gate.slice(0, gate.indexOf(';'))).toContain('isEarlySessionOutcomeEnabled()');
    expect(actions).toContain('const showsPrimary = awaiting && Boolean(onSetStatus)');
  });

  it('never overrides an outcome already recorded', () => {
    /*
     * Testing early must not mean overwriting what happened. A session that is
     * held, missed or called off keeps its answer whatever the flag says.
     */
    const gate = actions.slice(actions.indexOf('const awaiting ='));
    const clause = gate.slice(0, gate.indexOf(';'));

    expect(clause).toContain('meetingStatus == null');
    expect(clause).toContain('!settled');
  });

  it('leaves the real clock rule in front of it', () => {
    /* With the flag off, the gate is exactly what it was. */
    const gate = actions.slice(actions.indexOf('const awaiting ='));
    const clause = gate.slice(0, gate.indexOf(';'));

    expect(clause.indexOf('isMeetingPastDue')).toBeLessThan(
      clause.indexOf('isEarlySessionOutcomeEnabled')
    );
  });
});

describe('it can be removed in three deletions', () => {
  it('has exactly one reader in the whole tree', () => {
    /*
     * The thing that makes removal safe. Anything else consulting it is a
     * fourth place to find later, and this is the only notice anyone gets.
     */
    const hits = execSync(
      'grep -rl "isEarlySessionOutcomeEnabled" --include="*.ts" --include="*.tsx" lib components app || true',
      { cwd: process.cwd(), encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
      .filter(file => !file.includes('__tests__'));

    expect(hits.sort()).toEqual([
      'app/api/scheduling/meetings/[id]/outcome/route.ts',
      'components/crm/contact-drawer/MeetingRowActions.tsx',
      'lib/utils/featureFlags.ts',
    ]);
  });

  it('and the env var is read in exactly one place', () => {
    /*
     * The READ, not the name: the clause in `MeetingRowActions` names the flag
     * in its comment so the next reader knows what opened the control, and
     * that mention is documentation rather than a second place to change.
     */
    const hits = execSync(
      'grep -rl "process[.]env[.]NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME" --include="*.ts" --include="*.tsx" lib components app || true',
      { cwd: process.cwd(), encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
      .filter(file => !file.includes('__tests__'));

    expect(hits).toEqual(['lib/utils/featureFlags.ts']);
  });

  it('is written down where flags are, with its removal steps', () => {
    /* A temporary flag nobody recorded is a permanent flag. */
    const doc = read('docs/FEATURE_FLAGS.md');

    expect(doc).toContain('NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME');
    expect(doc).toContain('Remove when');
    expect(doc).toContain('To remove it');
  });
});
