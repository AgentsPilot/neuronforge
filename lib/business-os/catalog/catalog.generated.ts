/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by: npx tsx scripts/generate-business-catalog.ts
 * Source     : jgccgkyhpwirgknnceoh.supabase.co
 * Generated  : 2026-08-26T01:05:57.789Z
 *
 * This is the PHYSICAL half of the Business Catalog: what columns actually exist
 * in the database. The hand-authored semantic half lives in ./catalog.ts, and
 * ./index.ts fails loudly when the two disagree.
 *
 * Re-run the generator after every migration. A stale file will surface as a
 * failing catalog-drift test, not as a silent production bug.
 */

import type { PhysicalCatalog } from './catalog.schema';

export const PHYSICAL_CATALOG: PhysicalCatalog = {
  "generatedAt": "2026-08-26T01:05:57.789Z",
  "source": "jgccgkyhpwirgknnceoh.supabase.co",
  "tables": {
    "crm_contacts": {
      "name": "crm_contacts",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "first_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "last_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "email",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "phone",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "stage",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "description": "References stage_key from crm_pipeline_stages table. Configured by Business Architect during onboarding."
        },
        {
          "name": "tags",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "custom_fields",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "isPrimaryKey": false,
          "description": "Vertical-specific custom fields (insurance, diagnosis, etc.)"
        },
        {
          "name": "source",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "How this contact was created (website_form, manual, booking, etc.)"
        },
        {
          "name": "notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "source_metadata",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "isPrimaryKey": false,
          "description": "Attribution data including UTM params, referrer, smart link info, and capture channel"
        }
      ]
    },
    "crm_tasks": {
      "name": "crm_tasks",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "contact_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "crm_contacts",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `crm_contacts.id`."
        },
        {
          "name": "title",
          "format": "character varying",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "priority",
          "format": "public.task_priority",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "public.task_status",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "due_date",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "reminder_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "completed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_by",
          "format": "character varying",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "description": "Source of task creation: manual, ai_employee, automation, booking_reminder, etc."
        },
        {
          "name": "source_entity_type",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Type of entity that triggered AI task creation (if applicable)"
        },
        {
          "name": "source_entity_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "ID of entity that triggered AI task creation (if applicable)"
        },
        {
          "name": "tags",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        }
      ]
    },
    "payment_invoices": {
      "name": "payment_invoices",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "contact_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "crm_contacts",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `crm_contacts.id`."
        },
        {
          "name": "invoice_number",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "line_items",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "due_date",
          "format": "date",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_terms",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "internal_notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "sent_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "paid_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_method",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_received_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_checkout_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_payment_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_customer_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_payment_method_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "retry_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "last_retry_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "next_retry_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_invoice_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Stripe Invoice ID when created via Stripe Invoicing API"
        },
        {
          "name": "stripe_hosted_invoice_url",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Stripe hosted invoice page URL where client can pay"
        },
        {
          "name": "stripe_invoice_pdf",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Stripe-generated PDF URL for the invoice"
        },
        {
          "name": "client_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "client_email",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "client_address",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "isPrimaryKey": false,
          "description": "Client billing address: {line1, line2, city, state, postal_code, country}"
        },
        {
          "name": "booking_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_bookings",
            "column": "id"
          },
          "description": "Optional link to booking for booking-based invoices Note: This is a Foreign Key to `scheduling_bookings.id`."
        },
        {
          "name": "service_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_services",
            "column": "id"
          },
          "description": "References the service this invoice is for (optional) Note: This is a Foreign Key to `scheduling_services.id`."
        }
      ]
    },
    "payment_transactions": {
      "name": "payment_transactions",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "contact_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "crm_contacts",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `crm_contacts.id`."
        },
        {
          "name": "stripe_payment_intent_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_charge_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_customer_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "payment_method",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "invoice_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_invoices",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_invoices.id`."
        },
        {
          "name": "metadata",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "isPrimaryKey": false,
          "description": "JSONB field for true metadata only (source, notes, campaign_id, custom_fields). Relational data (booking_id, service_id) moved to proper FK columns."
        },
        {
          "name": "failure_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "paid_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "refund_status",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "refunded_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "refunded_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "refund_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_refund_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "service_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_services",
            "column": "id"
          },
          "description": "References the service this payment is for (optional) Note: This is a Foreign Key to `scheduling_services.id`."
        },
        {
          "name": "booking_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_bookings",
            "column": "id"
          },
          "description": "Foreign key to scheduling_bookings - moved from metadata JSONB to proper column for better performance and data integrity Note: This is a Foreign Key to `scheduling_bookings.id`."
        }
      ]
    },
    "scheduling_bookings": {
      "name": "scheduling_bookings",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "service_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_services",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `scheduling_services.id`."
        },
        {
          "name": "contact_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "crm_contacts",
            "column": "id"
          },
          "description": "Foreign key to crm_contacts (NOT NULL) - single source of truth for client data. Client name/email/phone retrieved via JOIN. Note: This is a Foreign Key to `crm_contacts.id`."
        },
        {
          "name": "start_time",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "end_time",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "timezone",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "cancellation_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_status",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "internal_notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "booking_source",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "reminder_24hr_sent",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "reminder_2hr_sent",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "external_calendar_event_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Event ID from external calendar (Google/Outlook)"
        },
        {
          "name": "calendar_sync_provider",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Provider used for sync: google_calendar or outlook"
        },
        {
          "name": "calendar_synced_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Timestamp of last successful sync to external calendar"
        },
        {
          "name": "calendar_sync_error",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Error message if last sync failed"
        },
        {
          "name": "payment_method",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "invoice_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_invoices",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_invoices.id`."
        },
        {
          "name": "payment_plan_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_plans",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_plans.id`."
        },
        {
          "name": "intake_responses",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "isPrimaryKey": false,
          "description": "JSON object with template_id, template_key, and responses"
        },
        {
          "name": "intake_completed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Timestamp when intake form was completed"
        }
      ]
    },
    "scheduling_services": {
      "name": "scheduling_services",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "service_name",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "duration_minutes",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "price",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "buffer_minutes",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "max_bookings_per_day",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "advance_booking_days",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "min_notice_hours",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "availability",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "is_active",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "public.service_status",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "description": "Service status: draft (AI-generated, awaiting review), active (bookable), inactive (hidden)"
        },
        {
          "name": "source",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "description": "How service was created: manual, ai_generated, template, imported"
        },
        {
          "name": "ai_suggestions",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "isPrimaryKey": false,
          "description": "AI metadata including reasoning and confidence for generated services"
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false,
          "description": "Currency code for the service price (USD, EUR, ILS, GBP)"
        },
        {
          "name": "payment_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "installment_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "installment_frequency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "first_payment_due",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "first_payment_days",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "isPrimaryKey": false
        }
      ]
    },
    "crm_pipeline_stages": {
      "name": "crm_pipeline_stages",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "vertical",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "stage_key",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "stage_label",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "position",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "isPrimaryKey": false
        },
        {
          "name": "color",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "isPrimaryKey": false
        }
      ]
    }
  }
} as const;
