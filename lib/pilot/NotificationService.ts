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
    // Use environment variable or default
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
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
    return `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #FF6D00; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; margin: 10px 5px; text-decoration: none; border-radius: 4px; font-weight: bold; }
            .approve { background: #4CAF50; color: white; }
            .reject { background: #f44336; color: white; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✋ Approval Required</h1>
            </div>
            <div class="content">
              <h2>${data.title}</h2>
              <p>${data.message || 'An approval is required to continue this workflow.'}</p>
              ${data.expiresAt ? `<p><strong>Expires:</strong> ${new Date(data.expiresAt).toLocaleString()}</p>` : ''}
              <div style="text-align: center; margin-top: 30px;">
                <a href="${data.approvalUrl}?action=approve" class="button approve">Approve ✅</a>
                <a href="${data.approvalUrl}?action=reject" class="button reject">Reject ❌</a>
              </div>
            </div>
            <div class="footer">
              <p>This is an automated notification from your workflow system.</p>
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
    const result = await sendEmail({ to, subject, html: body, from: data?.from, ownerUserId: data?.ownerUserId });
    if (result.sent) {
      logger.info({ provider: result.provider, recipients: to.length }, 'Email sent');
    } else {
      logger.warn({ provider: result.provider, error: result.error, recipients: to.length, subject }, 'Email not sent');
    }
    return result.sent;
  }
}
