import {
  normalizeFieldName,
  isSameFieldDifferentSpelling,
} from '../field-name-normalizer';

describe('normalizeFieldName', () => {
  it('collapses snake_case and camelCase to the same key', () => {
    expect(normalizeFieldName('mime_type')).toBe('mimetype');
    expect(normalizeFieldName('mimeType')).toBe('mimetype');
    expect(normalizeFieldName('MIME-TYPE')).toBe('mimetype');
    expect(normalizeFieldName('mimetype')).toBe('mimetype');
  });

  it('strips underscores and hyphens and lowercases', () => {
    expect(normalizeFieldName('attachment_id')).toBe('attachmentid');
    expect(normalizeFieldName('attachment-id')).toBe('attachmentid');
    expect(normalizeFieldName('AttachmentId')).toBe('attachmentid');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeFieldName('  message_id  ')).toBe('messageid');
  });

  it('keeps distinct fields distinct', () => {
    expect(normalizeFieldName('message_id')).not.toBe(normalizeFieldName('attachment_id'));
  });
});

describe('isSameFieldDifferentSpelling', () => {
  it('is true for same field, different spelling', () => {
    expect(isSameFieldDifferentSpelling('mime_type', 'mimeType')).toBe(true);
  });

  it('is false for byte-identical names (nothing to reconcile)', () => {
    expect(isSameFieldDifferentSpelling('mimeType', 'mimeType')).toBe(false);
  });

  it('is false for genuinely different fields', () => {
    expect(isSameFieldDifferentSpelling('message_id', 'attachment_id')).toBe(false);
  });
});
