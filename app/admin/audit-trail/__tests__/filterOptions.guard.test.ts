/**
 * Regression guard for AC-A3: the audit page's Action and Entity Type filters
 * stay catalogue-driven.
 *
 * This is what makes "a newly registered event becomes selectable with no UI
 * change" real rather than aspirational. The defect being guarded is not a bug
 * in one option list — it is the shape: a hand-maintained list of <option>s that
 * silently omits whatever was added to the registry afterwards. It went
 * unnoticed for the whole life of the page, and it would come back the first
 * time someone "just adds one option".
 *
 * Source-level, in Jest's default node environment: no jsdom, no UserProvider
 * mock, no rendering. Precedent: app/api/plugins/__tests__/
 * dead-plugin-routes-removed.guard.test.ts and
 * lib/__tests__/system-initializer-removed.guard.test.ts.
 */

import fs from 'fs';
import path from 'path';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import { AUDIT_ENTITY_TYPES } from '@/lib/audit/types';

const PAGE = path.join(__dirname, '..', 'page.tsx');
const source = fs.readFileSync(PAGE, 'utf8');

/** Every `<option value="X"` literal in the page, X included. */
const optionValues = [...source.matchAll(/<option\s+value=["']([^"'{]+)["']/g)].map((m) => m[1]);

/**
 * The only values allowed to be literals.
 *
 * "all" is a UI sentinel, not a catalogue value — there is no registry entry for
 * "no filter". The three severities are hardcoded deliberately: AuditSeverity is
 * a type-only union with no runtime array (lib/audit/types.ts), so there is no
 * catalogue to derive them from. Deriving it was raised and deferred by SA
 * (workplan OQ-2 / R-3) as its own change, because it would also have to collapse
 * the duplicate enum in AuditReadQuerySchema in the same commit.
 */
const ALLOWED_LITERAL_OPTION_VALUES = new Set(['all', 'info', 'warning', 'critical']);

describe('the audit page holds no hardcoded catalogue literal', () => {
  it('has no <option> whose value is a registered audit event', () => {
    const events = new Set<string>(Object.values(AUDIT_EVENTS));
    const offenders = optionValues.filter((v) => events.has(v));
    expect(offenders).toEqual([]);
  });

  it('has no <option> whose value is a registered entity type', () => {
    const entityTypes = new Set<string>(AUDIT_ENTITY_TYPES);
    const offenders = optionValues.filter((v) => entityTypes.has(v));
    expect(offenders).toEqual([]);
  });

  it('holds only the sentinel and the three severity literals', () => {
    const unexpected = optionValues.filter((v) => !ALLOWED_LITERAL_OPTION_VALUES.has(v));
    expect(unexpected).toEqual([]);
  });

  it('builds both lists from the shared catalogue module instead', () => {
    expect(source).toContain("from '@/lib/audit/filterOptions'");
    expect(source).toContain('buildEntityTypeFilterOptions()');
  });

  it('restricts the Action list by the explicit audience map, not by a list of its own (slice 2c)', () => {
    // The operator list is catalogue minus the events TAGGED agentspilot in
    // lib/audit/eventAudience.ts. The page must not grow its own exclusions.
    expect(source).toContain('buildActionFilterGroups({ audiences: OPERATOR_AUDIENCES })');
    expect(source).toContain("from '@/lib/audit/eventAudience'");
    expect(source).not.toMatch(/\.filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*!\s*\[/);
  });

  it('builds the BOS AI failures preset from the catalogue constant, not a literal', () => {
    expect(source).toContain('AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED');
    expect(source).not.toContain("'BUSINESS_AI_ACTION_FAILED'");
  });
});

describe('the AI detail renderer stays an allow-list (FR-A5, AC-A5, AC-A6)', () => {
  it('names its fields explicitly and never dumps AiAuditDetails wholesale', () => {
    // Object.entries over an AI entry's details would put any future key on an
    // admin screen without a review. The generic dump is a separate, pre-existing
    // block and is suppressed for AI rows — see the next test.
    expect(source).toContain('interface AiActionDetailsView');
    expect(source).not.toMatch(/Object\.entries\(\s*details\s*\)/);
  });

  it('suppresses the generic key/value dump for AI entries, so a row renders one block not two', () => {
    const genericDumpGuard = source
      .split('\n')
      .find((line) => line.includes("log.details && !log.action.startsWith('AIS_')"));
    expect(genericDumpGuard).toBeDefined();
    expect(genericDumpGuard).toContain('log.entity_type !== AI_ACTION_ENTITY_TYPE');
  });

  it('detects an AI entry by entity type, not by the action prefix', () => {
    // Outcome-independent: _COMPLETED and _FAILED must take the same path.
    expect(source).toContain('log.entity_type === AI_ACTION_ENTITY_TYPE && log.details');
    expect(source).not.toContain("startsWith('BUSINESS_AI_ACTION_')");
  });
});
