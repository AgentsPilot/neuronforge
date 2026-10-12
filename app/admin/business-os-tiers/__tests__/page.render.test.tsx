/**
 * @jest-environment jsdom
 *
 * What an admin actually reads on the Business OS Tiers screen.
 *
 * The assertions are about the things that would mislead somebody if they were
 * wrong: the enforcement banner, the price and allowance on each card, the
 * cannot-be-sold list, and the fact that nothing here offers to change
 * anything.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';

import BusinessOsTiersPage from '../page';
import type { Plan, PlansPayload } from '../types';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    // INVENTED ids, names and prices. A fixture that used the real ones would
    // make FR-12 fail (tier names live in config and nowhere else) and, worse,
    // would let a render test agree with a typo in the price list.
    id: 'paid-plan',
    kind: 'tier',
    name: 'Fixture Paid Plan',
    monthlyPriceUsd: 42,
    // Public but not sellable by default — the state the product actually ships
    // in, and the one where the two flags DISAGREE, so a card that rendered only
    // one of them would pass by luck.
    shownToCustomers: true,
    availableToBuy: false,
    active: true,
    inheritsFrom: null,
    credits: '19,750 per month',
    endsWhen: 'While the plan is paid for.',
    state: 'active',
    basis: 'tier',
    includes: [
      {
        capability: 'crm.core',
        label: 'CRM',
        category: 'crm',
        display: 'yes',
        granting: true,
        gateBuilt: false,
      },
      {
        capability: 'credits.allowance',
        label: 'Credits',
        category: 'ai_chat',
        display: '19,750 per month',
        granting: true,
        gateBuilt: false,
      },
    ],
    withholds: [
      {
        capability: 'chat.access',
        label: 'AI chat assistant',
        category: 'ai_chat',
        display: 'no',
        granting: false,
        // The case SA R-1 is about: the plan withholds it and nothing refuses it.
        gateBuilt: false,
      },
    ],
    ...overrides,
  };
}

function payload(overrides: Partial<PlansPayload> = {}): PlansPayload {
  return {
    generatedAt: '2026-09-24T09:00:00.000Z',
    mode: 'off',
    modeEnvVar: 'BOS_ENTITLEMENTS_MODE',
    modeMeaning: 'Nothing is resolved, nothing is recorded and nothing is blocked.',
    enforced: false,
    matrixVersion: 1,
    withheldWithoutGate: ['chat.access'],
    plans: [plan()],
    notBuilt: [
      {
        capability: 'marketing.posts',
        label: 'Post creation',
        category: 'marketing',
        note: 'No post composer or scheduler in the repository.',
      },
    ],
    writeOpsNotOnThisPage: ['assign_tier', 'launch_champion_existing'],
    ...overrides,
  };
}

function stubFetch(data: PlansPayload) {
  return jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, data }),
  })) as unknown as typeof fetch;
}

async function renderPage(data: PlansPayload = payload()) {
  global.fetch = stubFetch(data);
  render(<BusinessOsTiersPage />);
  await waitFor(() => expect(screen.getByTestId('enforcement-banner')).toBeInTheDocument());
}

describe('which plans are public, and which are sellable', () => {
  it('shows BOTH commercial flags on every card, including when they disagree', async () => {
    // The user asked for this explicitly: an operator should see at a glance
    // which plans are public and which are sellable. They are different
    // questions, and "public but not yet sellable" — the state the product ships
    // in — is exactly the combination a single badge would hide.
    await renderPage();

    expect(screen.getByTestId('plan-paid-plan-shown')).toHaveTextContent(/shown to customers/i);
    expect(screen.getByTestId('plan-paid-plan-buyable')).toHaveTextContent(/not available to buy/i);
  });

  it('an INACTIVE plan is unmistakable, and says it is FYI only (2026-09-29)', async () => {
    // Words AND styling: the badge reads INACTIVE and the card is dashed and
    // dimmed, so the state is never carried by styling alone. The tooltip says it
    // changes nothing, because "inactive" otherwise reads as a switch.
    await renderPage(payload({ plans: [plan({ active: false })] }));

    const badge = screen.getByTestId('plan-paid-plan-active');
    expect(badge).toHaveTextContent('INACTIVE');
    expect(badge).toHaveAttribute('title', expect.stringMatching(/FYI only/i));
    expect(screen.getByTestId('plan-paid-plan').className).toMatch(/border-dashed/);
  });

  it('an active plan says "active" quietly and is not dashed', async () => {
    await renderPage();

    expect(screen.getByTestId('plan-paid-plan-active')).toHaveTextContent(/^active$/);
    expect(screen.getByTestId('plan-paid-plan').className).not.toMatch(/border-dashed/);
  });

});

describe('the enforcement banner', () => {
  it('says nothing is enforced, and shows the mode it was given', async () => {
    await renderPage();

    const banner = screen.getByTestId('enforcement-banner');
    expect(banner).toHaveTextContent(/Nothing on this page is enforced/i);
    expect(within(banner).getByTestId('enforcement-mode')).toHaveTextContent('off');
    expect(banner).toHaveTextContent('BOS_ENTITLEMENTS_MODE');
  });

  it('explains shadow in plain words: recorded, not blocked', async () => {
    await renderPage(
      payload({
        mode: 'shadow',
        modeMeaning:
          'Usage is resolved and recorded so it can be measured. NOTHING IS BLOCKED — every customer keeps every feature, whatever their plan says below.',
      })
    );

    const banner = screen.getByTestId('enforcement-banner');
    expect(within(banner).getByTestId('enforcement-mode')).toHaveTextContent('shadow');
    expect(banner).toHaveTextContent(/NOTHING IS BLOCKED/);
    expect(banner).toHaveTextContent(/recorded/i);
  });

  it('changes its words when enforcement is ON rather than disappearing', async () => {
    // A banner that vanishes in the one state that matters is a banner nobody
    // learns to look for — and "nothing is enforced" would then be false.
    await renderPage(payload({ mode: 'enforce', enforced: true, modeMeaning: 'Decisions are acted on.' }));

    const banner = screen.getByTestId('enforcement-banner');
    expect(banner).toHaveTextContent(/being ENFORCED/i);
    expect(banner).not.toHaveTextContent(/Nothing on this page is enforced/i);
  });

  it('cannot be dismissed', async () => {
    await renderPage();
    const banner = screen.getByTestId('enforcement-banner');
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('the plan cards', () => {
  it('shows the marketing name, the internal id, the price and the allowance', async () => {
    await renderPage();

    const card = screen.getByTestId('plan-paid-plan');
    expect(card).toHaveTextContent('Fixture Paid Plan');
    // The id is what the `tier` column holds — an admin reading a plan row
    // needs the mapping in front of them.
    expect(card).toHaveTextContent('paid-plan');
    expect(card).toHaveTextContent('$42');
    expect(within(card).getByTestId('plan-paid-plan-credits')).toHaveTextContent('19,750 per month');
    expect(within(card).getByTestId('plan-paid-plan-ends')).toHaveTextContent(/paid for/i);
  });

  it('shows a free plan as free rather than as $0', async () => {
    await renderPage(payload({ plans: [plan({ id: 'free-plan', kind: 'cohort', name: 'Fixture Free Plan', monthlyPriceUsd: 0, inheritsFrom: 'paid-plan' })] }));

    const card = screen.getByTestId('plan-free-plan');
    expect(card).toHaveTextContent('Free');
    expect(card).toHaveTextContent(/Inherits/i);
  });

  it('lists what is included, and reveals what is withheld on request', async () => {
    await renderPage();

    const card = screen.getByTestId('plan-paid-plan');
    expect(card).toHaveTextContent('CRM');
    expect(screen.queryByTestId('plan-paid-plan-withholds')).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: /Withholds/ }));

    const withheld = screen.getByTestId('plan-paid-plan-withholds');
    expect(withheld).toHaveTextContent('AI chat assistant');
  });

  it('does not repeat "yes" after a capability that is simply on', async () => {
    await renderPage();
    const card = screen.getByTestId('plan-paid-plan');
    expect(card).not.toHaveTextContent('CRM — yes');
  });
});

describe('withheld is not the same as refused (SA R-1)', () => {
  // The banner covers this while nothing is enforced at all. The moment its
  // words change, these markers are the only thing standing between the page
  // and a false claim about one specific capability.
  it('shows the marker beside the capability once the list is open', async () => {
    await renderPage();

    await userEvent.click(
      within(screen.getByTestId('plan-paid-plan')).getByRole('button', { name: /Withholds/ })
    );

    expect(screen.getByTestId('no-gate-chat.access')).toHaveTextContent('no gate yet');
  });

  it('drops the marker when a gate exists, without anyone editing this page', async () => {
    // Self-clearing: `gateBuilt` comes from `ENFORCEMENT_POINTS`, whose entries
    // are checked against the source in both directions. Registering a real
    // gate is what removes the marker — there is no note to delete.
    await renderPage(
      payload({
        withheldWithoutGate: [],
        plans: [
          plan({
            withholds: [
              {
                capability: 'chat.access',
                label: 'AI chat assistant',
                category: 'ai_chat',
                display: 'no',
                granting: false,
                gateBuilt: true,
              },
            ],
          }),
        ],
      })
    );

    await userEvent.click(
      within(screen.getByTestId('plan-paid-plan')).getByRole('button', { name: /Withholds/ })
    );

    expect(screen.queryByTestId('no-gate-chat.access')).not.toBeInTheDocument();
    expect(screen.queryByTestId('no-gate-summary')).not.toBeInTheDocument();
  });

  it('states the size of the gap once, above the cards', async () => {
    await renderPage();

    const summary = screen.getByTestId('no-gate-summary');
    expect(summary).toHaveTextContent(/no gate built yet/i);
    expect(summary).toHaveTextContent('chat.access');
    // It must not read as a permanent property of the product.
    expect(summary).toHaveTextContent(/shrinks by itself/i);
  });
});

describe('the account lookup says why it wants an id', () => {
  it('names the reason and points at the screen that does search people', async () => {
    await renderPage();

    const lookup = screen.getByTestId('account-lookup');
    expect(lookup).toHaveTextContent(/not an email/i);
    expect(lookup).toHaveTextContent(/look people up/i);
    expect(within(lookup).getByRole('link', { name: /Businesses/ })).toHaveAttribute('href', '/admin/users');
  });
});

describe('the cannot-be-sold list', () => {
  it('names each capability, its id and the recorded reason', async () => {
    await renderPage();

    const panel = screen.getByTestId('not-built-panel');
    expect(panel).toHaveTextContent(/Cannot be sold/i);
    expect(panel).toHaveTextContent(/No plan may include one/i);

    const row = within(panel).getByTestId('not-built-marketing.posts');
    expect(row).toHaveTextContent('Post creation');
    expect(row).toHaveTextContent('marketing.posts');
    expect(row).toHaveTextContent('No post composer or scheduler in the repository.');
  });
});

describe('read-only', () => {
  it('names the write operations it deliberately does not offer', async () => {
    await renderPage();

    expect(screen.getByText('assign_tier')).toBeInTheDocument();
    expect(screen.getByText('launch_champion_existing')).toBeInTheDocument();
    expect(screen.getByText(/Changing any of this/i)).toBeInTheDocument();
  });

  it('has no control that submits a change — only the lookup and the disclosures', async () => {
    await renderPage();

    // The only button that posts anywhere is the account lookup, which reads.
    const buttons = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    for (const label of buttons) {
      expect(label).not.toMatch(/save|assign|apply|reset|launch|grant|revoke/i);
    }
  });
});

describe('when the payload cannot be read', () => {
  it('says so instead of rendering an empty page that looks like "no plans"', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ success: false, error: 'Could not read the Business OS plans' }),
    })) as unknown as typeof fetch;

    render(<BusinessOsTiersPage />);

    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    expect(screen.queryByTestId('enforcement-banner')).not.toBeInTheDocument();
    // An empty plan list with a reassuring banner would be the worst outcome:
    // it reads as "there are no plans", which is a different fact.
    expect(screen.queryByTestId('not-built-panel')).not.toBeInTheDocument();
  });
});

// ── Admin Layout Standard L-5 (T-1 to T-9, SA S-2, S-5, S-6) ─────────────────
// Appended; no case above is edited.

type StubResponse = { ok: boolean; status?: number; json: () => Promise<unknown> };

function okBody(data: PlansPayload): StubResponse {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}

/** A fetch whose answers are given in order; the last one repeats. */
function fetchSequence(...answers: Array<StubResponse | Error | 'pending'>) {
  let call = 0;
  const mock = jest.fn(() => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (answer === 'pending') return new Promise<StubResponse>(() => undefined);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer);
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

const SUBMIT_WORDS = /save|assign|apply|reset|launch|grant|revoke/i;
const tileText = (id: string) => screen.getByTestId(`kpi-${id}`).textContent;
const chipTone = (testId: string) =>
  screen.getByTestId(testId).querySelector('[data-tone]')?.getAttribute('data-tone');
const precedes = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('L-5 T-1: the shared header', () => {
  it('has one h1 with the sidebar label, the neutral Read-only chip, the purpose and the server As of', async () => {
    await renderPage();

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Plans & entitlements');
    expect(screen.queryByText(/Business OS Tiers/)).not.toBeInTheDocument();

    const badge = screen.getByTestId('read-only-badge');
    expect(badge).toHaveAttribute('data-tone', 'neutral');
    expect(badge.textContent).toBe('Read-only');

    expect(screen.getByText(/which is on the Onboarding page/)).toBeInTheDocument();
    expect(screen.getByTestId('as-of').textContent).toBe('As of 2026-09-24 09:00 UTC.');
  });
});

describe('L-5 T-2 to T-4: the KPI strip', () => {
  it('shows four tiles from the one payload, each an anchor to a section that exists (T-2)', async () => {
    await renderPage();

    // SA M-2: the base fixture's plan is not available to buy, so 0 of 1.
    expect(tileText('enforcement')).toBe('EnforcementOffNot enforced');
    expect(tileText('available')).toBe('Available to buy0of 1 plan');
    expect(tileText('no-gate')).toBe('Withheld with no gate1');
    expect(tileText('not-built')).toBe('Cannot be sold1');

    const targets: Array<[string, string]> = [
      ['enforcement', 'enforcement'],
      ['available', 'plans'],
      ['no-gate', 'withheld-without-gate'],
      ['not-built', 'not-built'],
    ];
    for (const [tile, target] of targets) {
      expect(screen.getByTestId(`kpi-${tile}`)).toHaveAttribute('href', `#${target}`);
      expect(document.getElementById(target)).not.toBeNull();
    }
  });

  it('says "plans" for more than one (SA Q-9)', async () => {
    await renderPage(payload({ plans: [plan(), plan({ id: 'second-plan', name: 'Fixture Second Plan' })] }));
    expect(tileText('available')).toBe('Available to buy0of 2 plans');
  });

  it('every tile is neutral, enforced or not, and the name reads label then value (T-3, SA Q-1)', async () => {
    await renderPage();
    for (const tile of ['enforcement', 'available', 'no-gate', 'not-built']) {
      expect(screen.getByTestId(`kpi-${tile}`)).toHaveAttribute('data-status', 'neutral');
    }
    expect(screen.getByTestId('kpi-enforcement')).toHaveAttribute('aria-label', 'Enforcement, Off');
  });

  it('stays neutral when enforcement is on (T-3, SA Q-1)', async () => {
    await renderPage(payload({ mode: 'enforce', enforced: true, modeMeaning: 'Decisions are acted on.' }));
    for (const tile of ['enforcement', 'available', 'no-gate', 'not-built']) {
      expect(screen.getByTestId(`kpi-${tile}`)).toHaveAttribute('data-status', 'neutral');
    }
    expect(tileText('enforcement')).toBe('EnforcementEnforceEnforced');
  });

  it('the no-gate tile has no target when nothing is withheld without a gate; a buyable plan counts (T-4)', async () => {
    await renderPage(payload({ withheldWithoutGate: [], plans: [plan({ availableToBuy: true })] }));

    const noGate = screen.getByTestId('kpi-no-gate');
    expect(noGate.tagName).toBe('DIV');
    expect(noGate).toHaveAttribute('role', 'group');
    expect(noGate).not.toHaveAttribute('href');
    expect(tileText('no-gate')).toBe('Withheld with no gate0');
    expect(screen.queryByTestId('no-gate-summary')).not.toBeInTheDocument();
    expect(tileText('available')).toBe('Available to buy1of 1 plan');
  });
});

describe('L-5 T-5: K-10 placeholders and the hidden strip', () => {
  it('shows placeholders and no tiles while the first read is pending', async () => {
    fetchSequence('pending');
    render(<BusinessOsTiersPage />);

    expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(4);
    expect(screen.queryByTestId('kpi-enforcement')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading the plans…');
  });

  it('shows no strip and no placeholders on a first-load error', async () => {
    fetchSequence({ ok: false, status: 500, json: async () => ({ success: false, error: 'Could not read the Business OS plans' }) });
    render(<BusinessOsTiersPage />);

    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    expect(screen.queryAllByTestId('kpi-placeholder')).toHaveLength(0);
    expect(screen.queryByTestId('kpi-enforcement')).not.toBeInTheDocument();
  });
});

describe('L-5 T-6: the read never shows a parser or browser message', () => {
  it('a body that is not JSON reads as the fixed sentence', async () => {
    fetchSequence({
      ok: false,
      status: 504,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });
    render(<BusinessOsTiersPage />);

    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    expect(screen.getByTestId('page-error').textContent).toBe('Could not read the plans. Try again in a moment.');
    expect(document.body.textContent).not.toContain('Unexpected token');
  });

  it('a rejected fetch reads as the network sentence', async () => {
    fetchSequence(new TypeError('Failed to fetch'));
    render(<BusinessOsTiersPage />);

    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    expect(screen.getByTestId('page-error').textContent).toBe(ADMIN_NETWORK_ERROR);
    expect(document.body.textContent).not.toContain('Failed to fetch');
  });

  it('a 401 says the session ended', async () => {
    fetchSequence({ ok: false, status: 401, json: async () => ({ success: false, error: 'Unauthorized' }) });
    render(<BusinessOsTiersPage />);

    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    expect(screen.getByTestId('page-error').textContent).toBe('Your admin session has ended. Sign in again.');
  });

  it('Try again reads again and shows the page', async () => {
    const mock = fetchSequence(new TypeError('Failed to fetch'), okBody(payload()));
    render(<BusinessOsTiersPage />);

    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByTestId('enforcement-banner')).toBeInTheDocument());
    expect(mock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('page-error')).not.toBeInTheDocument();
  });
});

