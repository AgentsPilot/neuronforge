/**
 * The owner's view of audit rows (credits boost slice 4a, SA C-5).
 */

import { AUDIT_EVENTS } from '@/lib/audit/events';
import { OWNER_EVENT_LABELS, OWNER_NEUTRAL_EVENTS, presentOwnerAuditRow } from '@/lib/audit/ownerEventPresentation';

describe('presentOwnerAuditRow', () => {
  it('BOS_BOOST_FLAGGED: a neutral label in en/he/es and NO details (no reason code, no payment intent)', () => {
    const row = {
      id: 'r1',
      action: 'BOS_BOOST_FLAGGED',
      details: { reason: 'amount_mismatch', row_status: 'pending', stripe_payment_intent_id: 'pi_1' },
    };
    const shown = presentOwnerAuditRow(row);
    expect(shown).toEqual({
      id: 'r1',
      action: 'BOS_BOOST_FLAGGED',
      details: {},
      owner_label: { en: 'Payment under review', he: 'התשלום בבדיקה', es: 'Pago en revisión' },
    });
    expect(JSON.stringify(shown)).not.toContain('amount_mismatch');
    expect(JSON.stringify(shown)).not.toContain('pi_1');
    // The stored row is not mutated (admins read it in full).
    expect(row.details.reason).toBe('amount_mismatch');
  });

  it('CREDITED keeps its details and gains a label', () => {
    const shown = presentOwnerAuditRow({ action: 'BOS_BOOST_CREDITED', details: { credits_total: 1 } });
    expect(shown).toMatchObject({ details: { credits_total: 1 }, owner_label: { en: 'Credits added' } });
  });

  it.each([
    ['DATA_EXPORT_REQUESTED', { request_id: 'q1', modules: ['clients'], origin: 'owner' }, 'Data export requested'],
    [
      'DATA_EXPORT_MODULE_SENT',
      { request_id: 'q1', job_id: 'j1', module: 'clients', origin: 'owner', rows: 3, parts: 1, parts_accepted: 1 },
      'One area of your export was sent by email',
    ],
    [
      'DATA_EXPORT_MODULE_FAILED',
      { request_id: 'q1', job_id: 'j1', module: 'clients', origin: 'owner', rows: null, parts: 0, parts_accepted: 0, failure_code: 'too_large', interrupted: false },
      'One area of your export could not be sent',
    ],
  ])('export MX-4a: %s gains its label and keeps its details (SA Q-6 c, d)', (action, details, en) => {
    expect(Object.values(AUDIT_EVENTS)).toContain(action);
    const shown = presentOwnerAuditRow({ action, details });
    expect(shown).toMatchObject({ action, details, owner_label: { en } });
    expect(OWNER_NEUTRAL_EVENTS.has(action)).toBe(false);
  });

  it('an unlabelled row is returned unchanged (the same object)', () => {
    const row = { id: 'r2', action: 'USER_LOGIN', details: { a: 1 } };
    expect(presentOwnerAuditRow(row)).toBe(row);
  });

  it('every label names a registered event, has three non-empty languages and no underscore or code', () => {
    for (const [action, label] of Object.entries(OWNER_EVENT_LABELS)) {
      expect(Object.values(AUDIT_EVENTS)).toContain(action);
      for (const text of [label.en, label.he, label.es]) {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(/_/);
      }
    }
    for (const action of OWNER_NEUTRAL_EVENTS) expect(OWNER_EVENT_LABELS[action]).toBeDefined();
  });
});
