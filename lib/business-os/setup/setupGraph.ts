/**
 * What has to be configured, in what order, and what hangs off what.
 *
 * The readiness card used to carry one notion of importance: `required: boolean`.
 * That is the wrong model, and a non-technical user feels it. "Required" is not a
 * property of a step — it is a property of a step *relative to an outcome*.
 * Services are not required in the abstract; they are required to take a booking,
 * to sell anything on the website, and to put a line on an invoice. Availability
 * without services is an open hour with nothing to book.
 *
 * The shape the user has to understand is a road with turnings: **one chain of
 * mandatory steps**, and off each of them the optional work that belongs to it.
 * A booking form belongs to services. A calendar belongs to your hours. Invoice
 * details belong to getting paid. Nobody has to hold four separate lists in their
 * head — they follow the trunk, and the branches are clearly beside it.
 *
 * Nothing here knows about React, fetching or copy — labels are i18n keys resolved
 * by whoever renders them, which is what makes this testable as a table of
 * expectations. Same family as profileReadiness.ts and funnelGap.ts.
 */

/** Every step the dashboard can compute. Ids match `SetupItem.id`. */
export type StepId =
  | 'services'
  | 'availability'
  | 'design'
  | 'website'
  | 'payments'
  | 'profile'
  | 'invoicing'
  | 'calendar'
  | 'intake'
  | 'service_descriptions'
  | 'meta_insights'
  | 'google_analytics';


/**
 * What the onboarding chat learned about how this business actually runs.
 *
 * Three answers decide the whole of configuration, and the chat already
 * produces two of them. `collection` is the one it currently guesses: today a
 * price is read as "needs Stripe", which has no way to express the most
 * ordinary arrangement there is — I charge money, and I collect it myself.
 *
 * Every field may be `null`, meaning "not asked yet". That is what lets the
 * chat panel resolve the same graph mid-conversation and draw the steps it does
 * not know about yet as ghosts rather than guessing at them.
 */
export interface BusinessShape {
  /** Any service costs money. */
  hasPricedServices: boolean | null;
  /** How the money reaches them. */
  collection: CollectionMethod | null;
  /**
   * Read off the services rather than asked, because none of these is a
   * property of the business.
   *
   * One practice sells a ₪250 appointment paid by card, a ₪80 download paid by
   * card, a ₪6,000 programme billed against an invoice and a free intro call.
   * Working hours matter to three of those, a card processor to two, and
   * company and bank details to one — and a single business-wide answer got
   * every one of them wrong for somebody.
   */
  /** Some service is booked against a time. */
  appointments: boolean | null;
  /** Some priced service is collected by card at the moment of booking. */
  collectsOnline: boolean | null;
  /** Some priced service is billed afterwards. */
  invoices: boolean | null;
  /** What the chat agreed about being findable online. */
  presence: PresenceMode | null;
  /**
   * Payment plans defined on services — "3 monthly payments of ₪200".
   *
   * Says nothing about how the instalments are collected: each one can be
   * invoiced and paid by transfer just as easily as charged to a card. What it
   * does say is that money moves on a schedule, which makes the invoice
   * paperwork real, and that automatic charging is worth offering.
   */
  plans: PlanKind | null;
}

export type PlanKind =
  /** No payment plan on any service. */
  | 'none'
  /** Plans exist, and the business collects each instalment itself. */
  | 'manual'
  /** Plans exist that are set up to charge automatically, which needs Stripe —
   *  a choice the business makes, never one having a plan makes for it. */
  | 'automatic';

export type CollectionMethod =
  /** They pay by card at booking — needs a processor. */
  | 'card_online'
  /** An invoice goes out; they transfer, or call with a card. No processor. */
  | 'invoice'
  /** Cash or card in the room. Nothing to configure. */
  | 'in_person'
  /** Both, depending on the client. */
  | 'mixed'
  /** Nothing is charged. */
  | 'none';

