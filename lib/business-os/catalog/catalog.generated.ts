/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by: npx tsx scripts/generate-business-catalog.ts
 * Source     : jgccgkyhpwirgknnceoh.supabase.co
 * Generated  : 2026-10-29T17:26:52.805Z
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
  "generatedAt": "2026-10-29T17:26:52.805Z",
  "source": "jgccgkyhpwirgknnceoh.supabase.co",
  "tables": {
    "business_intake_forms": {
      "name": "business_intake_forms",
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
        },
        {
          "name": "version",
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
          "isPrimaryKey": false,
          "description": "draft = never sent; published = the form clients receive (at most one); archived = superseded, kept so completed submissions stay readable."
        },
        {
          "name": "questions",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "IntakeQuestion[] in the business's own language. See lib/business-os/intake/types.ts."
        },
        {
          "name": "generated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "generated_from",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
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
    "abandoned_bookings": {
      "name": "abandoned_bookings",
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "source",
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
          "name": "status",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
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
          "name": "checkout_session_id",
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
          "name": "updated_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "page_url",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The booking page the client was on, for the rebook link. Stored rather than rebuilt: a page reached by custom domain, landing page or smart link cannot be reconstructed from the service alone."
        },
        {
          "name": "locale",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "recovery_email_sent_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "When the abandoned-booking email was sent. Null means never. Guarantees one email per attempt, however often the sender runs."
        }
      ]
    },
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
        },
        {
          "name": "stage_entered_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "When this contact entered its current stage. Maintained by trigger on a real stage change only. Readers should fall back to updated_at when NULL."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
        },
        {
          "name": "allow_online_payment",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Whether this invoice may be paid online (card, via the connected processor). FALSE means collect it by transfer: no card button on the pay page, bank details instead. NULL means no choice was recorded — fall back to the business's own collection capability, which is how every invoice behaved before this column existed."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
        },
        {
          "name": "reason_note",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The owner's own sentence about why the money went back. Never a substitute for reason, which holds the countable code. Null for refunds issued before this column existed."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
        },
        {
          "name": "cancel_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Why the plan was stopped, from STOP_REASONS. Null for plans stopped before this column existed. Group with canonicalReason()."
        },
        {
          "name": "cancel_note",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The sentence the owner typed. Never a substitute for cancel_reason, and not the refund reason — that is its own field on the refund."
        },
        {
          "name": "cancelled_by",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Who stopped it. Always the owner today; the column exists so the first automated stop does not have to claim it was."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
        },
        {
          "name": "label",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The stage this payment is for — \"Foundation\", \"Sessions 1-4\". Null for a plain instalment, which is identified by its number."
        },
        {
          "name": "trigger",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "date = bills on its due_date, the existing instalment behaviour and the default so nothing changes. manual = a milestone: no due date until the owner marks the stage complete, which is what raises its invoice."
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
          "name": "proposal_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "proposals",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `proposals.id`."
        },
        {
          "name": "cancel_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Why this period was stopped, from STOP_REASONS. Null for periods cancelled before this column existed. Group with canonicalReason()."
        },
        {
          "name": "cancel_note",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The sentence the owner typed. Never a substitute for cancel_reason, and not a refund reason — that is its own field on the refund."
        },
        {
          "name": "cancelled_by",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Who stopped it: client, owner or system. The same three values every other cancellation surface uses."
        },
        {
          "name": "cancelled_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "When it was stopped. Unlike payment_plan_subscriptions, this table had no such column — status went to cancelled with no timestamp, so nothing could say when a plan stopped billing."
        },
        {
          "name": "meeting_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_meetings",
            "column": "id"
          },
          "description": "The APPOINTMENT this stage bills, for a plan that charges per session. NULL where the plan has no appointment to bill against — a course, a product — or where the stage falls due on a date rather than on work being done. `booking_id` names the JOB and remains valid; this names which meeting of it. Note: This is a Foreign Key to `scheduling_meetings.id`."
        }
      ]
    },
    "proposals": {
      "name": "proposals",
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "total",
          "format": "numeric",
          "jsonType": "number",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "prices_include_tax",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false
        },
        {
          "name": "tax_rate",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "tax_label",
          "format": "text",
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
          "isPrimaryKey": false
        },
        {
          "name": "valid_until",
          "format": "date",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "payment_shape",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "decline_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "decline_note",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "supersedes_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "proposals",
            "column": "id"
          },
          "description": "Note: This is a Foreign Key to `proposals.id`."
        },
        {
          "name": "accepted_snapshot",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "created_invoice_id",
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
          "name": "created_plan_id",
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
          "name": "sent_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "viewed_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "decided_at",
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
          "description": "The request this quote answers. Null for quotes created before this column existed, and for any raised outside a booking. Note: This is a Foreign Key to `scheduling_bookings.id`."
        },
        {
          "name": "document_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "contact_documents",
            "column": "id"
          },
          "description": "Optional proposal document, attached to the email and shown to the client before they can accept. Note: This is a Foreign Key to `contact_documents.id`."
        },
        {
          "name": "payment_terms_days",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Days to pay, agreed on this quote. Null inherits business_profiles.invoice_payment_terms_days."
        },
        {
          "name": "stop_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Why an accepted job ended early, from STOP_REASONS. Null when unknown. Distinct from decline_reason, which is why a quote was never agreed."
        },
        {
          "name": "stop_note",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The owner's own sentence about why the job stopped. Optional, and never a substitute for stop_reason."
        },
        {
          "name": "stopped_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "When the remaining stages were called off. Not updated_at, which any later edit moves."
        },
        {
          "name": "sessions",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "A package: { \"dates\": [\"2026-10-07T10:00:00Z\", …], \"duration_minutes\": 60 }. NULL means this quote is not a package, which is every quote written before this column existed. Dates are EXPLICIT, never a cadence rule — a repeat rule would need clash detection, time-off reading, DST-correct stepping and a preview screen, and the owner picking six dates costs six date pickers."
        },
        {
          "name": "package_booking_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_bookings",
            "column": "id"
          },
          "description": "The container booking this accepted quote created, for a package. NULL on every quote that is not a package and on every package not yet accepted. Written by recordAcceptance alongside created_invoice_id and created_plan_id. ON DELETE SET NULL: if the purchase is removed the quote remains as the record of what was agreed, simply no longer pointing at a package — the reverse (losing the proposal) would destroy the agreement itself. Note: This is a Foreign Key to `scheduling_bookings.id`."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
          "isPrimaryKey": false,
          "description": "One of: confirmed, pending, cancelled, completed, no_show. PENDING MEANS NOT CONFIRMED YET — either a payment is outstanding or the service is quoted and has no price yet. It is NOT a statement that money is owed: read payment_status for that, which is 'paid' whenever the price is zero or there is nothing to collect. The roster lives in lib/business-os/bookingStatus.ts."
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
        },
        {
          "name": "intake_sent_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "When the intake request was emailed to the client. Replaces the template_key='pending' sentinel previously written into intake_responses."
        },
        {
          "name": "intake_reminded_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "When the client was reminded to complete their intake form. Set once; null means never chased."
        },
        {
          "name": "cancel_reason",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Why it was cancelled, from CLIENT_CANCEL_REASONS or OWNER_CANCEL_REASONS. Null for rows cancelled before this column existed. Group with canonicalReason() — some stored codes have equivalent spellings."
        },
        {
          "name": "cancel_note",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The sentence the client or owner typed. Never a substitute for cancel_reason."
        },
        {
          "name": "cancelled_by",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Who called it off. Replaces parsing the CLIENT_CANCELLED_PREFIX out of cancellation_reason, which is still written for existing readers."
        },
        {
          "name": "parent_booking_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_bookings",
            "column": "id"
          },
          "description": "The purchase this meeting belongs to, for a package. NULL on every ordinary booking and on the container itself, which is what makes \"purchases → parent_booking_id IS NULL\" correct for every reader. ON DELETE CASCADE: removing the purchase removes the meetings it bought, which is the only honest reading of deleting it. Note: This is a Foreign Key to `scheduling_bookings.id`."
        },
        {
          "name": "occurrence_number",
          "format": "integer",
          "jsonType": "integer",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Which meeting of the package this is, 1..N, in the order the owner chose. NULL on ordinary bookings and on the container. Never a count of payments — reusing installment_count for sessions is the mistake RetPackageEndingDetector was deleted for, because it counted a payment split as a package."
        },
        {
          "name": "meeting_status",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "What happened at the APPOINTMENT, independent of the job. NULL means nobody has said yet, which is the ordinary state of a past meeting. held | no_show | cancelled. The job's own state stays in status/cancel_reason/cancelled_by."
        },
        {
          "name": "outcome_by",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Who recorded the CURRENT attempt's outcome. Copied onto the attempt by syncMeeting; the pair is temporary in the same way meeting_status is. Distinct from cancelled_by, which is about the JOB rather than an appointment."
        },
        {
          "name": "outcome_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false
        },
        {
          "name": "proposal_continues",
          "format": "boolean",
          "jsonType": "boolean",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The owner's answer when a meeting was cancelled on a quoted job: is the quote still coming? NULL means nobody was asked, which is every row predating 20261083 and every booking whose meeting was never cancelled. Distinct from true on purpose. false makes the journey ask whether the booking should be closed, since work nobody will quote for should not sit open."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
        },
        {
          "name": "sale_mode",
          "format": "text",
          "jsonType": "string",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "direct = the client books and pays in one sitting (today's behaviour, and the default so no existing service changes). proposal = the client cannot buy immediately; they leave details, the owner sends a quote, and the journey resumes once it is accepted. Read by journeySteps() to decide where the client journey stops."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
          "isPrimaryKey": false,
          "description": "Whether reminders are sent BEFORE an invoice is due (upcoming_due, due_today). Past-due chasing is chase_invoices_enabled, deliberately separate: a reminder before the date is a courtesy, one after it says you are late."
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
          "description": "The address this business shows its clients — where to come. Rendered from `address_parts` on save; still free text for rows that predate it. Distinct from invoice_address, which is the structured billing address printed on invoices and may deliberately differ."
        },
        {
          "name": "invoice_document_type",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "What the business's client-facing documents are titled: receipt, invoice or tax_invoice. NULL follows the derived default (tax + tax id => tax_invoice, tax alone => invoice, otherwise receipt). The platform never decides this on the business's behalf — entitlement to issue a tax invoice comes from a registration, not from a settings flag."
        },
        {
          "name": "invoice_prices_include_tax",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "The business states its prices already contain tax. Display only — the platform never adds tax to a price."
        },
        {
          "name": "invoice_tax_rate",
          "format": "numeric",
          "jsonType": "number",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Percent, as the business typed it (19, 17, 21). Used only to carve the tax out of an inclusive price for display."
        },
        {
          "name": "invoice_tax_label",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "What the business calls it — VAT, מע״מ, IVA, MwSt. Free text."
        },
        {
          "name": "daily_briefing_email_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Opt-in for the morning briefing email. Off by default; requires a timezone on user_preferences to be meaningful."
        },
        {
          "name": "invoice_payment_terms_days",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Default days to pay for invoices this business raises automatically. 0 = due on receipt."
        },
        {
          "name": "subdomain",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The web address every public surface of this business publishes under, without the domain. Set by whichever surface is published first — a website's settings or a landing page's publish step — and inherited by every page created after. Falls back to user_code when never chosen."
        },
        {
          "name": "lead_alert_email_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Send the owner an email the moment a contact form is submitted or a client books. On by default: the alert only fires because a real person asked to be contacted."
        },
        {
          "name": "lead_autosend_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Send a booking link to a new lead automatically, ~15 minutes after the owner is alerted. Off by default: writing to a client on the business's behalf is an opt-in."
        },
        {
          "name": "chase_invoices_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Whether the platform may email this business's clients about invoices that are past due. Answered through the advisor's \"Chase unpaid invoices\" card; read by PaymentReminderService's overdue scan, which is the only thing that sends. The schedule is payment_overdue_reminder_days."
        },
        {
          "name": "chase_intake_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Send one reminder for an intake form still not returned. Off by default, and separate from the invoice chase — they are different appetites."
        },
        {
          "name": "automations_declined",
          "format": "text[]",
          "jsonType": "array",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "Operational automation ids the owner has explicitly said no to. Keeps the advisor from asking again, and is distinct from simply not being approved yet. Approving one removes it from here."
        },
        {
          "name": "currency",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The business's DEFAULT currency: pre-fills the picker when a service is created and labels figures with no row behind them. Never a constraint — scheduling_services.currency remains the authority for what a client is charged, so a business in one country can price in another's currency. NULL means not chosen, which is deliberate and must stay distinguishable from a choice."
        },
        {
          "name": "meeting_reminder_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Whether a reminder goes out before EVERY confirmed appointment. Answered through the advisor card; off until asked for. While it is ON, the insight-triggered reminder (send_reminder_sequence, fired by the no-show and cancellation-spike detectors) stands down for this business — the two are alternatives, not layers, and running both would send two reminders for one appointment. See InsightActionDispatchService.bookingReminder."
        },
        {
          "name": "meeting_reminder_hours_before",
          "format": "integer",
          "jsonType": "integer",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "How many hours before the appointment the reminder goes out, 1-168. Owner-chosen because the right answer differs by trade: a day suits a therapist, two hours suits a barber. Read by the meeting_upcoming gap and by enqueueApprovedChases."
        },
        {
          "name": "meeting_reminder_notify_client",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Whether the client is reminded before their appointment. Only applies while meeting_reminder_enabled is true."
        },
        {
          "name": "meeting_reminder_notify_owner",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Whether the OWNER is reminded before the appointment. Nothing else on the platform tells an owner anything before a booking. Only applies while meeting_reminder_enabled is true."
        },
        {
          "name": "address_parts",
          "format": "jsonb",
          "jsonType": "unknown",
          "required": true,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "The display address in parts: {line1, line2, city, state, postal_code, country}. `country` is an ISO 3166-1 alpha-2 code chosen from a list, never typed. The `address` column holds the rendered one-line form of this and is what public surfaces read; it is composed on save, so the two do not drift. Empty on rows written before the structured form existed — there `address` alone is authoritative and must not be overwritten by a guess."
        },
        {
          "name": "address_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "business_addresses",
            "column": "id"
          },
          "description": "Which saved address `address_parts` is a copy of. NULL means the address was typed here and never added to the book, which is allowed — the copy is still what renders. ON DELETE SET NULL: removing an address from the book must not blank the address a business is currently showing its clients. Note: This is a Foreign Key to `business_addresses.id`."
        },
        {
          "name": "invoice_address_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "business_addresses",
            "column": "id"
          },
          "description": "Which saved address `invoice_address` is a copy of. Equal to `address_id` when the business bills from where it trades, which is the common case and is what makes correcting one correct both. Note: This is a Foreign Key to `business_addresses.id`."
        },
        {
          "name": "auto_complete_meetings_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Owner consent for automation #5: mark a confirmed booking completed once its start time has passed and the staleness window has elapsed. Opt-in (DEFAULT false) because it writes to the owner's own records rather than sending anything. Added 2026-10-06."
        },
        {
          "name": "chase_quotes_enabled",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "Owner consent for automation #6: send ONE reminder on a quote still unanswered 72 hours after it was sent, asking whether the client needs more time or more information. Never a sequence — the queue dedupes per proposal, so a quote is followed up once and never again. Opt-in (DEFAULT false). Added 2026-10-10."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
        },
        {
          "name": "resolved_at",
          "format": "timestamp with time zone",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "When the condition stopped holding, set by the detection sweep rather than by a person. NULL for every other status."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
          "description": "NULL means the mail went to the business OWNER, not to a client — a briefing, a dispute alert. Client-scoped queries filter on this column, so a NULL row appears in no contact timeline, which is the point. Dashboard counts that mean \"business activity\" must exclude owner mail; see app/api/business-os/stats/route.ts. The log_email_activity trigger is guarded on this being NOT NULL because crm_activities.contact_id is itself NOT NULL. Note: This is a Foreign Key to `crm_contacts.id`."
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
          "isPrimaryKey": false,
          "description": "One of the values in lib/business-os/emailSendStatus.ts (EMAIL_SEND_STATUSES), enforced by email_sends_status_check. `bounced` and `complained` are terminal and are NOT the same thing: a bounce is a broken address, a complaint is a working address whose owner did not want the mail. `delivered`/`opened`/`clicked` are recorded as timestamps and do not rewrite this column."
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
          "description": "The JOB this email was about, where it was about one. NULL for campaign and sequence sends, and for every row written before 20261077 — the link was never stored, and guessing it would put a heuristic into a column that reads as authoritative. Note: This is a Foreign Key to `scheduling_bookings.id`."
        },
        {
          "name": "meeting_id",
          "format": "uuid",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "foreignKey": {
            "table": "scheduling_meetings",
            "column": "id"
          },
          "description": "The APPOINTMENT this email was about — which attempt, for a booking rescheduled after an outcome. NULL where the email concerns the whole job rather than one appointment, and on every row predating 20261077. Note: This is a Foreign Key to `scheduling_meetings.id`."
        },
        {
          "name": "is_resend",
          "format": "boolean",
          "jsonType": "boolean",
          "required": true,
          "hasDefault": true,
          "isPrimaryKey": false,
          "description": "True when this was a REPEAT of mail the client had already been given — the owner pressing \"send again\". Set by the resend routes. Backfilled for confirmations only, where the second and later per booking are necessarily repeats; a reschedule notice shares its subject across moves and repeats legitimately, so those are left false rather than guessed at."
        },
        {
          "name": "email_kind",
          "format": "text",
          "jsonType": "string",
          "required": false,
          "hasDefault": false,
          "isPrimaryKey": false,
          "description": "What this message was, as its sender knew it: booking_confirmed, booking_rescheduled, missed_appointment, meeting_reminder, payment_receipt and so on. Set by lib/notifications/recordEmailSend.ts, which is the only writer. NULL on rows predating 20261081 — there is no honest way to assign one retrospectively, and the journey falls back to the subject. Deliberately not an enum: a new kind of mail should not need a migration."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
            "table": "business_profiles",
            "column": "user_id"
          },
          "description": "Note: This is a Foreign Key to `business_profiles.user_id`."
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
    }
  }
} as const;
