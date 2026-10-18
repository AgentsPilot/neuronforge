/**
 * The receipt input (DE-10b.1, workplan §7.1; SA W-7, R-6) and its match with
 * what the generated function reads from `p_receipt`.
 */

import { RECEIPT_INPUT_KEYS } from '@/scripts/generate-test-account-cleanup-sql';
import {
  DELETION_RECEIPT_INPUT_KEYS,
  DELETION_RECEIPT_RETENTION,
  buildAdminReceipt,
  computeRetainUntil,
  deletionReceiptBaseSchema,
  withFilesRemoved,
} from '../receiptInput';

const FP = 'f'.repeat(64);
const NOW = new Date('2026-10-18T10:00:00.000Z');
const facts = {
  emailFingerprint: FP,
  fingerprintKeyVersion: 1,
  adminEmail: 'ops@example.com',
  reasonCategory: 'customer_asked' as const,
  reasonNote: null,
  ownerLastExportReadyAt: '2026-10-10 10:00:00+00',
  ownerExportDownloadedAt: null,
  adminExportExisted: false,
  requestedAt: NOW,
  correlationId: 'corr-1',
};

describe('retention (R-6, BQ-13)', () => {
  it('is one constant of at least one year, placeholder 7', () => {
    expect(DELETION_RECEIPT_RETENTION.years).toBeGreaterThanOrEqual(1);
    expect(DELETION_RECEIPT_RETENTION.years).toBe(7);
  });

  it('retain_until is the request time plus the constant, in UTC years', () => {
    expect(computeRetainUntil(NOW).toISOString()).toBe('2033-10-18T10:00:00.000Z');
    expect(buildAdminReceipt(facts).retain_until).toBe('2033-10-18T10:00:00.000Z');
  });
});

describe('the schema', () => {
  it('has no slot for the subject email: only the fingerprint and the admin own address', () => {
    const keys = Object.keys(deletionReceiptBaseSchema._def.schema.shape);
    expect(keys.filter((key) => key.includes('email'))).toEqual(['email_fingerprint', 'executor_admin_email']);
    expect(deletionReceiptBaseSchema.safeParse({ ...buildAdminReceipt(facts), email: 'jane@example.com' }).success).toBe(false);
  });

  it('holds exactly the keys the generated function reads (W-7)', () => {
    expect([...DELETION_RECEIPT_INPUT_KEYS].sort()).toEqual([...RECEIPT_INPUT_KEYS].sort());
  });

  it('never carries a key the function computes itself', () => {
    for (const computed of ['id', 'status', 'mode', 'placeholder_ref', 'rows_removed', 'rows_blanked', 'tables_removed', 'completed_at', 'executor_admin_id', 'subject_user_id']) {
      expect(DELETION_RECEIPT_INPUT_KEYS).not.toContain(computed);
    }
  });

  it.each([
    ['origin and executor disagree', { origin: 'owner', executor_kind: 'admin' }],
    ['an admin deletion without a reason', { reason_category: null }],
    ['Other without a note', { reason_category: 'other', reason_note: null }],
    ['a short note', { reason_category: 'other', reason_note: 'abc' }],
    ['a bad fingerprint', { email_fingerprint: 'nothex' }],
    ['key version 0', { fingerprint_key_version: 0 }],
  ])('refuses %s', (_name, patch) => {
    expect(deletionReceiptBaseSchema.safeParse({ ...buildAdminReceipt(facts), ...patch }).success).toBe(false);
  });
});

describe('buildAdminReceipt', () => {
  it('builds an admin receipt, normalising database timestamps', () => {
    const receipt = buildAdminReceipt(facts);
    expect(receipt).toMatchObject({
      email_fingerprint: FP,
      origin: 'admin',
      executor_kind: 'admin',
      executor_admin_email: 'ops@example.com',
      reason_category: 'customer_asked',
      reason_note: null,
      statement_language: null,
      statement_text: null,
      owner_last_export_ready_at: '2026-10-10T10:00:00.000Z',
      owner_export_downloaded_at: null,
      admin_export_existed: false,
      requested_at: NOW.toISOString(),
      correlation_id: 'corr-1',
    });
    expect(withFilesRemoved(receipt, 3).files_removed).toBe(3);
    expect(withFilesRemoved(receipt, -2).files_removed).toBe(0);
  });

  it('throws on a value the table would refuse, so nothing is removed', () => {
    expect(() => buildAdminReceipt({ ...facts, emailFingerprint: 'x' })).toThrow();
  });
});
