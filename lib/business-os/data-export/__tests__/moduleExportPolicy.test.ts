/**
 * Module export MX-1a (workplan §6 T-2): the mirror constants of migration
 * 20261095. The literal <-> constant pins live in the migration test; this
 * suite pins the relations between the constants, and that the file is pure.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CODE_SHAPE,
  EXPORT_REQUEST_ORIGINS,
  MODULE_EXPORT_POLICY,
  MODULE_JOB_IN_FLIGHT,
  MODULE_JOB_NOT_COUNTED,
  MODULE_JOB_STATUSES,
  MODULE_JOB_TERMINAL,
  NOTICE_STATES,
  PART_STATES,
  START_OUTCOMES,
} from '@/lib/business-os/data-export/moduleExportPolicy';
import { EXPORT_MODULE_IDS } from '@/lib/business-os/data-export/exportModules';

const SOURCE = readFileSync(join(process.cwd(), 'lib', 'business-os', 'data-export', 'moduleExportPolicy.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('MODULE_EXPORT_POLICY (MX-1a T-2)', () => {
  it('the lease outlives the worker by at least 60 s, and the budget ends before the worker is killed (XC-8)', () => {
    const p = MODULE_EXPORT_POLICY;
    expect(p.LEASE_SECONDS).toBeGreaterThanOrEqual(p.WORKER_MAX_DURATION_SECONDS + 60);
    expect(p.WORKER_BUDGET_SECONDS).toBeLessThan(p.WORKER_MAX_DURATION_SECONDS);
  });

  it('the limits are BQ-29 and XC-20 as the user set them', () => {
    expect(MODULE_EXPORT_POLICY.OWNER_DAILY_LIMIT).toBe(2);
    expect(MODULE_EXPORT_POLICY.ADMIN_DAILY_LIMIT_PER_OWNER).toBe(2);
    expect(MODULE_EXPORT_POLICY.DAILY_WINDOW_HOURS).toBe(24);
  });

  it('every limit and count is a positive whole number', () => {
    for (const [name, value] of Object.entries(MODULE_EXPORT_POLICY)) {
      expect([name, Number.isInteger(value) && value > 0]).toEqual([name, true]);
    }
  });

  it('in flight and terminal split the statuses: disjoint, and together all of them', () => {
    const inFlight = new Set<string>(MODULE_JOB_IN_FLIGHT);
    const terminal = new Set<string>(MODULE_JOB_TERMINAL);
    for (const status of inFlight) expect(terminal.has(status)).toBe(false);
    expect([...inFlight, ...terminal].sort()).toEqual([...MODULE_JOB_STATUSES].sort());
  });

  it('the not-counted statuses are terminal and never include sent (BQ-29: a request with any sent job counts)', () => {
    for (const status of MODULE_JOB_NOT_COUNTED) expect(MODULE_JOB_TERMINAL as ReadonlyArray<string>).toContain(status);
    expect(MODULE_JOB_NOT_COUNTED as ReadonlyArray<string>).not.toContain('sent');
  });

  it('the value lists hold no duplicate', () => {
    for (const list of [EXPORT_REQUEST_ORIGINS, MODULE_JOB_STATUSES, NOTICE_STATES, PART_STATES, START_OUTCOMES]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('every MX-0 module id fits CODE_SHAPE, so the table CHECK can never refuse a real module (SA MX1A-10)', () => {
    for (const id of EXPORT_MODULE_IDS) expect([id, CODE_SHAPE.test(id)]).toEqual([id, true]);
    expect(EXPORT_MODULE_IDS.length).toBeLessThanOrEqual(MODULE_EXPORT_POLICY.MAX_MODULES_PER_REQUEST);
  });

  it('CODE_SHAPE refuses free text, an upper case letter, a leading digit and 41 characters', () => {
    for (const bad of ['Owes money', 'Crm', '1crm', 'a', '', `a${'b'.repeat(40)}`, 'crm,payments']) {
      expect([bad, CODE_SHAPE.test(bad)]).toEqual([bad, false]);
    }
    expect(CODE_SHAPE.test(`a${'b'.repeat(39)}`)).toBe(true);
  });

  it('the file is pure: no import and no require', () => {
    expect(SOURCE).not.toMatch(/^\s*import\b/m);
    expect(SOURCE).not.toMatch(/\brequire\(/);
  });
});
