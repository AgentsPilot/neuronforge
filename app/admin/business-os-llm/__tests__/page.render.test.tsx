/**
 * @jest-environment jsdom
 *
 * What an admin actually reads.
 *
 * ── What this round changed, and why S2-T3/T6/T8/T11 look different ──────
 * The provenance badge (S2-T3's first half) is superseded by FR-6's markers;
 * the `enabled` field, the `switch locked` chip, the `Cannot be switched off`
 * chip, the two `area-lock-reason` notices and the inline fail-open sentence
 * are all gone with the switch surface (FR-1, FR-5), so the assertions on them
 * are INVALIDATED rather than edited. What survives from S2-T6 is the pair of
 * TEMPERATURE lock texts — and under FR-6 those are now the only carrier of
 * "this value is code-owned by policy" (C-6), which makes them more
 * load-bearing than they were, not less. See `R-T18` below.
 *
 * S2-T8's page-wide scan for a claim that an area IS off is kept verbatim and
 * extended over the new call-level chip: it costs nothing and it is the only
 * thing stopping a future edit reintroducing "Disabled".
 *
 * S2-T11 moves from the ledger panel (parked, FR-3) to the page header, and
 * the panel's own ledger-specific clause gains an assertion in
 * `ledgerPanel.render.test.tsx` so it stays under test while unmounted (W-7).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  area,
  call,
  issue,
  seedDerivedAreas,
  seedDerivedShape,
  seedExcludedCalls,
  SEED_EXCLUDED_CALL_NAMES,
  SEED_EXCLUDED_REASON,
  stubFetch,
} from '@/tests/helpers/bos-llm-admin-fixtures';

import BusinessOsLlmSettingsPage from '../page';
import type { AreaView } from '../types';
import {
  AREA_OFF_CAVEAT,
  CALL_NAME_CAPTION,
  MARKER_GLYPH,
  MARKER_LEGEND,
  MARKER_SR,
  MARKER_TITLE,
  PAGE_STANDING_NOTE,
  PAGE_SUBTITLE,
  READ_ONLY_NOTE,
  TEMPERATURE_NOT_SET,
} from '../copy';

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

/**
 * Expand one area card.
 *
 * The card's own disclosure button is always the FIRST button inside it — the
 * expanded card also contains the stored-row toggle, and that one's accessible
 * name embeds the area key (`bos_llm_area_chat`), so a name-based query would
 * be ambiguous for every area.
 *
 * `fireEvent`, not `userEvent`: the toggle is a plain `onClick`, so the extra
 * pointer sequence buys nothing, and several tests below walk all EIGHT cards.
 * Under a parallel jest run `userEvent` made those tests exceed the 5 s default
 * timeout — a flake in the harness, not in the page.
 */
function expandCard(areaName: string) {
  const card = screen.getByTestId(`area-card-${areaName}`);
  act(() => {
    fireEvent.click(within(card).getAllByRole('button')[0]);
  });
  return screen.getByTestId(`area-card-${areaName}`);
}

/** Generous, and only on the tests that open every card in turn. */
const EIGHT_CARDS = 30_000;

// ---------------------------------------------------------------------------
// Removals
// ---------------------------------------------------------------------------

describe('R-T1 / AC-1: the on/off switch control surface is gone', () => {
  it('renders no enabled field, no switch-locked chip and no "cannot be switched off" chip', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);

    for (const a of areas) {
      const card = expandCard(a.area);
      expect(within(card).queryByTestId('field-enabled')).not.toBeInTheDocument();
      expect(within(card).queryByTestId('lock-chip')).not.toBeInTheDocument();
      expect(within(card).queryByLabelText(/enabled$/)).not.toBeInTheDocument();
      expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument();
    }

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Cannot be switched off');
    expect(text).not.toContain('switch locked');
    expect(text).not.toContain('This call cannot be switched off on its own.');
    expect(text).not.toContain('This area can never be switched off');
  }, EIGHT_CARDS);

  it('shows no state chip at all on an area that is configured on, or cannot be switched off', async () => {
    await renderPage([
      area({ area: 'insights' }),
      area({ area: 'onboarding', key: 'bos_llm_area_onboarding', switchable: false }),
    ]);

    expect(screen.queryByTestId('state-chip')).not.toBeInTheDocument();
    expandCard('onboarding');
    expect(screen.queryByTestId('state-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-lock-reason')).not.toBeInTheDocument();
  });
});

