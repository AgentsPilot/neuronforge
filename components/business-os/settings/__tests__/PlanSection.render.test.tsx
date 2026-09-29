/**
 * @jest-environment jsdom
 *
 * What a customer actually reads in "Your plan".
 *
 * ── Rendered against the REAL payload, not a fixture ────────────────────────
 * The admin Tiers page shipped with a gap QA had to find: nothing compared the
 * page to the payload the server sends, so a field could be renamed server-side
 * and the page would quietly render nothing. That was patched there with a
 * recorded body and a freshness check.
 *
 * Here it can be done properly. `buildCustomerPlanView` reads no database and
 * touches no request, so this suite calls the real builder, resolves the real
 * config, and feeds the result through `fetch` into the real component. There is
 * no fixture to go stale: rename a field and the assertions below fail on the
 * same commit.
 *
 * ── What is asserted ────────────────────────────────────────────────────────
 * The things that would mislead somebody if they were wrong: the plan name and
 * price, "free — no end date" for a Founding Partner, that the next plan is
 * shown as information and not as a button, that a failed load says so rather
 * than rendering an empty plan, and that the word "chat" never appears.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';

import { PlanSection } from '@/components/business-os/settings/PlanSection';
import { buildCustomerPlanView } from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';

/*
 * The dictionary, for the handful of keys this file asserts on.
 *
 * The section names its sentences with keys and the component renders them, so a
 * `t` that echoed the key would turn every assertion here into a check that the
 * key is spelled right — which `planCopy.i18n.test.ts` already does, across all
 * three languages. What THIS file is for is what a customer sees, so it renders
 * the real English and keeps asserting the words.
 *
 * `language` matters as much as `t`: the date in "ends on {date}" is formatted
 * by the component in the reader's locale, so without it there is no date to
 * find.
 */
const COPY: Record<string, string> = {
  'plan.includes': 'What your plan includes',
  'plan.loading': 'Loading your plan…',
  'plan.price.free_no_end': 'Free — no end date',
  'plan.price.free': 'Free',
  'plan.price.per_month': '{amount} a month',
  'plan.ends_on': 'Your free access ends on {date}.',
  'plan.ends_on_or_actions': 'Ends on {date}, or when the AI actions run out, whichever comes first.',
  'plan.ends.while_paid': 'While the plan is paid for. An admin can set an end date on one account.',
  'plan.changes.no_end_date':
    'Your access has no end date. Business OS is normally a paid monthly plan, so if that ever changes for your account we will tell you first and you will be able to choose a plan.',
  'plan.changes.on_end':
    'When this ends you will be able to choose a paid monthly plan. Nothing is charged before you choose one.',
  'plan.problem.unavailable':
    'We could not load your plan just now. Nothing has changed about your account — please try again shortly.',
  'plan.problem.no_record':
    'We do not have a plan record for this account yet. Everything keeps working; get in touch if this stays here.',
  'plan.move_before_then': 'Get in touch if you would like to move plan before then.',
  'plan.category.crm': 'Clients (CRM)',
  'plan.category.website_intake': 'Website and enquiries',
  'plan.category.payments': 'Payments',
  'plan.category.ai_chat': 'AI assistant',
  'plan.category.marketing': 'Marketing',
  'plan.category.insights': 'Insights',
  'plan.category.support': 'Support',
  'plan.category.platform': 'Platform',
  'plan.category.addon': 'Add-ons',
};

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => COPY[key] ?? key,
    isRTL: false,
    language: 'en',
  }),
}));

const NOW = new Date('2026-09-27T00:00:00.000Z');

/** The payload the route would send for an account on this plan. */
function payloadFor(planId: string) {
  const config = readCodeConfig();
  const resolution = resolveEntitlements({
    config,
    account: previewAccountFor(config, planId, NOW),
    overrides: [],
    addons: [],
    now: NOW,
  });

  return buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config });
}

function serve(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => body,
  }) as unknown as typeof fetch;
}

