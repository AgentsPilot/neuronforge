import {
  resolveSetup,
  nextStep,
  blockerFor,
  allSteps,
  isReadyForClients,
  shapeFromProfile,
  sellsAnything,
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

/**
 * A website and a contact form, and nothing for sale.
 *
 * The shape `OnboardingConfigurationService` writes when an owner answers "none"
 * to the services count: presence stored, both money predicates false, no
 * appointments. Everything else about it is silence, which is exactly why the
 * presence answer is what makes it a decision rather than an empty account.
 */
const WEBSITE_ONLY: BusinessShape = { hasPricedServices: false, collection: 'none', appointments: false, collectsOnline: false, invoices: false, presence: 'website_only', plans: 'none' };

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

    /* `availability` was in this list until 2026-10-26, when its dependency on
       `services` was removed: the two formed a circle with the publish gate —
       hours were needed to publish a service, and services had to be done
       before hours could be set. `website` and `intake` genuinely do wait for a
       service, so they carry the case. */
    for (const id of ['website', 'intake'] as StepId[]) {
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
    /* `availability` since 2026-10-26, when the catalogue moved to the end of
       the graph: the suggestion is the first compulsory ready step in array
       order, and pointing a new account at services before it has hours, a tax
       id or a bank account pointed it at the one task it could not finish —
       `active_services_count` counts a service only once it is PUBLISHED, and
       publishing is refused until those exist. */
    expect(next[0].item.id).toBe('availability');
  });

  it('moves next along as steps are completed, skipping locked ones', () => {
    /*
     * Payments is a choice — a business can invoice by hand — so it is skipped.
     * What comes next is the PAPERWORK, not the publish.
     *
     * This used to expect 'website', and the order it was asserting was the
     * bug: publishing a page then REFUSED for a business with no working hours
     * and no invoice details, so naming the publish first sent owners to a
     * screen that turned them away for things nobody had asked them for yet.
     * Hours, then how you get paid, then open the doors.
     *
     * Publishing no longer refuses — a site may be a contact form and nothing
     * else, and the unready services simply do not render. So this order is
     * now ADVICE rather than a door, and it is still the right advice: a page
     * that goes live with its catalogue missing is not what the owner meant.
     */
    const graph = resolveSetup(items(['services', 'availability']), CARD);
    expect(nextStep(graph)?.item.id).toBe('profile');
  });

  it('offers the publish last, once the page would go live with its catalogue', () => {
    // The same account with its paperwork done. `website` is what is left, and
    // now it is a step that publishes a page with its services actually on it.
    const graph = resolveSetup(
      items(['services', 'availability', 'profile', 'invoicing']),
      CARD
    );
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
    /* `calendar` since the catalogue moved to the end: it belongs to
       `availability` and so now precedes `intake`, which belongs to services.
       The behaviour under test is "optional only after mandatory", and that is
       unchanged — only which optional step comes first. */
    expect(nextStep(graph)?.item.id).toBe('calendar');
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
    /* `intake`, not `availability`: hours no longer wait for a service — see
       the note on the list above. The behaviour under test is unchanged, only
       the step that illustrates it. */
    const intake = find(graph, 'intake')!;

    expect(blockerFor(intake, graph)?.item.id).toBe('services');
  });

  it('has no blocker to point at once the step is unlocked', () => {
    const graph = resolveSetup(items(['services']), CARD);
    const availability = find(graph, 'availability')!;

    expect(blockerFor(availability, graph)).toBeNull();
  });
});

