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

export class NotificationService {
  /**
   * Send notifications for approval request
   */
  async sendApprovalNotifications(
    approvalRequest: ApprovalRequest,
    step: HumanApprovalStep
  ): Promise<void> {
    console.log(`📢 [NotificationService] Sending notifications for ${approvalRequest.id}`);

    if (!step.notificationChannels || step.notificationChannels.length === 0) {
      console.log(`  ℹ️  No notification channels configured`);
      return;
    }

    const notifications = step.notificationChannels.map(channel =>
      this.sendNotification(channel, approvalRequest)
    );

    await Promise.allSettled(notifications);
    console.log(`✅ [NotificationService] Notifications sent`);
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
          console.warn(`⚠️  [NotificationService] Unknown channel type: ${channel.type}`);
      }
    } catch (error: any) {
      console.error(`❌ [NotificationService] Failed to send ${channel.type} notification:`, error.message);
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

    console.log(`🔔 [NotificationService] Sending webhook to ${url}`);

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

    console.log(`✅ [NotificationService] Webhook sent successfully`);
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

    console.log(`📧 [NotificationService] Sending email to ${to}`);

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

    console.log(`✅ [NotificationService] Email notification sent`);
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

    console.log(`💬 [NotificationService] Sending Slack message`);

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

    console.log(`✅ [NotificationService] Slack message sent`);
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

    console.log(`💬 [NotificationService] Sending Teams message`);

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

    console.log(`✅ [NotificationService] Teams message sent`);
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
   * Send email notification via Resend
   * Falls back gracefully if RESEND_API_KEY is not configured
   */
  private async sendEmailNotification(
    to: string[],
    subject: string,
    body: string,
    data: any
  ): Promise<void> {
    // Use Resend for email notifications
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!RESEND_API_KEY) {
      console.warn('⚠️  [NotificationService] RESEND_API_KEY not configured - skipping email');
      console.log(`📧 [NotificationService] Email preview:`, {
        to,
        subject,
        bodyLength: body.length,
        from: data.from || 'NeuronForge <notifications@neuronforge.app>',
      });
      return;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: data.from || 'NeuronForge <notifications@neuronforge.app>',
          to: to,
          subject: subject,
          html: body,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Resend API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`✅ [NotificationService] Email sent via Resend:`, {
        id: result.id,
        to: to.length,
      });
    } catch (error: any) {
      console.error(`❌ [NotificationService] Email failed:`, error.message);
      throw error;
    }
  }
}
