/**
 * Tests for the calibration result email's deterministic "What we changed" block
 * (Option A, Phase 2.5). Only exercises renderHtml (no LLM / no send).
 */

import { renderHtml, type CalibrationResultEmailInput } from '../calibrationResultEmail';

function input(overrides: Partial<CalibrationResultEmailInput> = {}): CalibrationResultEmailInput {
  return {
    to: 'u@example.com',
    agentId: 'a1',
    agentName: 'Leads Agent',
    passed: true,
    issuesFound: 1,
    issuesFixed: 1,
    issuesRemaining: 0,
    ctaUrl: 'https://app/agents/a1',
    ...overrides,
  };
}

const NOTE = 'The spreadsheet has one tab, "Leads", so I set the sheet to it.';

describe('calibration email — "What we changed" block', () => {
  it('renders the block on a PASSED run when appliedFixNotes are present', () => {
    const html = renderHtml(input({ passed: true, appliedFixNotes: [NOTE] }), 'summary');
    expect(html).toContain('What we changed');
    expect(html).toContain('The spreadsheet has one tab');
  });

  it('renders the block on a FAILED run too', () => {
    const html = renderHtml(input({ passed: false, appliedFixNotes: [NOTE] }), 'summary');
    expect(html).toContain('What we changed');
    expect(html).toContain('The spreadsheet has one tab');
  });

  it('omits the block when there are no appliedFixNotes', () => {
    expect(renderHtml(input({ appliedFixNotes: [] }), 'summary')).not.toContain('What we changed');
    expect(renderHtml(input({ appliedFixNotes: undefined }), 'summary')).not.toContain('What we changed');
  });

  it('HTML-escapes note content (tab names)', () => {
    const html = renderHtml(input({ appliedFixNotes: ['tab <b>Q1 & Q2</b>'] }), 'summary');
    expect(html).toContain('tab &lt;b&gt;Q1 &amp; Q2&lt;/b&gt;');
    expect(html).not.toContain('<b>Q1');
  });

  it('renders one <li> per note', () => {
    const html = renderHtml(input({ appliedFixNotes: ['note one', 'note two'] }), 'summary');
    expect((html.match(/<li /g) || []).length).toBe(2);
  });
});

describe('calibration email — managed failure variant (IMP-1)', () => {
  it('shows the deterministic reassurance line on a FAILED run', () => {
    const html = renderHtml(input({ passed: false }), 'summary');
    expect(html).toContain('Our team is working to resolve this');
    expect(html).toContain('no action needed from you');
  });

  it('uses managed h1 + "View your agents" CTA on a FAILED run', () => {
    const html = renderHtml(input({ passed: false }), 'summary');
    expect(html).toContain("We're getting your agent ready");
    expect(html).toContain('View your agents');
    expect(html).not.toContain('Review & fix');
  });

  it('suppresses the issue-count table on a FAILED run', () => {
    const html = renderHtml(
      input({ passed: false, issuesFound: 3, issuesFixed: 1, issuesRemaining: 2 }),
      'summary',
    );
    expect(html).not.toContain('Still needs attention');
    expect(html).not.toContain('Issues found');
  });

  it('keeps the success layout unchanged on a PASSED run', () => {
    const html = renderHtml(input({ passed: true }), 'summary');
    expect(html).toContain('Your agent is ready');
    expect(html).toContain('Still needs attention');
    expect(html).toContain('View your agent');
    expect(html).not.toContain('Our team is working to resolve this');
  });
});
