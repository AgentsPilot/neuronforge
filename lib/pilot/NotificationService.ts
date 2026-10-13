/**
 * NotificationService - Send notifications for approval requests
 *
 * Responsibilities:
 * - Send webhook notifications
 * - Send email notifications
 * - Support Slack/Teams integrations (future)
 *
 * Phase 6: Human-in-the-Loop
 *
 * @module lib/pilot/NotificationService
 */

import type { ApprovalRequest, HumanApprovalStep } from './types';
import { platformOrigin } from '@/lib/utils/origins';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'NotificationService' });

export class NotificationService {
  /**
   * Send a one-off transactional email to a user via Resend.
   *
   * Public wrapper over the internal sendEmailNotification — for user-facing
   * notification emails (e.g. post-creation calibration results) that aren't
   * tied to an approval request.
   *
   * @returns `true` if the email was actually dispatched to Resend, `false` if
   *   it was skipped because RESEND_API_KEY is not configured. Throws on a
   *   Resend API error (caller decides how to handle). Letting callers
   *   distinguish skipped-vs-sent avoids misleading "email sent" logs.
   */
  async sendTransactionalEmail(
    to: string[],
    subject: string,
    html: string,
    from?: string,
    ownerUserId?: string
  ): Promise<boolean> {
    return this.sendEmailNotification(to, subject, html, { from, ownerUserId });
  }

  /**
   * Send notifications for approval request
   */
  async sendApprovalNotifications(
    approvalRequest: ApprovalRequest,
    step: HumanApprovalStep
  ): Promise<void> {
    logger.info({ approvalRequestId: approvalRequest.id }, 'Sending approval notifications');

    if (!step.notificationChannels || step.notificationChannels.length === 0) {
      logger.info({ approvalRequestId: approvalRequest.id }, 'No notification channels configured');
      return;
    }

    const notifications = step.notificationChannels.map(channel =>
      this.sendNotification(channel, approvalRequest)
    );

    await Promise.allSettled(notifications);
    logger.info({ approvalRequestId: approvalRequest.id, channels: step.notificationChannels.length }, 'Approval notifications sent');
  }

  /**
   * Send single notification
   */
  private async sendNotification(
    channel: { type: string; config: Record<string, any> },
    approvalRequest: ApprovalRequest
  ): Promise<void> {
    try {
      switch (channel.type) {
        case 'webhook':
          await this.sendWebhook(channel.config, approvalRequest);
          break;

        case 'email':
          await this.sendEmail(channel.config, approvalRequest);
          break;

        case 'slack':
          await this.sendSlack(channel.config, approvalRequest);
          break;

        case 'teams':
          await this.sendTeams(channel.config, approvalRequest);
          break;

        default:
          logger.warn({ channelType: channel.type }, 'Unknown notification channel type');
      }
    } catch (error: any) {
      logger.error({ err: error, channelType: channel.type }, 'Failed to send notification');
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(
    config: Record<string, any>,
    approvalRequest: ApprovalRequest
  ): Promise<void> {
    const { url, method = 'POST', headers = {} } = config;

    if (!url) {
      throw new Error('Webhook URL not configured');
    }

    logger.info({ url, approvalRequestId: approvalRequest.id }, 'Sending webhook notification');

    const payload = {
      type: 'approval_request',
      approval_id: approvalRequest.id,
      execution_id: approvalRequest.executionId,
      step_id: approvalRequest.stepId,
      title: approvalRequest.title,
      message: approvalRequest.message,
      context: approvalRequest.context,
      approvers: approvalRequest.approvers,
      approval_type: approvalRequest.approvalType,
      expires_at: approvalRequest.expiresAt,
      created_at: approvalRequest.createdAt,
    };

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
    }

    logger.info({ url }, 'Webhook sent successfully');
  }

  /**
   * Send email notification
   */
  private async sendEmail(
    config: Record<string, any>,
    approvalRequest: ApprovalRequest
  ): Promise<void> {
    const { to, from, subject, template } = config;

    if (!to) {
      throw new Error('Email recipient not configured');
    }

    logger.info({ to, approvalRequestId: approvalRequest.id }, 'Sending approval email');

    // Generate approval URL
    const approvalUrl = this.generateApprovalUrl(approvalRequest.id);

    const emailBody = this.renderEmailTemplate(template || 'default', {
      title: approvalRequest.title,
      message: approvalRequest.message,
      context: approvalRequest.context,
      approvalUrl,
      expiresAt: approvalRequest.expiresAt,
    });

    // Send via Resend email service
    await this.sendEmailNotification(
      [to],
      subject || `Approval Required: ${approvalRequest.title}`,
      emailBody,
      {
        from,
        approvalRequest,
        template: template || 'default',
      }
    );

    logger.info({ to }, 'Approval email notification sent');
  }

  /**
   * Send Slack notification
   */
  private async sendSlack(
    config: Record<string, any>,
    approvalRequest: ApprovalRequest
  ): Promise<void> {
    const { webhookUrl, channel } = config;

    if (!webhookUrl) {
      throw new Error('Slack webhook URL not configured');
    }

    logger.info({ channel, approvalRequestId: approvalRequest.id }, 'Sending Slack notification');

    const approvalUrl = this.generateApprovalUrl(approvalRequest.id);

    const slackMessage = {
      channel,
      text: `Approval Required: ${approvalRequest.title}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `✋ ${approvalRequest.title}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: approvalRequest.message || 'An approval is required to continue this workflow.',
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Approval Type:*\n${approvalRequest.approvalType}`,
            },
            {
              type: 'mrkdwn',
              text: `*Approvers:*\n${approvalRequest.approvers.length} user(s)`,
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Approve ✅',
              },
              url: `${approvalUrl}?action=approve`,
              style: 'primary',
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Reject ❌',
              },
              url: `${approvalUrl}?action=reject`,
              style: 'danger',
            },
          ],
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}`);
    }

    logger.info({ channel }, 'Slack notification sent');
  }

