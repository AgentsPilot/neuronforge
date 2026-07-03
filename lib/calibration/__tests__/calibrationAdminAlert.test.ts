/**
 * Tests for the calibration admin failure alert (IMP-2). Exercises only the
 * deterministic renderer (no LLM / no send / no transport).
 */

import { renderAdminAlertHtml, type CalibrationAdminAlertInput } from '../calibrationAdminAlert';

function input(overrides: Partial<CalibrationAdminAlertInput> = {}): CalibrationAdminAlertInput {
  return {
    adminEmails: ['admin@example.com'],
    agentId: 'agent-123',
    agentName: 'Leads Agent',
    ownerUserId: 'user-9',
    ownerEmail: 'owner@example.com',
    status: 'needs_review',
    iterations: 3,
    autoFixesApplied: 2,
    stepsCompleted: 4,
    stepsFailed: 1,
    stepsSkipped: 0,
    issuesRemaining: [
      { category: 'parameter_error', title: 'Unable to parse range', technicalDetails: 'range "Sheet1" not found', affectedSteps: ['step_2'] },
    ],
    workflowHash: 'abc123hash',
    sessionId: 'sess-1',
    calibrationHistoryId: 'hist-1',
    executionId: 'exec-1',
    inputValues: { spreadsheet_id: 'ss-1', range: 'Sheet1!A1:B10' },
    appBaseUrl: 'https://app.example.com',
    ...overrides,
  };
}

describe('calibration admin alert — renderAdminAlertHtml', () => {
  it('renders the remaining issues with category + technical details', () => {
    const html = renderAdminAlertHtml(input());
    expect(html).toContain('Unable to parse range');
    expect(html).toContain('parameter_error');
    expect(html).toContain('range "Sheet1" not found'); // technicalDetails (quotes not escaped)
    expect(html).toContain('step_2');
  });

  it('embeds the data the agent was processing when inputValues are present', () => {
    const html = renderAdminAlertHtml(input());
    expect(html).toContain('Data the agent was processing');
    expect(html).toContain('spreadsheet_id');
    expect(html).toContain('Sheet1!A1:B10');
  });

  it('omits the data section when inputValues are empty', () => {
    expect(renderAdminAlertHtml(input({ inputValues: {} }))).not.toContain('Data the agent was processing');
    expect(renderAdminAlertHtml(input({ inputValues: null }))).not.toContain('Data the agent was processing');
  });

  it('includes the RCA command + key IDs', () => {
    const html = renderAdminAlertHtml(input());
    expect(html).toContain('npx tsx scripts/dump-calibration.ts agent-123');
    expect(html).toContain('abc123hash'); // workflow hash
    expect(html).toContain('sess-1'); // session id
    expect(html).toContain('exec-1'); // execution id
    expect(html).toContain('CALIBRATION_RCA_RUNBOOK.md');
  });

  it('shows the internal-only / do-not-forward footer', () => {
    const html = renderAdminAlertHtml(input());
    expect(html).toContain('Internal only');
    expect(html).toContain('Do not forward');
  });

  it('HTML-escapes issue + data content (no injection)', () => {
    const html = renderAdminAlertHtml(
      input({
        issuesRemaining: [{ title: '<script>x</script>', technicalDetails: 'a & b < c' }],
        inputValues: { note: '<img src=x>' },
      }),
    );
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('a &amp; b &lt; c');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('handles zero remaining issues gracefully', () => {
    const html = renderAdminAlertHtml(input({ issuesRemaining: [] }));
    expect(html).toContain('Remaining issues (0)');
    expect(html).toContain('(none recorded)');
  });

  it('shows the admin-test banner only when initiatedByAdminId is set', () => {
    const withAdmin = renderAdminAlertHtml(input({ initiatedByAdminId: 'admin-42' }));
    expect(withAdmin).toContain('Admin test run');
    expect(withAdmin).toContain('admin-42');

    const withoutAdmin = renderAdminAlertHtml(input({ initiatedByAdminId: null }));
    expect(withoutAdmin).not.toContain('Admin test run');
  });
});
