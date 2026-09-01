import {
  isBusinessProfileComplete,
  missingProfileFields,
  isInvoicingComplete,
  missingInvoiceFields,
  type BusinessProfileFields,
  type OrganizationSettings,
  type InvoiceFields,
} from '../profileReadiness';

const FULL_PROFILE: BusinessProfileFields = {
  company_name: 'International School of Parenting',
  vertical: 'tutor',
  logo_url: 'https://example.com/logo.png',
};

const FULL_SETTINGS: OrganizationSettings = {
  industry: 'education',
  company_size: 'solo',
  primary_goal: 'grow_revenue',
  technical_level: 'non_technical',
};

const FULL_INVOICE: InvoiceFields = {
  invoice_company_name: 'International School of Parenting Ltd',
  invoice_tax_id: '514123456',
  invoice_address: { line1: '12 Herzl St', city: 'Tel Aviv', country: 'IL' },
  invoice_bank_name: 'Bank Leumi',
  invoice_bank_account: '12-345-678901',
};

describe('[smoke] business profile readiness', () => {
  it('is complete when every field the form exposes is filled', () => {
    expect(isBusinessProfileComplete(FULL_PROFILE, FULL_SETTINGS)).toBe(true);
    expect(missingProfileFields(FULL_PROFILE, FULL_SETTINGS)).toEqual([]);
  });

  it('names each profile field that is missing', () => {
    // The chip's tooltip says what is absent, so the list has to be the actual
    // fields rather than a bare count.
    expect(missingProfileFields({ ...FULL_PROFILE, company_name: null }, FULL_SETTINGS)).toEqual([
      'company_name',
    ]);
    expect(missingProfileFields({ ...FULL_PROFILE, vertical: null }, FULL_SETTINGS)).toEqual([
      'business_type',
    ]);
    expect(missingProfileFields({ ...FULL_PROFILE, logo_url: null }, FULL_SETTINGS)).toEqual([
      'logo',
    ]);
  });

  it('names each organization setting that is missing', () => {
    expect(missingProfileFields(FULL_PROFILE, { ...FULL_SETTINGS, industry: null })).toEqual([
      'industry',
    ]);
    expect(missingProfileFields(FULL_PROFILE, { ...FULL_SETTINGS, company_size: null })).toEqual([
      'company_size',
    ]);
    expect(missingProfileFields(FULL_PROFILE, { ...FULL_SETTINGS, primary_goal: null })).toEqual([
      'primary_goal',
    ]);
    expect(missingProfileFields(FULL_PROFILE, { ...FULL_SETTINGS, technical_level: null })).toEqual([
      'technical_level',
    ]);
  });

  it('treats an absent logo column as a missing logo, not an error', () => {
    // Until the logo migration runs there is no column to read, so the caller
    // passes nothing. That must read as "no logo yet" rather than throwing.
    const { logo_url, ...withoutLogo } = FULL_PROFILE;
    expect(missingProfileFields(withoutLogo, FULL_SETTINGS)).toEqual(['logo']);
  });

  it('does not accept whitespace as a filled field', () => {
    // A form saved with a space in the box is empty. Counting it would put a
    // blank line where the company name belongs.
    expect(missingProfileFields({ ...FULL_PROFILE, company_name: '   ' }, FULL_SETTINGS)).toEqual([
      'company_name',
    ]);
  });

  it('reports everything missing for an account with nothing set', () => {
    // The second test account: an organizations row exists with settings {}.
    expect(missingProfileFields(null, null)).toEqual([
      'company_name',
      'business_type',
      'logo',
      'industry',
      'company_size',
      'primary_goal',
      'technical_level',
    ]);
    expect(isBusinessProfileComplete(null, null)).toBe(false);
  });
});

describe('[smoke] invoicing readiness', () => {
  it('is complete with identity, address and a way to pay', () => {
    expect(isInvoicingComplete(FULL_INVOICE)).toBe(true);
    expect(missingInvoiceFields(FULL_INVOICE)).toEqual([]);
  });

  it('names the identifying fields when they are missing', () => {
    expect(missingInvoiceFields({ ...FULL_INVOICE, invoice_company_name: null })).toEqual([
      'company_name',
    ]);
    expect(missingInvoiceFields({ ...FULL_INVOICE, invoice_tax_id: null })).toEqual(['tax_id']);
  });

  it('requires street, city and country before an address counts', () => {
    // The live state of this account: invoice_address is {}, so the twelve
    // invoices already sent carry no address at all.
    expect(missingInvoiceFields({ ...FULL_INVOICE, invoice_address: {} })).toEqual(['address']);
    expect(missingInvoiceFields({ ...FULL_INVOICE, invoice_address: null })).toEqual(['address']);
    expect(
      missingInvoiceFields({ ...FULL_INVOICE, invoice_address: { line1: '12 Herzl St' } })
    ).toEqual(['address']);
    expect(
      missingInvoiceFields({
        ...FULL_INVOICE,
        invoice_address: { line1: '12 Herzl St', city: 'Tel Aviv' },
      })
    ).toEqual(['address']);
  });

  it('does not require a postal code or a state', () => {
    // Plenty of countries write addresses without either. Demanding them would
    // leave those businesses permanently incomplete over a field they cannot
    // fill.
    expect(
      isInvoicingComplete({
        ...FULL_INVOICE,
        invoice_address: { line1: '12 Herzl St', city: 'Tel Aviv', country: 'IL' },
      })
    ).toBe(true);
  });

  it('accepts bank details or written instructions, either alone', () => {
    const bankOnly: InvoiceFields = {
      ...FULL_INVOICE,
      invoice_payment_instructions: null,
    };
    const instructionsOnly: InvoiceFields = {
      ...FULL_INVOICE,
      invoice_bank_name: null,
      invoice_bank_account: null,
      invoice_payment_instructions: 'Bit or PayBox to 050-0000000',
    };

    expect(isInvoicingComplete(bankOnly)).toBe(true);
    expect(isInvoicingComplete(instructionsOnly)).toBe(true);
  });

  it('does not accept half a bank account as a way to pay', () => {
    // A bank name with no account number tells the client nothing they can act
    // on, so it is not a payment method.
    expect(
      missingInvoiceFields({
        ...FULL_INVOICE,
        invoice_bank_account: null,
        invoice_payment_instructions: null,
      })
    ).toEqual(['payment_method']);
  });

  it('never requires the routing number', () => {
    // US-specific, and most of the world has no equivalent to put in it.
    expect(
      isInvoicingComplete({ ...FULL_INVOICE, invoice_bank_routing: null } as InvoiceFields)
    ).toBe(true);
  });

  it('reports everything missing for an account that never opened the section', () => {
    // Exactly this account's state — and it has already sent twelve invoices.
    expect(missingInvoiceFields({ invoice_address: {} })).toEqual([
      'company_name',
      'tax_id',
      'address',
      'payment_method',
    ]);
    expect(isInvoicingComplete(null)).toBe(false);
  });
});