export type PresenceMode = 'full_website' | 'website_only' | 'booking_only' | 'none';

/** Nothing known yet — every rule that needs an answer waits rather than guesses. */
export const UNKNOWN_SHAPE: BusinessShape = {
  hasPricedServices: null,
  collection: null,
  appointments: null,
  collectsOnline: null,
  invoices: null,
  presence: null,
  plans: null,
};

/** Money can move, so documents about it have to be real documents. */
function moneyMoves(shape: BusinessShape): boolean | null {
  // A payment plan is money moving on a schedule, whoever collects it — so the
  // paperwork is required even for a business that told us it takes cash.
  if (shape.plans === 'manual' || shape.plans === 'automatic') return true;

  const online = collectsOnline(shape);
  const billed = invoices(shape);
  if (online === true || billed === true) return true;
  if (online === null && billed === null) return null;
  return false;
}

/**
 * Does this business need a card processor?
 *
 * Only one answer requires one: cards taken at booking. A payment plan does
 * NOT — instalments are a schedule, not a payment method, and a business can
 * perfectly well issue an invoice per instalment and take a bank transfer for
 * each. Stripe is how the platform can charge those automatically, which is a
 * convenience worth offering and never a condition of having a plan.
 *
 * An earlier version required it whenever a plan existed. That read the
 * automation as the feature, forced an identity check on businesses that
 * invoice for a living, and would have been wrong for most of them.
 */
function collectsOnline(shape: BusinessShape): boolean | null {
  // The per-service answer wins wherever it exists. `collection` is the older
  // business-wide summary, kept only so an account whose services predate the
  // per-service columns still resolves — and `!= null` rather than `!== null`
  // on purpose, because a caller that has never heard of these fields leaves
  // them undefined rather than null.
  if (shape.collectsOnline != null) return shape.collectsOnline;
  if (shape.collection == null) return null;
  return shape.collection === 'card_online' || shape.collection === 'mixed';
}

function invoices(shape: BusinessShape): boolean | null {
  if (shape.invoices != null) return shape.invoices;
  if (shape.collection == null) return null;
  return shape.collection === 'invoice' || shape.collection === 'mixed';
}

/**
 * Whether real invoice paperwork is owed.
 *
 * Either something is billed afterwards, or money moves on a schedule — a
 * payment plan is a series of bills whoever ends up collecting them, so the
 * document has to be a real document even for a business paid in cash.
 */
function needsInvoicePaperwork(shape: BusinessShape): boolean | null {
  if (shape.plans === 'manual' || shape.plans === 'automatic') return true;
  return invoices(shape);
}

/** Some service is booked against a time. Unknown until somebody says. */
function takesAppointments(shape: BusinessShape): boolean | null {
  return shape.appointments != null ? shape.appointments : null;
}

/**
 * Whether a step applies to this business at all, and whether it is compulsory.
 *
 * `null` from either means "cannot tell yet" — the chat draws a ghost, and the
 * dashboard (which always knows) never sees one.
 */
export type AppliesRule = (shape: BusinessShape) => boolean | null;
export type MandatoryRule =
  | 'always'
  | 'optional'
  | ((shape: BusinessShape, isComplete: (id: StepId) => boolean) => boolean | null);

