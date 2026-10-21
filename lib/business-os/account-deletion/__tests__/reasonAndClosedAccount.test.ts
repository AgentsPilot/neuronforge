/**
 * The admin delete reason (BQ-4, O-10) and the closed-account email helpers
 * (TQ-21). DE-10b.1, workplan §7.1.
 */

import { adminAccountLabel, closedAccountRef, isClosedAccountEmail } from '../closedAccount';
import { adminDeleteReasonSchema, hardDeleteReasonSchema, isReasonComplete, reasonNoteOf } from '../reason';

describe('adminDeleteReasonSchema', () => {
  it.each([
    [{ category: 'customer_asked' }],
    [{ category: 'test_account' }],
    [{ category: 'other', note: 'Duplicate signup' }],
    [{ category: 'other', note: 'x'.repeat(500) }],
  ])('accepts %j', (value) => {
    expect(adminDeleteReasonSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['an unknown category', { category: 'because' }],
    ['Other with no note', { category: 'other' }],
    ['a note under 5 characters', { category: 'other', note: 'abcd' }],
    ['a note of spaces', { category: 'other', note: '          ' }],
    ['a note over 500 characters', { category: 'other', note: 'x'.repeat(501) }],
    ['an extra key', { category: 'customer_asked', note: 'not allowed here' }],
    ['an extra key on Other', { category: 'other', note: 'Duplicate signup', email: 'a@b.co' }],
  ])('refuses %s', (_name, value) => {
    expect(adminDeleteReasonSchema.safeParse(value).success).toBe(false);
  });

  it('the hard delete takes only test_account (O-10)', () => {
    expect(hardDeleteReasonSchema.safeParse({ category: 'test_account' }).success).toBe(true);
    expect(hardDeleteReasonSchema.safeParse({ category: 'customer_asked' }).success).toBe(false);
    expect(hardDeleteReasonSchema.safeParse({ category: 'other', note: 'Duplicate signup' }).success).toBe(false);
  });

  it('reasonNoteOf and isReasonComplete', () => {
    expect(reasonNoteOf({ category: 'other', note: 'Duplicate' })).toBe('Duplicate');
    expect(reasonNoteOf({ category: 'customer_asked' })).toBeNull();
    expect(isReasonComplete(null, '')).toBe(false);
    expect(isReasonComplete('customer_asked', '')).toBe(true);
    expect(isReasonComplete('other', 'abcd')).toBe(false);
    expect(isReasonComplete('other', 'abcde')).toBe(true);
  });
});

describe('closed account email', () => {
  it('matches the exact placeholder only', () => {
    expect(isClosedAccountEmail('deleted-0123456789ab@deleted.invalid')).toBe(true);
    expect(closedAccountRef('deleted-0123456789ab@deleted.invalid')).toBe('0123456789ab');
  });

  it.each([
    'deleted-x@example.com',
    'deleted-0123456789AB@deleted.invalid',
    'deleted-0123456789a@deleted.invalid',
    'deleted-0123456789abc@deleted.invalid',
    'deleted-0123456789ab@deleted.invalid.com',
    'xdeleted-0123456789ab@deleted.invalid',
    '',
  ])('%s is not a closed account', (email) => {
    expect(isClosedAccountEmail(email)).toBe(false);
    expect(closedAccountRef(email)).toBeNull();
  });

  it('null and undefined are not closed accounts', () => {
    expect(isClosedAccountEmail(null)).toBe(false);
    expect(closedAccountRef(undefined)).toBeNull();
  });
});

describe('adminAccountLabel (DE-10b.2, TQ-21)', () => {
  it('names a closed account by its reference', () => {
    expect(adminAccountLabel('deleted-0123456789ab@deleted.invalid')).toBe('Deleted account 0123456789ab');
  });

  it('passes any other email through, and nothing for nothing', () => {
    expect(adminAccountLabel('jane@example.com')).toBe('jane@example.com');
    expect(adminAccountLabel('deleted-xyz@deleted.invalid')).toBe('deleted-xyz@deleted.invalid');
    expect(adminAccountLabel('')).toBeNull();
    expect(adminAccountLabel(null)).toBeNull();
    expect(adminAccountLabel(undefined)).toBeNull();
  });
});
