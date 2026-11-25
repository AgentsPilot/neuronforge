/**
 * "Pay you · ready" has to mean a client can pay.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED: "why is pay you green if we didn't complete the stripe connection?
 * is it because invoice data is completed?" — and then the damage it does:
 * "otherwise the user think ok I'm done with the payment side".
 *
 * The answer was yes. `ClientReachJourney` had two states: a station was red
 * when something behind it sat in `graph.blocking`, and green otherwise.
 * `blocking` is compulsory-and-outstanding, and `payments` is deliberately
 * `mandatory: 'optional'` — so a station with no processor, no bank details and
 * nothing settled was drawn exactly like one that was finished.
 *
 * `payments` staying optional is NOT the bug and must not be "fixed".
 * `theGatesDoNotContradict` pins the reason: a live card service on an account
 * with no Stripe falls back to an invoice and goes on trading, and every public
 * surface filters on `isBlockingGap`. Making the processor block would turn a
 * nudge into a platform-wide outage.
 *
 * So the missing state is not "half ready". It is "nothing this business sells
 * needs this stop", and it is read off `mandatory`, which the graph already
 * decides per business. This file pins what that state does and does not mean,
 * because the temptation when reading the words "nothing needs it" is to widen
 * it to cases that genuinely do.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { shapeFromServices } from '@/lib/business-os/businessShape';
import { resolveSetup, type ResolvableItem, type StepId } from '@/lib/business-os/setup/setupGraph';

const RAW = readFileSync(join(__dirname, '..', 'ClientReachJourney.tsx'), 'utf8');

/**
 * CODE ONLY, because the comments necessarily discuss the rules by name.
 *
 * The file's own explanation of the third state names `collectsOnline`,
 * `moneyMoves` and Stripe in prose, which is exactly what the test below
 * forbids in code. Reading the raw file would have failed on the documentation
 * that makes the change defensible.
 */
const SOURCE = RAW
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The steps the journey draws behind "Pay you". Mirrors `STATION_STEPS.pay`. */
const PAY: StepId[] = ['payments', 'profile', 'invoicing'];

/**
 * The dashboard's own items, as the journey receives them.
 *
 * Everything incomplete unless named: the question under test is which steps
 * the graph calls COMPULSORY for a given catalogue, and a completed step would
 * answer a different one.
 */
const items = (done: StepId[] = []): ResolvableItem[] =>
  (['services', 'website', 'availability', 'payments', 'profile', 'invoicing'] as StepId[]).map(
    id => ({ id, title: id, description: '', completed: done.includes(id) })
  );

const profile = { online_presence_mode: 'website_only', collection_method: 'none' } as const;

/** What the component computes: is any step behind the station compulsory now? */
const payIsIdle = (shape: ReturnType<typeof shapeFromServices>, done: StepId[] = []) => {
  const graph = resolveSetup(items(done), shape);
  return !graph.steps.some(step => step.mandatory && PAY.includes(step.item.id as StepId));
};

describe('the station goes quiet only where there is genuinely nothing to collect', () => {
  it('is idle for a catalogue that never bills anybody', () => {
    /*
     * The case the state exists for. A free service is a real service — hours,
     * reminders, no-shows — that simply never charges, so `payments` and
     * `invoicing` are both removed by `applies` and `profile` is not compulsory.
     *
     * Drawing that green claims a way to be paid this business never set up;
     * drawing it red invents a chore it does not owe.
     */
    const free = shapeFromServices([{ status: 'active', is_scheduled: true, price: 0, collection: null }], profile);
    expect(payIsIdle(free)).toBe(true);
  });

  it('is NOT idle for a business that invoices, which is the trap', () => {
    /*
     * "Nothing needs it" is tempting here too: no card, no processor, no Stripe.
     * But an invoice IS how this business gets paid, and it is worthless without
     * a company name, a tax id, an address and somewhere to send the money.
     * `invoicing.applies` is `moneyMoves`, not `collectsOnline`, for exactly
     * this reason, and the publish gate refuses a page whose service will be
     * invoiced with no way to issue one.
     */
    const invoices = shapeFromServices(
      [{ status: 'active', is_scheduled: true, price: 200, collection: 'invoice' }],
      profile
    );
    expect(payIsIdle(invoices)).toBe(false);
  });

  it('is NOT idle for a quote-only business, because a quote moves money', () => {
    /*
     * MEASURED AGAINST THE MODEL, and it corrected a design sketch that had
     * this the other way round: a quote looks like it collects nothing, since
     * it carries `price: null` and `collection: null` deliberately.
     *
     * `ProposalAcceptanceService` writes a `payment_invoices` row on
     * acceptance, so acceptance is a bill. `theGatesDoNotContradict` pins the
     * same pair of facts from the other side: `moneyMoves` is true for a quote
     * and `collectsOnline` is false. A quote-first business therefore owes its
     * invoice paperwork like any other, and a station reading "nothing needs
     * it" would be the first half of a client receiving an invoice with no
     * company details on it.
     */
    const quotes = shapeFromServices(
      [{ status: 'active', is_scheduled: true, price: null, collection: null, sale_mode: 'proposal' }],
      profile
    );
    expect(payIsIdle(quotes)).toBe(false);
  });

  it('is NOT idle once a processor is connected, whatever the catalogue says', () => {
    /*
     * `profile.mandatory` is `isComplete('payments') ? true : moneyMoves`, so
     * connecting Stripe pulls the paperwork in by itself: an account that can
     * charge a card can raise a receipt, and that receipt needs the same
     * details. A business that connected a processor before adding a priced
     * service must not be told the whole subject is irrelevant.
     */
    const free = shapeFromServices([{ status: 'active', is_scheduled: true, price: 0, collection: null }], profile);
    expect(payIsIdle(free, ['payments'])).toBe(false);
  });
});