/** The two channel connections, which replaced a single 'channels' step. */
const CHANNEL_STEPS = ['meta_insights', 'google_business'] as const;

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
    /* Hours first since the catalogue moved to the end of the graph. The set is
       unchanged; only the order is. */
    expect(allSteps(graph).map(step => step.item.id)).toEqual(['availability', 'services']);
  });

  it('counts compulsory work separately from everything else', () => {
    const graph = resolveSetup(items(['services', 'availability']), CARD);

    expect(graph.mandatoryDone).toBe(2);
    /*
     * services, hours, a way to book, business details, invoice details.
     *
     * Stripe is NOT among them, though this business means to take cards. A
     * missing processor does not stop it trading: the client books straight
     * through and the booking is billed by invoice instead. `journeyReadiness`
     * has always treated the processor as non-blocking for that reason, and the
     * graph now agrees with it.
     *
     * Invoice details ARE owed, and this once said they were not — on the
     * reasoning that nothing this business sells is billed afterwards. That
     * holds only once a processor is live. Until Stripe is connected, a priced
     * service set to collect by card falls back to being INVOICED, so the
     * paperwork is the only way this business gets paid. It is the fallback
     * that makes the processor optional, which is exactly why it cannot be.
     */
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
    for (const id of ['meta_insights', 'google_business'] as const) {
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
      expect(node.requires).not.toContain('google_business');
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
    /* Same three, in the order the graph now presents them: hours, then the
       catalogue, then the page that publishes it. */
    expect(graph.blocking.map(step => step.item.id)).toEqual(['availability', 'services', 'website']);
  });

  it('offers a card processor to a mixed business without demanding it', () => {
    const graph = resolveSetup(items(), {
      hasPricedServices: true, collection: 'mixed', appointments: true, collectsOnline: true, invoices: true, presence: 'full_website', plans: 'none',
    });

    // Offered, not demanded — which is what this test has always been called.
    // 'mixed' means these particular services are collected by card, so the
    // processor is worth showing; but until it exists they are invoiced like
    // everything else, and the business trades perfectly well without it.
    expect(find(graph, 'payments')).toBeDefined();
    expect(find(graph, 'payments')?.mandatory).toBe(false);
    // The paperwork is the half that IS demanded: it is the route the money
    // actually takes while there is no processor.
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

  it('asks an appointments-and-cards business for hours, and offers a processor', () => {
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
    // Shown, because they said they want cards. Not demanded, because they can
    // invoice until the processor is connected.
    expect(find(graph, 'payments')).toBeDefined();
    expect(find(graph, 'payments')?.mandatory).toBe(false);
    /*
     * Owed, though nothing here is billed afterwards BY CHOICE.
     *
     * `payments` is not complete in this graph — Stripe is wanted and not yet
     * connected — and until it is, every priced service is invoiced whatever it
     * was set to collect. Calling the details optional here would have the
     * chain say "not needed" about the one thing standing between this business
     * and being paid, while the publish gate refuses the page for want of it.
     */
    expect(find(graph, 'invoicing')?.mandatory).toBe(true);
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
    // Offered to a business selling by card, never compulsory for one.
    expect(find(graph, 'payments')).toBeDefined();
    expect(find(graph, 'payments')?.mandatory).toBe(false);
  });

  it('demands nothing new from an account that has not said yet', () => {
    // Everything unknown: the chat draws ghosts rather than guessing, and no
    // step becomes compulsory on the strength of an assumption.
    const graph = resolveSetup(items(), UNKNOWN_SHAPE);

    expect(find(graph, 'availability')?.mandatory).toBe(false);
    expect(find(graph, 'payments')?.mandatory).toBe(false);
  });
});

/**
 * A business that invoices for everything is never shown a card processor, so
 * the payments step is absent by design — and the two steps that hang off it in
 * the readiness card must still be reachable.
 *
 * The card nests by `belongsTo`, which silently dropped them: it said "you
 * cannot send invoices" and offered nothing to click. Nesting is presentation;
 * it must never remove a step from the list.
 */
describe('a step whose parent does not apply', () => {
  const graph = resolveSetup(items(), INVOICE);
  const steps = allSteps(graph);
  const ids = steps.map(step => step.item.id);

  it('leaves payments out for a business that never takes a card', () => {
    expect(ids).not.toContain('payments');
  });

  it('still carries the invoice and company steps', () => {
    expect(ids).toContain('invoicing');
    expect(ids).toContain('profile');
  });

  it('and they are what the card must draw at the top level', () => {
    const present = new Set(ids);
    const topLevel = steps
      .filter(step => !step.belongsTo || !present.has(step.belongsTo))
      .map(step => step.item.id);

    expect(topLevel).toContain('invoicing');
    expect(topLevel).toContain('profile');
  });
});

/**
 * The Google listing is listed, but never the thing to do next.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `suggested` falls through to the first ready step in graph order, and the
 * two third-party channel steps sit last. So a business that had finished
 * everything real was told its next move was connecting an account in somebody
 * else's product, which nothing here can create: a dead end for anyone who
 * does not already hold one.
 *
 * Removing the row was the wrong fix. The chain is the one place that lists
 * what is still configurable, so someone who acquires analytics in week six
 * needs it there. It stops being presented as work; it does not disappear.
 * ───────────────────────────────────────────────────────────────────────────
 */
describe('third-party channels are offered, not pressed', () => {
  const WITH_GA: StepId[] = [...ALL_STEP_IDS, 'google_business', 'meta_insights'];

  it('is never the suggested next move, even when it is all that is left', () => {
    const graph = resolveSetup(items(ALL_STEP_IDS, WITH_GA), CARD);

    expect(nextStep(graph)).toBeNull();
  });

  it('is still listed, so there is a way in later', () => {
    const graph = resolveSetup(items(ALL_STEP_IDS, WITH_GA), CARD);

    expect(find(graph, 'google_business')).toBeDefined();
  });

  it('is actionable rather than locked or hidden', () => {
    /*
     * 'ready' and not 'next': reachable whenever the user wants it, never
     * put in front of them. A locked or absent row would be the old bug in a
     * different costume.
     */
    const graph = resolveSetup(items(ALL_STEP_IDS, WITH_GA), CARD);

    expect(find(graph, 'google_business')?.state).toBe('ready');
  });

  it('does not displace real work from the suggestion', () => {
    /*
     * The flag must not change which step IS suggested while anything else is
     * outstanding — only what happens once nothing else is.
     */
    const graph = resolveSetup(items([], WITH_GA), CARD);

    /* `availability`, for the same reason as the suggestion test above: real
       work still wins over a third-party channel, and the first piece of real
       work is now hours rather than the catalogue. */
    expect(nextStep(graph)?.item.id).toBe('availability');
  });

  it('applies to meta as well, which has the same shape', () => {
    /*
     * A Facebook Page or Instagram account is equally not ours to create, and
     * it sat second-to-last in graph order — so it took over as the suggested
     * next move the moment the Google row stopped being one. Fixing only the
     * last step would have moved the problem up by one row.
     */
    const graph = resolveSetup(items(ALL_STEP_IDS, WITH_GA), CARD);

    expect(find(graph, 'meta_insights')?.state).toBe('ready');
    expect(nextStep(graph)).toBeNull();
  });

  it('shows as done once connected', () => {
    const graph = resolveSetup(items([...ALL_STEP_IDS, 'google_business'], WITH_GA), CARD);

    expect(find(graph, 'google_business')?.state).toBe('done');
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A BUSINESS THAT SELLS NOTHING IS NOT A BUSINESS WITH WORK OUTSTANDING.
 *
 * The setup checklist built all six steps unconditionally and filtered them on
 * `complete` alone, so a website-and-CRM business was told forever to add
 * services, set working hours and connect a card processor — three items it had
 * declined, with no action anywhere that would ever clear them. A checklist
 * with permanent entries is one people stop reading.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a business that sells nothing through the platform', () => {
  it('is asked for no catalogue, no hours and no processor', () => {
    const graph = resolveSetup(items([]), WEBSITE_ONLY);
    const ids = allSteps(graph).map(step => step.item.id);

    expect(ids).not.toContain('services');
    expect(ids).not.toContain('availability');
    expect(ids).not.toContain('payments');
  });

  it('is still offered the website and its design, which is what it came for', () => {
    const graph = resolveSetup(items([]), WEBSITE_ONLY);
    const ids = allSteps(graph).map(step => step.item.id);

    expect(ids).toContain('website');
    expect(ids).toContain('design');
  });

  /*
   * The regression this rule is most likely to cause, and the reason
   * `sellsAnything` answers TRUE rather than null when undecided: `services` is
   * the step that ANSWERS the question. Ghosting it until the shape knows
   * whether anything is sold would mean never showing the step that settles it.
   */
  it('still asks everyone else, including an account nobody has described yet', () => {
    expect(sellsAnything(UNKNOWN_SHAPE)).toBe(true);
    expect(sellsAnything(CARD)).toBe(true);
    expect(sellsAnything(INVOICE)).toBe(true);
    expect(sellsAnything(OFFLINE)).toBe(true);
  });

  /*
   * A free service is a service. It is booked against a time, it needs hours
   * and reminders, and it raises no invoice — so the money half is false and
   * the booking half is not, which is the whole distinction.
   */
  it('does not mistake a free catalogue for an empty one', () => {
    const freeOnly: BusinessShape = {
      hasPricedServices: false,
      collection: 'none',
      appointments: true,
      collectsOnline: false,
      invoices: false,
      presence: 'website_only',
      plans: 'none',
    };

    expect(sellsAnything(freeOnly)).toBe(true);
    expect(allSteps(resolveSetup(items([]), freeOnly)).map(s => s.item.id)).toContain('services');
  });
});

/**
 * The deadlock a real signup hit on 2026-10-26.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three true statements that together left a new account with nowhere to go:
 *
 *   · the dashboard counts `services` done only when one is PUBLISHED
 *     (`active_services_count` filters `status = 'active'`)
 *   · publishing a scheduled service is refused while `hours` is missing —
 *     `journeyReadiness` makes it a blocking gap
 *   · `availability` required `services`
 *
 * The owner saw "Add services", with "Set availability · After Services"
 * beneath it, and could complete neither. The onboarding build screen had the
 * opposite — and correct — order all along, so the two surfaces contradicted
 * each other.
 *
 * This guards the direction, not the wording: hours must be reachable before
 * anything has been published.
 */
describe('[smoke] setup graph — hours are reachable before a service exists', () => {
  it('does not lock availability behind services', () => {
    const graph = resolveSetup(items(), CARD);
    const availability = find(graph, 'availability');

    expect(availability?.blockedBy).not.toContain('services');
    expect(availability?.state).not.toBe('locked');
  });

  it('leaves nothing in the chain waiting on a service to set hours', () => {
    /*
     * The circle, stated as a reachability check rather than as one edge: from
     * a standing start — no services, no hours — at least one mandatory step
     * the OWNER can act on must be open. A graph where every compulsory step is
     * locked is a graph with no way in, whatever the individual edges say.
     */
    const graph = resolveSetup(items(), CARD);
    /* `next` counts as open: it is the suggested one of the ready steps, so
       filtering on `ready` alone silently excludes the very step the graph is
       pointing at. */
    const open = allSteps(graph).filter(
      step => step.mandatory && (step.state === 'ready' || step.state === 'next')
    );

    expect(open.length).toBeGreaterThan(0);
    expect(open.map(step => step.item.id)).toEqual(expect.arrayContaining(['availability']));
  });
});