  /**
   * Send Microsoft Teams notification
   */
  private async sendTeams(
    config: Record<string, any>,
    approvalRequest: ApprovalRequest
  ): Promise<void> {
    const { webhookUrl } = config;

    if (!webhookUrl) {
      throw new Error('Teams webhook URL not configured');
    }

    logger.info({ approvalRequestId: approvalRequest.id }, 'Sending Teams notification');

    const approvalUrl = this.generateApprovalUrl(approvalRequest.id);

    const teamsMessage = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      summary: `Approval Required: ${approvalRequest.title}`,
      themeColor: 'FF6D00',
      title: `✋ ${approvalRequest.title}`,
      text: approvalRequest.message || 'An approval is required to continue this workflow.',
      sections: [
        {
          facts: [
            { name: 'Approval Type', value: approvalRequest.approvalType },
            { name: 'Approvers', value: `${approvalRequest.approvers.length} user(s)` },
            {
              name: 'Expires At',
              value: approvalRequest.expiresAt
                ? new Date(approvalRequest.expiresAt).toLocaleString()
                : 'No expiration',
            },
          ],
        },
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'Approve ✅',
          targets: [{ os: 'default', uri: `${approvalUrl}?action=approve` }],
        },
        {
          '@type': 'OpenUri',
          name: 'Reject ❌',
          targets: [{ os: 'default', uri: `${approvalUrl}?action=reject` }],
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(teamsMessage),
    });

    if (!response.ok) {
      throw new Error(`Teams webhook returned ${response.status}`);
    }

    logger.info({ approvalRequestId: approvalRequest.id }, 'Teams notification sent');
  }

  /**
   * Generate approval URL
   */
  private generateApprovalUrl(approvalId: string): string {
    // `platformOrigin()`: a notification link has to be reachable by whoever
    // receives it, which a loopback address never is on a deployed build.
    const baseUrl = platformOrigin();
    return `${baseUrl}/approvals/${approvalId}`;
  }

  /**
   * Render email template
   */
  private renderEmailTemplate(
    template: string,
    data: {
      title: string;
      message?: string;
      context: Record<string, any>;
      approvalUrl: string;
      expiresAt?: string;
    }
  ): string {
    // Simple template rendering
    /*
     * EVERY RULE INLINE, because a phone throws the others away.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This was styled by a stylesheet in the head — `.container`, `.header`,
     * `.button`, `.approve`, `.reject`. Gmail's mobile apps STRIP that
     * element, and only that element: the markup arrives intact and every
     * rule meant to lay it out is gone. So the same email that looks right on
     * a laptop arrives on a phone as a bare column of text, with Approve and
     * Reject as two indistinguishable blue links.
     *
     * An approval request is the worst email to lose its buttons in: the two
     * actions are opposites, one click each, and unstyled they look the same.
     *
     * Inline `style` attributes survive everywhere, which is why
     * `lib/email/templates/base-template.ts` uses nothing else and why the
     * client-facing mail was never affected. `emailIsInlineStyled.guard.test.ts`
     * holds the line.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const button =
      'display: inline-block; padding: 12px 24px; margin: 10px 5px; text-decoration: none;' +
      ' border-radius: 4px; font-weight: bold; font-family: Arial, sans-serif; font-size: 15px;';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background: #ffffff;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #FF6D00; color: #ffffff; padding: 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 22px; color: #ffffff;">&#9995; Approval Required</h1>
            </div>
            <div style="padding: 20px; background: #f9f9f9;">
              <h2 style="margin-top: 0; color: #333333;">${data.title}</h2>
              <p>${data.message || 'An approval is required to continue this workflow.'}</p>
              ${data.expiresAt ? `<p><strong>Expires:</strong> ${new Date(data.expiresAt).toLocaleString()}</p>` : ''}
              <div style="text-align: center; margin-top: 30px;">
                <a href="${data.approvalUrl}?action=approve" style="${button} background: #4CAF50; color: #ffffff;">Approve &#9989;</a>
                <a href="${data.approvalUrl}?action=reject" style="${button} background: #f44336; color: #ffffff;">Reject &#10060;</a>
              </div>
            </div>
            <div style="text-align: center; padding: 20px; font-size: 12px; color: #666666;">
              <p style="margin: 0;">This is an automated notification from your workflow system.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Send email notification via the provider-agnostic transport
   * (Resend → Gmail OAuth2 → console preview). Best-effort: does not throw.
   *
   * @returns true if actually dispatched by some provider, false otherwise.
   */
  private async sendEmailNotification(
    to: string[],
    subject: string,
    body: string,
    data: any
  ): Promise<boolean> {
    // Approval and calibration notices, addressed to the account owner about
    // their own agents. Transactional by any reading.
    const result = await sendEmail({ kind: 'transactional', to, subject, html: body, from: data?.from, ownerUserId: data?.ownerUserId });
    if (result.sent) {
      logger.info({ provider: result.provider, recipients: to.length }, 'Email sent');
    } else {
      logger.warn({ provider: result.provider, error: result.error, recipients: to.length, subject }, 'Email not sent');
    }
    return result.sent;
  }
}
