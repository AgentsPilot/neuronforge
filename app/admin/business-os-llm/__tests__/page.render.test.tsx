/**
 * @jest-environment jsdom
 *
 * S2-T3 … S2-T6, S2-T8, S2-T11 — what an admin actually reads.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { area, call, issue, stubFetch } from '@/tests/helpers/bos-llm-admin-fixtures';

import BusinessOsLlmSettingsPage from '../page';

async function renderPage(areas: ReturnType<typeof area>[], ledgerStatus = 400) {
  global.fetch = stubFetch({
    settings: { areas, generatedAt: '2026-09-23T09:00:00.000Z' },
    ledger: {
      status: ledgerStatus,
      body: { success: false, reason: 'too_long_ago', error: 'Too old.' },
    },
  }) as unknown as typeof fetch;

  render(<BusinessOsLlmSettingsPage />);
  await waitFor(() => expect(screen.getByText(areas[0].area)).toBeInTheDocument());
}

async function expand(name: string) {
  await userEvent.click(screen.getByRole('button', { expanded: false, name: new RegExp(name) }));
}

describe('S2-T3: resolved values and their provenance', () => {
  it('badges each field with the level it came from', async () => {
    await renderPage([
      area({
        calls: [
          call({
            resolved: {
              enabled: true,
              provider: 'openai',
              model: 'gpt-4o',
              temperature: 0.5,
            },
            provenance: {
              enabled: 'default',
              provider: 'area',
              model: 'call',
              temperature: 'area',
            },
          }),
        ],
      }),
    ]);
    await expand('insights');

    const model = screen.getByTestId('field-model');
    expect(within(model).getByTestId('provenance')).toHaveTextContent('call override');
    expect(model).toHaveTextContent('gpt-4o');

    expect(within(screen.getByTestId('field-provider')).getByTestId('provenance')).toHaveTextContent(
      'area'
    );
    expect(within(screen.getByTestId('field-enabled')).getByTestId('provenance')).toHaveTextContent(
      'code default'
    );
  });

  it('renders an unset temperature as "not set", never as 0', async () => {
    await renderPage([
      area({
        calls: [
          call({
            resolved: {
              enabled: true,
              provider: 'openai',
              model: 'gpt-4o-mini',
              temperature: null,
            },
          }),
        ],
      }),
    ]);
    await expand('insights');

    const temperature = screen.getByTestId('field-temperature');
    expect(temperature).toHaveTextContent('not set — the provider default applies');
    expect(temperature).not.toHaveTextContent(/(^|\s)0(\s|$)/);
  });
});

describe('S2-T4: issues sit against the field they affected', () => {
  it('shows the resolver’s own reason with a gloss beside it', async () => {
    await renderPage([
      area({
        calls: [
          call({
            issues: [
              issue({ field: 'model', kind: 'rejected', reason: 'unpriced_model: openai/gpt-nope' }),
              issue({ field: 'temperature', kind: 'adjusted', reason: 'temperature_clamped: 1.5' }),
            ],
          }),
        ],
      }),
    ]);
    await expand('insights');

    const model = screen.getByTestId('field-model');
    expect(within(model).getByTestId('field-issue')).toHaveTextContent(
      'unpriced_model: openai/gpt-nope'
    );
    expect(within(model).getByTestId('field-issue')).toHaveTextContent(
      'This value was refused, so the resolver fell back to the level below it.'
    );

    // The clamp is attached to temperature, not to the model.
    expect(within(screen.getByTestId('field-temperature')).getByTestId('field-issue')).toHaveTextContent(
      'temperature_clamped: 1.5'
    );
    expect(within(model).getAllByTestId('field-issue')).toHaveLength(1);
  });
});

describe('S2-T5: an area with no stored row', () => {
  it('says it runs on code defaults, with no attribution line and no error styling', async () => {
    await renderPage([
      area({
        rowPresent: false,
        storedRow: null,
        updatedAt: null,
        lastChangedBy: { kind: 'no_row' },
      }),
    ]);

    expect(screen.getByTestId('no-row-note')).toHaveTextContent(
      'No stored row — every call in this area is running on its code default.'
    );
    expect(screen.queryByTestId('last-changed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-error')).not.toBeInTheDocument();

    // The values are still shown, normally.
    await expand('insights');
    expect(screen.getByTestId('field-model')).toHaveTextContent('gpt-4o-mini');
  });
});

describe('S2-T6: locked fields are disabled and say why, as text', () => {
  it('disables the call switch and prints the reason, not only a tooltip', async () => {
    await renderPage([
      area({
        area: 'chat',
        switchable: true,
        calls: [
          call({
            callName: 'planner',
            locks: { switchable: false, lockedTemperature: 0, temperatureNotApplicable: false },
          }),
        ],
      }),
    ]);
    await expand('chat');

    expect(screen.getByLabelText('planner enabled')).toBeDisabled();

    const reasons = screen.getAllByTestId('lock-reason').map((node) => node.textContent);
    expect(reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('This call cannot be switched off on its own.'),
        expect.stringContaining('Temperature is fixed in code for this call.'),
      ])
    );
  });

  it('an area that can never be switched off says so instead of showing a state', async () => {
    await renderPage([area({ area: 'onboarding', switchable: false })]);

    expect(screen.getByTestId('state-chip')).toHaveTextContent('Cannot be switched off');
    await expand('onboarding');
    expect(screen.getByTestId('area-lock-reason')).toHaveTextContent(
      'This area can never be switched off'
    );
  });

  /*
   * QA DEF-S2-4. The inline notice used to render on EVERY expanded card, so
   * the one area that cannot be switched off was told, in consecutive lines,
   * that a switch-off is not a guarantee and that the switch-off cannot exist.
   * On the single card where the switch warning is inapplicable it was the
   * most prominent text.
   */
  it('the card with no switch carries no switch warning, and no contradiction', async () => {
    await renderPage([area({ area: 'onboarding', switchable: false })]);
    await expand('onboarding');

    expect(screen.queryByTestId('fail-open-inline')).not.toBeInTheDocument();

    const lock = screen.getByTestId('area-lock-reason');
    expect(lock).toHaveTextContent('This area can never be switched off');
    // What DOES still apply here is said instead: the model is this area's
    // only lever, and it fails open the same way.
    expect(lock).toHaveTextContent('There is no switch to fail open here');
    expect(lock).toHaveTextContent('back on their code-default provider and model');
    expect(lock.textContent).not.toMatch(/Confirm at this area’s ledger check/);
  });

  it('an area that CAN be switched off still carries the warning', async () => {
    await renderPage([area({ area: 'leads', switchable: true })]);
    await expand('leads');

    expect(screen.getByTestId('fail-open-inline')).toBeInTheDocument();
    expect(screen.queryByTestId('area-lock-reason')).not.toBeInTheDocument();
  });
});

