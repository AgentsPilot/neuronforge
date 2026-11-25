import {
  isBusinessProfileComplete,
  missingProfileFields,
  missingSettingsProfileFields,
  isInvoicingComplete,
  missingInvoiceFields,
  type BusinessProfileFields,
  type OrganizationSettings,
  type InvoiceFields,
} from '../profileReadiness';

const FULL_PROFILE: BusinessProfileFields = {
  company_name: 'International School of Parenting',
  vertical: 'tutor',
  /* Gates since the onboarding chat turned out to ask for neither. Part of the
     fixture rather than a case of their own, so every assertion below goes on
     measuring the field it names. */
  phone: '+972501234567',
  email: 'hello@example.com',
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
  });

  /*
   * A logo is never missing, because it is never required.
   *
   * Plenty of businesses do not have one — a sole practitioner, a new business,
   * anyone who has not made one — and nothing breaks without it: the header
   * falls back to the business name, and the invoice PDF and emails render
   * fine. Counting it made the profile "incomplete", which made the readiness
   * step outstanding and could refuse a website publish over a missing image.
   */
  it('never reports a logo as missing, however it is absent', () => {
    expect(missingProfileFields({ ...FULL_PROFILE, logo_url: null }, FULL_SETTINGS)).toEqual([]);
    expect(missingProfileFields({ ...FULL_PROFILE, logo_url: '   ' }, FULL_SETTINGS)).toEqual([]);
    expect(isBusinessProfileComplete({ ...FULL_PROFILE, logo_url: null }, FULL_SETTINGS)).toBe(true);
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

  it('survives an account whose logo column is not there at all', () => {
    // The column arrives with the logo migration; until it runs the caller
    // passes nothing. That must not throw — and now reports nothing missing,
    // because a logo is not part of being complete.
    const { logo_url, ...withoutLogo } = FULL_PROFILE;
    expect(missingProfileFields(withoutLogo, FULL_SETTINGS)).toEqual([]);
  });

  it('does not accept whitespace as a filled field', () => {
    // A form saved with a space in the box is empty. Counting it would put a
    // blank line where the company name belongs.
    expect(missingProfileFields({ ...FULL_PROFILE, company_name: '   ' }, FULL_SETTINGS)).toEqual([
      'company_name',
    ]);
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE CONTACT DETAILS, AND WHY THEY ARE GATES.
   *
   * They were deliberately excluded once, on the argument that a page without
   * them still works because the enquiry form catches everything. What that
   * argument missed is that NOTHING ELSE ASKS: the onboarding chat has no
   * question for either, so an account that never opened settings had no phone
   * and no public email, and no screen ever said so.
   *
   * They gate the PROFILE step, where they are typed. They deliberately do not
   * gate an invoice — `journeyReadiness` lists both in `NOT_NEEDED_TO_INVOICE`,
   * because a document is valid with a company name, a tax id, an address and a
   * way to be paid. Without that exemption this change would have stopped every
   * invoiced service on every account with no public phone number.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('asks for the public phone and email', () => {
    expect(missingProfileFields({ ...FULL_PROFILE, phone: null }, FULL_SETTINGS)).toEqual(['phone']);
    expect(missingProfileFields({ ...FULL_PROFILE, email: null }, FULL_SETTINGS)).toEqual(['email']);
    expect(missingProfileFields({ ...FULL_PROFILE, phone: '  ' }, FULL_SETTINGS)).toEqual(['phone']);
  });

  it('names who the business is before how to reach it', () => {
    /* The order is read aloud by the dashboard and the settings strip. */
    expect(missingProfileFields({ company_name: null, vertical: null }, null)).toEqual([
      'company_name',
      'business_type',
      'industry',
      'company_size',
      'primary_goal',
      'technical_level',
      'phone',
      'email',
    ]);
  });

  it('reports everything missing for an account with nothing set', () => {
    // The second test account: an organizations row exists with settings {}.
    expect(missingProfileFields(null, null)).toEqual([
      'company_name',
      'business_type',
      'industry',
      'company_size',
      'primary_goal',
      'technical_level',
      'phone',
      'email',
    ]);
    expect(isBusinessProfileComplete(null, null)).toBe(false);
  });
});

describe('[smoke] what the settings form will not save without', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * TWO LISTS, ON PURPOSE, AND THE DIFFERENCE IS ONE FIELD.
   *
   * The owner asked for the business address to be mandatory. The cheap way to
   * do that is to add it to `missingProfileFields` — and that function is read
   * by the readiness card, by `journeyReadiness` and by the publish gate, so the
   * cheap way does not make a form stricter: it refuses a website publish.
   *
   * Counted on the live database before the change: of 8 business profiles, 4
   * had a usable address. Half the platform would have been blocked from
   * publishing over a field nothing had ever asked them for.
   *
   * So the address is required by the FORM, where it is typed, and by nothing
   * else. These cases exist to keep that split from being tidied away.
   * ───────────────────────────────────────────────────────────────────────────
   */

  const ADDRESS = { line1: '12 Herzl St', city: 'Tel Aviv', country: 'IL' };

  it('asks for everything the gates ask for, plus the address', () => {
    expect(missingSettingsProfileFields(FULL_PROFILE, FULL_SETTINGS, ADDRESS)).toEqual([]);
    expect(missingSettingsProfileFields(FULL_PROFILE, FULL_SETTINGS, null)).toEqual(['address']);
  });

  it('keeps the address LAST, which is the order the form reads it out in', () => {
    expect(
      missingSettingsProfileFields({ ...FULL_PROFILE, company_name: null }, FULL_SETTINGS, null)
    ).toEqual(['company_name', 'address']);
  });

  it('and the gates are untouched by it', () => {
    /* The guard that matters. If this ever fails, 4 of 8 live accounts stopped
       being able to publish a website. */
    expect(missingProfileFields(FULL_PROFILE, FULL_SETTINGS)).toEqual([]);
    expect(missingProfileFields(FULL_PROFILE, FULL_SETTINGS)).not.toContain('address');
  });

  it('wants street, city and country, and does not want a postal code', () => {
    /* The same test the invoice gate applies to `invoice_address`: plenty of
       countries write addresses with no postcode and no state, and asking for
       them would leave those businesses permanently unable to save. */
    const missing = (address: Record<string, string>) =>
      missingSettingsProfileFields(FULL_PROFILE, FULL_SETTINGS, address);

    expect(missing(ADDRESS)).toEqual([]);
    expect(missing({ ...ADDRESS, postal_code: '' })).toEqual([]);
    expect(missing({ line1: '12 Herzl St', city: 'Tel Aviv' })).toEqual(['address']);
    expect(missing({ line1: '12 Herzl St', country: 'IL' })).toEqual(['address']);
    expect(missing({ city: 'Tel Aviv', country: 'IL' })).toEqual(['address']);
  });

  it('does not count a space as an address', () => {
    /* A form saved with a space in a box is empty, and treating it as filled
       would put a blank line where the address belongs. */
    expect(
      missingSettingsProfileFields(FULL_PROFILE, FULL_SETTINGS, {
        line1: '   ',
        city: 'Tel Aviv',
        country: 'IL',
      })
    ).toEqual(['address']);
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
  });

  /**
   * THE TAX ID BELONGS TO ONE DOCUMENT, not to billing in general.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This file asked every business for one, and the platform has never
   * believed that. `defaultDocumentType` says so outright: "Tax without a
   * number is an ordinary invoice; neither is a receipt, which is what a
   * service business collecting on the spot is really sending."
   *
   * Two halves of one system disagreed, and the half that knew nothing about
   * document types was the one holding the publish gate. Reported by an owner
   * with no tax ID whose invoiced services could not be published, leaving
   * them a choice between inventing a number and giving up.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('the tax id follows the document', () => {
    /* `invoice_prices_include_tax` is what moves a business off a receipt. */
    const TAXED = { ...FULL_INVOICE, invoice_prices_include_tax: true };

    it('asks for one where the document is a tax invoice', () => {
      expect(
        missingInvoiceFields({ ...TAXED, invoice_document_type: 'tax_invoice', invoice_tax_id: null })
      ).toEqual(['tax_id']);
    });

    it('does not ask a business issuing receipts', () => {
      expect(
        missingInvoiceFields({ ...FULL_INVOICE, invoice_document_type: 'receipt', invoice_tax_id: null })
      ).toEqual([]);
    });

    it('does not ask a business issuing plain invoices', () => {
      expect(
        missingInvoiceFields({ ...TAXED, invoice_document_type: 'invoice', invoice_tax_id: null })
      ).toEqual([]);
    });

    it('follows the derived default when they have chosen nothing', () => {
      /*
       * Automatic. No tax on prices means a receipt, so no tax ID is owed;
       * tax on prices without a number is a plain invoice, same answer. The
       * one combination that asks for it cannot arise from the default, which
       * only reaches `tax_invoice` when a number is already there.
       */
      expect(missingInvoiceFields({ ...FULL_INVOICE, invoice_tax_id: null })).toEqual([]);
      expect(missingInvoiceFields({ ...TAXED, invoice_tax_id: null })).toEqual([]);
    });

    it('still asks for everything a document needs whoever is sending it', () => {
      /* Dropping the tax ID must not drop the other three: a client has to
         know who billed them and where the money goes. */
      expect(missingInvoiceFields({ invoice_document_type: 'receipt' })).toEqual([
        'company_name',
        'address',
        'payment_method',
      ]);
    });
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
    /*
     * Exactly this account's state, and it has already sent twelve invoices.
     *
     * No `tax_id` in the list any more, and not because the check weakened: an
     * account that has set nothing has no tax on its prices either, so the
     * document it issues is a RECEIPT, which does not carry one. The three
     * that remain are what any document needs. See "the tax id follows the
     * document" above.
     */
    expect(missingInvoiceFields({ invoice_address: {} })).toEqual([
      'company_name',
      'address',
      'payment_method',
    ]);
    expect(isInvoicingComplete(null)).toBe(false);
  });
});

