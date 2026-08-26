/**
 * Business Catalog — semantic layer (hand-authored)
 *
 * This declares WHAT the platform may see and do. It is deliberately the only
 * hand-written half; the physical column truth is introspected into
 * `catalog.generated.ts`, and `index.ts` fails loudly when the two disagree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS SHARED PLATFORM INFRASTRUCTURE, NOT CHAT CODE.
 *
 * Three consumers read from this one catalog:
 *
 *   1. The chat AI worker  — natural language → BizQL plan → compiler.
 *   2. The insight detectors (`lib/business-os/insight/detectors/`) — today each
 *      of ~29 detectors hand-writes its own Supabase query and its own
 *      `.eq('user_id', …)`. That is 29 chances to forget the only tenant
 *      boundary the product has.
 *   3. The automation kernel (`lib/business-os/insight/kernel/`) — a standing
 *      automation becomes a stored BizQL query plus an action, rather than a
 *      bespoke hand-written process.
 *
 * Because all three share this file, a fact is stated ONCE. "Which invoice
 * statuses count as unpaid" is currently written in at least three places
 * (CashArAgingDetector, semantic-schema.ts, and the v2 chat prompt) and they can
 * drift. Here it is `semanticTerms.open` on `invoices.status`, and everything
 * downstream inherits it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * HOW TO ADD A CAPABILITY
 * Add a field, a derived field, a relation, or an action — never a code path.
 * If a new user scenario seems to need a new branch somewhere, the missing
 * generalisation is almost certainly one of those four things.
 */

import type { SemanticCatalog } from './catalog.schema';

