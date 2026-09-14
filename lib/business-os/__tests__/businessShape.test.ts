/**
 * The shape, and the four surfaces it decides.
 *
 * Written as a table of catalogues rather than of predicates, because the claim
 * being tested is about businesses: a shop that sells downloads must not be
 * asked for opening hours, and a consultancy that invoices for everything must
 * not be asked to hand Stripe its ID.
 */

import {
  capabilityKeysFromShape,
  configTabsForShape,
  countServices,
  shapeFromServices,
  type ServiceFacts,
} from '../businessShape';

const scheduledCardService: ServiceFacts = {
  status: 'active',
  is_scheduled: true,
  collection: 'online',
  price: 250,
};

const scheduledInvoicedService: ServiceFacts = {
  status: 'active',
  is_scheduled: true,
  collection: 'invoice',
  price: 6000,
};

const product: ServiceFacts = {
  status: 'active',
  is_scheduled: false,
  collection: 'online',
  price: 80,
};

const freeConsultation: ServiceFacts = {
  status: 'active',
  is_scheduled: true,
  collection: null,
  price: 0,
};

describe('countServices', () => {
  it('counts only published services', () => {
    const counts = countServices([
      scheduledCardService,
      { ...scheduledInvoicedService, status: 'draft' },
      { ...product, status: 'inactive' },
    ]);

    expect(counts.activeServices).toBe(1);
    expect(counts.onlineServices).toBe(1);
    expect(counts.invoicedServices).toBe(0);
  });

  it('treats a service that never answered is_scheduled as an appointment', () => {
    expect(countServices([{ status: 'active', price: 100, collection: 'online' }]).scheduledServices).toBe(1);
  });

  it('reads a payment plan as money moving on a schedule, never as automatic charging', () => {
    const counts = countServices([
      { ...scheduledInvoicedService, payment_type: 'installments', installment_count: 3 },
    ]);

    expect(counts.plans).toBe('manual');
  });

  it('does not count a free service as priced', () => {
    expect(countServices([freeConsultation]).hasPricedServices).toBe(false);
  });
});

describe('a business that sells only products', () => {
  const shape = shapeFromServices([product]);

  it('is not asked for opening hours or an intake form', () => {
    expect(configTabsForShape(shape)).toEqual(['business', 'services', 'payments', 'invoice']);
  });

  it('gets no scheduling capability', () => {
    expect(capabilityKeysFromShape(shape)).not.toContain('scheduling');
  });
});

describe('a business that invoices for everything', () => {
  const shape = shapeFromServices([scheduledInvoicedService]);

  it('is never shown the Stripe tab, and always the invoice tab', () => {
    const tabs = configTabsForShape(shape);

    expect(tabs).not.toContain('payments');
    expect(tabs).toContain('invoice');
  });

  it('still keeps the Orders tab — invoices are orders', () => {
    expect(capabilityKeysFromShape(shape)).toContain('payments');
  });

  it('gets the Stripe tab back while an account still exists, so it can be disconnected', () => {
    expect(configTabsForShape(shape, { hasProcessorAccount: true })).toContain('payments');
  });
});

describe('a business that charges for nothing', () => {
  const shape = shapeFromServices([freeConsultation]);

  it('is asked for neither a processor nor bank details', () => {
    expect(configTabsForShape(shape)).toEqual(['business', 'services', 'availability', 'intake']);
  });

  it('has no payments capability', () => {
    expect(capabilityKeysFromShape(shape)).not.toContain('payments');
  });
});

describe('a mixed catalogue', () => {
  const shape = shapeFromServices([scheduledCardService, scheduledInvoicedService, product, freeConsultation], {
    online_presence_mode: 'full_website',
  });

  it('is asked for everything, because it does everything', () => {
    expect(configTabsForShape(shape)).toEqual([
      'business',
      'services',
      'availability',
      'intake',
      'payments',
      'invoice',
    ]);
  });

  it('has every derived capability', () => {
    expect(capabilityKeysFromShape(shape).sort()).toEqual(
      ['crm', 'insights', 'payments', 'reports', 'scheduling', 'website'].sort()
    );
  });
});

describe('an account with nothing yet', () => {
  const shape = shapeFromServices([]);

  it('sees every tab rather than a product cut down before it exists', () => {
    expect(configTabsForShape(shape)).toEqual([
      'business',
      'services',
      'availability',
      'intake',
      'payments',
      'invoice',
    ]);
  });

  it('still has CRM, which was never a choice', () => {
    expect(capabilityKeysFromShape(shape)).toContain('crm');
  });

  it('keeps reports and insights, which do not depend on taking money', () => {
    const keys = capabilityKeysFromShape(shape);

    expect(keys).toContain('reports');
    expect(keys).toContain('insights');
  });
});

describe('being findable online', () => {
  it('is the one answer the catalogue cannot give', () => {
    const wanted = shapeFromServices([scheduledCardService], { online_presence_mode: 'booking_only' });
    const declined = shapeFromServices([scheduledCardService], { online_presence_mode: 'none' });

    expect(capabilityKeysFromShape(wanted)).toContain('website');
    expect(capabilityKeysFromShape(declined)).not.toContain('website');
  });
});
