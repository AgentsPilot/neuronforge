/**
 * A readiness item the graph has no node for is never drawn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS TO STOP COMING BACK
 *
 * `LiveDashboard` appends its lead rows to the item list — "Website leads are
 * not being answered" and the two offers beside it. `SystemReadiness` renders
 * `allSteps(resolveSetup(items, shape))`, and `resolveSetup` walks
 * `SETUP_STEPS` and looks each NODE up in the items. An item whose id is not a
 * node is therefore skipped silently: it still counts towards the card's
 * "optional" tally and renders nothing at all.
 *
 * None of the three ids was a node. So the sentence describing the one failure
 * in the whole chain that reports nothing — enquiries filed, CRM healthy, no
 * request failing, no client ever answered — could not reach a screen, on any
 * account, in any state.
 *
 * Nothing about that was visible from either side. The dashboard's code is
 * correct and tested, the graph's code is correct and tested, and the two agree
 * about nothing. This file is the join.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  resolveSetup,
  allSteps,
  isReadyForClients,
  SETUP_STEPS,
  type BusinessShape,
  type ResolvableItem,
} from '../setupGraph';

/** Charges money, collects it herself. Any real shape does for these. */
const SHAPE: BusinessShape = {
  hasPricedServices: true,
  collection: 'invoice',
  appointments: true,
  collectsOnline: false,
  invoices: true,
  presence: 'booking_only',
  plans: 'none',
  /* The two the presence mode cannot carry, and the pair the mailbox stage is
     gated on. Null is the common state: never asked. */
  hasOwnWebsite: null,
  leadsArriveByEmail: null,
};

/** The three ids `LiveDashboard` can append, and what each one means. */
const LEAD_IDS = ['inbox-channel-replies', 'inbox-channel', 'lead-capture'] as const;

function item(id: string, completed = false): ResolvableItem {
  return { id, title: id, description: '', completed };
}

describe('the lead readiness rows', () => {
  it.each(LEAD_IDS)('%s is a node, so an item under it can be drawn', id => {
    expect(SETUP_STEPS.map(node => node.id)).toContain(id);
  });

  it.each(LEAD_IDS)('%s survives resolveSetup instead of being skipped', id => {
    const steps = allSteps(resolveSetup([item(id)], SHAPE));

    expect(steps.map(step => step.item.id)).toContain(id);
  });

  it('draws a completed row as done rather than dropping it', () => {
    /*
     * The row ticks, it does not vanish — the dashboard's own rule for it. A
     * step that disappears on being finished reads as "did my click do
     * anything?", and an owner who wants to check later finds no trace.
     */
    const steps = allSteps(resolveSetup([item('inbox-channel-replies', true)], SHAPE));

    expect(steps.find(step => step.item.id === 'inbox-channel-replies')?.state).toBe('done');
  });

  it('treats unanswered enquiries as compulsory, and the two offers as not', () => {
    const resolved = resolveSetup(LEAD_IDS.map(id => item(id)), SHAPE);
    const mandatory = allSteps(resolved)
      .filter(step => step.mandatory)
      .map(step => step.item.id);

    expect(mandatory).toContain('inbox-channel-replies');
    expect(mandatory).not.toContain('inbox-channel');
    expect(mandatory).not.toContain('lead-capture');
  });

  it('does not call a business ready while its enquiries go unanswered', () => {
    /* The point of it being compulsory. Everything else about this account is
       finished; nobody who writes in hears back. */
    expect(isReadyForClients(resolveSetup([item('inbox-channel-replies')], SHAPE))).toBe(false);
    expect(isReadyForClients(resolveSetup([item('inbox-channel-replies', true)], SHAPE))).toBe(true);
  });

  it('locks none of them behind another step', () => {
    /*
     * `requires: []` on all three, and the edge that looks obvious is wrong:
     * the replies row only exists once something can already receive an
     * enquiry, while `website` is satisfied by a booking link that cannot.
     * Requiring it would lock the row behind a step answering another question.
     */
    for (const step of allSteps(resolveSetup(LEAD_IDS.map(id => item(id)), SHAPE))) {
      if ((LEAD_IDS as readonly string[]).includes(step.item.id)) {
        expect({ id: step.item.id, blockedBy: step.blockedBy }).toEqual({
          id: step.item.id,
          blockedBy: [],
        });
      }
    }
  });
});
