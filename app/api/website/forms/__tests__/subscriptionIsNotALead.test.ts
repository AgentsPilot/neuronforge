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

/*
 * The row an enquiry becomes is no longer decided in the route.
 *
 * Stage resolution, find-or-create by address and the first/last message pair
 * moved to `captureEnquiry`, so that an enquiry read out of a MAILBOX becomes
 * the same row as one typed into the website form. The rules below did not
 * change and are still worth pinning; they are simply pinned where they live
 * now, which is what this guard's own note already said mattered: "what
 * matters is that this route asks the pipeline, not which statement it uses
 * to ask".
 */
const CAPTURE_ENQUIRY = join(
  __dirname, '..', '..', '..', '..', '..', 'lib', 'business-os', 'leads', 'captureEnquiry.ts'
);

const contactSource = readFileSync(CONTACT_ROUTE, 'utf-8');
const captureSource = readFileSync(CAPTURE_ENQUIRY, 'utf-8');
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
    /*
     * The documented default, and correct again now that subscribers are gone:
     * everyone arriving here IS waiting for a reply.
     *
     * This asserted the inline expression `pipelineStages?.[0]?.stage_key ||
     * 'lead'`. That was one of eight copies of the same resolution — and the
     * literal `'lead'` in it is a stage many pipelines do not contain, which
     * on a live board put a real contact in no column at all. The rule now
     * lives in `CRMPipelineStagesRepository.firstStageKey`, so the guard
     * follows it there: what matters is that this route asks the pipeline,
     * not which statement it uses to ask.
     */
    expect(captureSource).toContain('crmPipelineStagesRepository.firstStageKey(');
  });

  it('never writes a stage the business may not have', () => {
    /*
     * The other half, and the reason the expression above went away. With no
     * pipeline configured the stage is OMITTED so `crm_contacts.stage`'s own
     * `NOT NULL DEFAULT 'lead'` applies — rather than this route restating
     * that default as though it had decided it.
     */
    /* The CODE shape, not the words: prose about the old expression is fine. */
    expect(captureSource).not.toMatch(/stage_key\s*(\|\||\?\?)\s*'lead'/);
    expect(captureSource).toContain('...(initialStage ? { stage: initialStage } : {})');
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
    /* The route no longer touches `crm_contacts` itself, so the thing the shim
       must precede is the call that files the contact. */
    expect(shim).toBeLessThan(lineOf(contactSource, 'captureEnquiry({'));
    expect(shim).toBeLessThan(lineOf(contactSource, 'notifyOwnerOfLead({'));
  });
});
