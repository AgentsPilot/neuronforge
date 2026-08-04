/**
 * Business Event Types
 *
 * Type definitions for the Business OS Insight System event layer.
 * Events are organized by business vector (category) and used for:
 * 1. Pattern detection by detectors
 * 2. Metric computation
 * 3. Automation triggers
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

// ==================== EVENT CATEGORIES (Business Vectors) ====================

export type BusinessEventCategory =
  | 'acquisition'  // Traffic, form submissions, lead capture
  | 'conversion'   // Lead-to-client progression
  | 'sales'        // Enquiries, proposals, deals
  | 'cash_flow'    // Invoices, payments, AR
  | 'retention'    // Bookings, rebooking, churn
  | 'operations'   // Calendar, utilization, services
  | 'pricing';     // Price changes, discounts

// ==================== EVENT TYPES BY CATEGORY ====================

// Acquisition events
export type AcquisitionEventType =
  | 'page.viewed'
  | 'page.session_started'
  | 'form.submitted'
  | 'form.abandoned';

// Conversion events
export type ConversionEventType =
  | 'contact.created'
  | 'contact.stage_changed'
  | 'lead.qualified';

// Sales events
export type SalesEventType =
  | 'enquiry.received'
  | 'enquiry.replied'
  | 'enquiry.stalled'
  | 'proposal.sent'
  | 'proposal.viewed'
  | 'proposal.accepted'
  | 'proposal.rejected';

// Cash flow events (extends PaymentEventService types)
export type CashFlowEventType =
  | 'invoice.created'
  | 'invoice.sent'
  | 'invoice.viewed'
  | 'invoice.paid'
  | 'invoice.overdue'
  | 'invoice.cancelled'
  | 'payment.completed'
  | 'payment.failed'
  | 'refund.completed'
  | 'revenue.recognized'
  | 'ar.aged';

// Retention events
export type RetentionEventType =
  | 'booking.created'
  | 'booking.confirmed'
  | 'booking.completed'
  | 'booking.no_show'
  | 'booking.cancelled'
  | 'client.rebooking_due'
  | 'client.at_risk'
  | 'client.churned';

// Operations events
export type OperationsEventType =
  | 'calendar.slot_filled'
  | 'calendar.utilization_low'
  | 'calendar.utilization_high'
  | 'service.created'
  | 'service.updated'
  | 'service.disabled';

// Pricing events
export type PricingEventType =
  | 'pricing.changed'
  | 'discount.applied'
  | 'intro_offer.used'
  | 'intro_offer.converted';

// Union of all event types
export type BusinessEventType =
  | AcquisitionEventType
  | ConversionEventType
  | SalesEventType
  | CashFlowEventType
  | RetentionEventType
  | OperationsEventType
  | PricingEventType;

// ==================== ENTITY TYPES ====================

export type BusinessEntityType =
  | 'contact'
  | 'booking'
  | 'invoice'
  | 'service'
  | 'page'
  | 'session'
  | 'proposal'
  | 'activity';

// ==================== SOURCE CAPABILITIES ====================

export type SourceCapability =
  | 'scheduling'
  | 'payments'
  | 'crm'
  | 'website'
  | 'email'
  | 'kernel'
  | 'insight';

// ==================== INTERFACES ====================

export interface BusinessEvent {
  id: string;
  user_id: string;
  event_type: BusinessEventType;
  category: BusinessEventCategory;
  entity_type: BusinessEntityType;
  entity_id: string;
  contact_id?: string | null;
  session_id?: string | null;
  value_usd?: number | null;
  value_delta?: number | null;
  metadata: Record<string, unknown>;
  source_capability: SourceCapability;
  created_at: string;
}

export interface EmitBusinessEventParams {
  eventType: BusinessEventType;
  category: BusinessEventCategory;
  entityType: BusinessEntityType;
  entityId: string;
  contactId?: string | null;
  sessionId?: string | null;
  valueUsd?: number | null;
  valueDelta?: number | null;
  metadata?: Record<string, unknown>;
  sourceCapability: SourceCapability;
}

export interface GetBusinessEventsOptions {
  eventType?: BusinessEventType;
  category?: BusinessEventCategory;
  entityType?: BusinessEntityType;
  entityId?: string;
  contactId?: string;
  sourceCapability?: SourceCapability;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface BusinessEventServiceResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== EVENT TYPE TO CATEGORY MAPPING ====================

/**
 * Maps event types to their category for validation
 */
export const EVENT_TYPE_TO_CATEGORY: Record<BusinessEventType, BusinessEventCategory> = {
  // Acquisition
  'page.viewed': 'acquisition',
  'page.session_started': 'acquisition',
  'form.submitted': 'acquisition',
  'form.abandoned': 'acquisition',

  // Conversion
  'contact.created': 'conversion',
  'contact.stage_changed': 'conversion',
  'lead.qualified': 'conversion',

  // Sales
  'enquiry.received': 'sales',
  'enquiry.replied': 'sales',
  'enquiry.stalled': 'sales',
  'proposal.sent': 'sales',
  'proposal.viewed': 'sales',
  'proposal.accepted': 'sales',
  'proposal.rejected': 'sales',

  // Cash flow
  'invoice.created': 'cash_flow',
  'invoice.sent': 'cash_flow',
  'invoice.viewed': 'cash_flow',
  'invoice.paid': 'cash_flow',
  'invoice.overdue': 'cash_flow',
  'invoice.cancelled': 'cash_flow',
  'payment.completed': 'cash_flow',
  'payment.failed': 'cash_flow',
  'refund.completed': 'cash_flow',
  'revenue.recognized': 'cash_flow',
  'ar.aged': 'cash_flow',

  // Retention
  'booking.created': 'retention',
  'booking.confirmed': 'retention',
  'booking.completed': 'retention',
  'booking.no_show': 'retention',
  'booking.cancelled': 'retention',
  'client.rebooking_due': 'retention',
  'client.at_risk': 'retention',
  'client.churned': 'retention',

  // Operations
  'calendar.slot_filled': 'operations',
  'calendar.utilization_low': 'operations',
  'calendar.utilization_high': 'operations',
  'service.created': 'operations',
  'service.updated': 'operations',
  'service.disabled': 'operations',

  // Pricing
  'pricing.changed': 'pricing',
  'discount.applied': 'pricing',
  'intro_offer.used': 'pricing',
  'intro_offer.converted': 'pricing',
};

/**
 * Get the category for an event type
 */
export function getCategoryForEventType(eventType: BusinessEventType): BusinessEventCategory {
  return EVENT_TYPE_TO_CATEGORY[eventType];
}
