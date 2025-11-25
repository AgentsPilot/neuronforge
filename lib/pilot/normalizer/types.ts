/**
 * Unified Data Types for Cross-Plugin Normalization
 *
 * Phase 1: Data Normalization Layer
 * These types provide a consistent interface across different plugins
 * (Gmail, Outlook, Stripe, PayPal, HubSpot, Salesforce, etc.)
 */

/**
 * Unified Email Type
 * Supports: Gmail, Outlook, Exchange, Yahoo
 */
export interface UnifiedEmail {
  // Core fields
  id: string;
  subject: string;
  body: string;
  from: {
    email: string;
    name?: string;
  };
  to: Array<{ email: string; name?: string }>;
  cc?: Array<{ email: string; name?: string }>;
  bcc?: Array<{ email: string; name?: string }>;

  // Timestamps (ISO 8601)
  date: string;
  receivedDate?: string;
  sentDate?: string;

  // Metadata
  threadId?: string;
  labels?: string[];
  isRead: boolean;
  hasAttachments: boolean;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    size: number;
    url?: string;
  }>;

  // Source tracking
  _source: {
    plugin: string;      // 'google-mail', 'microsoft-outlook'
    originalId: string;
    normalizedAt: string;
  };
}

/**
 * Unified Transaction Type
 * Supports: Stripe, PayPal, Square, Braintree
 */
export interface UnifiedTransaction {
  // Core fields
  id: string;
  amount: number;
  currency: string;      // ISO 4217 (USD, EUR, etc.)
  status: 'pending' | 'completed' | 'failed' | 'refunded';

  // Parties
  customer: {
    id?: string;
    email?: string;
    name?: string;
  };
  merchant?: {
    id?: string;
    name?: string;
  };

  // Timestamps (ISO 8601)
  createdAt: string;
  completedAt?: string;

  // Details
  description?: string;
  paymentMethod?: 'card' | 'bank_transfer' | 'paypal' | 'crypto';
  fee?: number;
  net?: number;

  // Source tracking
  _source: {
    plugin: string;      // 'stripe', 'paypal'
    originalId: string;
    normalizedAt: string;
  };
}

/**
 * Unified Contact Type
 * Supports: HubSpot, Salesforce, Google Contacts, Microsoft Contacts
 */
export interface UnifiedContact {
  // Core fields
  id: string;
  email: string;
  name: {
    first?: string;
    last?: string;
    full: string;
  };

  // Contact info
  phone?: string;
  company?: string;
  jobTitle?: string;

  // Social
  linkedin?: string;
  twitter?: string;

  // CRM-specific
  tags?: string[];
  lastContactedAt?: string;
  notes?: string;

  // Source tracking
  _source: {
    plugin: string;
    originalId: string;
    normalizedAt: string;
  };
}

/**
 * Unified Event Type
 * Supports: Google Calendar, Outlook Calendar, Apple Calendar
 */
export interface UnifiedEvent {
  // Core fields
  id: string;
  title: string;
  description?: string;

  // Time
  startTime: string;    // ISO 8601
  endTime: string;      // ISO 8601
  timezone?: string;
  isAllDay: boolean;

  // Participants
  organizer: {
    email: string;
    name?: string;
  };
  attendees?: Array<{
    email: string;
    name?: string;
    status: 'accepted' | 'declined' | 'tentative' | 'needs_action';
  }>;

  // Metadata
  location?: string;
  meetingUrl?: string;
  recurrence?: string;  // RRULE format

  // Source tracking
  _source: {
    plugin: string;
    originalId: string;
    normalizedAt: string;
  };
}

/**
 * Data type detection
 */
export type NormalizedDataType = 'email' | 'transaction' | 'contact' | 'event' | 'unknown';