export interface GraphNode {
  id: StepId;
  /**
   * Steps that must be complete first, and *only* those where this step would
   * otherwise be inert or wrong. An advisory relationship ("a theme improves the
   * site") belongs in copy, never here: everything listed here locks.
   */
  requires: StepId[];
  /**
   * Whether this step has to be done at all — and that is not a fixed property.
   *
   * Invoice details are optional right up until payments are connected, and
   * compulsory the moment they are: money is moving, and an invoice with no
   * company name or tax id on it is not a valid invoice. A single boolean per
   * step cannot say that, which is why this is a rule rather than a flag.
   */
  mandatory: MandatoryRule;
  /**
   * Whether this business needs the step at all. Absent means always.
   *
   * A step that does not apply is not greyed out — it is gone. A disabled
   * control is still work: the eye stops on it and the reader has to decide it
   * does not matter. Everything remains reachable in settings.
   */
  applies?: AppliesRule;
  /**
   * Who can actually do this.
   *
   * 'platform' work is provisioned during the build and the user never touches
   * it. 'user' work needs their identity, their credentials or a third party's
   * consent — Stripe wants an ID and a bank account, Google wants them to
   * approve access in their own account, a bank account number is theirs to
   * type. No amount of automation removes those, so the onboarding chat must
   * name them as theirs rather than promising to build them.
   */
  owner: 'platform' | 'user';
  /**
   * The step this one extends. Purely for reading order — an intake form belongs
   * to services, a calendar to your hours — so related steps stay adjacent in
   * the chain instead of being scattered by their own dependencies.
   */
  belongsTo?: StepId;
}

/**
 * The whole graph, in the order it is presented.
 *
 * Ordered so that no step ever appears before something it needs, and so that
 * optional work sits directly after the step it belongs to.
 */
export const SETUP_STEPS: GraphNode[] = [
  // Nothing to sell, book or invoice without these.
  { id: 'services', requires: [], owner: 'platform', mandatory: 'always' },
  // The form attaches to a service booking.
  { id: 'intake', requires: ['services'], owner: 'platform', mandatory: 'optional', belongsTo: 'services' },

  // What each service actually is, in the owner's words.
  //
  // Optional on purpose: a business with no descriptions can still take a
  // client end to end, so this must never stand between them and trading. It
  // is here because the website's copy for a service is written from its
  // description — without one the model writes a paragraph guessed from the
  // service's name, and the page reads like it was written by somebody who has
  // never met the business.
  //
  // Never asked during the onboarding chat, where speed matters more; the
  // question belongs to the dashboard, once there is a reason to answer it.
  { id: 'service_descriptions', requires: ['services'], owner: 'user', mandatory: 'optional', belongsTo: 'services' },

  // Open hours with nothing to book render an empty booking page — and hours
  // asked of a business that sells only downloads are an empty demand. Applies
  // only where some service is actually booked against a time.
  {
    id: 'availability',
    requires: ['services'],
    owner: 'platform',
    applies: shape => takesAppointments(shape),
    mandatory: shape => takesAppointments(shape),
  },
  // Sync blocks slots; with no slots there is nothing to protect. Theirs to do:
  // Google and Outlook ask them to approve access in their own account.
  {
    id: 'calendar',
    requires: ['availability'],
    owner: 'user',
    // Follows availability rather than merely depending on it. A business that
    // books nothing against a time has no slots to protect, and a node locked
    // behind a step that will never exist can never open — a permanent dead
    // end on the chain.
    applies: shape => takesAppointments(shape),
    mandatory: 'optional',
    belongsTo: 'availability',
  },

  // A way for a client to reach and book: a published site, a landing page or a
  // smart link. Any one will do — which is why the dashboard decides whether it
  // is satisfied and the graph only says it is required. Never skipped: a
  // business nobody can book is not configured, whatever it said about websites.
  { id: 'website', requires: ['services'], owner: 'platform', mandatory: 'always' },
  // A site publishes fine on the stock theme, so this never blocks — but it is
  // where the look of the site, the invoices and the emails is set.
  { id: 'design', requires: [], owner: 'platform', mandatory: 'optional', belongsTo: 'website' },

  // A card processor, and only for businesses that take cards. Someone who
  // invoices and takes a transfer should never see this step at all, let alone
  // be asked to hand Stripe their ID for an account they will not use.
  {
    id: 'payments',
    requires: [],
    owner: 'user',
    // Shown only to businesses that take cards. One question decides it — how
    // the money reaches them — and nothing else may pull a card processor into
    // the setup behind their back. A payment plan does not: instalments are a
    // schedule, and each one can be invoiced and paid by transfer.
    // Read off the services now. A practice that takes a card for a session and
    // invoices for a programme needs a processor; a consultancy that invoices
    // for everything never does, and must not be asked to hand Stripe its ID
    // for an account it will not open.
    applies: shape => collectsOnline(shape),
    mandatory: shape => collectsOnline(shape),
  },

  // Both become compulsory the moment money can move, by card or by invoice.
  // An invoice with no company name and no tax id is not a valid document, and
  // one with no account number does not tell the client where to send anything.
  {
    id: 'profile',
    requires: [],
    owner: 'user',
    mandatory: (shape, isComplete) => (isComplete('payments') ? true : moneyMoves(shape)),
    belongsTo: 'payments',
  },
  {
    // Company and bank details go on every invoice — they are how the client
    // learns where to send the money. Required where some service is actually
    // billed afterwards, not merely because the business charges for things.
    id: 'invoicing',
    requires: ['profile'],
    owner: 'user',
    // Visible wherever money moves at all — a card business still issues
    // receipts, and the chain is meant to be the map of everything. Owed only
    // where something is actually billed afterwards, because bank details
    // exist to tell a client where to send a transfer.
    applies: shape => moneyMoves(shape),
    mandatory: (shape, isComplete) => (isComplete('payments') ? true : needsInvoicePaperwork(shape)),
    belongsTo: 'payments',
  },

  // The accounts a business already has, connected so we can say where clients
  // came from. Two steps, because they are two connections: a Meta login that
  // brings Facebook and its linked Instagram at once, and a Google one covering
  // Analytics and the business listing. One combined "channels" step would hide
  // which of the two is still outstanding, which is the only thing the row is
  // there to say.
  //
  // Present for EVERY business, including one that declined channels in the
  // onboarding chat. That answer decides whether the dashboard carries a
  // channels card; it must not decide whether the business can ever change its
  // mind. Someone who said no in week one and starts advertising on Instagram
  // in week six needs a way back in, and this chain is the one place that lists
  // everything still configurable.
  //
  // Never mandatory and never a prerequisite: a business takes clients end to
  // end without either. All they change is whether we can say where those
  // clients came from.
  { id: 'meta_insights', requires: [], owner: 'user', mandatory: 'optional' },
  { id: 'google_analytics', requires: [], owner: 'user', mandatory: 'optional' },
];

