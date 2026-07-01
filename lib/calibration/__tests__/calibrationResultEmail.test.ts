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
