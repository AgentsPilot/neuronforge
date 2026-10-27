/**
 * The plan-leave reason list (D2 / SX-1, SA W-6): codes only, unique, and
 * storable in the closure table's `reason_code` column as is.
 */

import * as fs from 'fs';
import * as path from 'path';

import { PLAN_LEAVE_REASON_CODES } from '@/lib/business-os/billing/planLeaveReasons';

/** The CHECK in 20261093, read from the migration so a change there fails here. */
function closureReasonCodePattern(): RegExp {
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  const file = fs.readdirSync(dir).find((name) => name.startsWith('20261093') && name.endsWith('.sql'));
  if (!file) throw new Error('migration 20261093 not found');
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  const match = sql.match(/CHECK \(reason_code ~ '([^']+)'\)/);
  if (!match) throw new Error('reason_code CHECK not found in 20261093');
  return new RegExp(match[1]);
}

describe('PLAN_LEAVE_REASON_CODES', () => {
  it('is the BQ-7 list (TL default), in order', () => {
    expect(PLAN_LEAVE_REASON_CODES).toEqual([
      'too_expensive',
      'not_using_enough',
      'missing_feature',
      'switching_tool',
      'business_closing',
      'technical_problems',
      'other',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(PLAN_LEAVE_REASON_CODES).size).toBe(PLAN_LEAVE_REASON_CODES.length);
  });

  it('every code fits the closure table reason_code CHECK (20261093)', () => {
    const pattern = closureReasonCodePattern();
    expect(pattern.source).toBe('^[a-z][a-z0-9_]{1,39}$');
    for (const code of PLAN_LEAVE_REASON_CODES) expect(code).toMatch(pattern);
  });

  it('the module has no import (client-safe)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'business-os', 'billing', 'planLeaveReasons.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\(/);
  });
});
