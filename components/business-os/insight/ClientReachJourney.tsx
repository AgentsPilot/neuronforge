'use client';

/**
 * Can a client actually reach you?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A PRESENTATION OF THE READINESS GRAPH. IT DECIDES NOTHING.
 *
 * Every fact here comes from the `ResolvedGraph` the dashboard already built:
 * which steps are outstanding, which are compulsory, and which single one comes
 * next. This component groups those steps into the three things a client does —
 * find you, book a time, pay you — and draws the first one that cannot happen.
 *
 * It is deliberately NOT a second opinion. `SystemReadiness` renders the same
 * graph as a list; this renders it as a path. Two views, one answer. If they
 * ever disagree, the bug is here, not in the graph.
 *
 * WHY A PATH RATHER THAN A LIST
 *
 * The list asks the reader to hold eleven rows of equal weight and work out
 * which matters. The path asks nothing: the break is where the arrow stops.
 * And it is phrased as a consequence for the client rather than a state of the
 * configuration — "nobody can book until you do" instead of "availability: not
 * configured" — because the owner cares about the first and has to translate
 * the second.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { nextStep, type ResolvedGraph, type ResolvedStep, type StepId } from '@/lib/business-os/setup/setupGraph';

type StationId = 'find' | 'book' | 'pay';

/**
 * Which steps stand behind each thing a client does.
 *
 * A grouping for the eye, not a dependency: the graph already owns what blocks
 * what. A step missing from every list here simply never colours a station — it
 * still appears in the readiness list below, and it can still be the callout if
 * the graph names it next.
 *
 * Note how little this table can actually decide. A station reddens only from
 * `graph.blocking`, which is compulsory-and-outstanding, and only six steps can
 * ever be compulsory: `website` (always), `services` (always), `availability`
 * (if the business takes appointments), and `payments` / `profile` / `invoicing`
 * (once money moves). Everything else is here for tidiness and cannot block.
 *
 * `meta_insights` and `google_business` are deliberately in no station: they
 * are about the owner seeing their own numbers, not about a client arriving.
 *
 * The one real judgement call is `services`. They are what the page displays,
 * so they could sit under "find you" — but a client cannot book nothing, and
 * "find you" reads better owned solely by whether the page is reachable.
 */
const STATION_STEPS: Record<StationId, StepId[]> = {
  find: ['website', 'design'],
  book: ['services', 'availability', 'intake', 'calendar', 'service_descriptions'],
  pay: ['payments', 'profile', 'invoicing'],
};

/**
 * The step whose PRESENCE means this station is in use at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED: "Book a time · ready", in green, on a business whose only published
 * service is a quote with no appointment. Nothing it sells books a time, and
 * the station said a client could.
 *
 * The cause is that `services` sits under `book` — a deliberate grouping, since
 * a client cannot book nothing — and `services` is `mandatory: 'always'`. So
 * the station always had a compulsory step behind it, could never be read as
 * "not in use", and went green the moment the catalogue had one live row of any
 * kind.
 *
 * A station needs two different questions answered, and conflating them is what
 * went wrong:
 *
 *   is this station USED?      the subject below, by its presence in the graph
 *   is it WORKING?             `graph.blocking` over `STATION_STEPS`
 *
 * Presence is the right test for the first because `resolveSetup` drops a step
 * whose `applies` is false, and `applies` is where the graph already decides
 * this per business:
 *
 *   website     no rule, so always present — every business must be findable
 *   availability `takesAppointments`, so absent unless something is scheduled
 *   payments     `collectsOnline`; invoicing `moneyMoves`
 *
 * So this reads the graph's own answer rather than forming a second one, which
 * is the rule this whole file is written to.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATION_SUBJECT: Record<StationId, StepId[]> = {
  find: ['website'],
  book: ['availability'],
  pay: ['payments', 'invoicing'],
};

const ORDER: StationId[] = ['find', 'book', 'pay'];

const OK = '#22C58B';
const LEAK = '#F26B6B';

/*
 * The icons went with the tiles.
 *
 * A magnifier, a calendar and a card sat in gradient squares at the head of
 * each stop. They carried no information the label did not — "Find you" beside
 * a magnifier is the word twice — and the lit tiles were most of what made this
 * card outweigh the action above it. A dot states the same thing in a tenth of
 * the space, and the colour on it is the only part a reader actually scans for.
 */