async function renderFor(planId: string) {
  serve({ success: true, data: payloadFor(planId) });
  render(<PlanSection />);
  await waitFor(() => expect(screen.queryByText(/Loading your plan/i)).not.toBeInTheDocument());
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a Founding Partner', () => {
  it('sees the name and that it is free with no end date', async () => {
    await renderFor('champion');

    // ONCE: the plan name. The pill that briefly sat beside it was dropped, so a
    // second occurrence here would mean it had come back.
    expect(screen.getAllByText('Founding Partner')).toHaveLength(1);
    expect(screen.getByText(/Free — no end date/i)).toBeInTheDocument();
  });

  it('a DATED champion sees the date and nothing claiming "no end date" (SA R4-1)', async () => {
    // The payload property is asserted in the view suite; this closes the class at
    // the DOM, which is where the fourth claim-bearing surface lives — `priceLine`
    // prints "Free — no end date" and reads the same field. A fifth would be
    // caught here too, which is the point of asserting on rendered text.
    const config = readCodeConfig();
    const dated = resolveEntitlements({
      config,
      account: { ...previewAccountFor(config, 'champion', NOW), cohortExpiresAt: '2026-12-01T00:00:00.000Z' },
      overrides: [],
      addons: [],
      now: NOW,
    });

    serve({ success: true, data: buildCustomerPlanView({ resolution: dated, unavailable: false, now: NOW, config }) });
    render(<PlanSection />);
    await waitFor(() => expect(screen.queryByText(/Loading your plan/i)).not.toBeInTheDocument());

    // The date is on screen …
    expect(screen.getByText(/December 1, 2026/)).toBeInTheDocument();
    // … and nothing anywhere says the opposite, including the pill's tooltip and
    // the price line.
    expect(document.body.textContent ?? '').not.toMatch(/no end date/i);
    // No pill on this surface any more, so the claim-bearing strings here are the
    // two sentences and the price line — all covered by the body-text assertion
    // above.
    expect(screen.queryByTestId('plan-badge-pill')).not.toBeInTheDocument();
  });

  it('renders NO plan pill — the one pill lives in the chrome (user decision)', async () => {
    // Dropped 2026-09-27: the heading already prints the plan name, so a pill
    // beside it repeated it. Asserted rather than merely absent, so a third attempt
    // to add one fails here and reads the reason.
    await renderFor('champion');

    expect(screen.queryByTestId('plan-badge-pill')).not.toBeInTheDocument();
  });

  it('is shown NO plan above — the section is absent, not an empty box', async () => {
    // Parity (2026-09-27): a Founding Partner has Autopilot's capabilities AND its
    // allowance, so there is nothing above them. This assertion inverted with that
    // change — it briefly expected Autopilot to be offered, back when the cohort
    // pinned a smaller allowance than the tier it inherits.
    await renderFor('champion');

    expect(screen.queryByText(/Autopilot/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Essentials/)).not.toBeInTheDocument();
    // No heading, no price, no badge — the whole block is gone rather than
    // rendered empty.
    expect(screen.queryByText(/would add/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Coming soon/i)).not.toBeInTheDocument();
    // And the one sentence that still prepares them for a future change is there.
    expect(screen.getByText(/Business OS is normally a paid monthly plan/i)).toBeInTheDocument();
  });

  it('is told everything it has, by name', async () => {
    await renderFor('champion');

    // Grouped rows: the category names are the lines, and the capability names
    // live inside each row's summary. Both halves checked, against the payload's
    // OWN strings — a substring like "Invoices" now appears in two summaries
    // (Payments, and the AI assistant's invoice control), so an exact match on the
    // row is the only unambiguous assertion.
    const payload = payloadFor('champion');
    const included = within(screen.getByRole('list', { name: /What your plan includes/i }));

    for (const category of ['crm', 'payments']) {
      const row = payload.included.find((entry) => entry.category === category)!;
      expect(included.getByText(COPY[row.labelKey] ?? row.labelKey)).toBeInTheDocument();
      expect(included.getByText(row.summary)).toBeInTheDocument();
    }

    // Non-vacuity: those two rows really do name the capabilities somebody came
    // to check.
    expect(payload.included.find((entry) => entry.category === 'crm')!.summary).toMatch(
      /Contacts, pipeline and tasks/
    );
    expect(payload.included.find((entry) => entry.category === 'payments')!.summary).toMatch(/Invoices/);
  });
});

