import {
  resolveSetup,
  nextStep,
  blockerFor,
  allSteps,
  isReadyForClients,
  shapeFromProfile,
  SETUP_STEPS,
  UNKNOWN_SHAPE,
  type BusinessShape,
  type ResolvableItem,
  type StepId,
} from '../setupGraph';

/**
 * A business that charges by card online — the shape the old code assumed
 * every priced business had. Most of the existing expectations are written
 * against it, so it is the default here too.
 */
const CARD: BusinessShape = { hasPricedServices: true, collection: 'card_online', appointments: true, collectsOnline: true, invoices: false, presence: 'full_website', plans: 'none' };

/** Charges money, collects it herself: an invoice, then a transfer or a call. */
const INVOICE: BusinessShape = { hasPricedServices: true, collection: 'invoice', appointments: true, collectsOnline: false, invoices: true, presence: 'booking_only', plans: 'none' };

/** Takes cash in the room, or charges nothing at all. */
const OFFLINE: BusinessShape = { hasPricedServices: true, collection: 'in_person', appointments: true, collectsOnline: false, invoices: false, presence: 'booking_only', plans: 'none' };

/**
 * Every step the dashboard computes, all outstanding. The starting point for a
 * brand new account, and the case the graph exists to make legible.
 */
const ALL_STEP_IDS: StepId[] = [
  'services',
  'availability',
  'design',
  'website',
  'payments',
  'profile',
  'invoicing',
  'calendar',
  'intake',
];

function items(done: StepId[] = [], ids: StepId[] = ALL_STEP_IDS): ResolvableItem[] {
  return ids.map(id => ({
    id,
    title: id,
    description: '',
    completed: done.includes(id),
    action: `do_${id}`,
  }));
}

function find(graph: ReturnType<typeof resolveSetup>, id: string) {
  return allSteps(graph).find(step => step.item.id === id);
}

describe('[smoke] setup graph — locking', () => {
  it('locks a step whose prerequisite is outstanding, and names the blocker', () => {
    const graph = resolveSetup(items(), CARD);

    for (const id of ['availability', 'website', 'intake'] as StepId[]) {
      const step = find(graph, id);
      expect(step?.state).toBe('locked');
      expect(step?.blockedBy).toEqual(['services']);
    }
  });

  it('unlocks a step the moment its prerequisite is complete', () => {
    const graph = resolveSetup(items(['services']), CARD);

    expect(find(graph, 'availability')?.state).not.toBe('locked');
    expect(find(graph, 'website')?.state).not.toBe('locked');
    expect(find(graph, 'intake')?.state).not.toBe('locked');
  });

  it('locks the calendar behind availability, not behind services', () => {
    // Sync blocks slots; with no slots there is nothing to protect. Services
    // alone is not enough to make it meaningful.
    const withServices = resolveSetup(items(['services']), CARD);
    expect(find(withServices, 'calendar')?.state).toBe('locked');
    expect(find(withServices, 'calendar')?.blockedBy).toEqual(['availability']);

    const withHours = resolveSetup(items(['services', 'availability']), CARD);
    expect(find(withHours, 'calendar')?.state).not.toBe('locked');
  });

  it('locks invoice details behind the business profile', () => {
    const graph = resolveSetup(items(), CARD);
    expect(find(graph, 'invoicing')?.blockedBy).toEqual(['profile']);
  });

  it('never locks payments — Stripe connects on its own', () => {
    // Deliberate: blocking this would be the graph being wrong in public.
    const graph = resolveSetup(items(), CARD);
    expect(find(graph, 'payments')?.state).not.toBe('locked');
  });

  it('never locks design — a site publishes fine on the stock theme', () => {
    const graph = resolveSetup(items(), CARD);
    expect(find(graph, 'design')?.state).not.toBe('locked');
  });
});