describe('R-T2 / AC-2: an issue on a field the row no longer renders still reaches the page', () => {
  /**
   * The bug this exists against (F-6): `CallRow` rendered four named fields and
   * filtered its catch-all against a SECOND hand-written copy of those names.
   * Removing two fields from the render without editing the filter deletes
   * their refusals from the page entirely — silently, because a missing warning
   * looks exactly like no warning.
   */
  it.each([
    ['provider_not_allowed', 'provider', 'rejected'],
    ['call_not_switchable', 'enabled', 'locked'],
    ['area_not_switchable', 'enabled', 'locked'],
    ['enabled_not_a_boolean', 'enabled', 'rejected'],
  ] as const)('renders %s, naming its field', async (reason, field, kind) => {
    await renderPage([
      area({
        calls: [call({ issues: [issue({ field, kind, reason })] })],
      }),
    ]);
    const card = expandCard('insights');

    const issues = within(card).getAllByTestId('field-issue');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toHaveTextContent(reason);
    expect(issues[0]).toHaveTextContent(field);
  });

  it('renders BOTH a refused provider and a locked enabled, each naming its field', async () => {
    await renderPage([
      area({
        calls: [
          call({
            issues: [
              issue({ field: 'provider', kind: 'rejected', reason: 'provider_not_allowed: groq' }),
              issue({ field: 'enabled', kind: 'locked', reason: 'call_not_switchable' }),
            ],
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');

    const texts = within(card)
      .getAllByTestId('field-issue')
      .map((node) => node.textContent ?? '');
    expect(texts).toHaveLength(2);
    expect(texts.some((t) => t.includes('provider') && t.includes('provider_not_allowed'))).toBe(
      true
    );
    expect(texts.some((t) => t.includes('enabled') && t.includes('call_not_switchable'))).toBe(true);
  });

  it('renders one issue on every possible field exactly once — none dropped, none doubled', async () => {
    const fields = ['enabled', 'provider', 'model', 'temperature', 'calls', 'row'] as const;
    await renderPage([
      area({
        calls: [
          call({
            issues: fields.map((field) =>
              issue({ field, kind: 'rejected', reason: `reason_for_${field}` })
            ),
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');

    const texts = within(card)
      .getAllByTestId('field-issue')
      .map((node) => node.textContent ?? '');
    expect(texts).toHaveLength(fields.length);
    for (const field of fields) {
      expect(texts.filter((t) => t.includes(`reason_for_${field}`))).toHaveLength(1);
    }
  });
});

describe('R-T3 / AC-3: the fail-open banner became one muted line', () => {
  it('renders no FailOpenNotice, and none of its five strings', async () => {
    await renderPage(seedDerivedAreas());
    expandCard('chat');

    expect(screen.queryByTestId('fail-open-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fail-open-inline')).not.toBeInTheDocument();

    const text = document.body.textContent ?? '';
    for (const gone of [
      'Switching an area off is not a guarantee.',
      'Every instance reads these settings when it starts',
      'Confirm at the ledger rather than at this switch',
      'the stored configuration, not a guarantee',
      'There is no switch to fail open here',
    ]) {
      expect({ gone, found: text.includes(gone) }).toEqual({ gone, found: false });
    }
  }, EIGHT_CARDS);

  it('carries the standing line, with all four load-bearing elements, ending at the runbook', async () => {
    await renderPage([area()]);

    const note = screen.getByTestId('page-standing-note');
    expect(note).toHaveTextContent(PAGE_STANDING_NOTE);

    const text = note.textContent ?? '';
    // RC-10: the one claim the line exists to make comes FIRST.
    expect(text.indexOf('These are the stored settings')).toBe(0);
    expect(text).toContain('about 60 seconds');
    expect(text).toContain('on startup');
    expect(text).toContain('falls back to the values in code');
    // R-A condition 2: with the banner gone this pointer is the only route on
    // the page to fleet-level truth.
    expect(text.trim().endsWith('(runbook §5).')).toBe(true);

    // Muted, not a warning, and with nothing to dismiss.
    expect(note.className).not.toMatch(/amber|red/);
    expect(within(note).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('R-T4 / AC-4: the ledger check is parked, not deleted', () => {
  it('renders no ledger panel on any card, and makes no ledger request', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);

    for (const a of areas) {
      expandCard(a.area);
      expect(screen.queryByTestId('ledger-panel')).not.toBeInTheDocument();
    }

    const calls = (global.fetch as unknown as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(calls.filter((url) => url.includes('/ledger'))).toEqual([]);
  }, EIGHT_CARDS);
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

describe('R-T5 / AC-5: the provider is stated once per area, not once per call', () => {
  it('renders it in the area summary of every area, and in no call row', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);

    for (const a of areas) {
      const card = expandCard(a.area);
      expect(within(card).getByTestId('area-summary')).toHaveTextContent('provider openai');
      expect(within(card).queryByTestId('field-provider')).not.toBeInTheDocument();
    }
  }, EIGHT_CARDS);
});

describe('R-T6 / AC-6, AC-7: the provider carries no marker, and defends its own precondition', () => {
  it('shows no marker beside the area provider', async () => {
    await renderPage([area()]);
    const summary = screen.getByTestId('area-summary');
    expect(within(summary).queryByTestId('marker-call')).not.toBeInTheDocument();
    expect(within(summary).queryByTestId('marker-code')).not.toBeInTheDocument();
  });

  it('falls back to "varies by call" and returns the per-call field — for that area only', async () => {
    await renderPage([
      area({
        area: 'insights',
        calls: [
          call({ callName: 'insight_content' }),
          call({
            callName: 'correlated_insight',
            resolved: {
              enabled: true,
              provider: 'anthropic',
              model: 'gpt-4o-mini',
              temperature: 0.4,
            },
            // Even set on the call itself, the provider takes no marker (AC-6).
            provenance: {
              enabled: 'area',
              provider: 'call',
              model: 'area',
              temperature: 'area',
            },
          }),
        ],
      }),
      area({ area: 'leads', key: 'bos_llm_area_leads', calls: [call({ callName: 'reply_recommendation' })] }),
    ]);

    const mixed = expandCard('insights');
    expect(within(mixed).getByTestId('area-summary')).toHaveTextContent('varies by call');
    const providerField = within(mixed).getAllByTestId('field-provider');
    expect(providerField).toHaveLength(2);
    // Returned with its label, still unmarked.
    expect(
      within(within(mixed).getByTestId('call-correlated_insight')).getByTestId('field-label-provider')
    ).not.toHaveTextContent(MARKER_GLYPH.call);

    const single = expandCard('leads');
    expect(within(single).getByTestId('area-summary')).not.toHaveTextContent('varies by call');
    expect(within(single).queryByTestId('field-provider')).not.toBeInTheDocument();
  });

  it('brings the provider ISSUES back with the field, through the same list', async () => {
    await renderPage([
      area({
        calls: [
          call({ callName: 'insight_content' }),
          call({
            callName: 'correlated_insight',
            resolved: { enabled: true, provider: 'anthropic', model: 'gpt-4o-mini', temperature: 0.4 },
            issues: [issue({ field: 'provider', kind: 'rejected', reason: 'provider_not_allowed: groq' })],
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');

    // With the field rendered, the issue sits UNDER it rather than in the
    // catch-all — and therefore appears exactly once either way.
    const row = within(card).getByTestId('call-correlated_insight');
    expect(within(row).getAllByTestId('field-issue')).toHaveLength(1);
    expect(within(within(row).getByTestId('field-provider')).getByTestId('field-issue')).toHaveTextContent(
      'provider_not_allowed: groq'
    );
  });
});

// ---------------------------------------------------------------------------
// Off states
// ---------------------------------------------------------------------------

describe('R-T7 / AC-9, AC-10: an off state is visible at both levels, as an exception', () => {
  it('renders the area chip plus its caveat when the row switches the area off', async () => {
    await renderPage([area({ configuredEnabled: false })]);

    expect(screen.getByTestId('state-chip')).toHaveTextContent('Configured: off');
    expect(screen.getByTestId('area-off-caveat')).toHaveTextContent(AREA_OFF_CAVEAT);
    expect(screen.getByTestId('area-off-caveat')).toHaveTextContent('runbook §5');
  });

  it('renders neither chip nor caveat on an area that is on', async () => {
    await renderPage([area({ configuredEnabled: true })]);
    expect(screen.queryByTestId('state-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-off-caveat')).not.toBeInTheDocument();
  });

  /** The `--include-calls` trap: the area flag was restored, the call flags were not. */
  it('marks a call the row switches off under an area that is ON, and rolls it up', async () => {
    await renderPage([
      area({
        configuredEnabled: true,
        calls: [
          call({ callName: 'insight_content' }),
          call({
            callName: 'correlated_insight',
            resolved: { enabled: false, provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4 },
          }),
        ],
      }),
    ]);

    expect(screen.getByTestId('calls-off-chip')).toHaveTextContent('1 call configured off');
    const card = expandCard('insights');
    const chips = within(card).getAllByTestId('call-state-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('Configured: off');
    expect(
      within(within(card).getByTestId('call-insight_content')).queryByTestId('call-state-chip')
    ).not.toBeInTheDocument();
  });

  it('renders neither the roll-up nor a call chip when nothing is off', async () => {
    await renderPage([area()]);
    expect(screen.queryByTestId('calls-off-chip')).not.toBeInTheDocument();
    expandCard('insights');
    expect(screen.queryByTestId('call-state-chip')).not.toBeInTheDocument();
  });

  /**
   * RC-4 + RC-6. An off AREA is the card's ONLY off statement.
   *
   * A locked call always resolves `enabled: true` (`modelSettings.ts:703-707`)
   * even inside an off area, so an unguarded card would say "Configured: off",
   * put a chip on the switchable call and leave the locked one bare — which
   * reads as "that one is still running", and is false: the gate stops it at
   * route entry.
   */
  it('says it once, at area level, when the area itself is off', async () => {
    await renderPage([
      area({
        area: 'chat',
        key: 'bos_llm_area_chat',
        configuredEnabled: false,
        calls: [
          call({
            callName: 'planner',
            resolved: { enabled: true, provider: 'openai', model: 'gpt-4o-mini', temperature: 0 },
            locks: { switchable: false, lockedTemperature: 0, temperatureNotApplicable: false },
          }),
          call({
            callName: 'analysis',
            resolved: { enabled: false, provider: 'openai', model: 'gpt-4o-mini', temperature: 0 },
          }),
        ],
      }),
    ]);

    expect(screen.getByTestId('state-chip')).toHaveTextContent('Configured: off');
    expect(screen.queryByTestId('calls-off-chip')).not.toBeInTheDocument();

    const card = expandCard('chat');
    expect(within(card).queryAllByTestId('call-state-chip')).toHaveLength(0);
    // Exactly one off statement on the whole card, and it is the area's.
    expect(within(card).queryAllByTestId('state-chip')).toHaveLength(1);
  });

  /** S2-T8, kept verbatim and extended over the new call-level chip. */
  it('never claims an area IS off, anywhere on the page', async () => {
    await renderPage([
      area({ configuredEnabled: false }),
      area({
        area: 'leads',
        key: 'bos_llm_area_leads',
        calls: [
          call({
            callName: 'reply_recommendation',
            resolved: { enabled: false, provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2 },
          }),
        ],
      }),
    ]);
    expandCard('leads');

    const text = document.body.textContent ?? '';
    for (const claim of [
      /this area is off/i,
      /\bis currently off\b/i,
      /no calls are being made/i,
      /\bnothing is calling\b/i,
      /\bconfirmed off\b/i,
      /\bswitch is holding\b(?!.*not)/i,
      /this call is off/i,
    ]) {
      expect({ claim: String(claim), found: claim.test(text) }).toEqual({
        claim: String(claim),
        found: false,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/** Every marker on the currently expanded card, by kind. */
function markersIn(card: HTMLElement) {
  return {
    call: within(card).queryAllByTestId('marker-call').length,
    code: within(card).queryAllByTestId('marker-code').length,
  };
}

describe('the seed-derived fixture is what it claims to be (R-2)', () => {
  it('asserts its own distribution before any AC depends on it', () => {
    expect(seedDerivedShape()).toEqual({
      areas: 8,
      calls: 22,
      renderedFields: 44,
      fromStoredRow: 42,
      callLevel: 9,
      policyOwnedTemperature: 2,
      configurableCodeDefaults: 0,
    });
  });
});

describe('R-T8 / AC-13: a value from the stored row carries no marker, at either level', () => {
  it('leaves 35 of 44 rendered fields unmarked, and renders all 42 stored values', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);

    let markedCall = 0;
    let markedCode = 0;
    let fields = 0;
    for (const a of areas) {
      const card = expandCard(a.area);
      const counts = markersIn(card);
      markedCall += counts.call;
      markedCode += counts.code;
      fields +=
        within(card).queryAllByTestId('field-model').length +
        within(card).queryAllByTestId('field-temperature').length;
    }

    expect({ fields, markedCall, markedCode }).toEqual({
      fields: 44,
      markedCall: 9,
      markedCode: 0,
    });
    // 44 rendered − 9 `*` − 0 `c` = 35 carrying nothing at all.
    expect(fields - markedCall - markedCode).toBe(35);
  }, EIGHT_CARDS);
});

describe('R-T9 / AC-14: `c` marks a code default on a CONFIGURABLE field, and nothing else', () => {
  it('renders zero times against the real seed', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);
    for (const a of areas) {
      const card = expandCard(a.area);
      expect(markersIn(card).code).toBe(0);
    }
  }, EIGHT_CARDS);

  it('never renders on a policy-locked or not-applicable temperature', async () => {
    await renderPage([
      area({
        calls: [
          call({
            callName: 'planner',
            provenance: { enabled: 'default', provider: 'default', model: 'area', temperature: 'default' },
            locks: { switchable: false, lockedTemperature: 0, temperatureNotApplicable: false },
          }),
          call({
            callName: 'image_generation',
            resolved: { enabled: true, provider: 'openai', model: 'gpt-image-1', temperature: null },
            provenance: { enabled: 'default', provider: 'default', model: 'area', temperature: 'default' },
            locks: { switchable: true, lockedTemperature: null, temperatureNotApplicable: true },
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');
    expect(markersIn(card).code).toBe(0);
  });

  it('DOES render for a genuinely unconfigured configurable field', async () => {
    await renderPage([
      area({
        calls: [
          call({
            provenance: { enabled: 'area', provider: 'area', model: 'area', temperature: 'default' },
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');
    expect(markersIn(card).code).toBe(1);
    expect(
      within(within(card).getByTestId('field-label-temperature')).getByTestId('marker-code')
    ).toBeInTheDocument();
  });

  /**
   * RC-3. A configured value the guardrails REFUSED leaves the provenance at
   * `default` while the row still holds it — so `c` renders, and the refusal
   * reason renders beside it on the same field.
   */
  it('DOES render — with the reason beside it — when a configured value was refused', async () => {
    await renderPage([
      area({
        calls: [
          call({
            provenance: { enabled: 'area', provider: 'area', model: 'area', temperature: 'default' },
            issues: [
              issue({
                field: 'temperature',
                kind: 'rejected',
                reason: 'temperature_out_of_bounds: 4',
              }),
            ],
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');

    const field = within(card).getByTestId('field-temperature');
    expect(within(field).getByTestId('marker-code')).toBeInTheDocument();
    expect(within(field).getByTestId('field-issue')).toHaveTextContent('temperature_out_of_bounds');
  });

  /**
   * RC-5. The THIRD path to `provenance === 'default'` with a value in the row,
   * and the one where the value was neither absent nor refused:
   * `modelSettings.ts:730-739` drops a temperature the resolved model rejects
   * and forces the provenance to `default`, pushing an **adjusted** issue. The
   * `c` hover must be true here too — which is why it says "not in force"
   * rather than "refused".
   */
  it('DOES render when a resolved model dropped the temperature (adjusted, not refused)', async () => {
    await renderPage([
      area({
        calls: [
          call({
            resolved: { enabled: true, provider: 'openai', model: 'o3-mini', temperature: null },
            provenance: { enabled: 'area', provider: 'area', model: 'area', temperature: 'default' },
            issues: [
              issue({
                field: 'temperature',
                kind: 'adjusted',
                reason: 'model_rejects_sampling_parameters',
              }),
            ],
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');

    const field = within(card).getByTestId('field-temperature');
    const marker = within(field).getByTestId('marker-code');
    expect(marker).toBeInTheDocument();
    expect(within(field).getByTestId('field-issue')).toHaveTextContent(
      'model_rejects_sampling_parameters'
    );
    // The hover must not assert a mechanism that is false in this state.
    const title = marker.getAttribute('title') ?? '';
    expect(title).not.toMatch(/refus/i);
    expect(title).toContain('not in force');

    /*
     * QA BUG-1 / SA CR-5. This is the state the whole three-state wording was
     * written for, and the state it was still wrong in: the temperature was
     * DROPPED, so the call sends none — while the code default for the field
     * is a number it is not using. The value line beside this marker already
     * says "not set — the provider default applies", so a hover promising a
     * code value was also a SECOND, different answer about one field.
     *
     * Pinned as two properties rather than as a string compare, so a reword
     * that keeps them true stays green and one that re-introduces the promise
     * does not:
     *   1. no claim about WHICH value the call is running on;
     *   2. no claim that "the guardrails" accepted or refused anything —
     *      `checkTemperature` DID accept this value; the sampling-parameter
     *      rule dropped it afterwards.
     */
    expect(within(field).getByTestId('field-value-temperature')).toHaveTextContent(
      TEMPERATURE_NOT_SET
    );
    expect(title).not.toMatch(/written in code|running on the value|code value|code default/i);
    expect(title).not.toMatch(/guardrail/i);
    // What it does say instead — the one thing the marker actually knows.
    expect(title).toContain('does not come from the stored row');
  });
});

describe('R-T10 / AC-15: `*` marks exactly the call-level fields, in the label', () => {
  it('renders on the 9 call-level fields of the seed fixture and on nothing else', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);

    const perArea: Record<string, number> = {};
    for (const a of areas) {
      const card = expandCard(a.area);
      perArea[a.area] = markersIn(card).call;
    }
    expect(perArea).toEqual({
      chat: 2,
      insights: 2,
      briefing: 0,
      website: 3,
      intake: 2,
      leads: 0,
      onboarding: 0,
      images: 0,
    });
    expect(Object.values(perArea).reduce((a, b) => a + b, 0)).toBe(9);
  }, EIGHT_CARDS);

  it('uses an asterisk — neither `i` nor `c`', async () => {
    expect(MARKER_GLYPH.call).toBe('*');
    expect(MARKER_GLYPH.call).not.toBe('i');
    expect(MARKER_GLYPH.call).not.toBe(MARKER_GLYPH.code);
  });

  /** RC-1: `0.7*` reads as part of a number; `TEMPERATURE *` does not. */
  it('sits inside the field LABEL and never beside the value', async () => {
    await renderPage([
      area({
        calls: [
          call({
            provenance: { enabled: 'area', provider: 'area', model: 'area', temperature: 'call' },
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');

    expect(
      within(within(card).getByTestId('field-label-temperature')).getByTestId('marker-call')
    ).toBeInTheDocument();
    expect(
      within(within(card).getByTestId('field-value-temperature')).queryByTestId('marker-call')
    ).not.toBeInTheDocument();
  });
});

describe('R-T11 / AC-16, AC-17: the marker is never carried by the glyph alone', () => {
  it('exposes the whole phrase to assistive technology and hides the glyph from it', async () => {
    await renderPage([
      area({
        calls: [
          call({
            provenance: { enabled: 'area', provider: 'area', model: 'call', temperature: 'default' },
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');

    for (const kind of ['call', 'code'] as const) {
      const marker = within(card).getByTestId(`marker-${kind}`);
      expect(marker).toHaveTextContent(MARKER_SR[kind]);
      expect(marker.querySelector('[aria-hidden="true"]')?.textContent).toBe(MARKER_GLYPH[kind]);
      expect(marker.querySelector('.sr-only')?.textContent).toBe(MARKER_SR[kind]);
      expect(marker.getAttribute('title')).toBe(MARKER_TITLE[kind]);
    }
  });

  it('states both meanings in the legend, at the point of use', async () => {
    await renderPage([area()]);
    const card = expandCard('insights');

    const legend = within(card).getByTestId('marker-legend');
    expect(legend).toHaveTextContent(MARKER_LEGEND);
    // One legend on screen at a time: only one card expands.
    expect(screen.getAllByTestId('marker-legend')).toHaveLength(1);
  });

  it('remains sufficient with every title attribute stripped', async () => {
    await renderPage([
      area({
        calls: [
          call({
            provenance: { enabled: 'area', provider: 'area', model: 'call', temperature: 'default' },
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');
    for (const node of Array.from(document.querySelectorAll('[title]'))) {
      node.removeAttribute('title');
    }

    const text = card.textContent ?? '';
    expect(text).toContain(MARKER_SR.call);
    expect(text).toContain(MARKER_SR.code);
    expect(within(card).getByTestId('marker-legend').textContent).toContain(MARKER_GLYPH.code);
  });

  it('says the CONSEQUENCE on hover, not the legend label over again', () => {
    for (const kind of ['call', 'code'] as const) {
      expect(MARKER_TITLE[kind]).not.toBe(MARKER_SR[kind]);
      expect(MARKER_TITLE[kind]).toContain('runbook §3');
    }
  });

  /** R-E: the pairing that produced the user's original misreading. */
  it('pairs no "code" word with a "database" word in the call-level legend entry', () => {
    const callEntry = MARKER_LEGEND.slice(
      MARKER_LEGEND.indexOf(`${MARKER_GLYPH.call} `),
      MARKER_LEGEND.indexOf(` · ${MARKER_GLYPH.code} `)
    );
    expect(callEntry).not.toMatch(/database|db\b|code/i);
    expect(MARKER_LEGEND).not.toMatch(/not in the database/i);
  });

  it('rolls the `*`s up into a `N set per call` chip, only when N > 0', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);

    const chipText = (name: string) =>
      within(screen.getByTestId(`area-card-${name}`)).queryByTestId('set-per-call-chip')
        ?.textContent ?? null;

    expect(chipText('chat')).toBe('2 set per call');
    expect(chipText('website')).toBe('3 set per call');
    expect(chipText('intake')).toBe('1 set per call');
    expect(chipText('briefing')).toBeNull();
    expect(chipText('leads')).toBeNull();

    // Its hover says N counts CALLS — the chip sits beside `2 calls`.
    expect(
      within(screen.getByTestId('area-card-chat')).getByTestId('set-per-call-chip').getAttribute('title')
    ).toContain('calls have a value set on the call itself');
  }, EIGHT_CARDS);
});

// ---------------------------------------------------------------------------
// Additions
// ---------------------------------------------------------------------------

describe('R-T12 / AC-18: the call name says what kind of identifier it is', () => {
  it('captions every call row, and leaves the identifier verbatim and monospace', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);

    for (const a of areas) {
      const card = expandCard(a.area);
      for (const c of a.calls) {
        const row = within(card).getByTestId(`call-${c.callName}`);
        expect(row).toHaveTextContent(CALL_NAME_CAPTION);
        const identifier = within(row).getByText(c.callName);
        expect(identifier).toHaveClass('font-mono');
        expect(identifier.textContent).toBe(c.callName);
      }
    }
  }, EIGHT_CARDS);
});

describe('R-T13 / AC-19: chat lists all six of its catalogued calls', () => {
  it('shows two configurable and four muted, counts six, and states the server’s reason', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);

    const chat = screen.getByTestId('area-card-chat');
    expect(within(chat).getByTestId('call-count-chip')).toHaveTextContent('6 calls');

    const card = expandCard('chat');
    expect(within(card).queryAllByTestId('excluded-call-reason')).toHaveLength(4);
    for (const name of SEED_EXCLUDED_CALL_NAMES) {
      const row = within(card).getByTestId(`excluded-call-${name}`);
      expect(row).toHaveTextContent(CALL_NAME_CAPTION);
      expect(row).toHaveTextContent(name);
      expect(within(row).getByTestId('excluded-call-reason')).toHaveTextContent(SEED_EXCLUDED_REASON);
      // C-7 condition: no value fields, no markers.
      expect(within(row).queryByTestId('field-model')).not.toBeInTheDocument();
      expect(within(row).queryByTestId('field-temperature')).not.toBeInTheDocument();
      expect(within(row).queryByTestId('marker-call')).not.toBeInTheDocument();
      expect(within(row).queryByTestId('marker-code')).not.toBeInTheDocument();
    }
    // Below the configurable calls, not interleaved with them.
    const order = Array.from(card.querySelectorAll('[data-testid^="call-"], [data-testid^="excluded-call-"]'))
      .map((n) => n.getAttribute('data-testid') ?? '')
      .filter(
        (id) =>
          !id.startsWith('call-state') &&
          !id.startsWith('call-count') &&
          id !== 'excluded-call-reason'
      );
    expect(order).toEqual([
      'call-planner',
      'call-analysis',
      ...SEED_EXCLUDED_CALL_NAMES.map((n) => `excluded-call-${n}`),
    ]);
  }, EIGHT_CARDS);

  it('renders whatever reason the payload carries — the string is never written here', async () => {
    await renderPage([
      area({
        area: 'chat',
        key: 'bos_llm_area_chat',
        excludedCalls: [{ callName: 'plan_cache_lookup_embedding', reason: 'A SERVER SENTENCE.' }],
      }),
    ]);
    const card = expandCard('chat');
    expect(within(card).getByTestId('excluded-call-reason')).toHaveTextContent('A SERVER SENTENCE.');
  });
});

describe('R-T14 / AC-20: the other seven areas are untouched', () => {
  it('lists no excluded calls, and counts exactly its configurable ones', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);

    const expected: Record<string, string> = {
      insights: '3 calls',
      briefing: '1 call',
      website: '8 calls',
      intake: '2 calls',
      leads: '1 call',
      onboarding: '4 calls',
      images: '1 call',
    };
    for (const [name, chip] of Object.entries(expected)) {
      expect(
        within(screen.getByTestId(`area-card-${name}`)).getByTestId('call-count-chip')
      ).toHaveTextContent(chip);
      const card = expandCard(name);
      expect(within(card).queryByTestId('excluded-call-reason')).not.toBeInTheDocument();
    }
  }, EIGHT_CARDS);

  /**
   * QA EDGE-1. A payload with no `excludedCalls` at all used to blank the whole
   * page — the area heading never rendered, because `AreaCard` read `.length`
   * off `undefined` before anything else.
   *
   * Not reachable while client and server ship in one Vercel deployment, but
   * NOTHING would have caught it if it were: the `AreaView` wire pin is
   * one-directional (§8.1), so dropping the field from the CLIENT type is
   * invisible to `typecheck:bos-llm`; `next.config.js` ignores type errors; and
   * jest is type-blind. This test is the only gate that sees it, which is why
   * the field is deleted here at runtime rather than trusted to the type.
   */
  it('renders the card, not a blank page, when the payload omits excludedCalls', async () => {
    const withoutField: Partial<AreaView> = area();
    delete withoutField.excludedCalls;
    await renderPage([withoutField as AreaView]);

    const card = screen.getByTestId('area-card-insights');
    expect(within(card).getByTestId('call-count-chip')).toHaveTextContent('1 call');
    expect(within(expandCard('insights')).queryByTestId('excluded-call-reason')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Copy, retentions
// ---------------------------------------------------------------------------

describe('R-T15 / AC-21: the page says what it now is', () => {
  it('pins the subtitle — unasserted until this round, which is why it would have shipped stale', async () => {
    await renderPage([area()]);
    const subtitle = screen.getByTestId('page-subtitle');
    expect(subtitle).toHaveTextContent(PAGE_SUBTITLE);
    expect(subtitle).toHaveTextContent('Provider is shown per area');
    expect(subtitle).toHaveTextContent('changed with the runbook, not here');
    expect(subtitle.textContent).not.toMatch(/on\/off switch for every/);
  });

  /** RC-8: it shared a wrapper with the two notices this round deleted. */
  it('keeps READ_ONLY_NOTE, verbatim, on every expanded card', async () => {
    const areas = seedDerivedAreas();
    await renderPage(areas);
    for (const a of areas) {
      const card = expandCard(a.area);
      expect(within(card).getByTestId('read-only-note')).toHaveTextContent(READ_ONLY_NOTE);
    }
  }, EIGHT_CARDS);
});

describe('R-T18 / AC-12: the two temperature locks still say why, AS TEXT', () => {
  /**
   * C-6. Under FR-6 these are the ONLY carrier of "this value is code-owned by
   * policy": `markerFor` deliberately returns null for a locked temperature,
   * because a `c` there would be a permanent nag on two of the 22 calls. So
   * reducing either line to a tooltip would delete the fact from the page —
   * here, and in the density slice.
   */
  it('prints the locked reason and the not-applicable reason, not only a tooltip', async () => {
    await renderPage([
      area({
        calls: [
          call({
            callName: 'planner',
            locks: { switchable: false, lockedTemperature: 0, temperatureNotApplicable: false },
          }),
          call({
            callName: 'image_generation',
            resolved: { enabled: true, provider: 'openai', model: 'gpt-image-1', temperature: null },
            locks: { switchable: true, lockedTemperature: null, temperatureNotApplicable: true },
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');

    const reasons = within(card)
      .getAllByTestId('lock-reason')
      .map((node) => node.textContent ?? '');
    expect(reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Temperature is fixed in code for this call.'),
        expect.stringContaining('This call sends no temperature at all'),
      ])
    );
    // As TEXT: each one is a rendered node, not a title attribute.
    for (const node of within(card).getAllByTestId('lock-reason')) {
      expect(node.tagName).toBe('P');
      expect(node.getAttribute('title')).toBeNull();
    }
  });
});

describe('S2-T3 (surviving half) / S2-T5: values the round did not touch', () => {
  it('renders an unset temperature as "not set", never as 0', async () => {
    await renderPage([
      area({
        calls: [
          call({
            resolved: { enabled: true, provider: 'openai', model: 'gpt-4o-mini', temperature: null },
          }),
        ],
      }),
    ]);
    const card = expandCard('insights');

    const temperature = within(card).getByTestId('field-temperature');
    expect(temperature).toHaveTextContent('not set — the provider default applies');
    expect(temperature).not.toHaveTextContent(/(^|\s)0(\s|$)/);
  });

  it('says an area with no stored row runs on code defaults, with no error styling', async () => {
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

    const card = expandCard('insights');
    expect(within(card).getByTestId('field-model')).toHaveTextContent('gpt-4o-mini');
  });

  it('still attaches an issue to the field it affected, with the resolver’s own reason', async () => {
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
    const card = expandCard('insights');

    const model = within(card).getByTestId('field-model');
    expect(within(model).getByTestId('field-issue')).toHaveTextContent(
      'unpriced_model: openai/gpt-nope'
    );
    expect(within(model).getByTestId('field-issue')).toHaveTextContent(
      'This value was refused, so the resolver fell back to the level below it.'
    );
    expect(
      within(within(card).getByTestId('field-temperature')).getByTestId('field-issue')
    ).toHaveTextContent('temperature_clamped: 1.5');
    expect(within(model).getAllByTestId('field-issue')).toHaveLength(1);
  });
});

describe('the excluded rows are inert', () => {
  it('offers nothing to click or edit', async () => {
    await renderPage([
      area({ area: 'chat', key: 'bos_llm_area_chat', excludedCalls: seedExcludedCalls() }),
    ]);
    const card = expandCard('chat');
    const row = within(card).getByTestId('excluded-call-plan_cache_lookup_embedding');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