describe('the journey stays a presentation of the graph', () => {
  it('reads `mandatory` rather than deciding for itself', () => {
    /*
     * The file's own opening claim is that it decides nothing, and a third
     * state is exactly where that gets broken: it would be easy to test the
     * shape here, or to ask whether Stripe is connected. Both would be a second
     * opinion, and the first thing to disagree with the publish gate.
     */
    /*
     * The journey was rebuilt and the two reads are now separate expressions,
     * which is the same guarantee in two halves: `mandatory` is taken from the
     * step the graph hands over, and what blocks a station is `graph.blocking`
     * filtered by that station's steps. Neither asks about the shape, and
     * neither asks whether Stripe is connected.
     */
    expect(SOURCE).toContain('if (next?.mandatory) return next;');
    expect(SOURCE).toContain('graph.blocking.filter(step =>');
    expect(SOURCE).toContain('STATION_STEPS[station].includes');
    /*
     * The RULES, not the words. An earlier version of this forbade the string
     * "stripe" anywhere in the code and failed on the caveat's own English
     * fallback, which has every right to name the thing the owner has to
     * connect. What must not appear is this file working the answer out:
     * calling the shape predicates, or reading the processor's own flag.
     */
    expect(SOURCE).not.toMatch(/\b(collectsOnline|moneyMoves|takesAppointments|sellsAnything)\s*\(/);
    expect(SOURCE).not.toContain('charges_enabled');
    expect(SOURCE).not.toContain('stripe_connected');
  });

  it('keeps the processor out of `blocking`, which is a different file\'s job', () => {
    /* No local re-ranking of what blocks: `graph.blocking` is still the only
       source of the red state. */
    expect(SOURCE).toContain('graph.blocking.filter');
    expect(SOURCE).not.toMatch(/blocking\.push|\.concat\(/);
  });

  it('says the third state in every language the dashboard speaks', () => {
    expect(SOURCE).toContain("tr('reach.state.not_needed'");
    for (const file of ['en', 'he', 'es']) {
      const copy = readFileSync(
        join(__dirname, '..', '..', '..', '..', 'lib', 'business-os', 'translations', `${file}.ts`),
        'utf8'
      );
      expect(copy).toContain("'reach.state.not_needed'");
    }
  });

  it('qualifies a green pay station that will invoice instead of charging', () => {
    /*
     * The user's actual account: card chosen, invoice details complete, no
     * Stripe. Green is CORRECT there — the invoice fallback works and is itself
     * protected by `invoicing` being compulsory — so the fix is not a colour.
     * It is that green said nothing, and "Pay you · ready" with nothing beside
     * it is what produced "ok I'm done with the payment side".
     *
     * Derived from the graph: the `payments` step exists only where the
     * business takes cards (`applies` is `collectsOnline`) and is done exactly
     * when Stripe is connected. No new input, no second opinion.
     */
    expect(SOURCE).toContain('cardsFallBackToInvoice');
    expect(SOURCE).toContain("tr(\n            'reach.pay.invoiced_instead'");
    /* Suppressed when the station is red: the callout is already naming
       something that stops the money outright. */
    expect(SOURCE).toContain("if (stationState.pay === 'blocked') return false;");
  });

  it('draws it as neither of the two colours it is not', () => {
    /*
     * The whole point is that it is not green and not red. A dashed border and
     * muted type say "not in use"; either accent colour would say something
     * about work.
     */
    /* The station is `.crj-cell[data-state="idle"]` since the rebuild; it was
       `.crj-stn.idle`. The rule it carries is the same one. */
    const rule = SOURCE.slice(
      SOURCE.indexOf('.crj-cell[data-state="idle"] {'),
      SOURCE.indexOf('.crj-cell[data-state="idle"] .crj-dot')
    );
    expect(rule).not.toBe('');
    expect(rule).toContain('border-style: dashed');
    expect(rule).not.toContain('#22C58B');
    expect(rule).not.toContain('#F26B6B');
  });
});