describe('[smoke] setup graph — what to do next', () => {
  it('offers exactly one next step across the whole graph', () => {
    const graph = resolveSetup(items(), CARD);
    const next = allSteps(graph).filter(step => step.state === 'next');

    expect(next).toHaveLength(1);
    expect(next[0].item.id).toBe('services');
  });

  it('moves next along as steps are completed, skipping locked ones', () => {
    // Payments is a choice — a business can invoice by hand — so the next
    // compulsory thing after hours is giving clients a way to book.
    const graph = resolveSetup(items(['services', 'availability']), CARD);
    expect(nextStep(graph)?.item.id).toBe('website');
  });

  it('finishes the mandatory path before offering anything optional', () => {
    // Walking each trunk step with its branches would offer the booking form
    // before the next required step — the exact confusion the trunk removes.
    const graph = resolveSetup(items(['services']), CARD);
    expect(nextStep(graph)?.item.id).toBe('availability');
  });

  it('offers an optional step only once nothing mandatory is left', () => {
    // Cash in the room: nothing about money is compulsory, so once the three
    // always-required steps are done the next suggestion is optional work.
    const graph = resolveSetup(items(['services', 'availability', 'website']), OFFLINE);
    expect(nextStep(graph)?.item.id).toBe('intake');
  });

  it('offers nothing to do when everything is complete', () => {
    const graph = resolveSetup(items(ALL_STEP_IDS));
    expect(nextStep(graph)).toBeNull();
    expect(graph.allDone).toBe(graph.allTotal);
  });

  it('never offers a locked step as the next move', () => {
    const graph = resolveSetup(items(), CARD);
    expect(nextStep(graph)?.state).toBe('next');
    expect(nextStep(graph)?.blockedBy).toEqual([]);
  });
});

describe('[smoke] setup graph — compulsory is conditional', () => {
  it('leaves invoice details optional while no money can move', () => {
    const graph = resolveSetup(items(['services', 'availability', 'website']), OFFLINE);

    expect(find(graph, 'invoicing')).toBeUndefined();
    expect(find(graph, 'profile')?.mandatory).toBe(false);
    expect(isReadyForClients(graph)).toBe(true);
  });

  it('makes invoice details compulsory the moment payments are connected', () => {
    // Money is moving, and an invoice with no company name or tax id on it is
    // not a valid document. A single `required` flag set when the item was
    // built cannot express this — which is why the graph decides it.
    const graph = resolveSetup(items(['services', 'availability', 'website', 'payments']), CARD);

    expect(find(graph, 'invoicing')?.mandatory).toBe(true);
    expect(find(graph, 'profile')?.mandatory).toBe(true);
    // And the business is no longer "ready" until they are filled in.
    expect(isReadyForClients(graph)).toBe(false);
    expect(graph.blocking.map(step => step.item.id)).toEqual(['profile', 'invoicing']);
  });

  it('reports ready once everything compulsory is done', () => {
    const graph = resolveSetup(
      items(['services', 'availability', 'website', 'payments', 'profile', 'invoicing'])
    );

    expect(isReadyForClients(graph)).toBe(true);
    // Optional work outstanding never makes the system "not ready".
    expect(find(graph, 'calendar')?.state).not.toBe('done');
  });

  it('suggests the newly compulsory step ahead of any optional one', () => {
    const graph = resolveSetup(items(['services', 'availability', 'website', 'payments']), CARD);
    expect(nextStep(graph)?.item.id).toBe('profile');
  });
});

describe('[smoke] setup graph — a lock is a redirect, not a dead end', () => {
  it('points a locked step at the step that is blocking it', () => {
    const graph = resolveSetup(items(), CARD);
    const availability = find(graph, 'availability')!;

    expect(blockerFor(availability, graph)?.item.id).toBe('services');
  });

  it('has no blocker to point at once the step is unlocked', () => {
    const graph = resolveSetup(items(['services']), CARD);
    const availability = find(graph, 'availability')!;

    expect(blockerFor(availability, graph)).toBeNull();
  });
});

/** The two channel connections, which replaced a single 'channels' step. */
const CHANNEL_STEPS = ['meta_insights', 'google_analytics'] as const;