describe('S2-T8 / FR-16 / FR-17: the screen never claims an area is off', () => {
  it('says "Configured: off" and nothing stronger, anywhere on the page', async () => {
    await renderPage([area({ configuredEnabled: false })]);
    await expand('insights');

    expect(screen.getByTestId('state-chip')).toHaveTextContent('Configured: off');

    /*
     * The page's whole text, scanned for CLAIMS. Not for the word "off" —
     * the fail-open notice has to be able to say "an area you switched off
     * comes back on", which is the opposite of a claim that it is off.
     */
    const text = document.body.textContent ?? '';
    for (const claim of [
      /this area is off/i,
      /\bis currently off\b/i,
      /no calls are being made/i,
      /\bnothing is calling\b/i,
      /\bconfirmed off\b/i,
      /\bswitch is holding\b(?!.*not)/i,
    ]) {
      expect({ claim: String(claim), found: claim.test(text) }).toEqual({
        claim: String(claim),
        found: false,
      });
    }
  });

  it('carries the fail-open warning on the page AND beside every area switch', async () => {
    await renderPage([area({ area: 'insights' }), area({ area: 'leads', key: 'bos_llm_area_leads' })]);

    const banner = screen.getByTestId('fail-open-banner');
    expect(banner).toHaveTextContent('Switching an area off is not a guarantee.');
    expect(banner).toHaveTextContent('falls back to the code defaults, where every area is ON');
    /*
     * F-3: the evidence claim is SCOPED — "no new calls is the only evidence"
     * is false for an area the ledger cannot see at all.
     *
     * DEF-S2-3: and it must be true on DAY ONE. The ledger check answers the
     * reach question in one of its eight states, and the state every card is
     * in on load is "Too long ago to check" — so the banner states the 24-hour
     * limit up front and names the fallback that works for a change of any
     * age, instead of sending the operator to a panel that will shrug.
     */
    expect(banner).toHaveTextContent('where the ledger can see the area');
    expect(banner).toHaveTextContent('only covers a change made in the last 24 hours');
    expect(banner).toHaveTextContent('When it cannot answer');
    expect(banner).toHaveTextContent('runbook §5');

    /*
     * SA R-2. The fallback must describe what the fallback can actually do.
     * `llmUsageVerification.ts` requires an `accountId` and bounds `since` to
     * 7 days, refusing rather than clamping — so "for any period" was the same
     * defect DEF-S2-3 raised, one layer down, in the path an operator reaches
     * for when the 24-hour check has already turned them away.
     */
    expect(banner).toHaveTextContent('the only fleet-wide view of calls per area');
    expect(banner).toHaveTextContent('one business at a time, and the last 7 days only');
    expect(banner.textContent).not.toMatch(/for any period/);

    // None of the three superseded promises may come back.
    expect(banner.textContent).not.toMatch(/no new calls for the area is the only evidence/);
    expect(banner.textContent).not.toMatch(/each card’s ledger check says whether it can answer/);
    expect(banner.textContent).not.toMatch(/calls per area for any period/);

    /*
     * SA: headline, then what to DO, then the quiet why. Asserted by position,
     * because "reorder, not cut" is only observable in the order.
     */
    const text = banner.textContent ?? '';
    expect(text.indexOf('Switching an area off is not a guarantee')).toBeLessThan(
      text.indexOf('Confirm at the ledger')
    );
    expect(text.indexOf('Confirm at the ledger')).toBeLessThan(
      text.indexOf('Every instance reads these settings when it starts')
    );
    // Undismissible: there is no control inside it at all.
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument();

    await expand('insights');
    const inline = screen.getByTestId('fail-open-inline');
    expect(inline).toHaveTextContent('the stored configuration, not a guarantee');
    // F-3, F-7 and DEF-S2-3: the short form carries the same scope, the same
    // day-one limit and the same fallback.
    expect(inline).toHaveTextContent('only for a change made in the last 24 hours');
    expect(inline).toHaveTextContent('when it cannot answer, use runbook §5');
    // R-2: the short form names only the fleet-wide path, never the per-business,
    // 7-day tab it has no room to qualify.
    expect(inline).toHaveTextContent('read-only token_usage query');
    expect(inline.textContent).not.toMatch(/LLM Usage tab/);

    await expand('leads');
    expect(screen.getByTestId('fail-open-inline')).toBeInTheDocument();
  });
});

describe('S2-T11 / FR-20: propagation is stated', () => {
  it('says a change takes about 60 seconds and that the check only counts after that', async () => {
    await renderPage([area()]);
    await expand('insights');

    expect(screen.getByTestId('ledger-panel')).toHaveTextContent(
      'Running instances pick a change up within about 60 seconds'
    );
    expect(screen.getByTestId('ledger-panel')).toHaveTextContent(
      'The ledger check only starts counting after that'
    );
  });
});
