import { readFileSync } from 'fs';
import { join } from 'path';

/*
 * A subscription is not an enquiry, and is no longer a contact at all.
 *
 * It used to post to the contact endpoint, which made every subscriber a CRM
 * contact. Given a stage no pipeline column recognises they were invisible;
 * given `lead` they were picked up by `CrmColdLeadsDetector` seven days later,
 * counted as lost revenue, and offered up for a "you got in touch and we never
 * followed up" email they had no part in.
 *
 * Signups now go to `/api/public/newsletter/subscribe`, which writes
 * `business_subscribers` and creates no contact. These assert the SHAPE of both
 * routes rather than running them — they reach Supabase, the mail transport and
 * the lead queue — and they catch the regressions that actually matter: the
 * contact endpoint growing subscriber handling back, or the subscribe endpoint
 * quietly creating a contact.
 */

const CONTACT_ROUTE = join(__dirname, '..', 'contact', 'route.ts');
const SUBSCRIBE_ROUTE = join(
  __dirname, '..', '..', '..', 'public', 'newsletter', 'subscribe', 'route.ts'
);

const contactSource = readFileSync(CONTACT_ROUTE, 'utf-8');
const subscribeSource = readFileSync(SUBSCRIBE_ROUTE, 'utf-8');

const lineOf = (source: string, needle: string) => {
  const index = source.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  return source.slice(0, index).split('\n').length;
};

describe('the subscribe endpoint', () => {
  it('writes the subscriber roster', () => {
    expect(subscribeSource).toContain('businessSubscriberRepository.subscribe(');
  });

  it('never inserts a CRM contact', () => {
    /*
     * The whole point. A contact is something the chasers act on — the cold-lead
     * detector, the lead-response queue, the follow-up nudge all query
     * `crm_contacts`, so no contact means none of them can reach a subscriber.
     */
    expect(subscribeSource).not.toContain(".from('crm_contacts')\n      .insert");
    expect(subscribeSource).not.toMatch(/\.insert\(\s*\{[^}]*stage:/);
  });

  it('asks the address to confirm before treating anyone as subscribed', () => {
    expect(subscribeSource).toContain('beginDoubleOptIn({');
  });

  it('records consent against an existing contact rather than duplicating them', () => {
    /*
     * The dedupe rule. With subscribers no longer being contacts, the same
     * person can exist in two stores; an address that is already a client is an
     * existing person giving permission, not a new subscriber. This endpoint is
     * the only place that split can be prevented from this direction.
     */
    expect(subscribeSource).toContain("from('crm_contacts')");
    const lookup = lineOf(subscribeSource, 'const { data: existingContact }');
    const insert = lineOf(subscribeSource, 'businessSubscriberRepository.subscribe(');
    expect(lookup).toBeLessThan(insert);
    expect(subscribeSource).toContain('if (!existingContact)');
  });

  it('does not re-confirm somebody already on the list', () => {
    expect(subscribeSource).toContain('alreadySubscribed: true');
  });
});

describe('the contact endpoint', () => {
  it('no longer files anyone under a subscriber stage', () => {
    expect(contactSource).not.toContain("SUBSCRIBER_STAGE");
    expect(contactSource).not.toContain("'subscriber'");
  });

  it('starts an enquiry at the pipeline’s first stage', () => {
    // The documented default, and correct again now that subscribers are gone:
    // everyone arriving here IS waiting for a reply.
    expect(contactSource).toContain("pipelineStages?.[0]?.stage_key || 'lead'");
  });

  it('still routes a stale bundle’s newsletter post to the subscriber path', () => {
    /*
     * The compatibility shim. A visitor holding the previous JavaScript still
     * posts here. Rejecting it loses the address silently — the form shows its
     * thank-you either way — and accepting it as an enquiry recreates the bug.
     */
    expect(contactSource).toContain("if (data.source === 'newsletter')");

    const shim = lineOf(contactSource, "if (data.source === 'newsletter')");
    // Before any contact is created, and before anything that treats the sender
    // as somebody waiting for a reply.
    expect(shim).toBeLessThan(lineOf(contactSource, "from('crm_contacts')"));
    expect(shim).toBeLessThan(lineOf(contactSource, 'notifyOwnerOfLead({'));
  });
});