/** Where a step stands once the graph is resolved against real data. */
export type StepState =
  | 'done'
  /** The one thing to do next — first actionable incomplete step in graph order. */
  | 'next'
  /** Actionable, but not the suggested next move. */
  | 'ready'
  /** A prerequisite is missing. Named in `blockedBy`. */
  | 'locked'
  /**
   * Not yet knowable — the chat has not asked the question this step depends
   * on. Drawn faintly in the onboarding panel so the user can see the shape of
   * what is coming without being told something that might not be true. Never
   * produced for the dashboard, which always has the answers.
   */
  | 'ghost';

/** The shape this module needs off a `SetupItem`, structurally matched. */
export interface ResolvableItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action?: string;
  required?: boolean;
  /**
   * Exactly what this step is still waiting for, already in the user's words.
   *
   * The graph never reads it — knowing that a step is incomplete is enough to
   * resolve the chain. It travels with the item so the card can say which
   * field is missing instead of only that something is.
   */
  missing?: string[];
}

export interface ResolvedStep {
  item: ResolvableItem;
  state: StepState;
  /** Incomplete prerequisites, in graph order. Empty unless `state` is 'locked'. */
  blockedBy: StepId[];
  /** Compulsory *right now* — which can change as the business changes. */
  mandatory: boolean;
  /**
   * The capability this step configures, if it is not one itself.
   *
   * Carried out of the graph so a caller can nest a step under what it serves.
   * The dashboard card draws that nesting as indentation, which is how it shows
   * a dependency without drawing one: invoice details sit under payments
   * because that is what they are for.
   */
  belongsTo?: StepId;
  /** Who can actually do this: the platform, or only the person. */
  owner: 'platform' | 'user';
}

