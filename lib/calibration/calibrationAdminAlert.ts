// lib/calibration/calibrationAdminAlert.ts
// IMP-2: on a FAILED background calibration, email the system admins the agent +
// failure details so they can start RCA immediately. This is what fulfils IMP-1's
// "our team is on it" promise to the user (see calibrationResultEmail.ts).
//
// Design constraints (locked 2026-07-02; transport revised 2026-07-05):
//  - Deterministic (no LLM) — this is an internal technical alert.
//  - Transport: prefer system transport (Resend → Gmail-app), but fall back to
//    the run user's own google-mail plugin connection as a LAST RESORT when no
//    system transport is configured/working. Deliverability wins — if the system
//    is misconfigured, admins must still learn a calibration failed, even if the
//    mail is sent from the user's account. (Was "system transport only"; that
//    silently swallowed the alert on envs without Resend/Gmail-app — e.g. local.)
//    Note: on an admin-triggered run, ownerUserId is the impersonated owner, so
//    the last-resort send would come from the owner's Gmail — acceptable per the
//    deliverability-first decision (and admin runs use configured infra anyway).
//  - Deduped by workflow_hash upstream (route) — one alert per broken version.
//  - INTERNAL ONLY: embeds the user's data the agent was processing. Admins must
//    not forward it (stated in the footer).

import { NotificationService } from '@/lib/pilot/NotificationService';
import { createLogger } from '@/lib/logger';
import type { CalibrationAutoRca } from './calibrationRca-schema';

const logger = createLogger({ module: 'CalibrationAdminAlert', service: 'v6-calibration' });

/** A single calibration issue as stored in calibration_history.issues_*. */
export interface AdminAlertIssue {
  category?: string;
  title?: string;
  message?: string;
  description?: string;
  technicalDetails?: string;
  affectedSteps?: string[];
  [key: string]: any;
}

export interface CalibrationAdminAlertInput {
  /** Resolved admin recipients (AdminAccessService.listAdminEmails()). */
  adminEmails: string[];
  agentId: string;
  agentName: string;
  ownerUserId: string;
  ownerEmail: string | null;
  /** needs_review | failed — the status the run landed on. */
  status: string;
  iterations: number;
  autoFixesApplied: number;
  stepsCompleted: number;
  stepsFailed: number;
  stepsSkipped: number;
  /** Remaining issues that still block the agent (the actionable failures). */
  issuesRemaining: AdminAlertIssue[];
  /** Issues fixed automatically during the run (context for what was already tried). */
  issuesFixed?: AdminAlertIssue[];
  /** Plain-English notes about parameter values the resolver auto-set (IMP/Option A). */
  appliedFixNotes?: string[];
  /** Identifiers for RCA + dedup. */
  workflowHash: string;
  sessionId?: string | null;
  calibrationHistoryId?: string | null;
  executionId?: string | null;
  /** The input values the agent ran with — "the data the agent was processing". */
  inputValues?: Record<string, any> | null;
  /** Set when an admin triggered this run on behalf of the owner (test flow). */
  initiatedByAdminId?: string | null;
  /** Base app URL for building links. */
  appBaseUrl: string;
  /**
   * Optional LLM-generated root-cause analysis (FR-22). When present, an
   * additive "Automated RCA" section is rendered. When absent/null, the email
   * output is byte-identical to the deterministic-only alert.
   */
  autoRca?: CalibrationAutoRca | null;
}

/**
 * Send the admin failure alert. Best-effort: never throws — calibration
 * completion must not fail because the alert failed. Returns whether a message
 * was dispatched (false = no recipients or transport skipped).
 */