describe('[smoke] setup graph — shape', () => {
  it('keeps a step the graph has never heard of rather than dropping it', () => {
    // The failure this guards: an id with no entry in the UI's own maps was
    // rendered as the raw string "design" on the dashboard.
    const withStranger = [...items(), {
      id: 'newthing',
      title: 'New thing',
      description: '',
      completed: false,
    }];

    const graph = resolveSetup(withStranger, CARD);
    const stranger = find(graph, 'newthing');

    expect(stranger).toBeDefined();
    expect(stranger?.state).not.toBe('locked');
    // Never smuggled into the compulsory set.
    expect(stranger?.mandatory).toBe(false);
  });

  it('leaves out a step the dashboard could not compute rather than showing it unfinished', () => {
    // An absent item means "not known", never "outstanding" — the same rule
    // profile_readiness follows in the stats route.
    const graph = resolveSetup(items([], ['services', 'availability']), CARD);

    expect(find(graph, 'payments')).toBeUndefined();
    expect(allSteps(graph).map(step => step.item.id)).toEqual(['services', 'availability']);
  });

  it('counts compulsory work separately from everything else', () => {
    const graph = resolveSetup(items(['services', 'availability']), CARD);

    expect(graph.mandatoryDone).toBe(2);
    // services, hours, a way to book, Stripe, business details.
    //
    // Not invoice details: nothing this business sells is billed afterwards,
    // and bank details exist to tell a client where to send a transfer. A card
    // business is still offered the step, it is simply not owed it.
    expect(graph.mandatoryTotal).toBe(5);
    expect(graph.allDone).toBe(2);
    expect(graph.allTotal).toBe(9);
  });

  it('keeps optional work next to the step it belongs to', () => {
    // An intake form belongs to services, a calendar to your hours. Scattering
    // them by their own dependencies is what made the chain read as nine
    // unrelated dots.
    const order = allSteps(resolveSetup(items(), CARD)).map(step => step.item.id);

    expect(order.indexOf('intake')).toBe(order.indexOf('services') + 1);
    expect(order.indexOf('calendar')).toBe(order.indexOf('availability') + 1);
    expect(order.indexOf('design')).toBe(order.indexOf('website') + 1);
    expect(order.indexOf('invoicing')).toBe(order.indexOf('payments') + 2);
  });

  it('offers Meta and Google to every business, including one that declined them', () => {
    // Two steps, not one: a Meta login brings Facebook and its linked Instagram
    // together, a Google one covers Analytics and the listing. Combined, the row
    // could not say which of the two was still outstanding — the only thing it
    // is there to say.
    //
    // And the channels CARD is gated on the onboarding answer while these STEPS
    // are not. That answer said what the business wanted on day one; it is not a
    // permanent ruling, and someone who starts advertising on Instagram in week
    // six needs the way back in.
    for (const id of ['meta_insights', 'google_analytics'] as const) {
      const node = SETUP_STEPS.find(step => step.id === id);
      expect(node).toBeDefined();
      expect(node!.requires).toEqual([]);
      expect(node!.mandatory).toBe('optional');
      // No `applies` rule at all: nothing about the shape of a business can
      // remove these steps.
      expect(node!.applies).toBeUndefined();
    }
  });

  it('never lets Meta or Google block another step', () => {
    // A business takes a client end to end without connecting either. If one
    // were ever a prerequisite it could lock the chain over something purely
    // informational.
    for (const node of SETUP_STEPS) {
      expect(node.requires).not.toContain('meta_insights');
      expect(node.requires).not.toContain('google_analytics');
    }
  });

  it('declares no dependency on a step that is not in the graph', () => {
    const known = new Set(SETUP_STEPS.map(node => node.id));

    for (const node of SETUP_STEPS) {
      for (const requirement of node.requires) {
        expect(known.has(requirement)).toBe(true);
      }
      if (node.mandatory && typeof node.mandatory === 'object') {
        // Narrowed explicitly: `mandatory` is a boolean OR a { once } object,
        // and the boolean arm leaves nothing to look up.
        expect(known.has((node.mandatory as { once: StepId }).once)).toBe(true);
      }
      if (node.belongsTo) expect(known.has(node.belongsTo)).toBe(true);
    }
  });

  it('declares no dependency on a step that comes later', () => {
    // A prerequisite the user meets after the step that needs it would lock a
    // node that can never open in the order the chain presents.
    const order = SETUP_STEPS.map(node => node.id);

    for (const node of SETUP_STEPS) {
      for (const requirement of node.requires) {
        expect(order.indexOf(requirement)).toBeLessThan(order.indexOf(node.id));
      }
    }
  });
});

