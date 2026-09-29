/**
 * Business OS credit deduction, slice 3a: the credit value history (FR-3, AC-2,
 * SQ-7, SA ruling Q-2).
 *
 * The history is append-only. This suite compares it with the committed
 * snapshot `config/creditValue.history.json`, so an ACCIDENTAL edit to a shipped
 * entry fails here. It is not tamper-proof (a PR can edit both files): the PR
 * and its SA review are the audit record of a value change.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CREDIT_VALUE_HISTORY,
  currentCreditValue,
  type CreditValueVersion,
} from '@/lib/business-os/entitlements/config/creditValue';
import { TIER_MATRIX } from '@/lib/business-os/entitlements/config/tierMatrix';

const SNAPSHOT_PATH = join(process.cwd(), 'lib', 'business-os', 'entitlements', 'config', 'creditValue.history.json');
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as CreditValueVersion[];

/**
 * The comparison the guard makes: every released (snapshotted) entry is still
 * present, unchanged, at the same position. The history may be LONGER than the
 * snapshot (an append not yet snapshotted is caught by the equality test below),
 * never different.
 */
function editedEntries(released: readonly CreditValueVersion[], current: readonly CreditValueVersion[]): number[] {
  return released
    .map((entry, i) => (JSON.stringify(entry) === JSON.stringify(current[i]) ? -1 : entry.version))
    .filter((version) => version !== -1);
}

describe('the credit value history is append-only (FR-3, AC-2)', () => {
  it('matches the committed snapshot exactly', () => {
    // A new version is appended to BOTH files in the same PR. If this fails
    // because an existing entry changed, revert it and append a new version.
    expect(JSON.parse(JSON.stringify(CREDIT_VALUE_HISTORY))).toEqual(snapshot);
  });

  it('no released entry has been edited', () => {
    expect(editedEntries(snapshot, CREDIT_VALUE_HISTORY)).toEqual([]);
  });

  it('the comparison catches an edit to version 0 (negative control)', () => {
    const edited = JSON.parse(JSON.stringify(CREDIT_VALUE_HISTORY)) as CreditValueVersion[];
    edited[0] = { ...edited[0], usdPerCredit: 0.002 };
    expect(editedEntries(snapshot, edited)).toEqual([0]);
    const removed = edited.slice(1);
    expect(editedEntries(snapshot, removed)).toEqual([0]);
  });

  it('versions run 0, 1, 2 … with no gap', () => {
    expect(CREDIT_VALUE_HISTORY.map((entry) => entry.version)).toEqual(CREDIT_VALUE_HISTORY.map((_e, i) => i));
  });

  it('every value is finite and greater than zero', () => {
    for (const entry of CREDIT_VALUE_HISTORY) {
      expect(Number.isFinite(entry.usdPerCredit)).toBe(true);
      expect(entry.usdPerCredit).toBeGreaterThan(0);
    }
  });

  it('every entry is paired with a matrix version that exists, never going backwards (SQ-7)', () => {
    let previous = 0;
    for (const entry of CREDIT_VALUE_HISTORY) {
      expect(Number.isInteger(entry.matrixVersion)).toBe(true);
      expect(entry.matrixVersion).toBeGreaterThanOrEqual(Math.max(1, previous));
      expect(entry.matrixVersion).toBeLessThanOrEqual(TIER_MATRIX.version);
      previous = entry.matrixVersion;
    }
  });

  it('every entry says when and why it was decided', () => {
    for (const entry of CREDIT_VALUE_HISTORY) {
      expect(entry.decidedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.derivation.length).toBeGreaterThan(30);
    }
  });
});

describe('version 0', () => {
  it('is the provisional working figure: about $0.001 per credit (BD-1)', () => {
    expect(CREDIT_VALUE_HISTORY[0]).toMatchObject({ version: 0, usdPerCredit: 0.001, status: 'provisional', matrixVersion: 1 });
  });

  it('currentCreditValue() is the last entry', () => {
    expect(currentCreditValue()).toBe(CREDIT_VALUE_HISTORY[CREDIT_VALUE_HISTORY.length - 1]);
  });
});

describe('the config file stays data only (RC-7)', () => {
  it('imports nothing at run time', () => {
    const source = readFileSync(
      join(process.cwd(), 'lib', 'business-os', 'entitlements', 'config', 'creditValue.ts'),
      'utf8'
    );
    const valueImports = source.split('\n').filter((line) => /^\s*import\s/.test(line) && !/^\s*import\s+type\s/.test(line));
    expect(valueImports).toEqual([]);
  });
});
