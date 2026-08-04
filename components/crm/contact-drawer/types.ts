// Shared types for CRM Contact Drawer components

import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMActivity } from '@/lib/repositories/CRMActivityRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';

export interface PaymentTransaction {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  description?: string;
}

export interface IntakeResponses {
  template_id: string;
  template_key: string;
  responses: Record<string, unknown>;
}

export interface IntakeTemplateField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'tel' | 'email';
  label_en: string;
  label_es: string;
  label_he: string;
  required?: boolean;
  options?: Array<{
    value: string;
    label_en: string;
    label_es: string;
    label_he: string;
  }>;
}

export interface IntakeTemplate {
  id: string;
  template_key: string;
  name_en: string;
  name_es: string;
  name_he: string;
  fields: IntakeTemplateField[];
}

export interface Appointment {
  id: string;
  service_id: string;
  client_first_name: string;
  client_last_name?: string;
  client_email?: string;      // Client email at time of booking
  client_phone?: string;      // Client phone at time of booking
  start_time: string | null;  // null for product purchases (no time slot)
  end_time: string | null;    // null for product purchases (no time slot)
  timezone?: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes?: string;
  intake_responses?: IntakeResponses;
  intake_completed_at?: string;
  created_at?: string;  // For product purchases, use created_at as the order date
  service?: {
    service_name: string;
    is_product?: boolean;  // true for products (no scheduling)
  };
}

export interface ContactTask {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  due_date: string | null;
  created_by: string;
  created_at: string;
}

export interface ContactEmail {
  id: string;
  subject: string;
  to_email: string;
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
  sent_at: string | null;
  opened_at: string | null;
  created_at: string;
}

export interface ContactDocument {
  id: string;
  name: string;
  document_type: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  download_url?: string;
}

export interface SessionPayment {
  id?: string;
  amount: number;
  currency: string;
  status: 'paid' | 'pending' | 'failed' | 'free';
  paidAt?: string;
  paymentMethod?: string;  // 'card', 'cash', 'bank_transfer', etc.
  last4?: string;  // Last 4 digits of card
}

// Email confirmation sent to client
export interface BookingConfirmationEmail {
  id: string;
  subject: string;
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
  sentAt?: string;
  openedAt?: string;
}

// Client info snapshot at time of booking (to detect changes)
export interface BookingClientSnapshot {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  // If different from current contact info, we can show what changed
}

// Full booking journey data - everything about this client's booking
export interface BookingJourneyData {
  // Service/Product info
  service: {
    id: string;
    name: string;
    isProduct: boolean;
    price?: number;
    currency?: string;
    duration?: number;  // in minutes, for services
  };

  // Schedule (null for products)
  schedule?: {
    startTime: string;
    endTime: string;
    timezone?: string;
    location?: string;
  };

  // Client info at time of booking
  clientSnapshot?: BookingClientSnapshot;

  // Payment details
  payment?: SessionPayment;

  // Intake form
  intake?: {
    templateId: string;
    templateName?: string;
    completedAt?: string;
    responses: Record<string, unknown>;
  };

  // Confirmation email
  confirmationEmail?: BookingConfirmationEmail;

  // Booking metadata
  createdAt: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes?: string;
}

// Booking journey step - each booking tracks its own client journey
export interface BookingJourneyStep {
  id: string;
  key: string;  // Step key for translations: 'booked', 'payment', 'intake', 'confirmation', 'session', etc.
  status: 'completed' | 'active' | 'pending' | 'failed' | 'skipped';
  label?: string;  // Optional override label (if not using translation key)
  details?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;  // Additional data (e.g., payment amount, intake responses)
}

// Re-export for backward compatibility
export type BookingStepData = BookingJourneyStep;

export interface SessionCardData {
  booking: Appointment;
  payment: SessionPayment | null;
  // Full journey data - all the info about this booking
  journeyData?: BookingJourneyData;
  // Journey steps - the actual client journey for this booking (optional, can be derived from journeyData)
  journeySteps?: BookingJourneyStep[];
}

export interface ContactFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  stage: string;
  source: string;
  tags: string[];
  notes: string;
  custom_fields: Record<string, unknown>;
}

// Props shared across sections
export interface SectionProps {
  contact: CRMContact;
  t: (key: string) => string;
  isRTL: boolean;
  language: string;
}

export type { CRMContact, CRMActivity, CRMPipelineStage };