export const SEMANTIC_CATALOG: SemanticCatalog = {
  // ===========================================================================
  // CONTACTS
  // ===========================================================================
  contacts: {
    table: 'crm_contacts',
    labels: {
      one: { en: 'contact', he: 'איש קשר', es: 'contacto' },
      many: { en: 'contacts', he: 'אנשי קשר', es: 'contactos' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: ['first_name', 'last_name'],
    displayFields: ['first_name', 'last_name', 'email', 'phone', 'stage'],
    searchableFields: ['first_name', 'last_name', 'email', 'phone'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      first_name: {
        column: 'first_name',
        type: 'string',
        labels: { en: 'first name', he: 'שם פרטי', es: 'nombre' },
        writable: true,
      },
      last_name: {
        column: 'last_name',
        type: 'string',
        labels: { en: 'last name', he: 'שם משפחה', es: 'apellido' },
        writable: true,
      },
      email: {
        column: 'email',
        type: 'string',
        format: 'email',
        labels: { en: 'email', he: 'אימייל', es: 'correo' },
        writable: true,
      },
      phone: {
        column: 'phone',
        type: 'string',
        format: 'phone',
        labels: { en: 'phone', he: 'טלפון', es: 'teléfono' },
        writable: true,
      },
      /**
       * NOT a fixed enum. The column comment says it references
       * `crm_pipeline_stages.stage_key` and is configured per user during
       * onboarding. Every prior registry hardcoded a list here and was wrong:
       * chat-v3 declared ['active','inactive','lead'] against a column that
       * isn't even called `status`. Resolve at runtime, per user.
       */
      stage: {
        column: 'stage',
        type: 'enum',
        format: 'enum',
        labels: { en: 'stage', he: 'שלב', es: 'etapa' },
        writable: true,
        enumSource: {
          table: 'crm_pipeline_stages',
          valueColumn: 'stage_key',
          scopedToUser: true,
          // One record per stage, so the user's own pipeline IS the vocabulary.
          // `stage_label` is what they see in their own language and `position`
          // orders the funnel, which together beat any classification we could
          // invent: for a tutor, stage `family_enrolled` is labelled "לקוח"
          // (client) at position 2, so "my clients" resolves correctly with no
          // synonym table, no translation, and nothing hardcoded per vertical.
          labelColumn: 'stage_label',
          orderColumn: 'position',
          // `semanticColumn: 'stage_type'` would also work and the compiler
          // supports it, but that column does not exist on this database — the
          // migration adding it is untracked and unapplied. Declaring it would
          // make every stage query fail at execution time. Label + position
          // makes it unnecessary anyway.
        },
      },
      tags: {
        column: 'tags',
        type: 'string[]',
        format: 'tags',
        labels: { en: 'tags', he: 'תגיות', es: 'etiquetas' },
        writable: true,
      },
      source: {
        column: 'source',
        type: 'string',
        labels: { en: 'source', he: 'מקור', es: 'origen' },
      },
      notes: {
        column: 'notes',
        type: 'string',
        labels: { en: 'notes', he: 'הערות', es: 'notas' },
        writable: true,
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'created', he: 'נוצר', es: 'creado' },
      },
    },

    relations: {
      bookings: {
        target: 'bookings',
        cardinality: 'many',
        via: { column: 'contact_id', side: 'remote' },
        labels: { en: 'bookings', he: 'פגישות', es: 'reservas' },
      },
      invoices: {
        target: 'invoices',
        cardinality: 'many',
        via: { column: 'contact_id', side: 'remote' },
        labels: { en: 'invoices', he: 'חשבוניות', es: 'facturas' },
      },
    },

    /**
     * Derived fields are the generalisation device that removes the need for
     * scenario-specific code. `has_completed_intake` turns "contacts without an
     * intake form" — previously inexpressible at ANY layer — into an ordinary
     * boolean that every operator composes with.
     */
    derived: {
      has_completed_intake: {
        type: 'boolean',
        labels: {
          en: 'completed intake form',
          he: 'מילא טופס קליטה',
          es: 'completó el formulario de admisión',
        },
        expand: {
          relation: 'bookings',
          quantifier: 'any',
          where: [{ field: 'intake_completed_at', op: 'is_not_null' }],
        },
      },
      has_bookings: {
        type: 'boolean',
        labels: { en: 'has bookings', he: 'יש פגישות', es: 'tiene reservas' },
        expand: { relation: 'bookings', quantifier: 'any' },
      },
    },

    actions: {
      create: {
        labels: { en: 'add contact', he: 'הוסף איש קשר', es: 'añadir contacto' },
        risk: 'create',
        requiresConfirmation: false,
        requiredFields: ['first_name'],
        optionalFields: ['last_name', 'email', 'phone', 'stage', 'tags', 'notes'],
      },
      update: {
        labels: { en: 'update contact', he: 'עדכן איש קשר', es: 'actualizar contacto' },
        risk: 'update',
        requiresConfirmation: false,
      },
      delete: {
        labels: { en: 'delete contact', he: 'מחק איש קשר', es: 'eliminar contacto' },
        risk: 'delete',
        requiresConfirmation: true,
        // Deliberately never bulk: deleting a contact cascades to its bookings.
        allowBulk: false,
      },
      /**
       * Outbound email to a contact.
       *
       * This is what completes "find everyone without an intake form and send it
       * to them". Bulk is permitted because that scenario is the whole point —
       * but capped at 100, confirmed every time, and never reversible, which is
       * why the fan-out executor layers idempotency and a daily quota on top.
       */
      send: {
        labels: { en: 'send an email', he: 'שלח אימייל', es: 'enviar un correo' },
        risk: 'send',
        requiresConfirmation: true,
        requiredFields: ['email'],
        allowBulk: true,
        maxFanout: 100,
      },
    },
  },

  // ===========================================================================
  // INVOICES
  // ===========================================================================
  invoices: {
    table: 'payment_invoices',
    labels: {
      one: { en: 'invoice', he: 'חשבונית', es: 'factura' },
      many: { en: 'invoices', he: 'חשבוניות', es: 'facturas' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'invoice_number',
    displayFields: ['invoice_number', 'amount', 'currency', 'status', 'due_date'],
    searchableFields: ['invoice_number', 'client_name', 'client_email'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      invoice_number: {
        column: 'invoice_number',
        type: 'string',
        labels: { en: 'invoice number', he: 'מספר חשבונית', es: 'número de factura' },
      },
      contact_id: { column: 'contact_id', type: 'uuid', labels: { en: 'contact' } },
      amount: {
        column: 'amount',
        type: 'money',
        format: 'money',
        labels: { en: 'amount', he: 'סכום', es: 'importe' },
        writable: true,
      },
      /**
       * NO synonym list here, deliberately.
       *
       * A user says "500 shekels", not "500 ILS" — but mapping shekels→ILS,
       * dollars→USD, שקלים→ILS, dólares→USD by hand is an unbounded, per-language
       * table, which is exactly the pattern that made the previous three chat
       * versions unmaintainable. Publishing the allowed values is enough: an LLM
       * maps "shekels" to ILS without being told.
       *
       * Rule of thumb for this file: declare FACTS (what values exist, what they
       * mean as a business rule). Never declare VOCABULARY.
       */
      currency: {
        column: 'currency',
        type: 'enum',
        format: 'enum',
        labels: { en: 'currency', he: 'מטבע', es: 'moneda' },
        enumValues: ['USD', 'EUR', 'ILS', 'GBP'],
      },
      /**
       * The single definition of "unpaid". Previously duplicated in
       * CashArAgingDetector, semantic-schema.ts and the v2 chat prompt — three
       * copies that could drift. The planner emits the semantic term (`open`)
       * and never the storage values, which is what makes Hebrew and Spanish
       * work without a single phrasing example.
       */
      /**
       * `semanticTerms` here holds exactly ONE entry, and that is the point.
       *
       * "unpaid" is a genuine BUSINESS RULE — that money owed to you means
       * `sent` OR `overdue`, and specifically NOT `draft` (never issued) or
       * `cancelled` — and it is not something a model should have to infer,
       * because guessing wrong silently changes who gets chased for money.
       *
       * Everything the model CAN infer is left to it. `paid`, `overdue`,
       * `draft` and `cancelled` are published as plain enum values, so no
       * entries are needed for "settled", "late", "outstanding", "owed" or their
       * Hebrew and Spanish equivalents. Adding those synonyms is what produced
       * 230 dead example strings in the previous version.
       */
      status: {
        column: 'status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
        writable: true,
        enumValues: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
        semanticTerms: {
          unpaid: ['sent', 'overdue'],
        },
      },
      due_date: {
        column: 'due_date',
        type: 'date',
        format: 'date',
        labels: { en: 'due date', he: 'תאריך תשלום', es: 'fecha de vencimiento' },
        writable: true,
      },
      sent_at: {
        column: 'sent_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'sent at', he: 'נשלח ב', es: 'enviado el' },
      },
      paid_at: {
        column: 'paid_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'paid at', he: 'שולם ב', es: 'pagado el' },
      },
      client_name: {
        column: 'client_name',
        type: 'string',
        labels: { en: 'client name', he: 'שם לקוח', es: 'nombre del cliente' },
      },
      client_email: {
        column: 'client_email',
        type: 'string',
        format: 'email',
        labels: { en: 'client email', he: 'אימייל לקוח', es: 'correo del cliente' },
      },
      notes: {
        column: 'notes',
        type: 'string',
        labels: { en: 'notes', he: 'הערות', es: 'notas' },
        writable: true,
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'created', he: 'נוצר', es: 'creado' },
      },
      // Never exposed to the planner: private to the business owner.
      internal_notes: {
        column: 'internal_notes',
        type: 'string',
        labels: { en: 'internal notes' },
        readable: false,
      },
    },

    relations: {
      contact: {
        target: 'contacts',
        cardinality: 'one',
        via: { column: 'contact_id', side: 'local' },
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
      },
    },

    actions: {
      create: {
        labels: { en: 'create invoice', he: 'צור חשבונית', es: 'crear factura' },
        risk: 'create',
        requiresConfirmation: true,
        requiredFields: ['amount'],
        optionalFields: ['contact_id', 'due_date', 'currency', 'notes'],
      },
      mark_paid: {
        labels: { en: 'mark as paid', he: 'סמן כשולם', es: 'marcar como pagada' },
        risk: 'update',
        requiresConfirmation: true,
      },
      send: {
        labels: { en: 'send invoice', he: 'שלח חשבונית', es: 'enviar factura' },
        risk: 'send',
        requiresConfirmation: true,
        // Bulk send is what powers "chase everyone who owes me money", so it is
        // permitted — but capped, and never without an explicit preview.
        allowBulk: true,
        maxFanout: 100,
      },
    },
  },

  // ===========================================================================
  // BOOKINGS
  // ===========================================================================
  bookings: {
    table: 'scheduling_bookings',
    labels: {
      one: { en: 'booking', he: 'פגישה', es: 'reserva' },
      many: { en: 'bookings', he: 'פגישות', es: 'reservas' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    // A booking has no name, so its time is the only useful label. Combined with
    // the embedded contact the renderer produces "Ofir Omer (Aug 26, 1:00 PM)".
    labelField: 'start_time',
    displayFields: ['start_time', 'end_time', 'status', 'payment_status'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      contact_id: { column: 'contact_id', type: 'uuid', labels: { en: 'contact' } },
      service_id: { column: 'service_id', type: 'uuid', labels: { en: 'service' } },
      start_time: {
        column: 'start_time',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'start time', he: 'שעת התחלה', es: 'hora de inicio' },
        writable: true,
      },
      end_time: {
        column: 'end_time',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'end time', he: 'שעת סיום', es: 'hora de fin' },
        writable: true,
      },
      status: {
        column: 'status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
        writable: true,
        enumValues: ['confirmed', 'cancelled', 'completed', 'no_show'],
        // No synonyms: 'confirmed'/'completed'/'cancelled'/'no_show' are
        // self-describing, so "upcoming", "done" and "missed" need no entries.

      },
      payment_status: {
        column: 'payment_status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'payment status', he: 'סטטוס תשלום', es: 'estado de pago' },
        enumValues: ['pending', 'paid', 'refunded'],
      },
      /**
       * The column that makes `contacts.has_completed_intake` possible.
       * NOTE: the booking's client_* columns that older migrations created were
       * dropped by 20260810_remove_client_fields_and_total_amount.sql — client
       * identity now lives on the linked contact. Introspection caught that;
       * reading the migrations alone would not have.
       */
      intake_completed_at: {
        column: 'intake_completed_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'intake completed at', he: 'טופס קליטה הושלם', es: 'admisión completada' },
      },
      notes: {
        column: 'notes',
        type: 'string',
        labels: { en: 'notes', he: 'הערות', es: 'notas' },
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'created', he: 'נוצר', es: 'creado' },
      },
      internal_notes: {
        column: 'internal_notes',
        type: 'string',
        labels: { en: 'internal notes' },
        readable: false,
      },
    },

    relations: {
      contact: {
        target: 'contacts',
        cardinality: 'one',
        via: { column: 'contact_id', side: 'local' },
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
      },
    },

    actions: {
      cancel: {
        labels: { en: 'cancel booking', he: 'בטל פגישה', es: 'cancelar reserva' },
        risk: 'update',
        requiresConfirmation: true,
      },
      complete: {
        labels: { en: 'mark completed', he: 'סמן כהושלם', es: 'marcar completada' },
        risk: 'update',
        requiresConfirmation: false,
      },
    },
  },
};