interface Props {
  /** The graph the dashboard already resolved. Never re-resolved here. */
  graph: ResolvedGraph;
  /** The same dispatcher the readiness list uses, so a step behaves the same in both. */
  onAction?: (action: string, data?: unknown) => void;
  /**
   * Something above this card is already naming the next thing to do.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE STATIONS AND THE CALLOUT ANSWER DIFFERENT QUESTIONS, and only one of
   * them is this card's to keep when the services panel is on screen.
   *
   * The stations answer "can a client reach you", as an outcome: find you, book
   * a time, pay you, with the break drawn where it is. Nothing else on the
   * dashboard says that, and the owner cannot work it out from a list of
   * settings.
   *
   * The callout answers "what should I do next", and the services panel above
   * now answers the same question better: it names a SERVICE, which is a thing
   * an owner set out to sell, where the callout names a GAP that exists only as
   * a consequence of one. Two cards answering it at once is how this dashboard
   * came to describe the same work three times in three vocabularies, which is
   * the whole reason for the rework.
   *
   * So the sentence stands down and the picture stays. Not removed outright: on
   * an account with no catalogue the panel draws nothing, and the callout is
   * then the only thing naming a way forward.
   * ───────────────────────────────────────────────────────────────────────────
   */
  nextIsNamedAbove?: boolean;
  /**
   * Drawn INSIDE another card rather than as one of its own.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This began as a card beside the readiness list, and the two said the same
   * thing twice: the stations named what a client cannot do, the list named the
   * work that would fix it, and the callout repeated whichever row the graph
   * put first. Three surfaces, one subject.
   *
   * So it moves inside the readiness card. The stations become its picture and
   * the callout its next action, above the list of everything. Embedded, it
   * drops its own border, ground, shadow and bottom margin, which the host
   * already provides.
   * ───────────────────────────────────────────────────────────────────────────
   */
  embedded?: boolean;
  /**
   * A client can reach something of this business: any live page, or ANY active
   * smart link, a contact form included.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Deliberately NOT `is_reachable`, which the stats route restricts to
   * `booking` and `payment` links — a rule worth keeping, since a contact form
   * is "not evidence that this business is open" and that is what every gate
   * and every public surface means by reachable.
   *
   * This station asks a smaller question. "Find you" is whether somebody
   * looking for this business lands anywhere of theirs, and a live enquiry form
   * answers it: they arrive, they type, the business hears about it. Drawing it
   * blocked was wrong in a way an owner can see from their own browser.
   *
   * What they still cannot do is book a time or pay, and those are the next two
   * stops, which say so themselves.
   * ───────────────────────────────────────────────────────────────────────────
   */
  findableByLink?: boolean;
}