describe('[smoke] setup graph — how the money is collected', () => {
  it('never shows a card processor to a business that invoices', () => {
    // The scenario the old model could not express at all: a price was read as
    // "needs Stripe", so someone taking bank transfers was asked to hand over
    // an ID for an account they will never use.
    const graph = resolveSetup(items(), INVOICE);

    expect(find(graph, 'payments')).toBeUndefined();
    expect(find(graph, 'invoicing')?.mandatory).toBe(true);
    expect(find(graph, 'profile')?.mandatory).toBe(true);
  });

  it('requires nothing about money from a business paid in person', () => {
    const graph = resolveSetup(items(), OFFLINE);

    expect(find(graph, 'payments')).toBeUndefined();
    expect(find(graph, 'invoicing')).toBeUndefined();
    expect(graph.blocking.map(step => step.item.id)).toEqual(['services', 'availability', 'website']);
  });

  it('offers a card processor to a mixed business without demanding it', () => {
    const graph = resolveSetup(items(), {
      hasPricedServices: true, collection: 'mixed', appointments: true, collectsOnline: true, invoices: true, presence: 'full_website', plans: 'none',
    });

    // Demanded, not merely offered. 'mixed' used to mean "cards are possible";
    // now it means these particular services are collected by card, and those
    // services cannot charge anybody until the processor is connected.
    expect(find(graph, 'payments')).toBeDefined();
    expect(find(graph, 'payments')?.mandatory).toBe(true);
    // And the paperwork too, because the other half is billed afterwards.
    expect(find(graph, 'invoicing')?.mandatory).toBe(true);
  });

  it('always requires a way to book, whatever they said about websites', () => {
    // Declining a website is a choice about the shape of the thing, not about
    // whether clients can reach them.
    for (const shape of [CARD, INVOICE, OFFLINE]) {
      const graph = resolveSetup(items(), shape);
      expect(find(graph, 'website')?.mandatory).toBe(true);
    }
  });
});

describe('[smoke] setup graph — mid-conversation', () => {
  it('draws what it has not asked about as a ghost rather than guessing', () => {
    // The onboarding panel resolves the same graph before the money question
    // has been asked. Nothing about money may be claimed either way.
    const graph = resolveSetup(items(), UNKNOWN_SHAPE);

    expect(find(graph, 'payments')?.state).toBe('ghost');
    expect(find(graph, 'invoicing')?.state).toBe('ghost');
    // What does not depend on the answer is still knowable.
    expect(find(graph, 'services')?.state).toBe('next');
  });

  it('never counts a ghost as outstanding work', () => {
    const graph = resolveSetup(items(), UNKNOWN_SHAPE);

    expect(graph.blocking.some(step => step.state === 'ghost')).toBe(false);
    expect(graph.yours.some(step => step.state === 'ghost')).toBe(false);
  });

  it('resolves a ghost the moment the question is answered', () => {
    const before = resolveSetup(items(), UNKNOWN_SHAPE);
    const after = resolveSetup(items(), CARD);

    expect(find(before, 'payments')?.state).toBe('ghost');
    expect(find(after, 'payments')?.state).not.toBe('ghost');
  });
});

describe('[smoke] setup graph — who can do the work', () => {
  it('marks the steps that need the person themselves', () => {
    // Stripe wants an ID and a bank account, Google wants consent in their own
    // account, a tax id is theirs to type. The chat must not promise to build
    // any of these.
    const graph = resolveSetup(items(), CARD);

    expect(find(graph, 'payments')?.owner).toBe('user');
    expect(find(graph, 'profile')?.owner).toBe('user');
    expect(find(graph, 'invoicing')?.owner).toBe('user');
    expect(find(graph, 'calendar')?.owner).toBe('user');
  });

  it('marks the steps the platform provisions', () => {
    const graph = resolveSetup(items(), CARD);

    for (const id of ['services', 'availability', 'website', 'design', 'intake'] as StepId[]) {
      expect(find(graph, id)?.owner).toBe('platform');
    }
  });

  it('counts the outstanding work that only the person can do', () => {
    // The number the onboarding chat promises: "I will build four, one is yours".
    const graph = resolveSetup(items(['services', 'availability', 'website']), INVOICE);

    expect(graph.yours.map(step => step.item.id)).toEqual(['profile', 'invoicing']);
  });
});

describe('[smoke] setup graph — reading the profile', () => {
  it('reads the explicit collection method once the chat asks it', () => {
    const shape = shapeFromProfile({ collection_method: 'invoice', online_presence_mode: 'booking_only' });

    expect(shape.collection).toBe('invoice');
    expect(shape.presence).toBe('booking_only');
  });

  it('reads across from payment_mode for accounts that predate the question', () => {
    // upfront meant cards; invoicing and installments meant a document.
    expect(shapeFromProfile({ payment_mode: 'upfront' }).collection).toBe('card_online');
    expect(shapeFromProfile({ payment_mode: 'invoicing' }).collection).toBe('invoice');
    expect(shapeFromProfile({ payment_mode: 'installments' }).collection).toBe('invoice');
    expect(shapeFromProfile({ payment_mode: 'none' }).collection).toBe('none');
  });

  it('says it does not know rather than guessing', () => {
    expect(shapeFromProfile({}).collection).toBeNull();
    expect(shapeFromProfile({ online_presence_mode: 'nonsense' }).presence).toBeNull();
  });
});

