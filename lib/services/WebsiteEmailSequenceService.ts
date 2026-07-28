/**
 * Website Email Sequence Service
 * Creates and manages default email sequences for website capability triggers
 *
 * Triggers:
 * - contact_created: When a contact form is submitted
 * - booking_confirmed: When a booking is made
 * - payment_received: When a payment is processed
 * - intake_completed: When an intake form is submitted
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'WebsiteEmailSequenceService' });

// Email template types
type TriggerType = 'contact_created' | 'booking_confirmed' | 'payment_received' | 'intake_completed';

interface EmailTemplate {
  name: string;
  description: string;
  trigger_type: TriggerType;
  steps: {
    step_number: number;
    delay_minutes: number;
    subject: string;
    body_html: string;
  }[];
}

// Default email templates
const DEFAULT_TEMPLATES: Record<TriggerType, EmailTemplate> = {
  contact_created: {
    name: 'Website Contact Response',
    description: 'Automatic response when someone submits your website contact form',
    trigger_type: 'contact_created',
    steps: [
      {
        step_number: 1,
        delay_minutes: 0, // Immediate
        subject: 'Thank you for reaching out!',
        body_html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Thank you for your message!</h2>
            <p>Hi {{contact.first_name}},</p>
            <p>Thank you for reaching out to us. We've received your message and will get back to you as soon as possible.</p>
            <p>In the meantime, feel free to explore our services or book a consultation directly on our website.</p>
            <p>Best regards,<br>{{business.name}}</p>
          </div>
        `
      },
      {
        step_number: 2,
        delay_minutes: 1440, // 24 hours
        subject: 'Just checking in...',
        body_html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <p>Hi {{contact.first_name}},</p>
            <p>I wanted to follow up on your inquiry from yesterday. We'd love to help you with your needs.</p>
            <p>Would you like to schedule a quick call to discuss how we can help?</p>
            <p><a href="{{booking_link}}" style="display: inline-block; background: #4F6EF7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Book a Call</a></p>
            <p>Looking forward to hearing from you!</p>
            <p>Best,<br>{{business.name}}</p>
          </div>
        `
      }
    ]
  },
  booking_confirmed: {
    name: 'Booking Confirmation',
    description: 'Sent when a client books an appointment',
    trigger_type: 'booking_confirmed',
    steps: [
      {
        step_number: 1,
        delay_minutes: 0, // Immediate
        subject: 'Your appointment is confirmed!',
        body_html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Booking Confirmed!</h2>
            <p>Hi {{contact.first_name}},</p>
            <p>Great news! Your appointment has been confirmed.</p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Service:</strong> {{booking.service_name}}</p>
              <p style="margin: 10px 0 0;"><strong>Date:</strong> {{booking.date}}</p>
              <p style="margin: 10px 0 0;"><strong>Time:</strong> {{booking.time}}</p>
              <p style="margin: 10px 0 0;"><strong>Duration:</strong> {{booking.duration}} minutes</p>
            </div>
            <p>Please arrive 5-10 minutes early. If you need to reschedule, please let us know at least 24 hours in advance.</p>
            <p>See you soon!</p>
            <p>Best,<br>{{business.name}}</p>
          </div>
        `
      },
      {
        step_number: 2,
        delay_minutes: -1440, // 24 hours BEFORE (reminder)
        subject: 'Reminder: Your appointment is tomorrow',
        body_html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Appointment Reminder</h2>
            <p>Hi {{contact.first_name}},</p>
            <p>This is a friendly reminder about your upcoming appointment:</p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Service:</strong> {{booking.service_name}}</p>
              <p style="margin: 10px 0 0;"><strong>Date:</strong> {{booking.date}}</p>
              <p style="margin: 10px 0 0;"><strong>Time:</strong> {{booking.time}}</p>
            </div>
            <p>We look forward to seeing you!</p>
            <p>Best,<br>{{business.name}}</p>
          </div>
        `
      }
    ]
  },
  payment_received: {
    name: 'Payment Receipt',
    description: 'Sent when a payment is successfully processed',
    trigger_type: 'payment_received',
    steps: [
      {
        step_number: 1,
        delay_minutes: 0, // Immediate
        subject: 'Payment received - Thank you!',
        body_html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Payment Received</h2>
            <p>Hi {{contact.first_name}},</p>
            <p>Thank you for your payment! Here's your receipt:</p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Description:</strong> {{payment.description}}</p>
              <p style="margin: 10px 0 0;"><strong>Amount:</strong> {{payment.amount}}</p>
              <p style="margin: 10px 0 0;"><strong>Date:</strong> {{payment.date}}</p>
              <p style="margin: 10px 0 0;"><strong>Reference:</strong> {{payment.reference}}</p>
            </div>
            <p>If you have any questions about this payment, please don't hesitate to reach out.</p>
            <p>Thank you for your business!</p>
            <p>Best,<br>{{business.name}}</p>
          </div>
        `
      }
    ]
  },
  intake_completed: {
    name: 'Intake Form Received',
    description: 'Sent when a client completes an intake form',
    trigger_type: 'intake_completed',
    steps: [
      {
        step_number: 1,
        delay_minutes: 0, // Immediate
        subject: 'Thank you for completing your intake form',
        body_html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Intake Form Received</h2>
            <p>Hi {{contact.first_name}},</p>
            <p>Thank you for completing your intake form! We've received all the information and will review it before our upcoming session.</p>
            <p>This helps us personalize your experience and make the most of our time together.</p>
            <p>If you have any additional information to share or questions before our meeting, feel free to reply to this email.</p>
            <p>Looking forward to working with you!</p>
            <p>Best,<br>{{business.name}}</p>
          </div>
        `
      }
    ]
  }
};

export class WebsiteEmailSequenceService {
  /**
   * Create default email sequences for a user's website
   * Called when a user enables the Website capability
   */
  static async createDefaultSequences(userId: string): Promise<{ success: boolean; created: string[] }> {
    const created: string[] = [];

    try {
      for (const [triggerType, template] of Object.entries(DEFAULT_TEMPLATES)) {
        // Check if sequence already exists
        const { data: existing } = await supabaseServer
          .from('email_sequences')
          .select('id')
          .eq('user_id', userId)
          .eq('trigger_type', triggerType)
          .single();

        if (existing) {
          logger.info({ userId, triggerType }, 'Sequence already exists, skipping');
          continue;
        }

        // Create sequence
        const { data: sequence, error: seqError } = await supabaseServer
          .from('email_sequences')
          .insert({
            user_id: userId,
            name: template.name,
            description: template.description,
            trigger_type: template.trigger_type,
            trigger_config: { source: 'website' },
            is_active: true
          })
          .select('id')
          .single();

        if (seqError || !sequence) {
          logger.error({ err: seqError, triggerType }, 'Failed to create sequence');
          continue;
        }

        // Create steps
        for (const step of template.steps) {
          const { error: stepError } = await supabaseServer
            .from('email_sequence_steps')
            .insert({
              sequence_id: sequence.id,
              user_id: userId,
              step_number: step.step_number,
              delay_minutes: step.delay_minutes,
              subject: step.subject,
              body_html: step.body_html,
              body_text: step.body_html.replace(/<[^>]*>/g, '') // Strip HTML for plain text
            });

          if (stepError) {
            logger.error({ err: stepError, sequenceId: sequence.id, stepNumber: step.step_number }, 'Failed to create step');
          }
        }

        created.push(template.name);
        logger.info({ userId, sequenceId: sequence.id, name: template.name }, 'Created default sequence');
      }

      return { success: true, created };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to create default sequences');
      return { success: false, created };
    }
  }

  /**
   * Get available email sequences for website triggers
   */
  static async getWebsiteSequences(userId: string): Promise<{
    data: Array<{ id: string; name: string; trigger_type: string; is_active: boolean }> | null;
    error: Error | null;
  }> {
    try {
      const { data, error } = await supabaseServer
        .from('email_sequences')
        .select('id, name, trigger_type, is_active')
        .eq('user_id', userId)
        .in('trigger_type', ['contact_created', 'booking_confirmed', 'payment_received', 'intake_completed'])
        .order('name');

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get website sequences');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Trigger an email sequence for a contact
   */
  static async triggerSequence(
    userId: string,
    contactId: string,
    triggerType: TriggerType,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; enrollmentId?: string }> {
    try {
      // Find active sequence for this trigger
      const { data: sequence } = await supabaseServer
        .from('email_sequences')
        .select('id')
        .eq('user_id', userId)
        .eq('trigger_type', triggerType)
        .eq('is_active', true)
        .single();

      if (!sequence) {
        logger.info({ userId, triggerType }, 'No active sequence found for trigger');
        return { success: true }; // Not an error, just no sequence configured
      }

      // Check if already enrolled
      const { data: existingEnrollment } = await supabaseServer
        .from('email_sequence_enrollments')
        .select('id')
        .eq('sequence_id', sequence.id)
        .eq('contact_id', contactId)
        .eq('status', 'active')
        .single();

      if (existingEnrollment) {
        logger.info({ contactId, sequenceId: sequence.id }, 'Contact already enrolled');
        return { success: true, enrollmentId: existingEnrollment.id };
      }

      // Create enrollment
      const { data: enrollment, error } = await supabaseServer
        .from('email_sequence_enrollments')
        .insert({
          user_id: userId,
          sequence_id: sequence.id,
          contact_id: contactId,
          status: 'active',
          current_step_number: 1,
          next_send_at: new Date().toISOString(), // First email sends immediately
          metadata
        })
        .select('id')
        .single();

      if (error) throw error;

      logger.info(
        { userId, contactId, sequenceId: sequence.id, enrollmentId: enrollment?.id, triggerType },
        'Contact enrolled in email sequence'
      );

      return { success: true, enrollmentId: enrollment?.id };
    } catch (error) {
      logger.error({ err: error, userId, contactId, triggerType }, 'Failed to trigger sequence');
      return { success: false };
    }
  }
}