export interface ResolvedGraph {
  steps: ResolvedStep[];
  /** Compulsory steps that are still outstanding — what "not ready" means. */
  blocking: ResolvedStep[];
  /** Outstanding work only a person can do. The honest cost of the product. */
  yours: ResolvedStep[];
  mandatoryDone: number;
  mandatoryTotal: number;
  allDone: number;
  allTotal: number;
}

/**
 * Resolve the graph against what is known.
 *
 * @param items  what the dashboard computed, or as much of it as the chat has.
 * @param shape  the business's answers. Defaults to nothing known, which keeps
 *               every rule that needs an answer in the `ghost` state rather
 *               than guessing — the dashboard passes a real shape.
 */
export function resolveSetup(
  items: ResolvableItem[],
  shape: BusinessShape = UNKNOWN_SHAPE
): ResolvedGraph {
  const byId = new Map(items.map(item => [item.id, item]));
  const isComplete = (id: StepId) => byId.get(id)?.completed === true;

  const steps: ResolvedStep[] = [];

  for (const node of SETUP_STEPS) {
    const item = byId.get(node.id);
    // A step the dashboard did not compute is not shown as unfinished work:
    // absent means "not known", the same rule profile_readiness follows.
    if (!item) continue;

    // Does this business need the step at all? `false` removes it entirely —
    // greying it out would leave the reader work to do deciding it can be
    // ignored. `null` means the question has not been asked yet.
    const applies = node.applies ? node.applies(shape) : true;
    if (applies === false) continue;

    const mandatoryRule =
      node.mandatory === 'always'
        ? true
        : node.mandatory === 'optional'
          ? false
          : node.mandatory(shape, isComplete);

    const blockedBy = node.requires.filter(id => !isComplete(id));

    let state: StepState;
    if (item.completed) {
      state = 'done';
    } else if (applies === null || mandatoryRule === null) {
      state = 'ghost';
    } else if (blockedBy.length > 0) {
      state = 'locked';
    } else {
      state = 'ready';
    }

    steps.push({
      item,
      state,
      blockedBy,
      mandatory: mandatoryRule === true,
      owner: node.owner,
      belongsTo: node.belongsTo,
    });
  }

  // Steps the graph has never heard of still appear. The alternative is the
  // failure the `design` row already hit, where an id the UI had no entry for
  // rendered as the raw string "design". Never locked, never compulsory.
  const known = new Set<string>(SETUP_STEPS.map(node => node.id));
  for (const item of items) {
    if (known.has(item.id)) continue;
    steps.push({
      item,
      state: item.completed ? 'done' : 'ready',
      blockedBy: [],
      mandatory: false,
      owner: 'platform',
    });
  }

  // The single suggested next move, and compulsory work always wins it.
  //
  // Offering an optional booking form before the next required step is exactly
  // the confusion this is meant to remove: finish what is compulsory, then take
  // the turnings.
  const suggested =
    steps.find(step => step.state === 'ready' && step.mandatory) ??
    steps.find(step => step.state === 'ready');
  if (suggested) suggested.state = 'next';

  const outstanding = steps.filter(step => step.state !== 'done' && step.state !== 'ghost');

  return {
    steps,
    blocking: outstanding.filter(step => step.mandatory),
    yours: outstanding.filter(step => step.owner === 'user' && step.mandatory),
    mandatoryDone: steps.filter(step => step.mandatory && step.state === 'done').length,
    mandatoryTotal: steps.filter(step => step.mandatory).length,
    allDone: steps.filter(step => step.state === 'done').length,
    allTotal: steps.length,
  };
}

/** Every resolved step, in the order the chain presents them. */
export function allSteps(graph: ResolvedGraph): ResolvedStep[] {
  return graph.steps;
}

