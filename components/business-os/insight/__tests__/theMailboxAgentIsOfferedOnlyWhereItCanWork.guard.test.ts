/**
 * The agent that reads enquiry email is offered only where there IS enquiry email.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ON SCREEN
 *
 * The readiness card offered "Leads from your own website" to every owner who
 * had declined our website, described like this:
 *
 *     "Your website emails you when somebody fills in your contact form."
 *
 * Said to a business with no website. The gate was
 * `presence === 'booking_only' || presence === 'none'`, and `presence` records
 * only what WE are asked to BUILD — so a business keeping its own site and a
 * business with no web presence at all both carry `booking_only`. Half the
 * group being offered an agent that reads a contact form had no contact form,
 * and never would.
 *
 * It was not even sufficient for the other half. An owner can keep their own
 * site and take every enquiry by phone, by WhatsApp, or through a portal we
 * cannot see. Having a website does not put anything in a mailbox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO ANSWERS THAT REPLACED IT
 *
 *   hasOwnWebsite       the chip, "I already have a website"
 *   leadsArriveByEmail  the follow-up, asked only of those owners
 *
 * Both must be `=== true`. Null is a real and common value — "never asked" —
 * and it has to suppress the item rather than be read as either answer. That
 * asymmetry is the whole design: an owner who is not offered something can
 * still find it in the channels card, where an owner offered an agent that
 * cannot work for them has simply been misled.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Rendering the branch needs the dashboard's full prop surface — stats, gaps,
 * journey anchors, inbox status, a language provider. The thing that broke was
 * which FIELDS a condition reads, and that stays textual. This asserts the two
 * fields are read, that `=== true` is how they are read, and that the old
 * presence test is gone from this decision.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

const DASHBOARD = 'components/business-os/insight/LiveDashboard.tsx';
const SHAPE = 'lib/business-os/setup/setupGraph.ts';
const PAGE = 'app/business-os/page.tsx';

const dashboard = read(DASHBOARD);
const shape = read(SHAPE);
const page = read(PAGE);

/**
 * The readiness block that decides the mailbox item, comments stripped.
 *
 * Bounded by the two things that have to stay together: the condition and the
 * item it gates. Taking the whole file would let a `presence` test anywhere
 * else in it fail the assertion below for no reason — the dashboard reads
 * `presence` legitimately in three other places.
 */
function mailboxDecision(): string {
  const from = dashboard.indexOf('const readsItsOwnEnquiryMail');
  const to = dashboard.indexOf("action: 'connect_inbox_channel'", from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);

  return dashboard
    .slice(from, to)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the readiness gate for the mailbox agent', () => {
  it('reads both answers, not the presence mode', () => {
    const decision = mailboxDecision();

    expect(decision).toContain('hasOwnWebsite');
    expect(decision).toContain('leadsArriveByEmail');
  });

  it('is gone from the presence mode entirely', () => {
    /*
     * THE BUG, as one assertion. `booking_only` and `none` cannot tell an owner
     * with their own site from one with no site at all, which is the single
     * distinction this offer depends on.
     */
    const decision = mailboxDecision();

    expect(decision).not.toContain('booking_only');
    expect(decision).not.toContain("presence === 'none'");
  });

  it('requires true on both, so a null never passes for an answer', () => {
    /*
     * `=== true` rather than truthiness. A bare `if (shape.hasOwnWebsite)` is
     * the same thing for `true`/`false` and silently wrong for the null that
     * every account onboarded before the columns existed carries.
     */
    const decision = mailboxDecision();

    expect(decision).toMatch(/hasOwnWebsite === true/);
    expect(decision).toMatch(/leadsArriveByEmail === true/);
  });

  it('still requires that no mailbox is already connected', () => {
    /* Readiness must not report an unfinished setup for something working —
       the claim this card cannot afford to get wrong. */
    expect(mailboxDecision()).toContain('noMailboxAtAll');
  });
});

describe('the two answers reach the card at all', () => {
  it('the shape carries them, nullable, and never infers them from presence', () => {
    expect(shape).toMatch(/hasOwnWebsite: boolean \| null;/);
    expect(shape).toMatch(/leadsArriveByEmail: boolean \| null;/);

    /* Passed through from the stored columns. Deriving either from `presence`
       would reintroduce the collapse this whole change exists to undo. */
    expect(shape).toMatch(/hasOwnWebsite: profile\.has_website \?\? null/);
    expect(shape).toMatch(/leadsArriveByEmail: profile\.leads_arrive_by_email \?\? null/);
  });

  it('the unknown shape is null on both, so a card with no stats offers nothing', () => {
    const unknown = shape.slice(
      shape.indexOf('export const UNKNOWN_SHAPE'),
      shape.indexOf('}', shape.indexOf('export const UNKNOWN_SHAPE'))
    );

    expect(unknown).toContain('hasOwnWebsite: null');
    expect(unknown).toContain('leadsArriveByEmail: null');
  });

  it('the dashboard page feeds them in from the stats route', () => {
    /*
     * The one link that cannot be checked by type: `shapeFromProfile` takes an
     * optional bag, so omitting a key compiles and silently yields null —
     * which reads exactly like "never asked" and would suppress the item for
     * every owner, forever, with nothing failing.
     */
    expect(page).toMatch(/has_website: s\.business_shape\?\.has_own_website/);
    expect(page).toMatch(/leads_arrive_by_email: s\.business_shape\?\.leads_arrive_by_email/);
  });
});

describe('pressing the item lands on the channel', () => {
  it('scrolls to the channels card before opening the wizard', () => {
    /*
     * A lead channel is a channel: it belongs with the others, and the card
     * already draws a row for it once it exists. Opening the wizard from a
     * readiness line left the owner with no idea where the thing they had just
     * configured now lived.
     */
    const handler = page.slice(
      page.indexOf("action === 'connect_inbox_channel'"),
      page.indexOf("action === 'enable_lead_replies'")
    );

    expect(handler).toContain('CHANNELS_CARD_ID');
    expect(handler).toContain('scrollIntoBusinessOsView');
    /* The wizard still opens — this is a landing place, not a replacement. */
    expect(handler).toContain('setInboxSetupOpen(true)');
  });
});