/**
 * The one step the callout points at, as a function anyone can ask.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Exported because the readiness card now hosts this journey AND lists every
 * step below it. Whatever the callout names would otherwise appear twice, a
 * few pixels apart, in the same words — a card telling you to connect your own
 * website, above a row telling you to connect your own website.
 *
 * Shared rather than re-derived: the fallback below is subtle, and a second
 * copy of it in the host is a drift waiting to happen.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function reachFocus(graph: ResolvedGraph): ResolvedStep | null {
  const next = nextStep(graph);
  if (next?.mandatory) return next;

  const blockedBy = {} as Record<StationId, ResolvedStep[]>;
  for (const station of ORDER) {
    blockedBy[station] = graph.blocking.filter(step =>
      STATION_STEPS[station].includes(step.item.id as StepId)
    );
  }
  const firstBroken = ORDER.find(station => blockedBy[station].length > 0) ?? null;
  return firstBroken ? blockedBy[firstBroken][0] ?? next ?? null : next ?? null;
}

export function ClientReachJourney({
  graph,
  onAction,
  nextIsNamedAbove = false,
  embedded = false,
  findableByLink = false,
}: Props) {
  const { t, isRTL } = useLanguage();

  /**
   * `t` returns the KEY when a translation is missing, so the `t(k) || fallback`
   * idiom used elsewhere in this folder can never fall back. This one can.
   */
  const tr = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const font = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';
  const display = isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif';

  /**
   * A station is blocked by any compulsory step still outstanding behind it.
   *
   * `graph.blocking` is exactly that set, already filtered — so this is a
   * lookup, not a judgement.
   */
  const blockedBy = useMemo(() => {
    const map = {} as Record<StationId, ResolvedStep[]>;
    for (const station of ORDER) {
      map[station] = graph.blocking.filter(step =>
        STATION_STEPS[station].includes(step.item.id as StepId)
      );
    }
    return map;
  }, [graph]);

  /**
   * THREE STATES, BECAUSE TWO OF THEM WERE LYING.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A station was green unless something behind it was in `graph.blocking`, and
   * `blocking` is compulsory-and-outstanding. So "Pay you · ready" was drawn
   * for a business that had connected nothing and settled nothing, because
   * `payments` is deliberately `mandatory: 'optional'` — a decision that is
   * right and must stay right, since a live card service with no processor
   * falls back to an invoice and goes on trading.
   *
   * Reported exactly that way: "why is pay you green if we didn't complete the
   * stripe connection? is it because invoice data is completed?" Yes, and the
   * conclusion drawn from it is the damage: "otherwise the user think ok I'm
   * done with the payment side".
   *
   * The missing state is NOT "half ready". It is "nothing you sell needs this".
   * A consultancy that invoices for everything is never asked for a processor;
   * a business that books no times is never asked for hours. For those
   * accounts the station has no work behind it, and `ready` claims a capability
   * they never chose while `blocked` invents a chore. Both are wrong in the
   * same way: they answer a question nobody asked.
   *
   * READ OFF `mandatory`, WHICH THE GRAPH ALREADY DECIDES PER BUSINESS, so
   * this stays a presentation of the graph and not a second opinion:
   *
   *   · `payments.applies`  = collectsOnline  — absent for an invoice-only shop
   *   · `invoicing.applies` = moneyMoves      — absent when no money moves
   *   · `profile.mandatory` = moneyMoves      — present always, compulsory only
   *                                             once there is money to document
   *
   * So "no step behind this station is compulsory right now" is exactly "this
   * business was never asked for any of it". `find` and `book` can never reach
   * it — `website` and `services` are `mandatory: 'always'` — which is correct:
   * every business has to be findable and has to sell something.
   *
   * Deliberately not keyed on `done`: a business that filled in its company
   * details and then sells nothing priced has still not made a way to be paid,
   * and `ready` would be the same claim one field further on.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const stationState = useMemo(() => {
    const map = {} as Record<StationId, 'ready' | 'blocked' | 'idle'>;
    for (const station of ORDER) {
      /* Found is found, whatever is still unfinished behind it. */
      if (station === 'find' && findableByLink) {
        map[station] = 'ready';
        continue;
      }
      if (blockedBy[station].length > 0) {
        map[station] = 'blocked';
        continue;
      }
      /*
       * Used, not merely compulsory. `mandatory` was the first test here and it
       * read `services` — always compulsory, in the `book` station — as proof
       * that a business takes bookings.
       */
      const used = graph.steps.some(
        step => STATION_SUBJECT[station].includes(step.item.id as StepId)
      );
      map[station] = used ? 'ready' : 'idle';
    }
    return map;
  }, [graph, blockedBy, findableByLink]);

  /**
   * What the callout points at.
   *
   * The graph's own `next` when it is compulsory — that is the whole reason
   * `nextStep` exists, and it already respects prerequisites.
   *
   * But `next` falls back to the first merely-READY step when no compulsory one
   * is actionable (`setupGraph.ts:536-544`), and that step can be optional. A
   * callout reading "your page still wears the default look" underneath a
   * station drawn red for a missing website would be describing a different
   * problem from the one the card is pointing at. So when `next` is not
   * compulsory, the first blocker behind the first broken station wins, and the
   * picture and the sentence stay about the same thing.
   */
  /* One decision, shared with the readiness card that hosts this. */
  const focus: ResolvedStep | null = useMemo(() => reachFocus(graph), [graph]);

  /**
   * GREEN, BUT NOT THE WAY THEY CHOSE.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The other half of "I'm done with the payment side". A business that picked
   * card and never connected a processor is genuinely able to be paid: every
   * priced service falls back to an invoice, and `invoicing` being compulsory
   * is what guarantees that fallback works. So the station is correctly green,
   * and must stay green — reddening it is the platform-wide outage
   * `theGatesDoNotContradict` exists to prevent.
   *
   * What it must not do is stop there. "Pay you · ready" with nothing beside it
   * reads as "the payment side is finished", and the owner finds out it is not
   * when a client is invoiced for something they expected to put a card into.
   *
   * Both facts come off the graph, so this is still no second opinion:
   *
   *   · the step EXISTS only where `payments.applies` is true, which is
   *     `collectsOnline` — so its presence means this business takes cards
   *   · the step is DONE exactly when Stripe is connected, which is how the
   *     dashboard builds the item (`app/business-os/page.tsx`)
   *
   * Not drawn when the station is blocked: the callout is then naming
   * something that stops the money entirely, and a note about which way it
   * arrives would be noise over the top of it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const cardsFallBackToInvoice = useMemo(() => {
    if (stationState.pay === 'blocked') return false;
    const payments = graph.steps.find(step => step.item.id === 'payments');
    return Boolean(payments) && payments!.state !== 'done';
  }, [graph, stationState]);

  const stationLabel: Record<StationId, string> = {
    find: tr('reach.station.find', 'Find you'),
    book: tr('reach.station.book', 'Book a time'),
    pay: tr('reach.station.pay', 'Pay you'),
  };

  /*
   * THE MOCKUP'S SHAPE: a plain panel of three cells, each with a dot.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * What this used to be: three tiles carrying gradient icon squares, joined by
   * tracks with a travelling dot, cut by a dashed line and a ✕ where something
   * blocked, over a glow. It was drawn carefully and it was the loudest thing
   * on a dashboard whose actual next step is a service nobody has finished.
   *
   * It is a SUMMARY. The owner reads it to learn whether a client can get to
   * them, then acts on the card above it. A summary that outweighs the action
   * is the wrong way round, and the links in particular claimed a sequence that
   * is not real: paying is not downstream of booking for a business that
   * invoices, and a cut between two stops implied an order the graph never had.
   *
   * So: one bordered panel, a quiet uppercase heading, three equal cells, a dot
   * each, and the state word under the name. Nothing moves.
   * ─────────────────────────────────────────────────────────────────────────
   */
  return (
    <div
      className={`crj${embedded ? ' crj-embedded' : ''}`}
      style={{ direction: isRTL ? 'rtl' : 'ltr', fontFamily: font }}
    >
      {!embedded && <div className="crj-head">{tr('reach.title', 'Can a client reach you?')}</div>}

      <div className="crj-row">
        {ORDER.map(station => {
          const state = stationState[station];
          return (
            <div key={station} className="crj-cell" data-state={state}>
              <span className="crj-dot" aria-hidden />
              <span className="crj-name" style={{ fontFamily: display }}>
                {stationLabel[station]}
              </span>
              {/*
                ──────────────────────────────────────────────────────────────
                THE WORD UNDER THE NAME SAYS WHICH FACT IT IS REPORTING.

                It read "blocked", "nothing needs it" or "ready" — three words
                that describe the DOT rather than the business. Reported from a
                real account: "Book a time · blocked, although we defined the
                availability". The hours were set; the red came from `services`,
                because both rows were still drafts and a client cannot book
                something that is not published. The station was right and said
                nothing a person could act on, so the obvious reading was the
                one the name suggests — the diary.

                Both replacements are READ OFF THE GRAPH rather than written
                per station, so neither can describe a state that is not the
                one on screen:

                  blocked  the step that actually did it, by name. `blockedBy`
                           is already the filtered `graph.blocking`, so the
                           caption and the colour have one source.
                  idle     why this business was never asked — `applies` is
                           false, so the step is not in the graph at all. "Not
                           needed" alone invites the question this answers: a
                           shop selling products reads "nothing you sell books
                           a time", which is the whole explanation.
                ──────────────────────────────────────────────────────────────
              */}
              <span className="crj-state">
                {state === 'blocked'
                  ? tr(
                      `reach.needs.${blockedBy[station][0]?.item.id ?? 'unknown'}`,
                      tr('reach.state.blocked', 'blocked')
                    )
                  : state === 'idle'
                    ? tr(`reach.idle.${station}`, tr('reach.state.not_needed', 'nothing needs it'))
                    : tr('reach.state.ready', 'ready')}
              </span>
            </div>
          );
        })}
      </div>

      {/* Green, with the one qualification it needs. See `cardsFallBackToInvoice`. */}
      {cardsFallBackToInvoice && (
        <div className="crj-caveat" role="status">
          {tr(
            'reach.pay.invoiced_instead',
            'Cards cannot be charged yet: until Stripe is connected, anything priced is invoiced instead. Nobody is turned away.'
          )}
        </div>
      )}

      {/*
        The one thing to do, named as a consequence for the client.

        Silent when the card above has already named it — see `nextIsNamedAbove`.
        It survives for the account with no catalogue, where this is the only
        thing on the page offering a way forward.
      */}
      {focus && !nextIsNamedAbove && (
        <div className="crj-next">
          <div className="crj-next-text">
            {/*
              ───────────────────────────────────────────────────────────────
              "NOBODY CAN REACH YOU" IS FALSE ONCE A FORM IS LIVE.
              ───────────────────────────────────────────────────────────────
              This sentence is written for a business with nothing published at
              all, and it kept running after that stopped being true: the stop
              directly above it reads "Find you · ready", because an active
              contact form does let somebody arrive and say something.

              What is actually missing is narrower, and it is the two things
              this card already offers: a link a client can BOOK through, and
              somebody reading the enquiries the site emails over. So when the
              business is findable the card says that instead, and keeps the
              original sentence for the account it was written for.
            */}
            <b>
              {focus.item.action === 'create_booking_link'
                ? findableByLink
                  ? tr('reach.blocked.website_link_found', 'They can reach you. Two things would take it further.')
                  : tr('reach.blocked.website_link', focus.item.title)
                : tr(`reach.blocked.${focus.item.id}`, focus.item.title)}
            </b>
            <span>
              {focus.item.action === 'create_booking_link' && findableByLink
                ? tr(
                    'reach.why.website_link_found',
                    'Your enquiry form is live, so a message gets through. A booking link lets a client pick a time themselves instead of waiting for you to arrange it. Connecting your mailbox turns the enquiries your site emails you into leads with a reply already drafted. Either one is worth doing on its own.'
                  )
                : focus.item.missing?.length
                  ? `${tr('readiness.stillNeeds', 'Still needs:')} ${focus.item.missing.join(' · ')}`
                  : focus.item.description}
            </span>
          </div>

          <div className="crj-actions">
            {focus.item.action && onAction && (
              <button
                type="button"
                onClick={() => onAction(focus.item.action!, { stepId: focus.item.id })}
                /* `ap-primary-lift` on the primary only. The quiet variant below
                   overrides the fill with `!important`, and that class's
                   dark-mode rule is `!important` too, so wearing both would
                   paint the secondary orange in dark mode. */
                className="crj-btn ap-primary-lift"
              >
                {focus.item.action === 'create_booking_link'
                  ? tr('reach.fix.website_link', tr('readiness.setUpNow', 'Set up now'))
                  : tr(`reach.fix.${focus.item.id}`, tr('readiness.setUpNow', 'Set up now'))}
              </button>
            )}

            {/*
              TWO WAYS TO BE REACHED, AND A BUSINESS WITH ITS OWN SITE HAS BOTH.
              Their site is already where clients find them; what is missing is
              a link to book through, and a way for the enquiries that site
              emails them to become leads instead of sitting in an inbox. Drawn
              only in that case, which `create_booking_link` marks exactly.
            */}
            {focus.item.action === 'create_booking_link' && onAction && (
              <button
                type="button"
                onClick={() => onAction('connect_inbox_channel', { stepId: focus.item.id })}
                className="crj-btn crj-btn-quiet"
              >
                {tr('reach.fix.inbox_channel', 'Read my website enquiries')}
              </button>
            )}
          </div>
        </div>
      )}

      <style jsx global>{`
        .crj {
          border: 1px solid var(--v2-border);
          background: var(--v2-surface);
          border-radius: 18px;
          padding: 15px 16px 16px;
          margin-bottom: 24px;
        }
        /* Inside the readiness card, which already owns the surface. */
        .crj-embedded {
          border: none;
          background: none;
          border-radius: 0;
          padding: 0;
          margin-bottom: 14px;
        }
        .crj-head {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--v2-text-secondary);
          margin-bottom: 12px;
        }

        .crj-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 9px;
        }
        .crj-cell {
          display: flex;
          flex-direction: column;
          gap: 5px;
          padding: 11px 12px;
          border: 1px solid var(--v2-border);
          border-radius: 12px;
          background: var(--v2-bg);
        }
        .crj-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--v2-text-muted);
        }
        .crj-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--v2-text-primary);
          line-height: 1.2;
        }
        .crj-state {
          font-size: 11.5px;
          color: var(--v2-text-muted);
        }

        .crj-cell[data-state="ready"] {
          border-color: color-mix(in srgb, ${OK} 45%, var(--v2-border));
        }
        .crj-cell[data-state="ready"] .crj-dot { background: ${OK}; }
        .crj-cell[data-state="ready"] .crj-state { color: ${OK}; }

        .crj-cell[data-state="blocked"] {
          border-color: color-mix(in srgb, ${LEAK} 45%, var(--v2-border));
        }
        .crj-cell[data-state="blocked"] .crj-dot { background: ${LEAK}; }
        .crj-cell[data-state="blocked"] .crj-state { color: ${LEAK}; font-weight: 600; }

        /*
         * Idle: present, and plainly not in use. Dashed rather than solid,
         * because the stop is part of the path the product offers and not part
         * of this business's path. Nothing here is red, and nothing is green.
         */
        .crj-cell[data-state="idle"] {
          border-style: dashed;
          background: transparent;
        }
        .crj-cell[data-state="idle"] .crj-dot {
          background: transparent;
          border: 1.5px solid var(--v2-border);
        }
        .crj-cell[data-state="idle"] .crj-name { color: var(--v2-text-secondary); }

        /*
         * Amber, which is this product's word for "working, but not the way you
         * chose". The same sentence wears the same colour in the services
         * editor, so an owner meets one visual claim about the processor rather
         * than two. Not red: nothing here is broken.
         */
        .crj-caveat {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 11px;
          border: 1px solid rgba(240,163,60,0.45);
          background: rgba(240,163,60,0.08);
          color: var(--v2-text-primary);
          font-size: 12.5px;
          line-height: 1.45;
        }

        .crj-next {
          margin-top: 12px;
          padding: 13px 14px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, ${LEAK} 40%, var(--v2-border));
          background: color-mix(in srgb, ${LEAK} 7%, transparent);
          display: flex;
          align-items: center;
          gap: 13px;
          flex-wrap: wrap;
        }
        .crj-next-text {
          flex: 1;
          min-width: 220px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .crj-next-text b {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--v2-text-primary);
          line-height: 1.35;
        }
        .crj-next-text span {
          font-size: 12.5px;
          color: var(--v2-text-secondary);
          line-height: 1.45;
        }

        .crj-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        /*
         * The fill comes from the platform token, and the lift from the class
         * every other primary button uses. (No backticks in here: this comment
         * sits inside a styled-jsx template literal, and one would close it.)
         * The shadow is deliberately NOT redeclared, because a scoped
         * styled-jsx selector outranks the global class and would win it back.
         */
        .crj-btn {
          flex: 0 0 auto;
          border: none;
          background: var(--v2-primary);
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          padding: 9px 15px;
          border-radius: 11px;
          cursor: pointer;
          transition: filter 0.15s, transform 0.15s;
        }
        .crj-btn:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }
        /*
         * The second route is an alternative, not a lesser one. A transparent
         * fill let the card's tint show through, so it read as a shaded patch
         * rather than a control; it carries the surface colour instead, like
         * every other secondary button in Business OS.
         */
        .crj-btn-quiet {
          background: var(--v2-surface) !important;
          color: var(--v2-text-primary) !important;
          border: 1px solid var(--v2-border) !important;
        }
        .crj-btn-quiet:hover {
          background: var(--v2-surface-hover) !important;
        }

        /* Phone: one cell per line. Three columns at 110px each is unreadable,
           and a sideways scroll would hide whichever stop is the problem. */
        @media (max-width: 640px) {
          .crj-row {
            grid-template-columns: 1fr;
          }
          .crj-cell {
            flex-direction: row;
            align-items: center;
            gap: 10px;
          }
          .crj-state {
            margin-inline-start: auto;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .crj-btn {
            transition: none;
          }
          .crj-btn:hover {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