/** The one thing to do next, or null when nothing is outstanding. */
export function nextStep(graph: ResolvedGraph): ResolvedStep | null {
  return graph.steps.find(step => step.state === 'next') ?? null;
}

/**
 * Nothing compulsory is outstanding.
 *
 * Replaces asking each item whether it is `required`: that flag cannot express
 * "compulsory only once money can move", so a business invoicing clients with
 * no tax id on its invoices was reported as ready.
 */
export function isReadyForClients(graph: ResolvedGraph): boolean {
  return graph.blocking.length === 0;
}

/**
 * The step a locked node should point at instead of acting.
 *
 * A lock that does nothing when clicked is a dead end, and the user has no way
 * to discover what to do about it. Lighting up the blocker answers "why not" on
 * the chain they are already looking at.
 */
export function blockerFor(step: ResolvedStep, graph: ResolvedGraph): ResolvedStep | null {
  const firstBlocker = step.blockedBy[0];
  if (!firstBlocker) return null;

  return graph.steps.find(candidate => candidate.item.id === firstBlocker) ?? null;
}

/**
 * The shape of a business, read off the profile the onboarding chat wrote.
 *
 * One place where storage names become graph inputs, so a column rename cannot
 * quietly change what every user is asked to configure.
 */
export function shapeFromProfile(profile: {
  payment_mode?: string | null;
  collection_method?: string | null;
  online_presence_mode?: string | null;
  hasPricedServices?: boolean | null;
  /** Payment plans defined on services, as the dashboard counted them. */
  plans?: PlanKind | null;
  /**
   * What the services themselves say, counted by the stats route. These
   * outrank every business-wide field above, because booking and payment are
   * properties of a service: one business sells an appointment paid by card
   * and a programme billed against an invoice.
   *
   * Undefined where the caller has no services to count — during the chat,
   * before anything is built — and the presence mode is read across instead.
   */
  scheduledServices?: number;
  onlineServices?: number;
  invoicedServices?: number;
  activeServices?: number;
}): BusinessShape {
  const collection = ((): CollectionMethod | null => {
    // The explicit answer wins once the chat starts asking it.
    const explicit = profile.collection_method;
    if (explicit === 'card_online' || explicit === 'invoice' || explicit === 'in_person' || explicit === 'mixed' || explicit === 'none') {
      return explicit;
    }

    // Older accounts only have payment_mode, which conflated "has a price" with
    // "takes cards". Read across as faithfully as it allows: upfront meant
    // cards, invoicing and installments meant a document, none meant free.
    switch (profile.payment_mode) {
      case 'upfront': return 'card_online';
      case 'invoicing':
      case 'installments': return 'invoice';
      case 'none': return 'none';
      default: return null;
    }
  })();

  const presence = ((): PresenceMode | null => {
    const mode = profile.online_presence_mode;
    return mode === 'full_website' || mode === 'website_only' || mode === 'booking_only' || mode === 'none'
      ? mode
      : null;
  })();

  // With services on the books, they are the answer. Without them — the chat,
  // a brand-new account — fall back to what the interview said about being
  // findable, which encodes whether they take appointments at all.
  const hasServices = (profile.activeServices ?? 0) > 0;

  const appointments = hasServices
    ? (profile.scheduledServices ?? 0) > 0
    : presence === 'full_website' || presence === 'booking_only'
      ? true
      : presence === null ? null : false;

  const collectsOnlineNow = hasServices
    ? (profile.onlineServices ?? 0) > 0
    : null;

  const invoicesNow = hasServices
    ? (profile.invoicedServices ?? 0) > 0
    : null;

  return {
    hasPricedServices: profile.hasPricedServices ?? null,
    collection,
    appointments,
    collectsOnline: collectsOnlineNow,
    invoices: invoicesNow,
    presence,
    plans: profile.plans ?? null,
  };
}