describe('a paying customer on Essentials', () => {
  it('sees the price, and Autopilot as information rather than an offer', async () => {
    await renderFor('basic');

    expect(screen.getByText('Essentials')).toBeInTheDocument();
    expect(screen.getByText(/\$79 a month/)).toBeInTheDocument();

    // "Autopilot" now appears twice — in the section heading and in the list's
    // accessible name — since R2-1 gave the lists visible headings. Asserted on
    // the heading, which is the element a sighted reader actually sees.
    expect(screen.getByRole('heading', { name: /What Autopilot would add/i })).toBeInTheDocument();
    expect(screen.getByText(/500 per month becomes 2,000 per month/)).toBeInTheDocument();
  });

  it('has nothing to click, and the unavailability is VISIBLE — not a dead button', async () => {
    await renderFor('basic');

    // `availableToBuy` is false, so there is no control at all — and the reason is
    // on screen. A price with silence beside it reads as a broken page; a button
    // that cannot honour itself is worse than none.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument();
    expect(screen.getByText(/get in touch if you would like to move plan/i)).toBeInTheDocument();
  });

  it('does not print "yes" beside every feature it has', async () => {
    await renderFor('basic');

    // "Client documents (yes)" in a list titled "what your plan includes" is
    // noise. A number is the opposite: it is the information — so a value is
    // printed only when it says something, and `yes` never appears.
    expect(screen.queryByText(/\(yes\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/— yes/)).not.toBeInTheDocument();

    // Scoped to the INCLUDED list BY NAME. A positional query
    // (`getAllByRole('list')[0]`) passed when the included list was empty,
    // because it then found the next-plan list, which carries the same number.
    //
    // The number now sits inside the AI assistant row's summary, as
    // "AI actions (500 per month)" — grouping put the value in brackets beside
    // its own name rather than on a line of its own.
    const included = within(screen.getByRole('list', { name: /What your plan includes/i }));
    expect(included.getByText(/AI actions \(500 per month\)/)).toBeInTheDocument();
  });
});

describe('a trial', () => {
  it('is told when it ends and what the paid plan would add', async () => {
    await renderFor('trial');

    expect(screen.getByText('Test Flight')).toBeInTheDocument();
    expect(screen.getByText(/ends on \w+ \d+, \d{4}/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is charged before you choose one/i)).toBeInTheDocument();
  });
});

describe('chat is named like anything else (2026-09-27)', () => {
  it('Autopilot lists it among what the plan includes', async () => {
    // The reversal, at the last boundary. It used to be suppressed everywhere
    // because the plans withheld something nothing enforced; chat is in testing
    // and available now, so naming it is the honest thing.
    await renderFor('pro');

    const included = within(screen.getByRole('list', { name: /What your plan includes/i }));
    expect(included.getByText(/AI chat assistant/i)).toBeInTheDocument();
  });

  it('Essentials is told chat is what Autopilot would add', async () => {
    await renderFor('basic');

    const upgrade = within(screen.getByRole('list', { name: /What Autopilot would add/i }));
    expect(upgrade.getByText(/AI chat assistant/i)).toBeInTheDocument();
  });

  it('but no plan is described by what it withholds', async () => {
    // The narrower rule that replaced the suppression, at the pixel level.
    await renderFor('basic');

    expect(document.body.textContent ?? '').not.toMatch(
      /not included|excluded|does not include|do not have/i
    );
  });
});

describe('a cross-unit difference is shown as a CHANGE, not a gain (SA R2-1, QA-9)', () => {
  it('lives in its OWN list, with its own accessible name', async () => {
    // The finding: all three arrays rendered inside one `<ul>` named "What
    // Autopilot would add", so a screen-reader user was told "would add" about an
    // item the server explicitly refused to call a gain. The distinction existed
    // only in a muted arrow versus a muted tick — the one channel assistive
    // technology does not receive.
    await renderFor('trial');

    const changes = within(screen.getByRole('list', { name: /What changes on Essentials/i }));
    expect(changes.getByText(/AI actions/)).toBeInTheDocument();

    // And it is a DIFFERENT list from the additions one, not the same node found
    // twice.
    const adds = screen.getByRole('list', { name: /What Essentials would add/i });
    expect(adds).not.toBe(screen.getByRole('list', { name: /What changes on Essentials/i }));
  });

  it('uses different WORDS, not just a different icon', async () => {
    // The text is the other half of what assistive technology receives. "becomes"
    // is the improvements sentence; a change says outright that the number is
    // different rather than larger, which is exactly what `comparableAmount`
    // declined to decide.
    await renderFor('trial');

    expect(
      screen.getByText(/from 250 in total to 500 per month, which is different rather than larger/)
    ).toBeInTheDocument();
  });

  it('the improvements list still says "becomes", so the two read differently', async () => {
    // Non-vacuity for the assertion above: both sentences exist on the same
    // screen, and they are not the same sentence.
    await renderFor('trial');

    const improvements = within(screen.getByRole('list', { name: /What Essentials would add/i }));
    expect(improvements.getByText(/becomes/)).toBeInTheDocument();
  });

  it('a plan with no cross-unit difference renders no changes list at all', async () => {
    // Essentials → Autopilot differs only in chat (an addition) and the allowance
    // (a same-unit improvement), so there is nothing to report as a change.
    await renderFor('basic');

    expect(screen.queryByRole('list', { name: /What changes on/i })).not.toBeInTheDocument();
  });
});

describe('when it cannot be loaded', () => {
  it('says so in place, rather than rendering an empty plan', async () => {
    serve({ success: false, error: 'nope' });
    render(<PlanSection />);

    await waitFor(() =>
      expect(screen.getByText(/could not load your plan/i)).toBeInTheDocument()
    );
    // And it reassures rather than alarms: nothing has changed about the account.
    expect(screen.getByText(/Nothing has changed about your account/i)).toBeInTheDocument();
  });

  it('a network failure is the same message, not an unhandled rejection', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    render(<PlanSection />);

    await waitFor(() => expect(screen.getByText(/could not load your plan/i)).toBeInTheDocument());
  });

  it('a missing plan record is its own message', async () => {
    const config = readCodeConfig();
    serve({
      success: true,
      data: buildCustomerPlanView({ resolution: null, unavailable: false, now: NOW, config }),
    });
    render(<PlanSection />);

    await waitFor(() =>
      expect(screen.getByText(/do not have a plan record/i)).toBeInTheDocument()
    );
  });
});

