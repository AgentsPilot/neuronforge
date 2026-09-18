/**
 * @jest-environment jsdom
 *
 * LLM Usage tab — Layer 1.5 AC-16, AC-17: onboarding and image rows read
 * correctly with no new formatter or column, the images note is shown, and
 * Check 3(c) stays Info with its updated text.
 */

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import type { LlmUsageReport } from '@/lib/business-os/usage/llmUsageReportTypes';
import { CheckPanels } from '../CheckPanels';

const ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const ZERO = '00000000-0000-0000-0000-000000000000';
const GROUP = '33333333-3333-4333-8333-333333333333';

function row(over: Partial<LlmUsageReport['checks']['calls']['rows'][number]>) {
  return {
    createdAt: '2026-09-17T11:59:00.000Z',
    feature: 'business-os-onboarding',
    areaKind: 'current' as const,
    area: 'onboarding',
    areaLabel: 'onboarding',
    component: 'business_story_extraction',
    sessionId: GROUP,
    inputTokens: 900,
    outputTokens: 300,
    tokens: 1200,
    estimatedCostUsd: 0.006,
    success: true,
    errorCode: null,
    flags: [],
    knownComponent: null,
    ...over,
  };
}

function report(): LlmUsageReport {
  const imageRow = row({
    feature: 'business-os-images',
    area: 'images',
    areaLabel: 'images',
    component: 'image_generation',
    inputTokens: 0,
    outputTokens: 0,
    tokens: 0,
    estimatedCostUsd: 0.04,
  });
  return {
    account: { userId: ACCOUNT, companyName: 'Acme Coaching', profileLookup: 'found' },
    window: { start: '2026-09-17T11:00:00.000Z', end: '2026-09-17T12:00:00.000Z', startClamped: false },
    platformAccountIdsChecked: [ZERO],
    platformAccountEnvIgnored: false,
    incomplete: false,
    trigger: 'manual',
    limits: { pageSize: 1000, readCeiling: 5000, displayRows: 500, displayGroups: 500, platformBreakdownRows: 500, helperTimestamps: 50 },
    checks: {
      calls: {
        status: 'pass',
        error: null,
        rowsRead: 2,
        incomplete: false,
        flaggedRows: 0,
        flagCounts: { legacy_feature: 0, unknown_area: 0, unknown_call_name: 0, missing_group_id: 0 },
        rows: [row({}), imageRow],
        rowsTruncated: false,
        displayCap: 500,
      },
      platformAccount: { status: 'pass', error: null, count: 0, breakdown: [], breakdownRowsRead: 0, breakdownTruncated: false, breakdownCap: 500 },
      legacyLabels: {
        status: 'pass',
        error: null,
        legacyOnSelected: { count: 0, byFeature: [], incomplete: false },
        legacyOnPlatform: { count: 0 },
        helperLabelOnSelected: { count: 0 },
        helperLabelOnPlatform: { count: 1, timestamps: ['2026-09-17T11:10:00.000Z'], timestampsTruncated: false, timestampCap: 50 },
        helperLabel: { feature: 'onboarding', component: 'simple-complete' },
      },
      groups: {
        status: 'info',
        error: null,
        incomplete: false,
        groups: [],
        groupsTotal: 0,
        groupsTruncated: false,
        displayCap: 500,
        ungrouped: [],
        ungroupedTotal: 0,
        ungroupedFlagged: 0,
        ungroupedTruncated: false,
      },
      usageCard: {
        status: 'pass',
        error: null,
        summedBy: 'database',
        tokensPerCredit: 10,
        windowEnd: 'open',
        totals: { tokens: 1200, calls: 2, credits: 120 },
        categories: [
          { key: 'onboarding', tokens: 1200, calls: 1, credits: 120, shownOnCard: true },
          { key: 'images', tokens: 0, calls: 1, credits: 0, shownOnCard: false },
        ],
        otherFeatures: [],
      },
    },
    areaTotals: {
      status: 'complete',
      error: null,
      lines: [
        { key: 'onboarding', kind: 'area', calls: 1, tokens: 1200, estimatedCostUsd: 0.006 },
        { key: 'images', kind: 'area', calls: 1, tokens: 0, estimatedCostUsd: 0.04 },
      ],
      total: { calls: 2, tokens: 1200, estimatedCostUsd: 0.046 },
    },
  };
}

describe('CheckPanels with onboarding and image rows (Layer 1.5)', () => {
  it('shows a separate images area line with 0 tokens and its cost (AC-16)', () => {
    render(<CheckPanels report={report()} />);
    const areas = screen.getByTestId('llm-usage-panel-areas');
    const imagesLine = within(areas).getByText('images').closest('tr') as HTMLElement;
    expect(imagesLine).toBeInTheDocument();
    const cells = within(imagesLine).getAllByRole('cell').map((c) => c.textContent);
    expect(cells[1]).toBe('1');
    expect(cells[2]).toBe('0');
    expect(cells[3]).toContain('$0.0400');
    expect(within(areas).getByText('onboarding')).toBeInTheDocument();
  });

  it('shows the images note in the area totals (FR-21)', () => {
    render(<CheckPanels report={report()} />);
    expect(screen.getByTestId('llm-usage-images-note')).toHaveTextContent(/0 tokens: that is expected/);
    expect(screen.getByTestId('llm-usage-images-note')).toHaveTextContent(/priced per image/);
  });

  it('renders Check 5 for images as "no (no tokens)"', () => {
    render(<CheckPanels report={report()} />);
    expect(screen.getByText('no (no tokens)')).toBeInTheDocument();
  });

  it('keeps Check 3(c) as Info, still counts a helper-label row, with the Layer 1.5 text (AC-17)', () => {
    render(<CheckPanels report={report()} />);
    const legacy = screen.getByTestId('llm-usage-panel-legacy');
    expect(within(legacy).getByText(/Info only, never Fail/)).toBeInTheDocument();
    expect(within(legacy).getByTestId('llm-usage-helper-label-note')).toHaveTextContent(
      /Since Layer 1\.5 no live caller should write this label/
    );
    expect(legacy).toHaveTextContent(/on the platform account — Info only, never Fail:\s*1/);
  });
});
