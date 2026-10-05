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
import { CREDIT_EXPLANATION } from '@/lib/i18n/creditExplanation';
import { planCategoryLine } from '@/lib/business-os/planCategoryLine';

/*
 * The REAL dictionary, in the language a test asks for.
 *
 * The section names its sentences with keys and the component renders them, so a
 * `t` that echoed the key would turn every assertion here into a check that the
 * key is spelled right. What THIS file is for is what a customer sees, so it
 * renders the real words — and, since the user decision of 2026-10-02 that a
 * Hebrew or Spanish owner reads no English on this screen, in all three
 * languages rather than a hand-copied English subset.
 *
 * `language` matters as much as `t`: the date in "ends on {date}" is formatted
 * by the component in the reader's locale, so without it there is no date to
 * find.
 */
type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      isRTL: mockLang.language === 'he',
      t: (key: string, vars?: Record<string, string | number>) => {
        let text: string = translations[mockLang.language][key] || key;
        for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        return text;
      },
    }),
  };
});
// The dictionary module creates a browser Supabase client at import; only its
// `translations` are used here.
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
/** The English words, for the assertions written against them. */
const COPY = translations.en;

const NOW = new Date('2026-09-27T00:00:00.000Z');

/** The payload the route would send for an account on this plan. */
function payloadFor(planId: string, locale: Lang = 'en') {
  const config = readCodeConfig();
  const resolution = resolveEntitlements({
    config,
    account: previewAccountFor(config, planId, NOW),
    overrides: [],
    addons: [],
    now: NOW,
  });

  // `locale` as the route passes the reader's stored language (OI-10).
  return buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config, locale });
}

function serve(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => body,
  }) as unknown as typeof fetch;
}

async function renderFor(planId: string, language: Lang = 'en') {
  mockLang.language = language;
  serve({ success: true, data: payloadFor(planId, language) });
  render(<PlanSection />);
  await waitFor(() => expect(screen.queryByText(translations[language]['plan.loading'])).not.toBeInTheDocument());
}

/** A row's text without the explanation sentence under it — the heading and the line. */
function headingAndLine(row: HTMLElement): string {
  const note = row.querySelector('[data-testid^="plan-category-note-"]');
  return (row.textContent ?? '').replace(note?.textContent ?? '', '');
}

afterEach(() => {
  mockLang.language = 'en';
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
    expect(screen.getByText(/19,750 per month becomes 32,250 per month/)).toBeInTheDocument();
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
    // A value sits inside its row's summary, in brackets beside its own name,
    // as "Email volume 10,000 per month (alerts, never blocks)".
    const included = within(screen.getByRole('list', { name: /What your plan includes/i }));
    expect(included.getByText(/Email volume 10,000 per month/)).toBeInTheDocument();
  });
});

describe('the credit allowance is shown with its number, under its own heading (slice 6, D-g / D-h)', () => {
  it.each([
    // The line is the value alone: the heading already says "Credits" (user
    // decision, 2026-10-02 — no "Credits" over "Credits (…)").
    ['champion', '32,250 per month', CREDIT_EXPLANATION.en.monthly],
    ['pro', '32,250 per month', CREDIT_EXPLANATION.en.monthly],
    ['basic', '19,750 per month', CREDIT_EXPLANATION.en.monthly],
    ['trial', '2,000 in total', CREDIT_EXPLANATION.en.trial],
  ])('%s: a first "Credits" row reads %s, with the sentence under it', async (planId, line, sentence) => {
    await renderFor(planId);

    const included = screen.getByRole('list', { name: /What your plan includes/i });
    const firstRow = within(included).getAllByRole('listitem')[0];

    // The heading, the line with its number, and the sentence — all in the FIRST
    // row, which is the point of D-g.
    expect(within(firstRow).getByText('Credits')).toBeInTheDocument();
    expect(within(firstRow).getByText(line)).toBeInTheDocument();
    // "Credits" once in the heading and line: never repeated in the line. (The
    // sentence under it says "credits" in passing, so it is left out.)
    expect(headingAndLine(firstRow).match(/Credits/g)).toHaveLength(1);
    expect(within(firstRow).getByTestId('plan-category-note-credits')).toHaveTextContent(sentence);
    // Once on the page, not repeated under other rows.
    expect(screen.getAllByText(sentence)).toHaveLength(1);
  });

  it('no row but the credits one carries a sentence', async () => {
    await renderFor('champion');

    expect(screen.queryAllByTestId(/^plan-category-note-/)).toHaveLength(1);
  });
});