describe('L-5 T-7: Refresh', () => {
  it('keeps the content mounted and busy while reading, and keeps the cards after a failed refresh', async () => {
    let settle: (answer: StubResponse) => void = () => undefined;
    const mock = jest.fn((): Promise<StubResponse> => Promise.resolve(okBody(payload())));
    global.fetch = mock as unknown as typeof fetch;
    render(<BusinessOsTiersPage />);
    await waitFor(() => expect(screen.getByTestId('enforcement-banner')).toBeInTheDocument());

    mock.mockImplementationOnce(() => new Promise<StubResponse>((resolve) => (settle = resolve)));
    const refresh = screen.getByRole('button', { name: 'Refresh the plans' });
    fireEvent.click(refresh);

    await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByTestId('enforcement-banner')).toBeInTheDocument();
    expect(screen.getByTestId('plans-content')).toHaveAttribute('aria-busy', 'true');

    settle({ ok: false, status: 500, json: async () => ({ success: false, error: 'Could not read the Business OS plans' }) });

    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    // The existing choice, pinned: the stale cards stay under the error…
    expect(screen.getByTestId('plan-paid-plan')).toBeInTheDocument();
    // …and the strip hides (K-10).
    expect(screen.queryByTestId('kpi-enforcement')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('kpi-placeholder')).toHaveLength(0);
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe('L-5 T-8: the plan-card chips', () => {
  it('maps each flag to its tone and keeps the exact words', async () => {
    await renderPage();

    expect(chipTone('plan-paid-plan-shown')).toBe('info');
    expect(chipTone('plan-paid-plan-buyable')).toBe('warn');
    expect(chipTone('plan-paid-plan-active')).toBe('neutral');
    expect(screen.getByTestId('plan-paid-plan-shown').textContent).toBe('shown to customers');
    expect(screen.getByTestId('plan-paid-plan-buyable').textContent).toBe('not available to buy');
    expect(screen.getByTestId('plan-paid-plan-active').textContent).toBe('active');

    await userEvent.click(within(screen.getByTestId('plan-paid-plan')).getByRole('button', { name: /Withholds/ }));
    expect(chipTone('no-gate-chat.access')).toBe('warn');
    expect(screen.getByTestId('no-gate-chat.access').textContent).toBe('no gate yet');
    expect(screen.getByTestId('no-gate-chat.access')).toHaveAttribute('title', expect.stringMatching(/nothing in the product refuses it/));
  });

  it('a buyable, hidden plan reads ok and neutral', async () => {
    await renderPage(payload({ plans: [plan({ availableToBuy: true, shownToCustomers: false })] }));

    expect(chipTone('plan-paid-plan-buyable')).toBe('ok');
    expect(chipTone('plan-paid-plan-shown')).toBe('neutral');
    expect(screen.getByTestId('plan-paid-plan-buyable').textContent).toBe('available to buy');
    expect(screen.getByTestId('plan-paid-plan-shown').textContent).toBe('not shown to customers');
  });

  it('INACTIVE is warn, not danger, keeps its FYI title, and the dashes agree (SA M-1)', async () => {
    await renderPage(payload({ plans: [plan({ active: false })] }));

    const wrapper = screen.getByTestId('plan-paid-plan-active');
    expect(chipTone('plan-paid-plan-active')).toBe('warn');
    expect(wrapper.textContent).toBe('INACTIVE');
    expect(wrapper).toHaveAttribute('title', expect.stringMatching(/FYI only/));
    const card = screen.getByTestId('plan-paid-plan');
    expect(card.className).toMatch(/border-dashed/);
    expect(card.className).toMatch(/border-amber-500\/60/);
    expect(card.className).not.toMatch(/rose/);
  });
});

describe('L-5 T-9: region order, one alert, no new landmark (SA S-5, S-6)', () => {
  it('puts the strip and Refresh above the banner, and the banner first in the content', async () => {
    await renderPage();

    const banner = screen.getByTestId('enforcement-banner');
    expect(precedes(screen.getByTestId('kpi-enforcement'), banner)).toBe(true);
    expect(precedes(screen.getByRole('button', { name: 'Refresh the plans' }), banner)).toBe(true);

    expect(screen.getByTestId('plans-content').firstElementChild).toBe(banner);
    expect(precedes(banner, screen.getByTestId('no-gate-summary'))).toBe(true);
    expect(precedes(banner, screen.getByTestId('plan-paid-plan'))).toBe(true);
    expect(banner).toHaveAttribute('role', 'note');

    // Anchor ids only: no section gains a name, so none becomes a region (A-9).
    expect(document.querySelectorAll('section[aria-label], section[aria-labelledby]')).toHaveLength(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('shows exactly one alert on a first-load error', async () => {
    fetchSequence(new TypeError('Failed to fetch'));
    render(<BusinessOsTiersPage />);

    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

describe('L-5 SA S-2: no submit control in the error state or while a lookup reads', () => {
  it('the error state offers only Refresh and Try again', async () => {
    fetchSequence(new TypeError('Failed to fetch'));
    render(<BusinessOsTiersPage />);
    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());

    const labels = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(labels).toContain('Try again');
    for (const label of labels) expect(label).not.toMatch(SUBMIT_WORDS);
  });

  it('a pending lookup shows "Reading…", and no button offers a change', async () => {
    const mock = fetchSequence(okBody(payload()), 'pending');
    render(<BusinessOsTiersPage />);
    await waitFor(() => expect(screen.getByTestId('enforcement-banner')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Account id'), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Look up/ }));

    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    const labels = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(labels).toContain('Reading…');
    for (const label of labels) expect(label).not.toMatch(SUBMIT_WORDS);
  });
});