describe('[smoke] setup graph — payment plans', () => {
  it('never makes a card processor compulsory just because a plan exists', () => {
    // Instalments are a schedule, not a payment method. A business that
    // invoices for a living can issue one invoice per instalment and take a
    // transfer for each, and should not be sent through an identity check for
    // an account it will not use.
    for (const plans of ['manual', 'automatic'] as const) {
      const graph = resolveSetup(items(), { ...INVOICE, plans });
      expect(find(graph, 'payments')?.mandatory).not.toBe(true);
    }
  });

  it('shows no processor at all to a business that invoices, plan or no plan', () => {
    // One question decides whether a card processor is part of this business's
    // setup: how the money reaches them. Nothing else may pull it in.
    for (const plans of ['none', 'manual', 'automatic'] as const) {
      const graph = resolveSetup(items(), { ...INVOICE, plans });
      expect(find(graph, 'payments')).toBeUndefined();
    }
  });

  it('makes the invoice paperwork real even for a business paid in person', () => {
    // A plan is money moving on a schedule. Someone taking cash in the room who
    // then offers "six monthly payments" has agreements to document.
    const graph = resolveSetup(items(), { ...OFFLINE, plans: 'manual' });

    expect(find(graph, 'invoicing')?.mandatory).toBe(true);
    expect(find(graph, 'profile')?.mandatory).toBe(true);
  });

  it('leaves everything about money alone when no service has a plan', () => {
    const graph = resolveSetup(items(), { ...OFFLINE, plans: 'none' });

    expect(find(graph, 'payments')).toBeUndefined();
    expect(find(graph, 'invoicing')).toBeUndefined();
  });
});

describe('[smoke] setup graph — what the services say', () => {
  // Booking and payment belong to a service, not to a business. These are the
  // three shapes the design was checked against, and the point of each is what
  // the setup does NOT ask for.

  it('asks an appointments-and-cards business for hours and a processor', () => {
    // A practice selling a paid session, a paid download and a free intro call.
    const graph = resolveSetup(items(), {
      hasPricedServices: true,
      collection: null,
      appointments: true,
      collectsOnline: true,
      invoices: false,
      presence: 'booking_only',
      plans: 'none',
    });

    expect(find(graph, 'availability')?.mandatory).toBe(true);
    expect(find(graph, 'payments')?.mandatory).toBe(true);
    // Nothing is billed afterwards, so bank details are offered, not owed.
    expect(find(graph, 'invoicing')?.mandatory).toBe(false);
  });

  it('never mentions a card processor to a business that invoices for everything', () => {
    // A consultancy: two appointments, both billed against an invoice.
    const graph = resolveSetup(items(), {
      hasPricedServices: true,
      collection: null,
      appointments: true,
      collectsOnline: false,
      invoices: true,
      presence: 'booking_only',
      plans: 'none',
    });

    expect(find(graph, 'availability')?.mandatory).toBe(true);
    expect(find(graph, 'payments')).toBeUndefined();
    expect(find(graph, 'invoicing')?.mandatory).toBe(true);
    expect(find(graph, 'profile')?.mandatory).toBe(true);
  });

  it('draws no calendar at all for a business that sells only products', () => {
    // Digital downloads: nothing is booked against a time, so working hours are
    // not a step this business has left to do — they are a step it never had.
    const graph = resolveSetup(items(), {
      hasPricedServices: true,
      collection: null,
      appointments: false,
      collectsOnline: true,
      invoices: false,
      presence: 'booking_only',
      plans: 'none',
    });

    expect(find(graph, 'availability')).toBeUndefined();
    expect(find(graph, 'calendar')).toBeUndefined();
    expect(find(graph, 'payments')?.mandatory).toBe(true);
  });

  it('demands nothing new from an account that has not said yet', () => {
    // Everything unknown: the chat draws ghosts rather than guessing, and no
    // step becomes compulsory on the strength of an assumption.
    const graph = resolveSetup(items(), UNKNOWN_SHAPE);

    expect(find(graph, 'availability')?.mandatory).toBe(false);
    expect(find(graph, 'payments')?.mandatory).toBe(false);
  });
});