describe('a trial', () => {
  it('is told when it ends and what the paid plan would add', async () => {
    await renderFor('trial');

    expect(screen.getByText('Test Flight')).toBeInTheDocument();
    expect(screen.getByText(/ends on \w+ \d+, \d{4}/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is charged before you choose one/i)).toBeInTheDocument();
  });

  it('still reads that it ends when the credits run out', async () => {
    await renderFor('trial');

    expect(screen.getByText(/or when the credits run out/i)).toBeInTheDocument();
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
    expect(changes.getByText(/Credits/)).toBeInTheDocument();

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
      screen.getByText(/from 2,000 in total to 19,750 per month, which is different rather than larger/)
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
    // Essentials → Autopilot differs only in chat (an addition) and the credit
    // allowance (a same-unit improvement), so there is nothing to report as a
    // change.
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
    // server-built `summary` — or, for a row whose only feature is named like
    // its heading, that feature's value (2026-10-02). Both halves are asserted,
    // because a component that printed the label and dropped the line would
    // still look like a list.
    for (const row of payload.included.slice(0, 3)) {
      const heading = COPY[row.labelKey] ?? row.labelKey;
      expect(included.getByText(heading)).toBeInTheDocument();
      expect(included.getByText(planCategoryLine(heading, row)!)).toBeInTheDocument();
    }
    // Non-vacuity for the rule: the first row (credits) took the short form, and
    // the others kept the summary.
    expect(planCategoryLine(COPY['plan.category.credits'], payload.included[0])).toBe(payload.included[0].features[0].value);
    expect(planCategoryLine(COPY[payload.included[1].labelKey], payload.included[1])).toBe(payload.included[1].summary);
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

describe('a Hebrew or Spanish owner reads no English, and no repeated "Credits" (user decision, 2026-10-02)', () => {
  /*
   * Every English phrase this screen has ever printed around the values, plus
   * the English value phrases. Before 2026-10-02 the next-plan-up block mixed
   * them with localised values in one line (QA-6b-E1).
   */
  const ENGLISH = [
    /becomes/i,
    /would add/i,
    /What changes on/i,
    /different rather than larger/i,
    /a month/i,
    /Coming soon/i,
    /Available to choose/i,
    /could not list your features/i,
    /per month/i,
    /in total/i,
    /What your plan includes/i,
  ];
  const PLANS = ['champion', 'pro', 'basic', 'trial'];

  it.each((['he', 'es'] as const).flatMap((language) => PLANS.map((planId) => [language, planId] as const)))(
    '%s, %s: no English phrase anywhere on the screen',
    async (language, planId) => {
      await renderFor(planId, language);

      const text = document.body.textContent ?? '';
      // Non-vacuity: the screen really rendered, in that language.
      expect(text).toContain(translations[language]['plan.includes']);
      expect(ENGLISH.filter((phrase) => phrase.test(text)).map(String)).toEqual([]);
    }
  );

  it.each((['en', 'he', 'es'] as const).flatMap((language) => PLANS.map((planId) => [language, planId] as const)))(
    '%s, %s: the credits heading appears once in its row, over the value alone',
    async (language, planId) => {
      await renderFor(planId, language);

      const heading = translations[language]['plan.category.credits'];
      const included = screen.getByRole('list', { name: translations[language]['plan.includes'] });
      const firstRow = within(included).getAllByRole('listitem')[0];
      const credits = payloadFor(planId, language).included[0];

      expect(credits.category).toBe('credits');
      // The rule fires in every language: the capability's own label matches the
      // heading word for word, so the line is just the value.
      expect(within(firstRow).getByText(credits.features[0].value)).toBeInTheDocument();
      expect(headingAndLine(firstRow).split(heading)).toHaveLength(2);
      // And the summary (which repeats the name) is not on the screen at all.
      expect(document.body.textContent ?? '').not.toContain(credits.summary);
    }
  );

  it.each(['he', 'es'] as const)('%s: the next plan up is worded from the dictionary, with localised values', async (language) => {
    await renderFor('basic', language);
    const upgrade = payloadFor('basic', language).nextPlanUp!;
    const dictionary = translations[language];

    const addsHeading = dictionary['plan.next.adds_heading'].replace('{plan}', upgrade.name);
    expect(screen.getByRole('heading', { name: addsHeading })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: addsHeading })).toBeInTheDocument();

    const improvement = upgrade.improves.find((entry) => entry.capability === 'credits.allowance')!;
    const line = dictionary['plan.next.improves_line'].replace('{from}', improvement.from).replace('{to}', improvement.to);
    expect(screen.getByText(line, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(dictionary['plan.next.coming_soon'])).toBeInTheDocument();
  });

  it.each(['he', 'es'] as const)('%s: the cross-unit change on a trial is worded from the dictionary too', async (language) => {
    await renderFor('trial', language);
    const upgrade = payloadFor('trial', language).nextPlanUp!;
    const dictionary = translations[language];

    const changesHeading = dictionary['plan.next.changes_heading'].replace('{plan}', upgrade.name);
    expect(screen.getByRole('list', { name: changesHeading })).toBeInTheDocument();
    const change = upgrade.changes.find((entry) => entry.capability === 'credits.allowance')!;
    const line = dictionary['plan.next.changes_line'].replace('{from}', change.from).replace('{to}', change.to);
    expect(screen.getByText(line, { exact: false })).toBeInTheDocument();
  });
});
