import {
  indexProducerFields,
  indexProducerFieldNames,
} from '../schema-field-extractor';

describe('indexProducerFields', () => {
  it('indexes flat object properties by normalised key → canonical spelling', () => {
    const schema = {
      type: 'object',
      properties: {
        mimeType: { type: 'string' },
        attachment_id: { type: 'string' },
      },
    };
    const idx = indexProducerFields(schema);
    expect(idx.normalizedToCanonical.get('mimetype')).toBe('mimeType');
    expect(idx.normalizedToCanonical.get('attachmentid')).toBe('attachment_id');
    expect(idx.canonicalNames).toEqual(['mimeType', 'attachment_id']);
  });

  it('walks into array items and arbitrary nesting (emails[].attachments[].mimeType)', () => {
    const schema = {
      type: 'object',
      properties: {
        emails: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              attachments: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    mimeType: { type: 'string' },
                    filename: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };
    const idx = indexProducerFields(schema);
    expect(idx.normalizedToCanonical.get('mimetype')).toBe('mimeType');
    expect(idx.normalizedToCanonical.get('filename')).toBe('filename');
  });

  it('flags a normalised key as ambiguous when two real spellings collide', () => {
    // Producer legitimately emits BOTH mimeType and mime_type at different depths.
    const schema = {
      type: 'object',
      properties: {
        mimeType: { type: 'string' },
        nested: {
          type: 'object',
          properties: { mime_type: { type: 'string' } },
        },
      },
    };
    const idx = indexProducerFields(schema);
    expect(idx.ambiguousNormalized.has('mimetype')).toBe(true);
  });

  it('returns empty index for non-schema input', () => {
    const idx = indexProducerFields(null);
    expect(idx.canonicalNames).toEqual([]);
    expect(idx.normalizedToCanonical.size).toBe(0);
  });
});

describe('indexProducerFieldNames', () => {
  it('indexes an explicit list of names', () => {
    const idx = indexProducerFieldNames(['mimeType', 'filename', 'message_id']);
    expect(idx.normalizedToCanonical.get('mimetype')).toBe('mimeType');
    expect(idx.normalizedToCanonical.get('messageid')).toBe('message_id');
    expect(idx.canonicalNames).toHaveLength(3);
  });

  it('flags ambiguity when two supplied names normalise identically', () => {
    const idx = indexProducerFieldNames(['mimeType', 'mime_type']);
    expect(idx.ambiguousNormalized.has('mimetype')).toBe(true);
  });
});