describe('the contract with the server', () => {
  it('renders the payload the builder produces — a renamed field fails here', async () => {
    // The gap QA found on the admin page. Every string below comes from the real
    // builder, so this is the page and the payload compared, not the page and a
    // fixture somebody remembered to update.
    const payload = payloadFor('basic');

    await renderFor('basic');

    // Non-vacuity FIRST. Emptying `included` server-side used to leave this
    // test iterating an empty array and passing, which is the one failure mode a
    // contract test must not have.
    expect(payload.included.length).toBeGreaterThanOrEqual(3);

    const included = within(screen.getByRole('list', { name: /What your plan includes/i }));
    expect(screen.getByText(payload.name!)).toBeInTheDocument();

    // Grouped rows since 2026-09-27: each row prints its category label and the
    // server-built `summary`. Both are asserted, because a component that printed
    // the label and dropped the summary would still look like a list.
    for (const row of payload.included.slice(0, 3)) {
      expect(included.getByText(COPY[row.labelKey] ?? row.labelKey)).toBeInTheDocument();
      expect(included.getByText(row.summary)).toBeInTheDocument();
    }
  });

  it('an emptied `included` fails this suite in more than one place', () => {
    // The mutation that exposed the two problems above, as a property rather
    // than as a memory: the component must have a distinct, findable list for
    // what the plan includes, so its absence cannot be papered over by a
    // neighbouring list.
    const payload = payloadFor('basic');

    expect(payload.included.length).toBeGreaterThan(0);
    expect(payload.nextPlanUp).not.toBeNull();
    // Two different lists, so a query for one can never accidentally answer for
    // the other.
    expect(payload.included.map((row) => row.category)).not.toEqual(
      payload.nextPlanUp!.improves.map((entry) => entry.capability)
    );
  });
});
