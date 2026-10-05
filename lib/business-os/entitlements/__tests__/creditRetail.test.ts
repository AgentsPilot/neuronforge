/**
 * Business OS credits boost, slice 1: the retail markup history (requirement
 * §8.1, SA T-3a / F-3; workplan T-B10, T-B11).
 *
 * Append-only, like the credit value history: this suite compares it with the
 * committed snapshot `config/creditRetail.history.json`, so an ACCIDENTAL edit
 * to a shipped entry fails here. It is not tamper-proof; the PR and its SA
 * review are the audit record of a markup change.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CREDIT_RETAIL_HISTORY,
  currentCreditRetail,
  type CreditRetailVersion,
} from '@/lib/business-os/entitlements/config/creditRetail';
import { CREDIT_VALUE_HISTORY, currentCreditValue } from '@/lib/business-os/entitlements/config/creditValue';

const CONFIG_DIR = join(process.cwd(), 'lib', 'business-os', 'entitlements', 'config');
const snapshot = JSON.parse(readFileSync(join(CONFIG_DIR, 'creditRetail.history.json'), 'utf8')) as CreditRetailVersion[];

/** Released entries that are no longer present, unchanged, at the same position. */
function editedEntries(released: readonly CreditRetailVersion[], current: readonly CreditRetailVersion[]): number[] {
  return released
    .map((entry, i) => (JSON.stringify(entry) === JSON.stringify(current[i]) ? -1 : entry.version))
    .filter((version) => version !== -1);
}

describe('the retail markup history is append-only', () => {
  it('matches the committed snapshot exactly', () => {
    // A new version is appended to BOTH files in the same PR.
    expect(JSON.parse(JSON.stringify(CREDIT_RETAIL_HISTORY))).toEqual(snapshot);
  });

  it('no released entry has been edited', () => {
    expect(editedEntries(snapshot, CREDIT_RETAIL_HISTORY)).toEqual([]);
  });

  it('the comparison catches an edit and a removal (negative control)', () => {
    const edited = JSON.parse(JSON.stringify(CREDIT_RETAIL_HISTORY)) as CreditRetailVersion[];
    edited[0] = { ...edited[0], markup: 0.7 };
    expect(editedEntries(snapshot, edited)).toEqual([1]);
    expect(editedEntries(snapshot, [])).toEqual([1]);
  });

  it('versions run 1, 2, 3 … with no gap (SA Q-6: no provisional v0)', () => {
    expect(CREDIT_RETAIL_HISTORY[0].version).toBe(1);
    expect(CREDIT_RETAIL_HISTORY.map((entry) => entry.version)).toEqual(CREDIT_RETAIL_HISTORY.map((_e, i) => i + 1));
  });

  it('every markup is finite and not negative', () => {
    for (const entry of CREDIT_RETAIL_HISTORY) {
      expect(Number.isFinite(entry.markup)).toBe(true);
      expect(entry.markup).toBeGreaterThanOrEqual(0);
    }
  });

  it('every entry names a credit value version that exists, never going backwards', () => {
    const known = CREDIT_VALUE_HISTORY.map((entry) => entry.version as number);
    let previous = 0;
    for (const entry of CREDIT_RETAIL_HISTORY) {
      expect(known).toContain(entry.creditValueVersion);
      expect(entry.creditValueVersion).toBeGreaterThanOrEqual(previous);
      previous = entry.creditValueVersion;
    }
  });

  it('the shipped last markup is paired with the shipped current credit value (SA C-5)', () => {
    // Appending a credit value without deciding a markup against it fails HERE,
    // in CI, and not only at checkout.
    expect(currentCreditRetail().creditValueVersion).toBe(currentCreditValue().version);
  });

  it('every entry says when and why it was decided', () => {
    for (const entry of CREDIT_RETAIL_HISTORY) {
      expect(entry.decidedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.derivation.length).toBeGreaterThan(30);
    }
  });
});

describe('version 1', () => {
  it('is decision D1: 100% markup on credit value v1, decided 2026-09-30', () => {
    expect(CREDIT_RETAIL_HISTORY[0]).toMatchObject({ version: 1, markup: 1, creditValueVersion: 1, decidedOn: '2026-09-30' });
    expect(CREDIT_RETAIL_HISTORY[0].derivation).toContain('D1');
    expect(CREDIT_RETAIL_HISTORY[0].derivation).toContain('docs/architecture/BUSINESS_OS_CREDIT_PRICING.md');
  });

  it('currentCreditRetail() is the last entry', () => {
    expect(currentCreditRetail()).toBe(CREDIT_RETAIL_HISTORY[CREDIT_RETAIL_HISTORY.length - 1]);
  });
});

describe('the history cannot be changed at run time (QA I-1)', () => {
  it('entries and the list are frozen', () => {
    expect(() => {
      (CREDIT_RETAIL_HISTORY[0] as { markup: number }).markup = 0.5;
    }).toThrow(TypeError);
    expect(() => {
      (CREDIT_RETAIL_HISTORY as unknown as unknown[]).push({});
    }).toThrow(TypeError);
    expect(currentCreditRetail().markup).toBe(1);
  });
});
