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
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
    inheritsFrom: null,
    aiActions: '500 per month',
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
        capability: 'ai.actions',
        label: 'AI actions',
        category: 'ai_chat',
        display: '500 per month',
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
    expect(within(card).getByTestId('plan-paid-plan-ai')).toHaveTextContent('500 per month');
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
    expect(within(lookup).getByRole('link', { name: /Users/ })).toHaveAttribute('href', '/admin/users');
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
