// lib/calibration/calibrationResultEmail.ts
// Builds and sends the post-creation calibration result email (Phase 2).
// Body is LLM-summarized with a deterministic fallback; delivery reuses the
// existing Resend path via NotificationService.

import { NotificationService } from '@/lib/pilot/NotificationService';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CalibrationResultEmail', service: 'v6-calibration' });

// Mirrors the model used elsewhere in the calibration subsystem
// (ConstrainedSemanticValidator) — fast + accurate for short summaries.
const SUMMARY_MODEL = 'claude-sonnet-4-5-20250929';

export interface CalibrationResultEmailInput {
  to: string;
  agentId: string;
  agentName: string;
  passed: boolean;
  issuesFound: number;
  issuesFixed: number;
  issuesRemaining: number;
  /** Titles of issues still needing the user's attention (failed runs). */
  remainingIssueTitles?: string[];
  /**
   * Plain-English notes about parameter values calibration looked up from the
   * live data source and set for the user (e.g. "The spreadsheet has one tab,
   * 'Leads', so I set the sheet to it."). Rendered in a "What we changed" block —
   * shown on BOTH passed and failed runs so the user always sees what was decided.
   */
  appliedFixNotes?: string[];
  /** Where the email's primary button points (agent page on pass, sandbox on fail). */
  ctaUrl: string;
  /** Agent owner's userId — enables the google-mail plugin-connection fallback transport. */
  ownerUserId?: string;
}

/**
 * Send the calibration-result email. Best-effort: never throws — calibration
 * completion must not fail because email failed.
 */
export async function sendCalibrationResultEmail(input: CalibrationResultEmailInput): Promise<void> {
  try {
    const summary = await buildSummary(input);
    const subject = input.passed
      ? `✅ "${input.agentName}" passed calibration and is ready to use`
      : `⚠️ "${input.agentName}" needs a quick review before it's ready`;
    const html = renderHtml(input, summary);

    const notificationService = new NotificationService();
    const dispatched = await notificationService.sendTransactionalEmail([input.to], subject, html, undefined, input.ownerUserId);

    if (dispatched) {
      logger.info({ agentId: input.agentId, passed: input.passed }, 'Calibration result email sent');
    } else {
      logger.warn(
        { agentId: input.agentId, passed: input.passed },
        'Calibration result email not delivered — no email transport succeeded (see EmailTransport logs for the provider-specific reason, e.g. RESEND_API_KEY missing / Gmail invalid_grant)'
      );
    }
  } catch (err) {
    logger.error({ err, agentId: input.agentId }, 'Failed to send calibration result email (non-blocking)');
  }
}

/** LLM-generated friendly summary, with a deterministic fallback. */
async function buildSummary(input: CalibrationResultEmailInput): Promise<string> {
  try {
    const provider = ProviderFactory.getProvider('anthropic');
    const prompt = [
      'Write a short, friendly 2-3 sentence summary of an automation calibration result for a non-technical user.',
      'Do not use markdown, headings, or bullet points — plain prose only.',
      '',
      `Agent name: ${input.agentName}`,
      `Outcome: ${input.passed ? 'passed cleanly — ready to use' : 'finished but still needs the user to review some issues'}`,
      `Issues found: ${input.issuesFound}; auto-fixed: ${input.issuesFixed}; still needing attention: ${input.issuesRemaining}`,
      input.remainingIssueTitles?.length
        ? `Remaining issues: ${input.remainingIssueTitles.slice(0, 5).join('; ')}`
        : '',
      input.appliedFixNotes?.length
        ? `Specific things we adjusted automatically (mention these plainly): ${input.appliedFixNotes.slice(0, 5).join(' ')}`
        : '',
      '',
      input.passed
        ? 'Tone: congratulatory and reassuring.'
        : 'Tone: helpful and encouraging — make clear a quick review will get it ready.',
    ].filter(Boolean).join('\n');

    const response = await provider.chatCompletion(
      {
        model: SUMMARY_MODEL,
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      },
      { userId: 'system', feature: 'calibration', component: 'CalibrationResultEmail' }
    );

    const content = response.choices[0]?.message?.content?.trim();
    if (content) return content;
  } catch (err) {
    logger.warn({ err, agentId: input.agentId }, 'LLM summary failed — using deterministic fallback');
  }
  return fallbackSummary(input);
}

function fallbackSummary(input: CalibrationResultEmailInput): string {
  if (input.passed) {
    return `Good news — we tested "${input.agentName}" on a real example and it ran successfully${
      input.issuesFixed > 0 ? `, fixing ${input.issuesFixed} thing${input.issuesFixed === 1 ? '' : 's'} automatically along the way` : ''
    }. It's ready to use.`;
  }
  return `We tested "${input.agentName}" and it needs a quick review: ${input.issuesRemaining} issue${
    input.issuesRemaining === 1 ? '' : 's'
  } still need your attention before it's ready. Open it to review and fix what's left.`;
}

// Exported for unit testing the deterministic HTML (the "What we changed" block,
// escaping); not used elsewhere.
export function renderHtml(input: CalibrationResultEmailInput, summary: string): string {
  const ctaLabel = input.passed ? 'View your agent' : 'Review & fix';
  const accent = input.passed ? '#16a34a' : '#d97706';
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `
  <!DOCTYPE html>
  <html>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
      <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
        <div style="padding:20px 24px;border-bottom:4px solid ${accent};">
          <h1 style="margin:0;font-size:18px;color:#111;">${input.passed ? 'Your agent is ready 🎉' : 'Your agent needs a quick review'}</h1>
        </div>
        <div style="padding:24px;color:#333;font-size:15px;line-height:1.55;">
          <p style="margin:0 0 16px;">${esc(summary)}</p>
          <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;color:#555;">
            <tr><td style="padding:4px 0;">Issues found</td><td style="padding:4px 0;text-align:right;font-weight:600;">${input.issuesFound}</td></tr>
            <tr><td style="padding:4px 0;">Fixed automatically</td><td style="padding:4px 0;text-align:right;font-weight:600;">${input.issuesFixed}</td></tr>
            <tr><td style="padding:4px 0;">Still needs attention</td><td style="padding:4px 0;text-align:right;font-weight:600;">${input.issuesRemaining}</td></tr>
          </table>
          ${input.appliedFixNotes?.length ? `
          <div style="margin:0 0 20px;padding:12px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#0369a1;">What we changed</p>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#334155;line-height:1.5;">
              ${input.appliedFixNotes.map((n) => `<li style="margin:0 0 4px;">${esc(n)}</li>`).join('')}
            </ul>
          </div>` : ''}
          <a href="${input.ctaUrl}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">${ctaLabel}</a>
        </div>
        <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #eee;color:#999;font-size:12px;">
          <p style="margin:0;">This is an automated message from NeuronForge.</p>
        </div>
      </div>
    </body>
  </html>`;
}
