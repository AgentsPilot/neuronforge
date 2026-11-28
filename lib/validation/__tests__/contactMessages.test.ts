import {
  ADMIN_MESSAGES_SEARCH_MAX,
  ADMIN_NOTES_MAX,
  CONTACT_EMAIL_MAX,
  CONTACT_MESSAGE_MAX,
  CONTACT_NAME_MAX,
  adminMessageIdParamSchema,
  adminMessagePatchSchema,
  adminMessagesListQuerySchema,
  contactFormBodySchema,
} from '../contactMessages';

const VALID = { name: 'Dana', email: 'dana@example.com', message: 'Hello' };

describe('contactFormBodySchema', () => {
  it('trims every field', () => {
    expect(contactFormBodySchema.parse({ name: '  Dana ', email: ' dana@example.com ', message: ' Hi\n ' })).toEqual({
      name: 'Dana',
      email: 'dana@example.com',
      message: 'Hi',
    });
  });

  it('drops unknown keys', () => {
    expect(contactFormBodySchema.parse({ ...VALID, extra: 'x' })).toEqual(VALID);
  });

  it.each(['name', 'email', 'message'] as const)('requires %s', (field) => {
    const body: Record<string, string> = { ...VALID };
    delete body[field];
    expect(contactFormBodySchema.safeParse(body).success).toBe(false);
    expect(contactFormBodySchema.safeParse({ ...VALID, [field]: '   ' }).success).toBe(false);
  });

  it('refuses an invalid email address, including one with a line break', () => {
    expect(contactFormBodySchema.safeParse({ ...VALID, email: 'not-an-email' }).success).toBe(false);
    expect(contactFormBodySchema.safeParse({ ...VALID, email: 'a@b.com\nBcc: c@d.com' }).success).toBe(false);
  });

  it('caps the lengths', () => {
    expect(contactFormBodySchema.safeParse({ ...VALID, name: 'a'.repeat(CONTACT_NAME_MAX) }).success).toBe(true);
    expect(contactFormBodySchema.safeParse({ ...VALID, name: 'a'.repeat(CONTACT_NAME_MAX + 1) }).success).toBe(false);
    expect(contactFormBodySchema.safeParse({ ...VALID, message: 'a'.repeat(CONTACT_MESSAGE_MAX) }).success).toBe(true);
    expect(contactFormBodySchema.safeParse({ ...VALID, message: 'a'.repeat(CONTACT_MESSAGE_MAX + 1) }).success).toBe(false);
    const longEmail = `${'a'.repeat(CONTACT_EMAIL_MAX)}@example.com`;
    expect(contactFormBodySchema.safeParse({ ...VALID, email: longEmail }).success).toBe(false);
  });
});

describe('adminMessagesListQuerySchema', () => {
  it('defaults to every status and no search', () => {
    expect(adminMessagesListQuerySchema.parse({})).toEqual({ filter: 'all', search: '' });
  });

  it('accepts what the page sends', () => {
    expect(adminMessagesListQuerySchema.parse({ filter: 'unread', search: ' dana ' })).toEqual({
      filter: 'unread',
      search: 'dana',
    });
  });

  it('refuses an unknown filter and an over-long search', () => {
    expect(adminMessagesListQuerySchema.safeParse({ filter: 'bogus' }).success).toBe(false);
    expect(adminMessagesListQuerySchema.safeParse({ search: 'a'.repeat(ADMIN_MESSAGES_SEARCH_MAX) }).success).toBe(true);
    expect(adminMessagesListQuerySchema.safeParse({ search: 'a'.repeat(ADMIN_MESSAGES_SEARCH_MAX + 1) }).success).toBe(false);
  });
});

describe('adminMessagePatchSchema', () => {
  it('accepts the status save the page sends, updated_at included', () => {
    expect(adminMessagePatchSchema.safeParse({ status: 'read', updated_at: '2026-11-27T10:00:00Z' }).success).toBe(true);
  });

  it('accepts the notes save, including clearing the notes', () => {
    expect(adminMessagePatchSchema.safeParse({ admin_notes: 'note', updated_at: 'x' }).success).toBe(true);
    expect(adminMessagePatchSchema.safeParse({ admin_notes: '' }).success).toBe(true);
  });

  it('refuses any other key', () => {
    expect(adminMessagePatchSchema.safeParse({ status: 'read', email: 'x@y.z' }).success).toBe(false);
    expect(adminMessagePatchSchema.safeParse({ status: 'read', email_sent: true }).success).toBe(false);
  });

  it('refuses a body with nothing to update', () => {
    expect(adminMessagePatchSchema.safeParse({ updated_at: 'x' }).success).toBe(false);
    expect(adminMessagePatchSchema.safeParse({}).success).toBe(false);
  });

  it('refuses an unknown status and over-long notes', () => {
    expect(adminMessagePatchSchema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(adminMessagePatchSchema.safeParse({ admin_notes: 'a'.repeat(ADMIN_NOTES_MAX + 1) }).success).toBe(false);
  });
});

describe('adminMessageIdParamSchema', () => {
  it('accepts a uuid and refuses anything else', () => {
    expect(adminMessageIdParamSchema.safeParse('99999999-9999-4999-8999-999999999999').success).toBe(true);
    expect(adminMessageIdParamSchema.safeParse('x').success).toBe(false);
    expect(adminMessageIdParamSchema.safeParse('1,2').success).toBe(false);
  });
});