export async function sendCalibrationAdminAlert(input: CalibrationAdminAlertInput): Promise<boolean> {
  try {
    if (!input.adminEmails.length) {
      logger.warn({ agentId: input.agentId }, 'No admin recipients resolved — skipping admin alert');
      return false;
    }

    const subject = `🚨 Calibration failed: "${input.agentName}" (${input.status}) — needs RCA`;
    const html = renderAdminAlertHtml(input);

    const notificationService = new NotificationService();
    // Prefer system transport (Resend → Gmail-app); pass ownerUserId so the
    // transport can fall back to the run user's google-mail plugin connection as
    // a LAST RESORT when no system transport is working. Deliverability of a
    // failure alert outranks the "internal mail shouldn't use a user connection"
    // preference — an undelivered alert is worse than one sent from the user's
    // account. See the transport-priority chain in lib/notifications/emailTransport.ts.
    const dispatched = await notificationService.sendTransactionalEmail(
      input.adminEmails,
      subject,
      html,
      undefined,
      input.ownerUserId
    );

    if (dispatched) {
      logger.info(
        { agentId: input.agentId, recipients: input.adminEmails.length, status: input.status },
        'Calibration admin alert sent'
      );
    } else {
      logger.warn(
        { agentId: input.agentId },
        'Calibration admin alert not delivered — no email transport succeeded (see EmailTransport logs)'
      );
    }
    return dispatched;
  } catch (err) {
    logger.error({ err, agentId: input.agentId }, 'Failed to send calibration admin alert (non-blocking)');
    return false;
  }
}

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function issueRows(issues: AdminAlertIssue[]): string {
  if (!issues.length) return '<p style="margin:0;color:#666;font-size:13px;">(none recorded)</p>';
  return issues
    .map((i) => {
      const heading = i.title || i.message || i.description || i.category || 'Issue';
      const detailBits: string[] = [];
      if (i.category) detailBits.push(`<span style="color:#6b7280;">category:</span> ${esc(i.category)}`);
      if (i.affectedSteps?.length)
        detailBits.push(`<span style="color:#6b7280;">steps:</span> ${esc(i.affectedSteps.join(', '))}`);
      const tech = i.technicalDetails ? `<pre style="margin:6px 0 0;padding:8px;background:#0b1020;color:#d1d5db;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word;">${esc(i.technicalDetails)}</pre>` : '';
      return `
        <li style="margin:0 0 12px;">
          <div style="font-weight:600;color:#111;">${esc(heading)}</div>
          ${detailBits.length ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${detailBits.join(' &nbsp;•&nbsp; ')}</div>` : ''}
          ${tech}
        </li>`;
    })
    .join('');
}

function kvRow(label: string, value: string): string {
  return `<tr><td style="padding:3px 12px 3px 0;color:#6b7280;white-space:nowrap;">${esc(label)}</td><td style="padding:3px 0;color:#111;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(value)}</td></tr>`;
}

/**
 * Render the additive, LLM-generated RCA section (FR-3/FR-4/FR-6). Every dynamic
 * field — including the LLM output — is HTML-escaped. Rendered only when an RCA
 * is present; otherwise the caller emits today's byte-identical output.
 */
function rcaSection(rca: CalibrationAutoRca): string {
  const solutions = rca.suggestedSolutions
    .map((s) => `<li style="margin:0 0 4px;">${esc(s)}</li>`)
    .join('');

  const field = (label: string, value: string): string => `
    <div style="margin:0 0 10px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#6b7280;margin-bottom:2px;">${esc(label)}</div>
      <div style="font-size:13px;color:#111;">${esc(value)}</div>
    </div>`;

  return `
          <div style="margin:0 0 20px;padding:14px 16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;">
            <h2 style="margin:0 0 4px;font-size:14px;color:#075985;">🤖 Automated RCA (LLM-generated — verify before acting)</h2>
            <p style="margin:0 0 12px;font-size:12px;color:#0369a1;">Machine-produced starting point. Confirm against the evidence before routing a fix.</p>
            ${field('Symptom', rca.symptom)}
            ${field('Evidence', rca.evidence)}
            ${field('Earliest failing step + cascade', rca.earliestFailingStep)}
            ${field('Root-cause layer', rca.rootCauseLayer)}
            <div style="margin:0 0 10px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#6b7280;margin-bottom:2px;">Root cause</div>
              <pre style="margin:0;padding:8px;background:#0b1020;color:#d1d5db;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word;">${esc(rca.rootCause)}</pre>
            </div>
            ${field('Fix owner', rca.fixOwner)}
            <div style="margin:0 0 10px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#6b7280;margin-bottom:2px;">Suggested solutions</div>
              <ul style="margin:0;padding-left:18px;font-size:13px;color:#111;">${solutions}</ul>
            </div>
            ${field('Remediation path', rca.remediationPath)}
          </div>`;
}

/** Deterministic technical HTML. Exported for unit testing. */
export function renderAdminAlertHtml(input: CalibrationAdminAlertInput): string {
  const dataJson = input.inputValues && Object.keys(input.inputValues).length
    ? JSON.stringify(input.inputValues, null, 2)
    : null;

  const rcaCommand = `npx tsx scripts/dump-calibration.ts ${input.agentId}`;
  const agentLink = `${input.appBaseUrl}/agents/${input.agentId}`;
  const sandboxLink = `${input.appBaseUrl}/v2/sandbox/${input.agentId}`;

  return `
  <!DOCTYPE html>
  <html>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
      <div style="max-width:680px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
        <div style="padding:18px 24px;border-bottom:4px solid #dc2626;background:#fef2f2;">
          <h1 style="margin:0;font-size:17px;color:#7f1d1d;">🚨 Calibration failed — RCA needed</h1>
          <p style="margin:6px 0 0;font-size:14px;color:#991b1b;">"${esc(input.agentName)}" landed on <strong>${esc(input.status)}</strong> after ${input.iterations} iteration${input.iterations === 1 ? '' : 's'}.</p>
        </div>
        ${input.initiatedByAdminId ? `
        <div style="padding:10px 24px;background:#eef2ff;border-bottom:1px solid #c7d2fe;">
          <p style="margin:0;font-size:13px;color:#3730a3;">🧪 <strong>Admin test run</strong> — triggered on behalf of the owner by admin <code>${esc(input.initiatedByAdminId)}</code>. This is a manual test, not a live user failure.</p>
        </div>` : ''}

        <div style="padding:20px 24px;color:#333;font-size:14px;line-height:1.5;">
          ${input.autoRca ? rcaSection(input.autoRca) : ''}
          <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;">Agent & run</h2>
          <table style="border-collapse:collapse;font-size:13px;margin:0 0 20px;">
            ${kvRow('Agent', `${input.agentName}`)}
            ${kvRow('Agent ID', input.agentId)}
            ${kvRow('Owner', `${input.ownerEmail || 'unknown'} (${input.ownerUserId})`)}
            ${kvRow('Status', input.status)}
            ${kvRow('Iterations', String(input.iterations))}
            ${kvRow('Auto-fixes applied', String(input.autoFixesApplied))}
            ${kvRow('Steps (done/failed/skipped)', `${input.stepsCompleted} / ${input.stepsFailed} / ${input.stepsSkipped}`)}
            ${kvRow('Workflow hash', input.workflowHash)}
            ${input.sessionId ? kvRow('Session ID', input.sessionId) : ''}
            ${input.executionId ? kvRow('Execution ID', input.executionId) : ''}
            ${input.calibrationHistoryId ? kvRow('History ID', input.calibrationHistoryId) : ''}
          </table>

          <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;">Remaining issues (${input.issuesRemaining.length})</h2>
          <ul style="margin:0 0 20px;padding-left:18px;">${issueRows(input.issuesRemaining)}</ul>

          ${input.appliedFixNotes?.length ? `
          <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;">Auto-adjustments already tried</h2>
          <ul style="margin:0 0 20px;padding-left:18px;font-size:13px;color:#334155;">
            ${input.appliedFixNotes.map((n) => `<li style="margin:0 0 4px;">${esc(n)}</li>`).join('')}
          </ul>` : ''}

          ${dataJson ? `
          <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;">Data the agent was processing</h2>
          <pre style="margin:0 0 20px;padding:12px;background:#0b1020;color:#d1d5db;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-word;">${esc(dataJson)}</pre>` : ''}

          <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;">Jump into RCA</h2>
          <p style="margin:0 0 6px;">Pull the full evidence bundle:</p>
          <pre style="margin:0 0 12px;padding:10px 12px;background:#111827;color:#a7f3d0;border-radius:6px;font-size:13px;">${esc(rcaCommand)}</pre>
          <p style="margin:0 0 4px;font-size:13px;">Runbook: <code>docs/Calibration/CALIBRATION_RCA_RUNBOOK.md</code></p>
          <p style="margin:0 0 4px;font-size:13px;"><a href="${esc(agentLink)}" style="color:#2563eb;">Agent page</a> &nbsp;•&nbsp; <a href="${esc(sandboxLink)}" style="color:#2563eb;">Sandbox</a></p>
        </div>

        <div style="padding:14px 24px;background:#fff7ed;border-top:1px solid #fed7aa;color:#9a3412;font-size:12px;">
          <p style="margin:0;"><strong>Internal only.</strong> This alert contains customer data (the agent's inputs). Do not forward outside the team.</p>
        </div>
      </div>
    </body>
  </html>`;
}
