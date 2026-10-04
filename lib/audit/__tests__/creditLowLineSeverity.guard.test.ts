/**
 * The low-line audit record is an observation, not an alert
 * (credit deduction slice 8b, SA SQ-46).
 *
 * Two things hold together, as for PAYMENT_REFUNDED:
 *  1. BOS_CREDIT_LOW_LINE_CROSSED is registered 'info', tagged 'bos', with no
 *     compliance flags.
 *  2. Its one writer (lib/business-os/credits/creditLowLine.ts) passes NO
 *     severity. `buildLogEntry` resolves `input.severity || metadata.severity`,
 *     so a writer's value would win; the registration must be the one source.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { audienceOf, isVisibleTo, OPERATOR_AUDIENCES } from '../eventAudience';
import { AUDIT_EVENTS, EVENT_METADATA, getEventMetadata } from '../events';
import { AUDIT_ENTITY_TYPES } from '../types';

const ACCEPTED_SEVERITIES = ['info', 'warning', 'critical'];
const WRITER = join(process.cwd(), 'lib', 'business-os', 'credits', 'creditLowLine.ts');

/** The writer with comments removed, so the explanation of this rule cannot satisfy it. */
function writerCode(): string {
  return readFileSync(WRITER, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const SEVERITY_KEY = /\bseverity\s*:/;

describe('BOS_CREDIT_LOW_LINE_CROSSED is recorded, not alerted', () => {
  it('is registered at info, with no compliance flags', () => {
    expect(EVENT_METADATA[AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED]).toBeDefined();
    const meta = getEventMetadata(AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED);
    expect(meta.severity).toBe('info');
    expect(meta.complianceFlags ?? []).toEqual([]);
    expect(meta.description).not.toMatch(/^Unknown event/);
    expect(ACCEPTED_SEVERITIES).toContain(meta.severity);
  });

  it('is tagged bos, so the admin audit trail lists it with the Business OS events', () => {
    expect(audienceOf(AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED)).toBe('bos');
    expect(isVisibleTo(AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED, OPERATOR_AUDIENCES)).toBe(true);
  });

  it('has its own registered entity type', () => {
    expect(AUDIT_ENTITY_TYPES).toContain('business_os_credit_period');
  });

  it('the severity rule matches a planted violation', () => {
    expect(SEVERITY_KEY.test("{ action: AUDIT_EVENTS.X, severity: 'warning' }")).toBe(true);
    expect(SEVERITY_KEY.test('// the writer passes no severity')).toBe(false);
  });

  it('the writer passes no severity of its own', () => {
    const code = writerCode();
    expect(code).toMatch(/AUDIT_EVENTS\.BOS_CREDIT_LOW_LINE_CROSSED/);
    expect(code).not.toMatch(SEVERITY_KEY);
  });
});
