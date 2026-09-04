/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by: npx tsx scripts/generate-business-catalog.ts
 * Source     : jgccgkyhpwirgknnceoh.supabase.co
 * Generated  : 2026-09-03T17:13:51.552Z
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
  "generatedAt": "2026-09-03T17:13:51.552Z",
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
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "last_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "email",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "phone",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stage",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "References stage_key from crm_pipeline_stages table. Configured by Business Architect during onboarding."
        },
        {
          "name": "tags",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "custom_fields",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Vertical-specific custom fields (insurance, diagnosis, etc.)"
        },
        {
          "name": "source",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "How this contact was created (website_form, manual, booking, etc.)"
        },
        {
          "name": "notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "source_metadata",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Attribution data including UTM params, referrer, smart link info, and capture channel"
        },
        {
          "name": "referrer_domain",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Host the lead arrived from (e.g. l.instagram.com), derived from source_metadata. Primary attribution signal — requires no tagging by the user."
        },
        {
          "name": "utm_source",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "utm_source from source_metadata. Present only on tagged links; referrer_domain is the fallback."
        },
        {
          "name": "utm_medium",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "utm_medium from source_metadata."
        },
        {
          "name": "utm_campaign",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "utm_campaign from source_metadata."
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
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "priority",
          "format": "public.task_priority",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "public.task_status",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "due_date",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "reminder_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "completed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_by",
          "format": "character varying",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Source of task creation: manual, ai_employee, automation, booking_reminder, etc."
        },
        {
          "name": "source_entity_type",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Type of entity that triggered AI task creation (if applicable)"
        },
        {
          "name": "source_entity_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "ID of entity that triggered AI task creation (if applicable)"
        },
        {
          "name": "tags",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        }
      ]
    },
    "crm_activities": {
      "name": "crm_activities",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "crm_contacts",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `crm_contacts.id`."
        },
        {
          "name": "activity_type",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "title",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "auto_logged",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Was this activity automatically logged by a capability?"
        },
        {
          "name": "source_capability",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Which capability created this activity (scheduling, payments, etc.)"
        },
        {
          "name": "source_entity_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Reference to the source entity (appointment_id, payment_id, etc.)"
        },
        {
          "name": "activity_date",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
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
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "line_items",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "due_date",
          "format": "date",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_terms",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "internal_notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "sent_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "paid_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "payment_method",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_received_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_checkout_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_payment_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_customer_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_payment_method_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "retry_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "last_retry_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "next_retry_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_invoice_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Stripe Invoice ID when created via Stripe Invoicing API"
        },
        {
          "name": "stripe_hosted_invoice_url",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Stripe hosted invoice page URL where client can pay"
        },
        {
          "name": "stripe_invoice_pdf",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Stripe-generated PDF URL for the invoice"
        },
        {
          "name": "client_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "client_email",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "client_address",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Client billing address: {line1, line2, city, state, postal_code, country}"
        },
        {
          "name": "booking_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_services",
            "column": "id"
          },
          "description": "References the service this invoice is for (optional) Note: This is a Foreign Key to `scheduling_services.id`."
        },
        {
          "name": "refunded_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "refund_status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Derived from the invoice's transactions by trigger. Do not write directly."
        },
        {
          "name": "refunded_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
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
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_charge_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_customer_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "payment_method",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "invoice_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "JSONB field for true metadata only (source, notes, campaign_id, custom_fields). Relational data (booking_id, service_id) moved to proper FK columns."
        },
        {
          "name": "failure_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "paid_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "refund_status",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "refunded_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "refunded_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "refund_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The most recent succeeded refund's reason, derived by recompute_transaction_refund_state(). Do not write directly — read payment_refunds for the full history."
        },
        {
          "name": "processor_refund_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "service_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_bookings",
            "column": "id"
          },
          "description": "Foreign key to scheduling_bookings - moved from metadata JSONB to proper column for better performance and data integrity Note: This is a Foreign Key to `scheduling_bookings.id`."
        },
        {
          "name": "stripe_connect_account_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The Stripe account this charge lives on. NULL with account_resolution=recorded means the platform; NULL with unknown means nobody recorded it."
        },
        {
          "name": "charge_account_kind",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "account_resolution",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "recorded = captured at charge time; reconciled = proved against Stripe later; unknown = never recorded; ambiguous = found on more than one account or none"
        },
        {
          "name": "processor_fee",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "What the processor kept, from the charge's balance transaction. NULL means not yet known — never assume zero. Denominated in fee_currency, which may differ from currency."
        },
        {
          "name": "net_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "What reached the business's balance: amount minus processor_fee, as Stripe reports it. NULL when the fee is not yet known."
        },
        {
          "name": "fee_currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The fee's currency. Stripe charges fees in the settlement currency, which is not always the currency of the payment."
        }
      ]
    },
    "payment_refunds": {
      "name": "payment_refunds",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "transaction_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_transactions",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_transactions.id`."
        },
        {
          "name": "invoice_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_invoices",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_invoices.id`."
        },
        {
          "name": "amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "amount_minor",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_type",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "processor_refund_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_connect_account_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "idempotency_key",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "source",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "initiated_by",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "failure_code",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "failure_message",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "metadata",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "succeeded_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "fee_returned",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "How much of the original processing fee the processor returned with this refund. Usually 0: Stripe keeps the fee on a refunded payment, which is what makes a full refund cost the business money."
        },
        {
          "name": "refund_fee",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "What issuing this refund cost, where the processor charges for it. NULL means not known."
        }
      ]
    },
    "payment_plans": {
      "name": "payment_plans",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_services",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `scheduling_services.id`."
        },
        {
          "name": "name",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "total_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "supported_currencies",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "installment_count",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "installment_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "installment_frequency",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "allowed_processors",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "preferred_processor",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "is_active",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        }
      ]
    },
    "payment_plan_subscriptions": {
      "name": "payment_plan_subscriptions",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "crm_contacts",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `crm_contacts.id`."
        },
        {
          "name": "booking_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_bookings",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `scheduling_bookings.id`."
        },
        {
          "name": "service_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_services",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `scheduling_services.id`."
        },
        {
          "name": "payment_plan_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_plans",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_plans.id`."
        },
        {
          "name": "stripe_subscription_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_schedule_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_price_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_customer_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stripe_connect_account_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "installment_count",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "installment_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "frequency",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "periods_paid",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "next_charge_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "next_charge_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "last_failure_code",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "last_failure_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "card_brand",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "card_last4",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Display metadata mirrored from Stripe. No card number is ever stored in this system."
        },
        {
          "name": "card_exp_month",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "card_exp_year",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "metadata",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "completed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "cancelled_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        }
      ]
    },
    "payment_plan_installments": {
      "name": "payment_plan_installments",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "payment_plan_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_plans",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_plans.id`."
        },
        {
          "name": "booking_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_bookings",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `scheduling_bookings.id`."
        },
        {
          "name": "contact_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "crm_contacts",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `crm_contacts.id`."
        },
        {
          "name": "installment_number",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "amount",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "due_date",
          "format": "date",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "paid_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_method",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "processor_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "transaction_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_transactions",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_transactions.id`."
        },
        {
          "name": "retry_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "last_retry_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "next_retry_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "subscription_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_plan_subscriptions",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_plan_subscriptions.id`."
        },
        {
          "name": "invoice_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "payment_invoices",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `payment_invoices.id`."
        },
        {
          "name": "stripe_invoice_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
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
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "hasDefault": false,
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
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "end_time",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "timezone",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "cancellation_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_status",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "pending | paid | refunded. Derived from the booking's transactions by propagate_refund_to_booking() whenever a refund lands. Application code may set it to paid or pending when money first arrives, but must not write refund state directly."
        },
        {
          "name": "payment_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "internal_notes",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "booking_source",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "reminder_24hr_sent",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "reminder_2hr_sent",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "external_calendar_event_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Event ID from external calendar (Google/Outlook)"
        },
        {
          "name": "calendar_sync_provider",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Provider used for sync: google_calendar or outlook"
        },
        {
          "name": "calendar_synced_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Timestamp of last successful sync to external calendar"
        },
        {
          "name": "calendar_sync_error",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Error message if last sync failed"
        },
        {
          "name": "payment_method",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_amount",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "invoice_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
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
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "JSON object with template_id, template_key, and responses"
        },
        {
          "name": "intake_completed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
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
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "duration_minutes",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "price",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "buffer_minutes",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "max_bookings_per_day",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "advance_booking_days",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "min_notice_hours",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "availability",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "is_active",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "public.service_status",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Service status: draft (AI-generated, awaiting review), active (bookable), inactive (hidden)"
        },
        {
          "name": "source",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "How service was created: manual, ai_generated, template, imported"
        },
        {
          "name": "ai_suggestions",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "AI metadata including reasoning and confidence for generated services"
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Currency code for the service price (USD, EUR, ILS, GBP)"
        },
        {
          "name": "payment_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "installment_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "installment_frequency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "first_payment_due",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "first_payment_days",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "is_scheduled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Does booking this service involve picking a time? Defaults true so every existing service keeps its current behaviour. False for a product or deliverable, whose client journey has no date step — its duration, if it has one, is kept and shown regardless."
        },
        {
          "name": "collection",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "How money for this service arrives: online (card at the moment of booking — requires a connected processor) | invoice (billed afterwards; transfer, Bit or cash — requires no processor). NULL where the service is free, or where nobody has said yet."
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
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stage_key",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "stage_label",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "position",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "color",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "stage_type",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Semantic classification: lead, prospect, client, past_client, lost, archived. Used for cross-vertical queries."
        },
        {
          "name": "is_primary_client_stage",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "If true, this is the stage contacts are promoted to after payment. Only one stage per user can be true."
        }
      ]
    },
    "business_profiles": {
      "name": "business_profiles",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Primary business vertical (therapist, coach, consultant, etc.)"
        },
        {
          "name": "sub_vertical",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "company_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "company_size",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "clients_per_week",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "revenue_tier",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "website_url",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "landing_pages",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "website_analysis",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "AI-extracted data from user website (services, target audience, brand voice)"
        },
        {
          "name": "connected_plugins",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "primary_crm",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "primary_calendar",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "primary_payment",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "onboarding_completed",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "onboarding_conversation",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Full chat conversation history from onboarding"
        },
        {
          "name": "profile_completeness",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Percentage (0-100) indicating how complete the profile is"
        },
        {
          "name": "language",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "services",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "List of services/products offered by the business (e.g., [\"therapy\", \"coaching\"])"
        },
        {
          "name": "scheduling_availability",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Weekly availability for scheduling (e.g., {\"monday\": [{\"start\": \"09:00\", \"end\": \"17:00\"}], ...})"
        },
        {
          "name": "calendar_sync_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Whether calendar sync is enabled for this user"
        },
        {
          "name": "calendar_sync_provider",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Preferred calendar provider: google_calendar or outlook"
        },
        {
          "name": "calendar_last_synced_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Timestamp of last successful external events sync"
        },
        {
          "name": "default_payment_processor",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "payment_retry_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "payment_retry_intervals",
          "format": "integer[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_max_retries",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "payment_reminder_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "payment_reminder_days_before",
          "format": "integer[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_overdue_reminder_days",
          "format": "integer[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_reminder_channels",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "process_steps",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "User-defined workflow steps for the website \"How It Works\" section. Array of {title, description, icon, number}"
        },
        {
          "name": "dismissed_setup_steps",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Array of setup step IDs that the user has dismissed (services, availability, payments, calendar, website)"
        },
        {
          "name": "invoice_company_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "invoice_address",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Structured address for invoices: {line1, line2, city, state, postal_code, country}"
        },
        {
          "name": "invoice_tax_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Tax ID/VAT number displayed on invoices"
        },
        {
          "name": "invoice_bank_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "invoice_bank_account",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "invoice_bank_routing",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "invoice_payment_instructions",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Custom payment instructions (wire transfer details, payment terms, etc.)"
        },
        {
          "name": "invoice_footer_text",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "invoice_number_prefix",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Prefix for invoice numbers (e.g., INV, BILL). Default: INV"
        },
        {
          "name": "logo_url",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The business's logo. The single source for invoices, PDFs, emails, booking pages, smart links and the website — no surface stores its own copy."
        },
        {
          "name": "pain_points",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Business pain points extracted from onboarding chat (e.g., no_shows, manual_reminders, payment_collection)"
        },
        {
          "name": "goals",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Business goals extracted from onboarding chat (e.g., grow_clients, save_time, automation, professional_image)"
        },
        {
          "name": "tools",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Tools/software user currently uses (e.g., google_calendar, stripe, whatsapp, excel)"
        },
        {
          "name": "payment_mode",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Payment configuration mode: none, upfront, invoicing, installments"
        },
        {
          "name": "online_presence_mode",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Online presence mode: none, booking_only, website_only, full_website"
        },
        {
          "name": "needs_stripe_connect",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Whether user needs Stripe Connect setup for payments"
        },
        {
          "name": "extracted_data",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Full extracted data from onboarding conversation for debugging and re-evaluation"
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Business description extracted during onboarding for website generation"
        },
        {
          "name": "user_code",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Unique short code for public conversion pages (e.g., /c/abc123/book)"
        },
        {
          "name": "setup_checklist_dismissed",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Whether the user has dismissed the setup checklist card on the dashboard"
        },
        {
          "name": "show_logo_on_smart_links",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Whether public smart-link pages display the business logo."
        },
        {
          "name": "collection_method",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "How money reaches the business: card_online | invoice | in_person | mixed | none. Decides whether the setup chain asks for a card processor or for bank details. NULL means the question predates this account, and payment_mode is read across instead."
        },
        {
          "name": "theme",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The business look — colours and fonts — used by the website, landing pages, smart links, transactional emails and the invoice PDF. Seeded from the template chosen during onboarding and editable on the Design tab. A website_pages.theme overrides it for that page only. NULL means the platform default."
        },
        {
          "name": "template_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The business's chosen website template. Established by whichever public surface is created first (an onboarding website, or the first landing page) and adopted by every one created after. Changing it restyles every surface. Values are ids from lib/website-builder/templates.ts; the matching colours and fonts live in business_profiles.theme."
        },
        {
          "name": "phone",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The phone number this business publishes to its own clients. Shown on the public booking, intake, contact and invoice pages, and used to derive a WhatsApp link. Stored in international format (leading +) wherever the owner provides one; a number without a country code is still shown but cannot become a WhatsApp link."
        },
        {
          "name": "email",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The email address this business publishes to its own clients. Shown on the public booking, intake, contact and invoice pages. Distinct from the account login email, which belongs to the user rather than to the business."
        },
        {
          "name": "address",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The address this business shows its clients — where to come. Free text, because a display address is written the way the business writes it. Distinct from invoice_address, which is the structured billing address printed on invoices and may deliberately differ."
        }
      ]
    },
    "insights": {
      "name": "insights",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "detector_id",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Which detector found this insight (e.g., cash_ar_overdue, ret_no_show_spike)"
        },
        {
          "name": "detection_run_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "category",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "severity",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "title",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "business_impact",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "recommendation",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "metric_key",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "current_value",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "baseline_value",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "threshold_value",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "percent_change",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "direction",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "affected_entity_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "affected_entity_ids",
          "format": "uuid[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "affected_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "estimated_impact_usd",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "impact_direction",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "impact_period",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "paired_process_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Kernel process that can address this insight (e.g., chase_overdue_invoices)"
        },
        {
          "name": "process_parameters",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "eligible_for_automation",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "priority_score",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Computed score for ranking (0-100) based on severity, money impact, recency, actionability"
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "snoozed_until",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "dismissed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "dismiss_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "acted_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "action_execution_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "last_surfaced_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "surface_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "detected_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "is_correlated",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "True if this insight is a unified correlated insight combining multiple signals"
        },
        {
          "name": "correlation_parent_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "insights",
            "column": "id"
          },
          "description": "For child insights, links to the parent correlated insight Note: This is a Foreign Key to `insights.id`."
        },
        {
          "name": "correlation_pattern_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Pattern that matched (e.g., revenue_at_risk, pipeline_stall)"
        },
        {
          "name": "contributing_insight_ids",
          "format": "uuid[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "total_correlated_impact_usd",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "story",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "LLM-generated narrative that tells the business story"
        },
        {
          "name": "trend_direction",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Week-over-week trend: improving, stable, or worsening"
        },
        {
          "name": "trend_percent_change",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "previous_week_value",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "language",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        }
      ]
    },
    "website_pages": {
      "name": "website_pages",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "page_type",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "slug",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "URL path for this page (e.g., /adhd-course)"
        },
        {
          "name": "title",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "meta_description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "seo_keywords",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "published",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "published_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "template_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Reference to the template this page was created from"
        },
        {
          "name": "theme",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Page-specific theme overrides (colors, fonts, etc.)"
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "subdomain",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "custom_domain",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "custom_domain_verified",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "last_published_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "favicon_url",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "og_image_url",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "client_flow",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "website_language",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Language for website content generation (en, es, he)"
        },
        {
          "name": "content_generated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "When AI last wrote this page's content. NULL means never — the page holds the static scaffold, and generating is safe. Non-null means regenerating would replace copy the business may have edited, so it must be asked for explicitly."
        }
      ]
    },
    "website_page_views": {
      "name": "website_page_views",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "page_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "website_pages",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `website_pages.id`."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "subdomain",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "viewed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "user_agent",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "referer",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "ip_hash",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "country_code",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "device_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "session_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "utm_source",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "utm_source from the landing URL, captured client-side. Exact where the referer is only a guess."
        },
        {
          "name": "utm_medium",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "utm_campaign",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "is_owner_view",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "True when the business owner viewed their own page. Must be excluded from visitor counts."
        }
      ]
    },
    "website_blocks": {
      "name": "website_blocks",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "page_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "website_pages",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `website_pages.id`."
        },
        {
          "name": "block_type",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Type of block (hero, services, cta, testimonials, etc.)"
        },
        {
          "name": "position",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Order of block on page (0 = first, 1 = second, etc.)"
        },
        {
          "name": "content",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Block-specific content (JSONB for flexibility)"
        },
        {
          "name": "styles",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "capability_config",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        }
      ]
    },
    "smart_links": {
      "name": "smart_links",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "code",
          "format": "character varying",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Short URL code (e.g., go.agentpilot.io/abc123)"
        },
        {
          "name": "name",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "destination_url",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "destination_type",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Type of destination: booking, form, payment, landing, website"
        },
        {
          "name": "source",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "medium",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "campaign",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "content",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "click_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "conversion_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "revenue_cents",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "is_active",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "metadata",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Stores smart link configuration: { \"journeyType\": \"contact-only\" | \"full\", \"serviceIds\": string[], \"flow\": string[], \"destinationType\": \"form\" | \"booking\" }"
        }
      ]
    },
    "smart_link_clicks": {
      "name": "smart_link_clicks",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "smart_link_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "smart_links",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `smart_links.id`."
        },
        {
          "name": "clicked_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "ip_hash",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "user_agent",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "referer",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "device_type",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "country_code",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "session_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "UUID to track conversion from click to completed action"
        },
        {
          "name": "converted",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "conversion_type",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "converted_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        }
      ]
    },
    "email_sends": {
      "name": "email_sends",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
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
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "crm_contacts",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `crm_contacts.id`."
        },
        {
          "name": "sequence_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "email_sequences",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `email_sequences.id`."
        },
        {
          "name": "sequence_step_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "email_sequence_steps",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `email_sequence_steps.id`."
        },
        {
          "name": "campaign_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "email_campaigns",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `email_campaigns.id`."
        },
        {
          "name": "subject",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "body_html",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "to_email",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "sent_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "delivered_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "opened_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "clicked_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "provider",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "provider_message_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "error_message",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "open_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "click_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        }
      ]
    },
    "channel_metrics_daily": {
      "name": "channel_metrics_daily",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "platform",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "account_id",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "metric_date",
          "format": "date",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "impressions",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "reach",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "engagements",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "profile_views",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "website_clicks",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "actions_calls",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "actions_directions",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "followers_count",
          "format": "bigint",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "raw",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "synced_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "channel",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Acquisition channel, from lib/business-os/channel-insights/channelFromReferrer.ts. '_account' means the account itself is the channel (Meta, Business Profile)."
        },
        {
          "name": "sessions",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "GA4 sessions — visits to a property the business owns. NOT reach: a visit is not an impression."
        },
        {
          "name": "visitors",
          "format": "bigint",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "GA4 activeUsers — distinct people behind those sessions, as the platform counts them."
        }
      ]
    },
    "channel_connections": {
      "name": "channel_connections",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "platform",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "plugin_key",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "account_id",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "account_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "account_token",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "insights_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "connected_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "last_synced_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "last_sync_error",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "backfill_completed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "measured_hosts",
          "format": "text[]",
          "jsonType": "array",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Hostnames this property reports traffic for. Used to detect overlap with AgentPilot-hosted pages so visits are not counted twice."
        }
      ]
    },
    "agents": {
      "name": "agents",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "agent_name",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "user_prompt",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "system_prompt",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "description",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "is_archived",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "input_schema",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "output_schema",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "connected_plugins",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "mode",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "schedule_cron",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "trigger_conditions",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "plugins_required",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "deactivation_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "workflow_steps",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "generated_plan",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "ai_reasoning",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "ai_confidence",
          "format": "real",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "detected_categories",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_from_prompt",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "ai_generated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "agent_config",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "last_run",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Timestamp of the most recent execution"
        },
        {
          "name": "next_run",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Pre-calculated next execution time for efficient querying"
        },
        {
          "name": "timezone",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Timezone for cron schedule evaluation (IANA format, e.g. America/New_York)"
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "schedule_version",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "schedule_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "qstash_schedule_id",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Upstash QStash schedule ID for recurring agent executions"
        },
        {
          "name": "intensity_score",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Computational complexity score (0-10) used for dynamic pricing multiplier"
        },
        {
          "name": "last_intensity_update",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Timestamp of last intensity calculation update"
        },
        {
          "name": "pilot_steps",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Normalized workflow steps for Pilot execution engine with dependencies, conditionals, and approvals. Separate from workflow_steps which is used for SmartAgentBuilder UI animation and AIS calculations. Format: [{ id, type, name, plugin, action, params, dependencies }]"
        },
        {
          "name": "deleted_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "production_ready",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "production_ready_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "calibration_run_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "insights_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Whether to generate AI-powered insights for this agent. Requires additional LLM API calls for business language translation. Users can enable this per-agent to control costs."
        },
        {
          "name": "workflow_purpose",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Business description of what this workflow does. Used by business intelligence system to provide context-aware insights. Falls back to agent_name + description if not provided."
        },
        {
          "name": "workflow_hash",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "SHA-256 hash of pilot_steps JSON - used to detect workflow changes that invalidate calibration"
        },
        {
          "name": "last_successful_calibration_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "calibration_history",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `calibration_history.id`."
        },
        {
          "name": "is_calibrated",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "True when agent has completed successful calibration with 0 issues. Enables fast path verification on subsequent calibrations."
        },
        {
          "name": "pilot_steps_original",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Original pilot_steps before any calibration modifications. Set once on first calibration and never modified."
        },
        {
          "name": "business_entity_type",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Business entity type detected from workflow prompt (e.g., Lead, Deal, Invoice). Auto-detected via LLM."
        },
        {
          "name": "entity_detection_confidence",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Confidence score (0.00-1.00) for entity type detection. Only store if >= 0.70."
        },
        {
          "name": "entity_desirability",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Classification for trend framing: desirable (more=better), undesirable (fewer=better), neutral."
        },
        {
          "name": "manual_time_per_item_seconds",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Time in seconds to manually process one item. Used for ROI calculation."
        },
        {
          "name": "items_per_week_baseline",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Average items processed per week (calculated from first 10 executions). Used for anomaly detection."
        },
        {
          "name": "org_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "organizations",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `organizations.id`."
        },
        {
          "name": "tags",
          "format": "text[]",
          "jsonType": "array",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "calibration_prompt_decision",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "User response to the post-creation calibration prompt: accepted | declined | NULL (never prompted)."
        },
        {
          "name": "calibration_prompt_decided_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Timestamp when calibration_prompt_decision was set."
        },
        {
          "name": "hourly_rate_usd",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Per-agent hourly rate for ROI calculation. Different automations may have different costs based on who performs the task."
        },
        {
          "name": "calibration_status",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Post-creation calibration gate state: running | passed | failed | skipped | NULL (legacy, read-time deferred). Drives dashboard badge/tooltip, click-target, and access gate."
        }
      ]
    },
    "agent_executions": {
      "name": "agent_executions",
      "columns": [
        {
          "name": "id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": true,
          "description": "Note: This is a Primary Key."
        },
        {
          "name": "agent_id",
          "format": "uuid",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "agents",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `agents.id`."
        },
        {
          "name": "execution_type",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Type of execution: calibration (test runs before agent is ready) or production (live runs after agent is deployed)"
        },
        {
          "name": "scheduled_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "started_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "completed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Status values: pending, queued, running, completed, failed, cancelled, retrying"
        },
        {
          "name": "result",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "error_message",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "execution_duration_ms",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "retry_count",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "next_retry_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "job_id",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "queue_name",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "progress",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "user_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "user_settings_complete",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `user_settings_complete.id`."
        },
        {
          "name": "cron_expression",
          "format": "character varying",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "next_scheduled_run",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "logs",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "run_mode",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Run mode: calibration (single test run), batch_calibration (multiple test cases), or production (live runs)"
        },
        {
          "name": "total_cost_usd",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Total cost in USD for all LLM calls during this execution"
        },
        {
          "name": "primary_model",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Primary/most-used model during execution (e.g., gpt-4o, claude-opus-4-5)"
        },
        {
          "name": "primary_provider",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Primary provider during execution (e.g., openai, anthropic)"
        },
        {
          "name": "models_used",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Array of all models used: [{model, provider, tokens, cost}]"
        },
        {
          "name": "routing_tier",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Routing tier used: fast, balanced, or powerful"
        },
        {
          "name": "complexity_score",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Complexity score (0-10) that determined routing tier"
        }
      ]
    }
  }
} as const;
