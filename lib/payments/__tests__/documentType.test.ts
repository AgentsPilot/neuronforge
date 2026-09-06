import {
  defaultDocumentType,
  resolveDocumentType,
  documentTitle,
  documentNoun,
  documentNumberLabel,
} from '../documentType';

describe('defaultDocumentType', () => {
  it('is a receipt when the business has not configured tax', () => {
    expect(defaultDocumentType({})).toBe('receipt');
    expect(defaultDocumentType(null)).toBe('receipt');
    expect(defaultDocumentType(undefined)).toBe('receipt');
  });

  it('is an invoice when tax is on but no registration number is given', () => {
    expect(defaultDocumentType({ invoice_prices_include_tax: true })).toBe('invoice');
  });

  it('is a tax invoice only with tax AND a registration number', () => {
    expect(
      defaultDocumentType({ invoice_prices_include_tax: true, invoice_tax_id: '514123456' })
    ).toBe('tax_invoice');
  });

  // A tax id typed and then cleared leaves whitespace behind in a form; that is
  // not a registration, and issuing a tax invoice on the strength of it is the
  // exact claim this module exists to avoid making.
  it('does not treat a whitespace-only tax id as a registration', () => {
    expect(
      defaultDocumentType({ invoice_prices_include_tax: true, invoice_tax_id: '   ' })
    ).toBe('invoice');
  });

  // A tax id alone is common — many businesses have one and are not registered
  // for VAT — so it must not on its own upgrade the document.
  it('ignores a tax id when tax is off', () => {
    expect(defaultDocumentType({ invoice_tax_id: '514123456' })).toBe('receipt');
  });
});

describe('resolveDocumentType', () => {
  it('prefers the business explicit choice over the default', () => {
    expect(
      resolveDocumentType({ invoice_document_type: 'receipt', invoice_prices_include_tax: true })
    ).toBe('receipt');
  });

  it('falls back to the default when nothing is chosen', () => {
    expect(resolveDocumentType({ invoice_document_type: null })).toBe('receipt');
  });

  // The column is text and older rows or a hand-written update could hold
  // anything; an unrecognised value must not become a document heading.
  it('ignores a value that is not one of the three documents', () => {
    expect(resolveDocumentType({ invoice_document_type: 'proforma' })).toBe('receipt');
  });
});

describe('documentTitle', () => {
  it('heads a paid receipt as a receipt', () => {
    expect(documentTitle({ invoice_document_type: 'receipt' }, 'he', true)).toBe('קבלה');
    expect(documentTitle({ invoice_document_type: 'receipt' }, 'en', true)).toBe('RECEIPT');
  });

  /*
   * The guarantee that matters: a receipt is evidence money was received, and
   * an unpaid document carrying that word tells the client a payment happened.
   * It is also the one document they might file instead of paying.
   */
  it('never heads an unpaid document as a receipt', () => {
    expect(documentTitle({ invoice_document_type: 'receipt' }, 'he', false)).toBe('חשבונית');
    expect(documentTitle({ invoice_document_type: 'receipt' }, 'en', false)).toBe('INVOICE');
  });

  it('leaves invoice and tax invoice alone whether paid or not', () => {
    expect(documentTitle({ invoice_document_type: 'tax_invoice' }, 'he', false)).toBe('חשבונית מס');
    expect(documentTitle({ invoice_document_type: 'tax_invoice' }, 'he', true)).toBe('חשבונית מס');
    expect(documentTitle({ invoice_document_type: 'invoice' }, 'en', true)).toBe('INVOICE');
  });

  it('falls back to English for a locale it has no words for', () => {
    expect(documentTitle({ invoice_document_type: 'receipt' }, 'fr', true)).toBe('RECEIPT');
    expect(documentTitle({ invoice_document_type: 'receipt' }, null, true)).toBe('RECEIPT');
  });
});

describe('documentNoun and documentNumberLabel', () => {
  it('gives sentence case for prose, not the heading shout', () => {
    expect(documentNoun({ invoice_document_type: 'tax_invoice' }, 'en', true)).toBe('Tax invoice');
  });

  it('labels the number with the document it belongs to', () => {
    expect(documentNumberLabel({ invoice_document_type: 'receipt' }, 'he', true)).toBe('מספר קבלה');
    expect(documentNumberLabel({ invoice_document_type: 'receipt' }, 'en', true)).toBe(
      'Receipt number'
    );
    expect(documentNumberLabel({ invoice_document_type: 'tax_invoice' }, 'es', true)).toBe(
      'Número de factura'
    );
  });

  // Same unpaid rule as the heading — a "Receipt number" on a document asking
  // for payment contradicts the document on its own first line.
  it('follows the unpaid rule the heading follows', () => {
    expect(documentNumberLabel({ invoice_document_type: 'receipt' }, 'he', false)).toBe(
      'מספר חשבונית'
    );
  });
});
