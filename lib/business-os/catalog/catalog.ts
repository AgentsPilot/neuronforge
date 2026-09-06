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
    aliases: ['clients', 'customers', 'לקוחות', 'clientes'],
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
          /*
           * What each of this business's stages MEANS.
           *
           * This was left off with a note saying the column did not exist and
           * declaring it would fail every stage query. That is no longer true:
           * `stage_type` is present on `crm_pipeline_stages` and carries
           * `lead | prospect | client | past_client`, and the compiler has
           * supported `semanticColumn` all along.
           *
           * It is worth turning on because label and position alone cannot
           * answer "how many NEW LEADS this week". A lead is not a label — this
           * account calls its first stage `inquiry`, labelled "פנייה" — and it
           * is not a position either, since pipelines differ in length. It is a
           * KIND, and the business has already classified its own stages into
           * these four. Without this, "leads" has to be guessed from stage keys
           * per account, which is exactly the per-vertical hardcoding the rest
           * of this declaration avoids.
           */
          semanticColumn: 'stage_type',
        },
        /*
         * The four kinds a stage can be — the stable vocabulary above every
         * business's own naming.
         *
         * These values are CLASSIFIERS, not storage values. Unlike
         * `invoices.status`, where `unpaid: ['sent','overdue']` names the
         * statuses directly, a contact's stage is whatever this business called
         * it: `inquiry` here, labelled "פנייה". The compiler translates each
         * classifier into that user's own stage keys through `semanticColumn`,
         * so `{ $semantic: 'lead' }` means the same thing on every account and
         * matches nothing hardcoded.
         *
         * Declared even though the mapping is data-driven because the term has
         * to be a known word before it can be resolved — an undeclared one is
         * refused rather than guessed, which is what stops "leads" quietly
         * matching nobody.
         */
        semanticTerms: {
          lead: ['lead'],
          prospect: ['prospect'],
          client: ['client'],
          past_client: ['past_client'],
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
      /**
       * Lead attribution, promoted from `source_metadata` by generated columns.
       *
       * Exposed as ordinary fields because that is all it takes: the compiler
       * has no JSONB path operator, and generated columns mean it does not need
       * one. "How many leads came from Instagram" now works through the existing
       * compute/group_by path with no new code — which is exactly the property
       * the catalog design is for.
       */
      referrer_domain: {
        column: 'referrer_domain',
        type: 'string',
        labels: { en: 'came from', he: 'הגיע מ', es: 'vino de' },
      },
      utm_source: {
        column: 'utm_source',
        type: 'string',
        labels: { en: 'campaign source', he: 'מקור קמפיין', es: 'fuente de campaña' },
      },
      utm_medium: {
        column: 'utm_medium',
        type: 'string',
        labels: { en: 'campaign medium', he: 'אמצעי קמפיין', es: 'medio de campaña' },
      },
      utm_campaign: {
        column: 'utm_campaign',
        type: 'string',
        labels: { en: 'campaign', he: 'קמפיין', es: 'campaña' },
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
      /* What this client has actually paid, as rows rather than a total. */
      transactions: {
        target: 'transactions',
        cardinality: 'many',
        via: { column: 'contact_id', side: 'remote' },
        labels: { en: 'payments', he: 'תשלומים', es: 'pagos' },
      },
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
      /*
       * Without this, "who owes me money?" could only ever traverse invoices —
       * and a client paying a course in three instalments has no invoice at all.
       * Money owed reaches a contact by two routes now, and both have to be
       * walkable from here.
       */
      installments: {
        target: 'installments',
        cardinality: 'many',
        via: { column: 'contact_id', side: 'remote' },
        labels: { en: 'plan payments', he: 'תשלומים בתוכנית', es: 'pagos del plan' },
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
      /**
       * Owes money by EITHER route.
       *
       * "Who owes me money?" planned `contacts WHERE ANY(invoices: unpaid)` —
       * the only route the catalog described — and answered "0 contacts" for a
       * business whose client was two ₪333 periods behind on a payment plan.
       * Nothing was wrong with the query; the question simply had a second
       * answer the planner could not see.
       *
       * A plan period is not an invoice: Stripe raises its own subscription
       * invoice and charges the saved card, so no `payment_invoices` row is
       * ever created. Both routes are real debt, and neither is a special case
       * of the other.
       *
       * Expressed as one boolean so the planner composes it like any other
       * field — `owes_money eq true`, negatable, combinable with a stage or a
       * date — instead of being taught which tables money hides in.
       */
      owes_money: {
        type: 'boolean',
        labels: {
          en: 'owes money',
          he: 'חייב כסף',
          es: 'debe dinero',
        },
        expand: [
          {
            relation: 'invoices',
            quantifier: 'any',
            where: [{ field: 'status', op: 'eq', value: { $semantic: 'unpaid' } }],
          },
          {
            relation: 'installments',
            quantifier: 'any',
            where: [{ field: 'status', op: 'eq', value: { $semantic: 'unpaid' } }],
          },
        ],
      },
    },

    actions: {
      create: {
        labels: { en: 'add contact', he: 'הוסף איש קשר', es: 'añadir contacto' },
        risk: 'create',
        requiresConfirmation: true,
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
       * "What does Dana owe, and what has she paid?"
       *
       * ─────────────────────────────────────────────────────────────────────
       * The data behind a statement, for one client: the open invoices as a
       * list of items, the payments received, and totals for each — per
       * currency, because adding ILS to USD invents a number.
       *
       * A capability rather than four calls the caller stitches together,
       * because stitching requires knowing which statuses count as open, that
       * money reaches a contact through invoices AND transactions, and that the
       * currencies must stay apart. Each of those, got wrong, produces a
       * plausible-looking figure in an email chasing a client for money.
       *
       * `risk: 'read'` and no confirmation: it assembles and returns. Saying
       * anything to the client is a separate `send`, which keeps its own gate.
       * ─────────────────────────────────────────────────────────────────────
       */
      statement: {
        labels: {
          en: 'get what a client owes and has paid (open invoices and payments)',
          he: 'מה הלקוח חייב ומה שילם (חשבוניות פתוחות ותשלומים)',
          es: 'qué debe y qué ha pagado un cliente (facturas abiertas y pagos)',
        },
        risk: 'read',
        requiresConfirmation: false,
        // Returns a report about the contact; writes nothing to the row.
        writesRow: false,
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
        // subject/body are the message, not columns of crm_contacts.
        writesRow: false,
        // What the USER must supply, not what the row holds.
        //
        // This said `['email']` — the contact's own address, which the executor
        // reads from the row and the user never types. Nothing asked for the
        // words, so "email Ofir" could reach the sender with no subject and no
        // body. A send's required fields are its message.
        requiredFields: ['subject', 'body'],
        allowBulk: true,
        maxFanout: 100,
      },
    },
  },

  // ===========================================================================
  // INVOICES
  // ===========================================================================
  invoices: {
    meaning: 'money BILLED to clients — raised, whether or not it has been paid',
    table: 'payment_invoices',
    labels: {
      one: { en: 'invoice', he: 'חשבונית', es: 'factura' },
      many: { en: 'invoices', he: 'חשבוניות', es: 'facturas' },
    },
    aliases: ['bills', 'חשבונות', 'cuentas'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'invoice_number',
    // No `currency`: the amount is formatted with its own symbol, so a separate
    // "currency: ILS" line repeated it in the one form the reader cannot use.
    displayFields: ['invoice_number', 'amount', 'status', 'due_date'],
    displayRelations: ['contact'],
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
      // Writable so an invoice can be raised FOR someone. The compiler verifies
      // the referenced row belongs to the caller before any write — see
      // assertReferencesOwned in MutateExecutor.
      contact_id: {
        column: 'contact_id',
        type: 'uuid',
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
        writable: true,
        references: 'contacts',
      },
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
        // Writable for the same reason as on services: an amount without a
        // currency is not an amount. "invoice Ofir 300 shekels" needs both.
        writable: true,
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
        enumLabels: {
          draft: { en: 'draft', he: 'טיוטה', es: 'borrador' },
          sent: { en: 'sent', he: 'נשלחה', es: 'enviada' },
          paid: { en: 'paid', he: 'שולמה', es: 'pagada' },
          overdue: { en: 'overdue', he: 'באיחור', es: 'vencida' },
          cancelled: { en: 'cancelled', he: 'בוטלה', es: 'anulada' },
        },
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
      // What the invoice was raised for. Both columns existed and neither was
      // declared, so an invoice could not be tied to the work behind it.
      service_id: {
        column: 'service_id',
        type: 'uuid',
        labels: { en: 'service', he: 'שירות', es: 'servicio' },
        references: 'services',
      },
      booking_id: {
        column: 'booking_id',
        type: 'uuid',
        labels: { en: 'booking', he: 'פגישה', es: 'reserva' },
        references: 'bookings',
      },
      // Never exposed to the planner: private to the business owner.
      internal_notes: {
        column: 'internal_notes',
        type: 'string',
        labels: { en: 'internal notes' },
        readable: false,
      },
    },

    derived: {
      /*
       * Whether any money went back on this invoice.
       *
       * `refunded_amount` lives on the PAYMENT, not on the invoice, so "which
       * invoices were refunded" meant traversing to payments and knowing which
       * column carried it. Declared here, every operator composes with it for
       * free — "unpaid invoices that were never refunded" becomes an ordinary
       * two-predicate filter.
       *
       * `succeeded` only: an attempted refund that failed returned nothing, and
       * counting it would tell a business it had given money back when it had
       * not.
       */
      was_refunded: {
        type: 'boolean',
        labels: { en: 'was refunded', he: 'הוחזר', es: 'reembolsada' },
        expand: {
          relation: 'refunds',
          quantifier: 'any',
          where: [{ field: 'status', op: 'eq', value: 'succeeded' }],
        },
      },
    },

    relations: {
      refunds: {
        target: 'refunds',
        cardinality: 'many',
        via: { column: 'invoice_id', side: 'remote' },
        labels: { en: 'refunds', he: 'זיכויים', es: 'reembolsos' },
      },
      contact: {
        target: 'contacts',
        cardinality: 'one',
        via: { column: 'contact_id', side: 'local' },
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
      },
      service: {
        target: 'services',
        cardinality: 'one',
        via: { column: 'service_id', side: 'local' },
        labels: { en: 'service', he: 'שירות', es: 'servicio' },
      },
      booking: {
        target: 'bookings',
        cardinality: 'one',
        via: { column: 'booking_id', side: 'local' },
        labels: { en: 'booking', he: 'פגישה', es: 'reserva' },
      },
    },

    actions: {
      /**
       * Cancel an invoice: it stands as a record but stops being owed.
       *
       * Preferred over deleting — the client may already have it, and a
       * cancelled invoice they can look up explains itself where a missing one
       * does not. Refuses an invoice that has been paid: voiding one they have
       * settled leaves money received against a cancelled document.
       */
      void: {
        labels: { en: 'cancel an invoice', he: 'בטל חשבונית', es: 'anular una factura' },
        risk: 'update',
        requiresConfirmation: true,
      },
      /**
       * Remove it entirely. Voids at the processor first, or the hosted payment
       * page outlives the row and money can arrive for a document that is gone.
       */
      delete: {
        labels: { en: 'delete an invoice', he: 'מחק חשבונית', es: 'eliminar una factura' },
        risk: 'delete',
        requiresConfirmation: true,
      },
      create: {
        labels: { en: 'create invoice', he: 'צור חשבונית', es: 'crear factura' },
        risk: 'create',
        requiresConfirmation: true,
        requiredFields: ['amount'],
        // The number is generated from the user's own sequence, never asked for.
        handlerSupplies: ['invoice_number'],
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

  /**
   * Money owed under a PAYMENT PLAN — one row per scheduled period.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * The chat could not see this at all. "Who owes me money?" resolved against
   * `invoices` alone, so a business selling a ₪1,000 course as three monthly
   * payments — two still to come — was told "0 contacts". True about invoices,
   * and the wrong answer to the question that was asked.
   *
   * A plan period is NOT an invoice. Nothing is billed for it: Stripe raises
   * its own subscription invoice each period and charges the saved card, so
   * there is no `payment_invoices` row to find. The debt is real, and this
   * table is the only place it exists.
   *
   * `unpaid` means here what it means on an invoice — money owed to you — and
   * excludes `cancelled` for the same reason `draft` is excluded there: a
   * period that will never be charged is not owed.
   * ─────────────────────────────────────────────────────────────────────────
   */
  installments: {
    meaning: 'money owed under a payment plan — one row per scheduled period, whether or not it has been collected',
    table: 'payment_plan_installments',
    labels: {
      one: { en: 'installment', he: 'תשלום', es: 'cuota' },
      many: { en: 'installments', he: 'תשלומים', es: 'cuotas' },
    },
    aliases: ['payment plan', 'תוכנית תשלומים', 'plan de pagos'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'installment_number',
    displayFields: ['installment_number', 'amount', 'due_date', 'status'],
    displayRelations: ['contact'],
    searchableFields: [],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      contact_id: {
        column: 'contact_id',
        type: 'uuid',
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
        references: 'contacts',
      },
      installment_number: {
        column: 'installment_number',
        type: 'number',
        labels: { en: 'payment number', he: 'מספר תשלום', es: 'número de pago' },
      },
      amount: {
        column: 'amount',
        type: 'money',
        format: 'money',
        labels: { en: 'amount', he: 'סכום', es: 'importe' },
      },
      currency: {
        column: 'currency',
        type: 'enum',
        labels: { en: 'currency', he: 'מטבע', es: 'moneda' },
        enumValues: ['USD', 'EUR', 'ILS', 'GBP'],
      },
      due_date: {
        column: 'due_date',
        type: 'date',
        format: 'date',
        labels: { en: 'due date', he: 'תאריך תשלום', es: 'fecha de vencimiento' },
      },
      /**
       * Read-only, unlike `invoices.status`.
       *
       * A period is marked paid by the Stripe webhook when its subscription
       * invoice is paid, and cancelled when the schedule ends. Letting the chat
       * write it would let someone mark money collected that Stripe never took.
       */
      status: {
        column: 'status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
        enumValues: ['pending', 'paid', 'overdue', 'cancelled'],
        enumLabels: {
          pending: { en: 'pending', he: 'ממתין', es: 'pendiente' },
          paid: { en: 'paid', he: 'שולם', es: 'pagada' },
          overdue: { en: 'overdue', he: 'באיחור', es: 'vencida' },
          cancelled: { en: 'cancelled', he: 'בוטל', es: 'anulada' },
        },
        // The same business rule as on invoices: owed means not yet collected
        // and still collectable. `cancelled` is neither.
        semanticTerms: {
          unpaid: ['pending', 'overdue'],
        },
      },
      paid_at: {
        column: 'paid_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'paid at', he: 'שולם בתאריך', es: 'pagado el' },
      },
    },
  },

  // ===========================================================================
  // BOOKINGS
  // ===========================================================================
  bookings: {
    meaning: 'appointments in the diary; payment_amount is the booked value, which may never be paid',
    table: 'scheduling_bookings',
    labels: {
      one: { en: 'booking', he: 'פגישה', es: 'reserva' },
      many: { en: 'bookings', he: 'פגישות', es: 'reservas' },
    },
    aliases: ['appointments', 'sessions', 'פגישות', 'תורים', 'citas'],
    userScope: { kind: 'column', column: 'user_id' },
    // A booking has no name, so its time is the only useful label. Combined with
    // the embedded contact the renderer produces "Ofir Omer (Aug 26, 1:00 PM)".
    labelField: 'start_time',
    displayFields: ['start_time', 'end_time', 'status', 'payment_status'],
    displayRelations: ['contact', 'service'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      // Writable so a booking can be made from the chat, and both declare what
      // they reference so every write is checked against rows this user owns —
      // a booking pointing at a stranger's contact would be a tenant leak
      // dressed as a foreign key.
      contact_id: {
        column: 'contact_id',
        type: 'uuid',
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
        writable: true,
        references: 'contacts',
      },
      service_id: {
        column: 'service_id',
        type: 'uuid',
        labels: { en: 'service', he: 'שירות', es: 'servicio' },
        writable: true,
        references: 'services',
      },
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
        enumLabels: {
          confirmed: { en: 'confirmed', he: 'מאושרת', es: 'confirmada' },
          cancelled: { en: 'cancelled', he: 'בוטלה', es: 'cancelada' },
          completed: { en: 'completed', he: 'הושלמה', es: 'completada' },
          no_show: { en: 'no-show', he: 'לא הגיע', es: 'no se presentó' },
        },
        /*
         * "Done" and "missed" ARE self-describing — `completed` and `no_show`
         * say themselves, and no synonym entry earns its place.
         *
         * "Upcoming" is not, and the comment that used to stand here said it
         * was. It is not a synonym for a status at all: it is a rule spanning
         * status AND time, and published as neither, the planner filtered on
         * time alone. Asked "האם יש לי פגישות קרובות?" it answered "you have 3"
         * and listed one completed, one cancelled and one no-show — every one
         * of them in the future, none of them a meeting anyone was going to
         * attend. A day that does not exist.
         *
         * `SchedulingRepository.getUpcoming` has always paired `confirmed` with
         * a future date. That pairing simply was never published, so the model
         * had to infer it and inferred the easy half.
         *
         * Status only. The "in the future" half stays with the date filter,
         * which the planner already gets right from the relative anchors.
         */
        semanticTerms: {
          upcoming: ['confirmed'],
        },
      },
      payment_status: {
        column: 'payment_status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'payment status', he: 'סטטוס תשלום', es: 'estado de pago' },
        enumValues: ['pending', 'paid', 'refunded'],
        enumLabels: {
          pending: { en: 'pending', he: 'ממתין', es: 'pendiente' },
          paid: { en: 'paid', he: 'שולם', es: 'pagado' },
          refunded: { en: 'refunded', he: 'הוחזר', es: 'reembolsado' },
        },
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
        // Writable so "book Ofir at 3, he's bringing the documents" keeps the
        // second half. `internal_notes` stays read-only — it is the owner's own
        // margin, not something a booking request should reach.
        writable: true,
      },
      payment_amount: {
        column: 'payment_amount',
        type: 'number',
        format: 'money',
        labels: { en: 'amount', he: 'סכום', es: 'importe' },
      },
      invoice_id: {
        column: 'invoice_id',
        type: 'uuid',
        labels: { en: 'invoice', he: 'חשבונית', es: 'factura' },
        references: 'invoices',
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
      invoice: {
        target: 'invoices',
        cardinality: 'one',
        via: { column: 'invoice_id', side: 'local' },
        labels: { en: 'invoice', he: 'חשבונית', es: 'factura' },
      },
      service: {
        target: 'services',
        cardinality: 'one',
        via: { column: 'service_id', side: 'local' },
        labels: { en: 'service', he: 'שירות', es: 'servicio' },
      },
    },

    actions: {
      /**
       * Remove a booking as if it never happened — for one entered by mistake.
       *
       * `cancel` is the usual verb and keeps the record. This refuses outright
       * if the booking has been paid for, and takes its unpaid invoices with it:
       * `payment_invoices.booking_id` is ON DELETE SET NULL, so an invoice left
       * behind becomes an orphan that is still owed and no longer traceable.
       */
      delete: {
        labels: { en: 'delete a booking', he: 'מחק פגישה', es: 'eliminar una reserva' },
        risk: 'delete',
        requiresConfirmation: true,
      },
      /** Ask the client to fill in the intake form for their appointment. */
      /*
       * Send the confirmation again.
       *
       * "She says she never got it" — previously only reachable from the
       * bookings screen, so the commonest reason a client misses an appointment
       * had no capability behind it.
       *
       * No invoice goes with it. A resend is about the appointment, not about
       * asking for money again; attaching a payment link to a booking already
       * paid for is how a client ends up paying twice.
       */
      resend_confirmation: {
        labels: {
          en: 'send the booking confirmation again',
          he: 'שלח שוב את אישור הפגישה',
          es: 'reenviar la confirmación de la reserva',
        },
        risk: 'send',
        requiresConfirmation: true,
        writesRow: false,
      },
      send_intake: {
        labels: {
          en: 'ask the client for their intake form',
          he: 'בקש מהלקוח למלא טופס קליטה',
          es: 'pedir al cliente el formulario de admisión',
        },
        risk: 'send',
        requiresConfirmation: true,
        writesRow: false,
      },
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
      // A no-show is a status and nothing more — the appointment happened, in
      // the sense that the slot was used up. The route does exactly this and no
      // calendar or email work, so the chat can too.
      no_show: {
        labels: { en: 'mark as no-show', he: 'סמן כלא הגיע', es: 'marcar como ausente' },
        risk: 'update',
        requiresConfirmation: true,
      },
      // Moving an appointment: new time, calendar updated, client told.
      reschedule: {
        labels: { en: 'reschedule', he: 'שנה מועד', es: 'reprogramar' },
        risk: 'update',
        requiresConfirmation: true,
        requiredFields: ['start_time', 'end_time'],
      },
      // Booking from the chat only became honest once the side effects moved
      // into BookingLifecycleService. Declared against the repository it would
      // have written a row that is absent from the calendar, possibly
      // double-booked, and unknown to the client expected to attend.
      create: {
        labels: { en: 'book appointment', he: 'קבע פגישה', es: 'reservar cita' },
        risk: 'create',
        requiresConfirmation: true,
        requiredFields: ['contact_id', 'service_id', 'start_time', 'end_time'],
        optionalFields: ['notes'],
      },
    },
  },

  // ===========================================================================
  // TASKS
  // ===========================================================================
  tasks: {
    table: 'crm_tasks',
    labels: {
      one: { en: 'task', he: 'משימה', es: 'tarea' },
      many: { en: 'tasks', he: 'משימות', es: 'tareas' },
    },
    aliases: ['todos', 'reminders', 'משימות', 'tareas'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'title',
    displayFields: ['title', 'status', 'priority', 'due_date'],
    displayRelations: ['contact'],
    searchableFields: ['title', 'description'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      // Writable so a task can be attached to a person. Ownership of the
      // referenced row is verified before the write — see MutateExecutor.
      contact_id: {
        column: 'contact_id',
        type: 'uuid',
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
        writable: true,
        references: 'contacts',
      },
      title: {
        column: 'title',
        type: 'string',
        labels: { en: 'title', he: 'כותרת', es: 'título' },
        writable: true,
      },
      description: {
        column: 'description',
        type: 'string',
        labels: { en: 'description', he: 'תיאור', es: 'descripción' },
        writable: true,
      },
      // A genuine Postgres enum type, not a CHECK constraint — PostgREST reports
      // it as 'public.task_priority'. Values come from the type definition.
      priority: {
        column: 'priority',
        type: 'enum',
        format: 'enum',
        labels: { en: 'priority', he: 'עדיפות', es: 'prioridad' },
        writable: true,
        enumValues: ['low', 'medium', 'high', 'urgent'],
        enumLabels: {
          low: { en: 'low', he: 'נמוכה', es: 'baja' },
          medium: { en: 'medium', he: 'בינונית', es: 'media' },
          high: { en: 'high', he: 'גבוהה', es: 'alta' },
          urgent: { en: 'urgent', he: 'דחופה', es: 'urgente' },
        },
      },
      status: {
        column: 'status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
        writable: true,
        enumValues: ['pending', 'in_progress', 'completed', 'cancelled'],
        enumLabels: {
          pending: { en: 'pending', he: 'ממתינה', es: 'pendiente' },
          in_progress: { en: 'in progress', he: 'בתהליך', es: 'en curso' },
          completed: { en: 'completed', he: 'הושלמה', es: 'completada' },
          cancelled: { en: 'cancelled', he: 'בוטלה', es: 'cancelada' },
        },
        // A business rule, not a synonym: "open" work is anything not finished
        // and not abandoned, which no single stored value expresses.
        semanticTerms: {
          open: ['pending', 'in_progress'],
        },
      },
      due_date: {
        column: 'due_date',
        type: 'datetime',
        format: 'date',
        labels: { en: 'due date', he: 'תאריך יעד', es: 'fecha límite' },
        writable: true,
      },
      completed_at: {
        column: 'completed_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'completed at', he: 'הושלם ב', es: 'completada el' },
      },
      tags: {
        column: 'tags',
        type: 'string[]',
        format: 'tags',
        labels: { en: 'tags', he: 'תגיות', es: 'etiquetas' },
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
      contact: {
        target: 'contacts',
        cardinality: 'one',
        via: { column: 'contact_id', side: 'local' },
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
      },
    },

    actions: {
      create: {
        labels: { en: 'add task', he: 'הוסף משימה', es: 'añadir tarea' },
        risk: 'create',
        // Creates confirm, like every other create here. "הוסף משימה למשה" wrote a
        // task titled "new task" and reported it done — the user never saw what
        // was about to be written, and a create is only cheap to undo if you know
        // it happened. The card now shows the actual values, which is what makes
        // one extra tap worth something.
        requiresConfirmation: true,
        requiredFields: ['title'],
        optionalFields: ['description', 'priority', 'due_date', 'contact_id', 'tags'],
      },
      update: {
        labels: { en: 'update task', he: 'עדכן משימה', es: 'actualizar tarea' },
        risk: 'update',
        requiresConfirmation: false,
      },
      delete: {
        labels: { en: 'delete task', he: 'מחק משימה', es: 'eliminar tarea' },
        risk: 'delete',
        requiresConfirmation: true,
        allowBulk: false,
      },
    },
  },

  // ===========================================================================
  // SERVICES
  // ===========================================================================
  services: {
    table: 'scheduling_services',
    labels: {
      one: { en: 'service', he: 'שירות', es: 'servicio' },
      many: { en: 'services', he: 'שירותים', es: 'servicios' },
    },
    aliases: ['offerings', 'treatments', 'שירותים', 'טיפולים'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'service_name',
    displayFields: ['service_name', 'duration_minutes', 'price', 'currency', 'status'],
    searchableFields: ['service_name', 'description'],
    defaultLimit: 50,
    maxLimit: 200,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      service_name: {
        column: 'service_name',
        type: 'string',
        labels: { en: 'name', he: 'שם', es: 'nombre' },
        writable: true,
      },
      description: {
        column: 'description',
        type: 'string',
        labels: { en: 'description', he: 'תיאור', es: 'descripción' },
        writable: true,
      },
      duration_minutes: {
        column: 'duration_minutes',
        type: 'number',
        labels: { en: 'duration (min)', he: 'משך (דקות)', es: 'duración (min)' },
        writable: true,
      },
      price: {
        column: 'price',
        type: 'money',
        format: 'money',
        labels: { en: 'price', he: 'מחיר', es: 'precio' },
        writable: true,
      },
      currency: {
        column: 'currency',
        type: 'enum',
        format: 'enum',
        labels: { en: 'currency', he: 'מטבע', es: 'moneda' },
        // Writable: a price is meaningless without it, and "250 ILS" failed
        // outright while the service itself was creatable.
        writable: true,
        enumValues: ['USD', 'EUR', 'ILS', 'GBP'],
      },
      status: {
        column: 'status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
        writable: true,
        enumValues: ['draft', 'active', 'inactive'],
        enumLabels: {
          draft: { en: 'draft', he: 'טיוטה', es: 'borrador' },
          active: { en: 'active', he: 'פעיל', es: 'activo' },
          inactive: { en: 'inactive', he: 'לא פעיל', es: 'inactivo' },
        },
      },
      is_active: {
        column: 'is_active',
        type: 'boolean',
        format: 'boolean',
        labels: { en: 'visible to clients', he: 'גלוי ללקוחות', es: 'visible' },
        writable: true,
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'created', he: 'נוצר', es: 'creado' },
      },
    },

    derived: {
      /*
       * A service nobody has ever booked.
       *
       * The question behind "what am I offering that isn't working" — and it is
       * an ABSENCE, which is the one thing PostgREST cannot express and the
       * reason the compiler's `none` quantifier exists. Without it a caller has
       * to fetch every service, fetch every booking, and diff them.
       *
       * Named for bookings rather than sales on purpose: a booking is not
       * revenue, and calling this `never_sold` would quietly answer a different
       * question for any service that is booked and billed separately.
       */
      never_booked: {
        type: 'boolean',
        labels: { en: 'never booked', he: 'לא הוזמן מעולם', es: 'nunca reservado' },
        expand: { relation: 'bookings', quantifier: 'none' },
      },
    },

    relations: {
      /* Money earned by this service — the other half of "what is working". */
      transactions: {
        target: 'transactions',
        cardinality: 'many',
        via: { column: 'service_id', side: 'remote' },
        labels: { en: 'payments', he: 'תשלומים', es: 'pagos' },
      },
      bookings: {
        target: 'bookings',
        cardinality: 'many',
        via: { column: 'service_id', side: 'remote' },
        labels: { en: 'bookings', he: 'פגישות', es: 'reservas' },
      },
    },

    actions: {
      /**
       * Remove a service outright.
       *
       * `deactivate` is the usual verb and the reversible one — it stops new
       * bookings while leaving the history readable. This is for a service
       * created by mistake. Past bookings keep their `service_id`, so deleting
       * one a client has booked leaves those rows pointing at nothing.
       */
      delete: {
        labels: { en: 'delete a service', he: 'מחק שירות', es: 'eliminar un servicio' },
        risk: 'delete',
        requiresConfirmation: true,
      },
      /**
       * Make a draft service bookable.
       *
       * `create` deliberately starts a service as a draft, so without this the
       * chat could invent a service it had no way to open for bookings — the
       * user had to finish the job by hand. The repository refuses to publish
       * anything that is not a draft, so a live service cannot be republished
       * into a different state by accident.
       */
      publish: {
        labels: { en: 'publish a draft service', he: 'פרסם שירות', es: 'publicar un servicio' },
        risk: 'update',
        requiresConfirmation: true,
      },
      create: {
        labels: { en: 'add service', he: 'הוסף שירות', es: 'añadir servicio' },
        risk: 'create',
        requiresConfirmation: true,
        // duration is NOT NULL in the database, so asking for it up front is
        // better than failing after the user thinks the service was created.
        requiredFields: ['service_name', 'duration_minutes'],
        optionalFields: ['description', 'price', 'currency'],
      },
      update: {
        labels: { en: 'update service', he: 'עדכן שירות', es: 'actualizar servicio' },
        risk: 'update',
        requiresConfirmation: false,
      },
      deactivate: {
        labels: { en: 'hide service', he: 'הסתר שירות', es: 'ocultar servicio' },
        risk: 'update',
        requiresConfirmation: true,
      },
    },
  },


  // ===========================================================================
  // PAYMENT PLANS  (the offer: "3 x 500 monthly")
  // ===========================================================================
  /*
   * A plan a business OFFERS, not one a client is on.
   *
   * Separate from `plan_subscriptions` because they answer different questions
   * and get confused constantly: this is the shape of the deal — three payments
   * of 500, monthly — and exists once per service. Who is actually paying it,
   * and how far through, is the subscription.
   */
  plans: {
    meaning: 'the instalment offers this business sells — the shape of the deal, not who is on it',
    table: 'payment_plans',
    labels: {
      one: { en: 'payment plan', he: 'תוכנית תשלומים', es: 'plan de pagos' },
      many: { en: 'payment plans', he: 'תוכניות תשלומים', es: 'planes de pago' },
    },
    aliases: ['instalment plans', 'installment plans', 'תוכניות תשלום', 'planes'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'name',
    displayFields: ['name', 'total_amount', 'installment_count', 'installment_frequency'],
    defaultLimit: 50,
    maxLimit: 200,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      name: { column: 'name', type: 'string', labels: { en: 'name', he: 'שם', es: 'nombre' } },
      description: {
        column: 'description',
        type: 'string',
        labels: { en: 'description', he: 'תיאור', es: 'descripción' },
      },
      service_id: {
        column: 'service_id',
        type: 'uuid',
        labels: { en: 'service', he: 'שירות', es: 'servicio' },
        references: 'services',
      },
      total_amount: {
        column: 'total_amount',
        type: 'money',
        format: 'money',
        labels: { en: 'total', he: 'סה"כ', es: 'total' },
      },
      installment_amount: {
        column: 'installment_amount',
        type: 'money',
        format: 'money',
        labels: { en: 'per payment', he: 'לתשלום', es: 'por cuota' },
      },
      installment_count: {
        column: 'installment_count',
        type: 'number',
        labels: { en: 'payments', he: 'מספר תשלומים', es: 'número de cuotas' },
      },
      installment_frequency: {
        column: 'installment_frequency',
        type: 'string',
        labels: { en: 'frequency', he: 'תדירות', es: 'frecuencia' },
      },
      currency: {
        column: 'currency',
        type: 'enum',
        format: 'enum',
        labels: { en: 'currency', he: 'מטבע', es: 'moneda' },
        enumValues: ['USD', 'EUR', 'ILS', 'GBP'],
      },
      is_active: {
        column: 'is_active',
        type: 'boolean',
        labels: { en: 'offered', he: 'פעילה', es: 'ofrecido' },
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'created', he: 'נוצרה', es: 'creado' },
      },
    },

    relations: {
      service: {
        target: 'services',
        cardinality: 'one',
        via: { column: 'service_id', side: 'local' },
        labels: { en: 'service', he: 'שירות', es: 'servicio' },
      },
    },
  },

  // ===========================================================================
  // PLAN SUBSCRIPTIONS  (a client actually paying one)
  // ===========================================================================
  /*
   * One client, part-way through a plan.
   *
   * The operational half: who is on a plan, how many periods they have paid,
   * when the next charge is, and whether the last one failed. Without it "whose
   * card is failing" and "who still owes on their plan" were unanswerable —
   * only the individual instalments were visible, which shows the payments but
   * not the arrangement they belong to.
   */
  plan_subscriptions: {
    meaning: 'clients part-way through a payment plan — the live arrangement, not the offer',
    table: 'payment_plan_subscriptions',
    labels: {
      one: { en: 'plan subscription', he: 'מנוי לתוכנית תשלומים', es: 'suscripción a plan' },
      many: { en: 'plan subscriptions', he: 'מנויים לתוכניות תשלומים', es: 'suscripciones a planes' },
    },
    aliases: ['clients on plans', 'active plans', 'מנויים', 'suscripciones'],
    userScope: { kind: 'column', column: 'user_id' },
    /*
     * There is no name on this table, and that is honest rather than an
     * oversight: a subscription is identified by WHO is on it, and the client's
     * name lives on `contacts`. `status` is the least-bad single column — it is
     * what distinguishes one row from another at a glance — and
     * `displayRelations` brings the client through wherever a row is shown.
     */
    labelField: 'status',
    displayFields: ['status', 'installment_amount', 'periods_paid', 'next_charge_at'],
    displayRelations: ['contact'],
    defaultLimit: 50,
    maxLimit: 200,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      contact_id: {
        column: 'contact_id',
        type: 'uuid',
        labels: { en: 'client', he: 'לקוח', es: 'cliente' },
        references: 'contacts',
      },
      payment_plan_id: {
        column: 'payment_plan_id',
        type: 'uuid',
        labels: { en: 'plan', he: 'תוכנית', es: 'plan' },
        references: 'plans',
      },
      status: {
        column: 'status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
        enumValues: ['active', 'completed', 'cancelled', 'past_due', 'paused'],
      },
      installment_amount: {
        column: 'installment_amount',
        type: 'money',
        format: 'money',
        labels: { en: 'per payment', he: 'לתשלום', es: 'por cuota' },
      },
      installment_count: {
        column: 'installment_count',
        type: 'number',
        labels: { en: 'payments', he: 'מספר תשלומים', es: 'número de cuotas' },
      },
      /* How far through they are — the number a client actually asks about. */
      periods_paid: {
        column: 'periods_paid',
        type: 'number',
        labels: { en: 'paid so far', he: 'שולמו עד כה', es: 'pagadas hasta ahora' },
      },
      currency: {
        column: 'currency',
        type: 'enum',
        format: 'enum',
        labels: { en: 'currency', he: 'מטבע', es: 'moneda' },
        enumValues: ['USD', 'EUR', 'ILS', 'GBP'],
      },
      next_charge_at: {
        column: 'next_charge_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'next charge', he: 'החיוב הבא', es: 'próximo cargo' },
      },
      /* Why the last attempt failed — the reason a plan quietly stops paying. */
      last_failure_code: {
        column: 'last_failure_code',
        type: 'string',
        labels: { en: 'last failure', he: 'כשל אחרון', es: 'último fallo' },
      },
      last_failure_at: {
        column: 'last_failure_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'failed on', he: 'תאריך הכשל', es: 'fecha del fallo' },
      },
      card_brand: {
        column: 'card_brand',
        type: 'string',
        labels: { en: 'card', he: 'כרטיס', es: 'tarjeta' },
      },
      card_last4: {
        column: 'card_last4',
        type: 'string',
        labels: { en: 'card ending', he: 'ספרות אחרונות', es: 'últimos dígitos' },
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'started', he: 'התחיל', es: 'iniciado' },
      },
      cancelled_at: {
        column: 'cancelled_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'cancelled', he: 'בוטל', es: 'cancelado' },
      },
    },

    relations: {
      contact: {
        target: 'contacts',
        cardinality: 'one',
        via: { column: 'contact_id', side: 'local' },
        labels: { en: 'client', he: 'לקוח', es: 'cliente' },
      },
      plan: {
        target: 'plans',
        cardinality: 'one',
        via: { column: 'payment_plan_id', side: 'local' },
        labels: { en: 'plan', he: 'תוכנית', es: 'plan' },
      },
    },

    actions: {
      /*
       * Stop the remaining charges.
       *
       * Cancels the Stripe subscription so nothing further is taken. It does
       * NOT refund what has already been collected: `cancelPlan` can do that,
       * and deliberately is not exposed here — giving money back is a separate
       * decision with its own capability (`transactions.refund`), and folding
       * it into "cancel" would let one sentence both stop a plan and move money
       * out of the business.
       */
      cancel: {
        labels: {
          en: 'stop the remaining payments on a plan',
          he: 'עצור את יתרת התשלומים בתוכנית',
          es: 'detener los pagos restantes de un plan',
        },
        risk: 'delete',
        requiresConfirmation: true,
        writesRow: false,
        optionalFields: ['reason'],
      },
    },
  },
  // ===========================================================================
  // REFUNDS  (read-only: money going back out is recorded by Stripe, not chat)
  // ===========================================================================
  /*
   * Money returned to a client, as its own thing.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * WHY THIS IS NOT JUST A FIELD ON A PAYMENT
   *
   * `transactions` carries `refunded_amount` and `refunded_at`, which is enough
   * to ask whether a payment was refunded. It is NOT enough to ask what was
   * refunded in a PERIOD, and the difference is not academic: aggregating
   * `refunded_amount` dates every refund by when the original payment was
   * taken, so a March payment refunded in August lands in March.
   *
   * The ledger export already knew this and filters refunds on `succeeded_at`
   * — "the period a refund belongs to is the one the money actually left in".
   * Without this entity the chat and the ledger answer "how much did I refund
   * in August" differently, and neither says so.
   *
   * A refund can also exist without a usable parent row and carries its own
   * reason, its own fee treatment and its own failure state, none of which fit
   * on the payment it reverses.
   * ─────────────────────────────────────────────────────────────────────────
   */
  refunds: {
    meaning:
      'money RETURNED to a client — dated by when it actually settled, not by when the original payment was taken',
    table: 'payment_refunds',
    labels: {
      one: { en: 'refund', he: 'זיכוי', es: 'reembolso' },
      many: { en: 'refunds', he: 'זיכויים', es: 'reembolsos' },
    },
    aliases: ['money back', 'credits', 'החזרים', 'זיכויים', 'devoluciones'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'reason',
    displayFields: ['amount', 'currency', 'status', 'succeeded_at'],
    displayRelations: ['transaction'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      transaction_id: {
        column: 'transaction_id',
        type: 'uuid',
        labels: { en: 'payment', he: 'תשלום', es: 'pago' },
        references: 'transactions',
      },
      invoice_id: {
        column: 'invoice_id',
        type: 'uuid',
        labels: { en: 'invoice', he: 'חשבונית', es: 'factura' },
        references: 'invoices',
      },
      amount: {
        column: 'amount',
        type: 'money',
        format: 'money',
        labels: { en: 'amount', he: 'סכום', es: 'importe' },
      },
      currency: {
        column: 'currency',
        type: 'enum',
        format: 'enum',
        labels: { en: 'currency', he: 'מטבע', es: 'moneda' },
        enumValues: ['USD', 'EUR', 'ILS', 'GBP'],
      },
      status: {
        column: 'status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
        enumValues: ['pending', 'succeeded', 'failed', 'cancelled'],
        enumLabels: {
          pending: { en: 'pending', he: 'ממתין', es: 'pendiente' },
          succeeded: { en: 'succeeded', he: 'הושלם', es: 'completado' },
          failed: { en: 'failed', he: 'נכשל', es: 'fallido' },
          cancelled: { en: 'cancelled', he: 'בוטל', es: 'cancelado' },
        },
      },
      reason: {
        column: 'reason',
        type: 'string',
        labels: { en: 'reason', he: 'סיבה', es: 'motivo' },
      },
      /*
       * The date that matters.
       *
       * `created_at` is when the refund was ATTEMPTED; `succeeded_at` is when
       * the money left. They differ whenever a refund succeeded after a retry,
       * and every period question should be asked against this one.
       */
      succeeded_at: {
        column: 'succeeded_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'refunded on', he: 'תאריך הזיכוי', es: 'fecha del reembolso' },
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'requested on', he: 'תאריך הבקשה', es: 'fecha de solicitud' },
      },
      /*
       * What the processor did NOT give back.
       *
       * Usually zero: Stripe keeps its fee on a refunded payment, which is what
       * makes a full refund cost the business money rather than being neutral.
       */
      fee_returned: {
        column: 'fee_returned',
        type: 'money',
        format: 'money',
        labels: { en: 'fee returned', he: 'עמלה שהוחזרה', es: 'comisión devuelta' },
      },
      refund_fee: {
        column: 'refund_fee',
        type: 'money',
        format: 'money',
        labels: { en: 'refund fee', he: 'עמלת זיכוי', es: 'comisión del reembolso' },
      },
      failure_message: {
        column: 'failure_message',
        type: 'string',
        labels: { en: 'failure reason', he: 'סיבת הכשל', es: 'motivo del fallo' },
      },
    },

    relations: {
      transaction: {
        target: 'transactions',
        cardinality: 'one',
        via: { column: 'transaction_id', side: 'local' },
        labels: { en: 'payment', he: 'תשלום', es: 'pago' },
      },
      invoice: {
        target: 'invoices',
        cardinality: 'one',
        via: { column: 'invoice_id', side: 'local' },
        labels: { en: 'invoice', he: 'חשבונית', es: 'factura' },
      },
    },
  },

  // ===========================================================================
  // TRANSACTIONS  (read-only: money movement is recorded by Stripe, not chat)
  // ===========================================================================
  transactions: {
    meaning: 'money that actually MOVED — payments received and refunds returned',
    table: 'payment_transactions',
    labels: {
      one: { en: 'payment', he: 'תשלום', es: 'pago' },
      many: { en: 'payments', he: 'תשלומים', es: 'pagos' },
    },
    aliases: ['payments', 'income', 'תשלומים', 'הכנסות', 'pagos'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'description',
    displayFields: ['amount', 'currency', 'status', 'paid_at'],
    displayRelations: ['contact'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      contact_id: {
        column: 'contact_id',
        type: 'uuid',
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
        writable: true,
        references: 'contacts',
      },
      invoice_id: { column: 'invoice_id', type: 'uuid', labels: { en: 'invoice' } },
      /**
       * What THIS payment was charged. Correct on a row; ambiguous in a total.
       *
       * The column holds the original charge and does not move when money is
       * refunded. Showing it on a row is right — a payments report lists what
       * was taken, with refunds beside it. SUMMING it is the trap: the total
       * means either what was billed or what was kept, and on this account
       * those are 731.33 and 208.33, because 523 went back and two payments
       * were refunded in full.
       *
       * Making `amount` itself net fixed the totals and broke the rows — one
       * word meaning gross in a listing and net in a sum. So it means one thing
       * everywhere, and the two totals are named separately below.
       */
      amount: {
        column: 'amount',
        // Summing this is ambiguous — see `aggregateInstead`.
        aggregateInstead: ['charged_amount', 'net_amount'],
        writable: true,
        type: 'money',
        format: 'money',
        labels: { en: 'amount', he: 'סכום', es: 'importe' },
      },
      currency: {
        column: 'currency',
        writable: true,
        type: 'enum',
        format: 'enum',
        labels: { en: 'currency', he: 'מטבע', es: 'moneda' },
        enumValues: ['USD', 'EUR', 'ILS', 'GBP'],
      },
      status: {
        column: 'status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
        enumValues: ['pending', 'succeeded', 'failed', 'refunded'],
        enumLabels: {
          pending: { en: 'pending', he: 'ממתין', es: 'pendiente' },
          succeeded: { en: 'succeeded', he: 'הצליח', es: 'completado' },
          failed: { en: 'failed', he: 'נכשל', es: 'fallido' },
          refunded: { en: 'refunded', he: 'הוחזר', es: 'reembolsado' },
        },
      },
      description: {
        column: 'description',
        writable: true,
        type: 'string',
        labels: { en: 'description', he: 'תיאור', es: 'descripción' },
      },
      /**
       * What actually went back to the client.
       *
       * NOT the same number as `amount` on a refunded row: a partial refund
       * leaves `amount` at the original charge. Summing `amount where status =
       * refunded` therefore overstates refunds by whatever was kept, which is
       * why "how much have I refunded" needs this column and not that one.
       */
      refunded_amount: {
        column: 'refunded_amount',
        type: 'number',
        format: 'money',
        labels: { en: 'refunded amount', he: 'סכום שהוחזר', es: 'importe devuelto' },
      },
      /**
       * The ORIGINAL charge, before any refund.
       *
       * The honest answer to "how much did I bill", and the wrong answer to
       * "how much did I earn". Named so that asking for it is a decision.
       */
      /**
       * What was KEPT — the charge less anything refunded.
       *
       * The answer to "how much did I earn". A refund does not reduce the
       * charge, so a revenue total that sums charges reports money already
       * given back, and counts a fully refunded payment at full value.
       */
      net_amount: {
        column: 'amount',
        minus: 'refunded_amount',
        type: 'number',
        format: 'money',
        labels: { en: 'net revenue', he: 'הכנסה נטו', es: 'ingresos netos' },
      },
      charged_amount: {
        column: 'amount',
        type: 'number',
        format: 'money',
        labels: { en: 'amount charged', he: 'סכום שחויב', es: 'importe cobrado' },
      },
      refunded_at: {
        column: 'refunded_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'refunded at', he: 'הוחזר ב', es: 'devuelto el' },
      },
      refund_reason: {
        column: 'refund_reason',
        type: 'string',
        labels: { en: 'refund reason', he: 'סיבת ההחזר', es: 'motivo de la devolución' },
      },
      // Connects money to the work it paid for. Without these there is no path
      // from a payment to the service behind it, so "how much did I refund for
      // X" had nothing to travel.
      service_id: {
        column: 'service_id',
        type: 'uuid',
        labels: { en: 'service', he: 'שירות', es: 'servicio' },
        references: 'services',
      },
      booking_id: {
        column: 'booking_id',
        type: 'uuid',
        labels: { en: 'booking', he: 'פגישה', es: 'reserva' },
        references: 'bookings',
      },
      paid_at: {
        column: 'paid_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'paid at', he: 'שולם ב', es: 'pagado el' },
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'created', he: 'נוצר', es: 'creado' },
      },
    },

    derived: {
      /*
       * Whether this payment was given back, from the refund rows themselves.
       *
       * `refunded_amount` on this row answers "how much", but it is maintained
       * by the refund flow — a refund that settled without that write leaves a
       * payment that looks untouched. The refund rows are the record of what
       * actually happened, so the boolean is derived from them.
       */
      was_refunded: {
        type: 'boolean',
        labels: { en: 'was refunded', he: 'הוחזר', es: 'reembolsado' },
        expand: {
          relation: 'refunds',
          quantifier: 'any',
          where: [{ field: 'status', op: 'eq', value: 'succeeded' }],
        },
      },
    },

    relations: {
      refunds: {
        target: 'refunds',
        cardinality: 'many',
        via: { column: 'transaction_id', side: 'remote' },
        labels: { en: 'refunds', he: 'זיכויים', es: 'reembolsos' },
      },
      contact: {
        target: 'contacts',
        cardinality: 'one',
        via: { column: 'contact_id', side: 'local' },
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
      },
      // Money to the work it paid for. The foreign keys were always there; not
      // declaring them meant a payment could not be traced to a service, so
      // every "revenue/refunds for X" question was unanswerable regardless of
      // how it was phrased.
      service: {
        target: 'services',
        cardinality: 'one',
        via: { column: 'service_id', side: 'local' },
        labels: { en: 'service', he: 'שירות', es: 'servicio' },
      },
      booking: {
        target: 'bookings',
        cardinality: 'one',
        via: { column: 'booking_id', side: 'local' },
        labels: { en: 'booking', he: 'פגישה', es: 'reserva' },
      },
      invoice: {
        target: 'invoices',
        cardinality: 'one',
        via: { column: 'invoice_id', side: 'local' },
        labels: { en: 'invoice', he: 'חשבונית', es: 'factura' },
      },
    },

    // No actions on purpose. Money movement is recorded by Stripe webhooks and
    // by the payments UI; letting the chat write here would create records that
    // do not correspond to anything that actually happened.
    actions: {
      /**
       * Correct a recorded payment — a mistyped amount, a missing description.
       *
       * `amount` is deliberately NOT offered: changing what a payment was worth
       * after the fact rewrites the business's revenue history and desynchronises
       * it from the processor. A wrong amount is refunded and re-recorded, not
       * edited.
       */
      update: {
        labels: { en: 'correct a payment record', he: 'תקן רישום תשלום', es: 'corregir un pago' },
        risk: 'update',
        requiresConfirmation: true,
        optionalFields: ['description', 'contact_id'],
      },
      /**
       * Record money that arrived outside the system.
       *
       * Cash, a bank transfer, a card machine. `invoices.mark_paid` covers money
       * against an invoice; this is the payment that has no invoice behind it,
       * and without it such income is invisible to every revenue question.
       *
       * `status` defaults to succeeded in the handler: a payment somebody is
       * telling us about has, by definition, already happened.
       */
      create: {
        labels: { en: 'record a payment', he: 'רשום תשלום', es: 'registrar un pago' },
        risk: 'create',
        requiresConfirmation: true,
        requiredFields: ['amount'],
        optionalFields: ['contact_id', 'description', 'currency'],
      },
      /**
       * Give money back.
       *
       * The only action in this catalog that moves funds OUT, which is why it
       * leans entirely on the existing RefundService rather than touching a
       * repository: that service already resolves which processor account the
       * payment landed in, caps the amount at what remains unrefunded, and is
       * idempotent per client request so a repeated confirmation cannot become
       * a second refund.
       *
       * Never bulk. Every other risky action here is capped and fanned out;
       * refunds go one at a time, deliberately.
       */
      refund: {
        labels: { en: 'refund a payment', he: 'החזר תשלום', es: 'reembolsar un pago' },
        risk: 'delete',
        requiresConfirmation: true,
        writesRow: false,
        optionalFields: ['amount', 'reason'],
      },
    },

  },

  // ===========================================================================
  // ACTIVITIES — the timeline of what happened with a client
  // ===========================================================================
  activities: {
    table: 'crm_activities',
    labels: {
      one: { en: 'activity', he: 'פעילות', es: 'actividad' },
      many: { en: 'activity', he: 'פעילויות', es: 'actividades' },
    },
    aliases: ['notes', 'history', 'פעילויות', 'היסטוריה'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'title',
    displayFields: ['title', 'activity_type', 'activity_date'],
    displayRelations: ['contact'],
    searchableFields: ['title', 'description'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      contact_id: {
        column: 'contact_id',
        type: 'uuid',
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
        writable: true,
        references: 'contacts',
      },
      title: {
        column: 'title',
        type: 'string',
        labels: { en: 'what happened', he: 'מה קרה', es: 'qué pasó' },
        writable: true,
      },
      description: {
        column: 'description',
        type: 'string',
        labels: { en: 'details', he: 'פרטים', es: 'detalles' },
        writable: true,
      },
      activity_type: {
        column: 'activity_type',
        type: 'enum',
        format: 'enum',
        labels: { en: 'type', he: 'סוג', es: 'tipo' },
        enumValues: ['note', 'email', 'call', 'meeting', 'booking', 'payment'],
        writable: true,
      },
      activity_date: {
        column: 'activity_date',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'when', he: 'מתי', es: 'cuándo' },
        writable: true,
      },
      auto_logged: {
        column: 'auto_logged',
        type: 'boolean',
        format: 'boolean',
        labels: { en: 'logged automatically', he: 'נרשם אוטומטית', es: 'registrado automáticamente' },
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
      // "log that I called Moshe about the quote" — the single most ordinary
      // thing to say to a CRM, and until now the chat could only READ the
      // timeline it was meant to help keep.
      //
      // A pure data write with no outbound side effect, which is why it can be
      // declared straight against the repository: nothing leaves the building,
      // and a wrong note is visible and editable by the person who wrote it.
      create: {
        labels: { en: 'log an activity', he: 'רשום פעילות', es: 'registrar actividad' },
        risk: 'create',
        requiresConfirmation: true,
        // `contact_id` is REQUIRED, not optional — crm_activities.contact_id is
        // NOT NULL. Declared optional, "log that I made a call" planned fine and
        // then died at the insert. An activity with nobody attached is also not
        // much use: the whole point is that it appears on someone's timeline.
        //
        // Required here means the chat ASKS who, which is the right outcome for
        // a sentence that genuinely did not say.
        requiredFields: ['title', 'contact_id'],
        // Defaults to 'note' — most logged activity is a note.
        handlerSupplies: ['activity_type'],
        optionalFields: ['description', 'activity_type', 'activity_date'],
      },
    },
  },

  // ===========================================================================
  // INSIGHTS — what the advisor has found
  // ===========================================================================
  // 47 physical columns; only the ones an owner would ask about are exposed.
  // Detector internals (baselines, thresholds, correlation ids) are noise here.
  insights: {
    table: 'insights',
    labels: {
      one: { en: 'insight', he: 'תובנה', es: 'hallazgo' },
      many: { en: 'insights', he: 'תובנות', es: 'hallazgos' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'title',
    displayFields: ['title', 'severity', 'category', 'estimated_impact_usd', 'status'],
    searchableFields: ['title', 'description', 'recommendation'],
    // The same finding is re-inserted on every detection run, so collapse to one
    // row per detector. Without this, "what's urgent?" answers with one issue
    // repeated twenty times.
    dedupeBy: 'detector_id',
    defaultLimit: 20,
    maxLimit: 200,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      // The stable identity of a finding, across detection runs.
      detector_id: {
        column: 'detector_id',
        type: 'string',
        labels: { en: 'finding', he: 'ממצא', es: 'hallazgo' },
      },
      title: {
        column: 'title',
        type: 'string',
        labels: { en: 'title', he: 'כותרת', es: 'título' },
      },
      description: {
        column: 'description',
        type: 'string',
        labels: { en: 'what we noticed', he: 'מה שמנו לב', es: 'qué notamos' },
      },
      recommendation: {
        column: 'recommendation',
        type: 'string',
        labels: { en: 'suggested action', he: 'פעולה מומלצת', es: 'acción sugerida' },
      },
      category: {
        column: 'category',
        type: 'enum',
        format: 'enum',
        labels: { en: 'area', he: 'תחום', es: 'área' },
        enumValues: [
          'acquisition', 'conversion', 'sales', 'cash_flow',
          'retention', 'operations', 'pricing',
        ],
      },
      severity: {
        column: 'severity',
        type: 'enum',
        format: 'enum',
        labels: { en: 'severity', he: 'חומרה', es: 'gravedad' },
        enumValues: ['low', 'medium', 'high', 'critical'],
        // A business rule: "needs attention" is high OR critical, which no
        // single stored value expresses.
        semanticTerms: { urgent: ['high', 'critical'] },
      },
      status: {
        column: 'status',
        type: 'enum',
        format: 'enum',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
        enumValues: ['new', 'viewed', 'snoozed', 'dismissed', 'acted', 'automated'],
        // "Still open" means not yet dealt with, in any of its forms.
        semanticTerms: { open: ['new', 'viewed'] },
      },
      estimated_impact_usd: {
        column: 'estimated_impact_usd',
        type: 'money',
        format: 'money',
        labels: { en: 'estimated impact', he: 'השפעה משוערת', es: 'impacto estimado' },
      },
      detected_at: {
        column: 'detected_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'found', he: 'זוהה', es: 'detectado' },
      },
    },
  },

  // ===========================================================================
  // WEBSITE
  // ===========================================================================
  pages: {
    table: 'website_pages',
    labels: {
      one: { en: 'page', he: 'עמוד', es: 'página' },
      many: { en: 'pages', he: 'עמודים', es: 'páginas' },
    },
    aliases: ['website', 'site', 'אתר', 'עמודים', 'sitio'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'title',
    displayFields: ['title', 'slug', 'published', 'page_type'],
    defaultLimit: 50,
    maxLimit: 200,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      title: {
        column: 'title',
        type: 'string',
        labels: { en: 'title', he: 'כותרת', es: 'título' },
        writable: true,
      },
      slug: { column: 'slug', type: 'string', labels: { en: 'address', he: 'כתובת', es: 'dirección' } },
      page_type: {
        column: 'page_type',
        type: 'string',
        labels: { en: 'type', he: 'סוג', es: 'tipo' },
      },
      published: {
        column: 'published',
        type: 'boolean',
        format: 'boolean',
        labels: { en: 'live', he: 'פורסם', es: 'publicada' },
      },
      published_at: {
        column: 'published_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'published', he: 'פורסם ב', es: 'publicada el' },
      },
    },

    relations: {
      views: {
        target: 'page_views',
        cardinality: 'many',
        via: { column: 'page_id', side: 'remote' },
        labels: { en: 'visits', he: 'צפיות', es: 'visitas' },
      },
    },
    actions: {
      /**
       * Rename a page, or change its address.
       *
       * `create` is deliberately absent: an empty page is not something anyone
       * wants, and building one is the website generator's job, not a sentence.
       */
      /*
       * A new page, with the blocks a page is expected to have.
       *
       * The only CRUD verb this entity was missing: it could be renamed,
       * published, unpublished and deleted, but not made — so "build me a
       * landing page for the new workshop" had no capability behind it and
       * creating one meant leaving the chat.
       *
       * A homepage is created with the standard section set, exactly as the
       * website API does, because a page row with no blocks is not a page: it
       * publishes as an empty screen.
       */
      create: {
        labels: {
          en: 'create a page',
          he: 'צור עמוד חדש',
          es: 'crear una página',
        },
        risk: 'create',
        requiresConfirmation: true,
        writesRow: false,
        // A title is the one thing that cannot be derived; the slug is built
        // from it and the type defaults to a landing page.
        requiredFields: ['title'],
        optionalFields: ['page_type', 'slug', 'template_id', 'website_language'],
      },
      update: {
        labels: { en: 'rename a page', he: 'שנה שם עמוד', es: 'renombrar una página' },
        risk: 'update',
        requiresConfirmation: true,
        optionalFields: ['title'],
      },
      /** Remove a page and everything on it. */
      delete: {
        labels: { en: 'delete a page', he: 'מחק עמוד', es: 'eliminar una página' },
        risk: 'delete',
        requiresConfirmation: true,
      },
      /**
       * Put the site on the web.
       *
       * Refuses a page with no address and a page with nothing enabled on it —
       * both would go live and be worse than not publishing, invisibly. See
       * WebsitePublishService.
       */
      publish: {
        labels: { en: 'put the website live', he: 'העלה את האתר לאוויר', es: 'publicar el sitio' },
        risk: 'update',
        requiresConfirmation: true,
      },
      /** Take it off the web. The content stays; only its visibility changes. */
      unpublish: {
        labels: {
          en: 'take the website offline',
          he: 'הורד את האתר מהאוויר',
          es: 'retirar el sitio',
        },
        risk: 'update',
        requiresConfirmation: true,
      },
    },

  },

  page_views: {
    table: 'website_page_views',
    labels: {
      one: { en: 'visit', he: 'צפייה', es: 'visita' },
      many: { en: 'visits', he: 'צפיות', es: 'visitas' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'viewed_at',
    displayFields: ['viewed_at', 'device_type', 'country_code'],
    defaultLimit: 100,
    maxLimit: 1000,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      page_id: { column: 'page_id', type: 'uuid', labels: { en: 'page' } },
      viewed_at: {
        column: 'viewed_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'when', he: 'מתי', es: 'cuándo' },
      },
      referer: {
        column: 'referer',
        type: 'string',
        labels: { en: 'came from', he: 'הגיע מ', es: 'vino de' },
      },
      device_type: {
        column: 'device_type',
        type: 'string',
        labels: { en: 'device', he: 'מכשיר', es: 'dispositivo' },
      },
      country_code: {
        column: 'country_code',
        type: 'string',
        labels: { en: 'country', he: 'מדינה', es: 'país' },
      },
      // ip_hash and user_agent are deliberately NOT exposed: they identify a
      // visitor, and nothing an owner asks needs them.
    },
  },

  // ===========================================================================
  // LEAD CAPTURE LINKS
  // ===========================================================================
  links: {
    table: 'smart_links',
    labels: {
      one: { en: 'link', he: 'קישור', es: 'enlace' },
      many: { en: 'links', he: 'קישורים', es: 'enlaces' },
    },
    aliases: ['tracking links', 'קישורים', 'enlaces'],
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'name',
    displayFields: ['name', 'click_count', 'conversion_count', 'campaign'],
    searchableFields: ['name', 'campaign'],
    defaultLimit: 50,
    maxLimit: 200,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      name: {
        column: 'name',
        type: 'string',
        labels: { en: 'name', he: 'שם', es: 'nombre' },
        writable: true,
      },
      destination_url: {
        column: 'destination_url',
        type: 'string',
        format: 'url',
        labels: { en: 'points to', he: 'מפנה אל', es: 'destino' },
        writable: true,
      },
      code: { column: 'code', type: 'string', labels: { en: 'code', he: 'קוד', es: 'código' } },
      campaign: {
        column: 'campaign',
        type: 'string',
        writable: true,
        labels: { en: 'campaign', he: 'קמפיין', es: 'campaña' },
      },
      source: {
        column: 'source',
        type: 'string',
        writable: true,
        labels: { en: 'channel', he: 'ערוץ', es: 'canal' },
      },
      click_count: {
        column: 'click_count',
        type: 'number',
        labels: { en: 'clicks', he: 'קליקים', es: 'clics' },
      },
      conversion_count: {
        column: 'conversion_count',
        type: 'number',
        labels: { en: 'signups', he: 'הרשמות', es: 'registros' },
      },
      is_active: {
        column: 'is_active',
        type: 'boolean',
        format: 'boolean',
        labels: { en: 'active', he: 'פעיל', es: 'activo' },
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'created', he: 'נוצר', es: 'creado' },
      },
    },
    actions: {
      /**
       * "Make me a link for the Instagram campaign."
       *
       * `code` is neither writable nor required: the short code is generated,
       * because one that collided with an existing link would quietly send
       * people to somebody else's destination.
       */
      create: {
        labels: { en: 'create a tracking link', he: 'צור קישור מעקב', es: 'crear un enlace' },
        risk: 'create',
        requiresConfirmation: true,
        requiredFields: ['destination_url'],
        // The short code is generated with a collision retry by the repository.
        handlerSupplies: ['code'],
        optionalFields: ['name', 'campaign', 'source'],
      },
      update: {
        labels: { en: 'update a link', he: 'עדכן קישור', es: 'actualizar un enlace' },
        risk: 'update',
        requiresConfirmation: true,
        optionalFields: ['name', 'campaign', 'source', 'destination_url'],
      },
      /**
       * Turns the link OFF rather than deleting it.
       *
       * A shared link is out in the world — on a card, in a post, in somebody's
       * messages. Deleting the row makes every one of those a dead end and takes
       * the click history with it, which is the record of whether the campaign
       * worked at all.
       */
      deactivate: {
        labels: { en: 'turn off a link', he: 'כבה קישור', es: 'desactivar un enlace' },
        risk: 'update',
        requiresConfirmation: true,
      },
    },

  },

  /**
   * Individual clicks on a smart link.
   *
   * THE FIRST RELATION-SCOPED ENTITY. `smart_link_clicks` has no `user_id` — a
   * click belongs to a link, and only the link knows whose it is. The compiler
   * reaches ownership through an INNER join on `link`; see `userScopeEmbed`.
   *
   * `links.click_count` is a running total kept on the link itself. This entity
   * is the individual events behind it, which is what makes "clicks last week"
   * or "clicks by country" answerable at all.
   */
  link_clicks: {
    table: 'smart_link_clicks',
    meaning: 'individual click events on a smart link — one row per click, unlike links.click_count which is the running total',
    labels: {
      one: { en: 'click', he: 'קליק', es: 'clic' },
      many: { en: 'clicks', he: 'קליקים', es: 'clics' },
    },
    userScope: { kind: 'relation', relation: 'link' },
    // A click has no name of its own; when it happened is what identifies it.
    labelField: 'clicked_at',
    displayFields: ['clicked_at', 'device_type', 'country_code', 'converted'],
    displayRelations: ['link'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      link_id: { column: 'smart_link_id', type: 'uuid', labels: { en: 'link' }, references: 'links' },
      clicked_at: {
        column: 'clicked_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'clicked at', he: 'זמן קליק', es: 'hora del clic' },
      },
      device_type: {
        column: 'device_type',
        type: 'string',
        labels: { en: 'device', he: 'מכשיר', es: 'dispositivo' },
      },
      country_code: {
        column: 'country_code',
        type: 'string',
        labels: { en: 'country', he: 'מדינה', es: 'país' },
      },
      referer: {
        column: 'referer',
        type: 'string',
        labels: { en: 'came from', he: 'הגיע מ', es: 'procedencia' },
      },
      converted: {
        column: 'converted',
        type: 'boolean',
        format: 'boolean',
        labels: { en: 'converted', he: 'הומר', es: 'convertido' },
      },
      converted_at: {
        column: 'converted_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'converted at', he: 'זמן המרה', es: 'hora de conversión' },
      },
    },

    relations: {
      link: { target: 'links', cardinality: 'one', via: { column: 'smart_link_id', side: 'local' }, labels: { en: 'link' } },
    },
  },

  /**
   * The business itself — and the working hours clients can book into.
   *
   * ONE row per user, so nothing here takes a target: there is only ever the
   * caller's own profile to act on.
   *
   * `scheduling_availability` is a JSON map of weekday → time ranges, and it is
   * deliberately NOT exposed as a field. A json column renders as
   * "[object Object]", and no planner should be authoring that shape by hand — a
   * fabricated key would silently close a day the business is open. The typed
   * actions below are the only way in: they read the map, edit one day, and
   * write it back whole.
   */
  business_profile: {
    table: 'business_profiles',
    meaning: 'this business itself — its name, its trade, and the weekly hours clients can book',
    labels: {
      one: { en: 'business profile', he: 'פרופיל העסק', es: 'perfil del negocio' },
      many: { en: 'business profile', he: 'פרופיל העסק', es: 'perfil del negocio' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'company_name',
    displayFields: ['company_name', 'vertical'],
    defaultLimit: 1,
    maxLimit: 1,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      company_name: {
        column: 'company_name',
        type: 'string',
        labels: { en: 'business name', he: 'שם העסק', es: 'nombre del negocio' },
      },
      vertical: {
        column: 'vertical',
        type: 'string',
        labels: { en: 'trade', he: 'תחום', es: 'sector' },
      },
    },

    actions: {
      /**
       * "Send my accountant last quarter's ledger."
       *
       * ───────────────────────────────────────────────────────────────────────
       * The ledger is a REPORT, not a row: it is assembled from payments,
       * refunds and invoices over a period, with tax and fee splits and
       * per-currency totals. It had exactly one way out of the platform — an
       * authenticated browser download from the export modal — so nothing on the
       * server could ask for it and no automation could be built on it.
       *
       * It lives on `business_profile` rather than on a `reports` entity of its
       * own because every entity in this catalog must name a real table that the
       * physical schema validates against, and a derived report has no table;
       * declaring one would fail the catalog build at import. `business_profile`
       * is the singleton that already carries the actions which are ABOUT the
       * business rather than about a row — which is exactly what a ledger is.
       *
       * `risk: 'read'` and no confirmation: this only produces the report.
       * Emailing it is a separate, confirmed `contacts.send` step, so the
       * dangerous half stays behind the gate that already guards sends rather
       * than being smuggled in behind a read.
       *
       * The parameters mirror the export modal one-for-one, so the chat, the
       * kernel and the download produce the same file from the same request.
       * `period` accepts the modal's presets plus `last_quarter` and
       * `last_year`, which are what an accountant actually asks for; supplying
       * `from`/`to` instead is the modal's "custom".
       * ───────────────────────────────────────────────────────────────────────
       */
      export_ledger: {
        labels: {
          en: 'export the ledger for a period (for the accountant)',
          he: 'הפקת דוח הנהלת חשבונות לתקופה (לרואה החשבון)',
          es: 'exportar el libro mayor de un período (para el contador)',
        },
        risk: 'read',
        requiresConfirmation: false,
        // Parameters, not columns of business_profiles.
        writesRow: false,
        // One profile per user: there is nothing to point at.
        needsTarget: false,
        /*
         * Nothing is required.
         *
         * "Export the ledger" with no period is a complete request — it means
         * the current month, which is what the modal opens on. Demanding a
         * period would turn the commonest phrasing into a clarifying question.
         */
        optionalFields: [
          'period',
          'from',
          'to',
          'format',
          'include_payments',
          'include_refunds',
          'include_invoices',
          'include_fees',
          'include_tax',
          'include_references',
          // What to hand back beyond the totals: the ledger rows themselves, and
          // the rendered file as base64 — the latter drops straight into an
          // email attachment, which is what makes "send the accountant the
          // ledger" composable without a download nobody server-side can fetch.
          'include_rows',
          'include_file',
        ],
      },
      /**
       * "Change Tuesday to 9-2 only."
       *
       * Replaces one weekday's hours and leaves the rest of the week alone.
       * Whole-day replacement rather than appending a range, because that is
       * what the sentence means: naming the hours a day HAS is a statement about
       * the whole day, not an addition to it.
       */
      set_availability: {
        labels: {
          en: 'set the working hours for one weekday',
          he: 'קבע שעות עבודה ליום בשבוע',
          es: 'fijar el horario de un día de la semana',
        },
        risk: 'update',
        requiresConfirmation: true,
        writesRow: false,
        // One profile per user: there is nothing to point at.
        needsTarget: false,
        requiredFields: ['day', 'start', 'end'],
      },
      /**
       * "I don't work Fridays any more." Empties one day, which is what closed
       * means.
       *
       * The label says "stop working on a day" rather than "close a day":
       * offered the terser wording the planner reached for `set_availability`
       * with 00:00–00:00 instead, which is not a working day at all.
       */
      clear_availability: {
        labels: {
          en: 'stop working on a day (close it entirely)',
          he: 'הפסק לעבוד ביום מסוים (סגור אותו)',
          es: 'dejar de trabajar un día (cerrarlo)',
        },
        risk: 'update',
        requiresConfirmation: true,
        writesRow: false,
        // One profile per user: there is nothing to point at.
        needsTarget: false,
        requiredFields: ['day'],
      },
    },
  },

  /**
   * The sections a website page is built from — what an owner means by "my
   * about section".
   *
   * RELATION-SCOPED, like link_clicks: `website_blocks` carries no `user_id`,
   * and only its page knows whose it is.
   *
   * `content` is deliberately not a writable field. It is a JSON object whose
   * shape depends on the section type — an FAQ holds its questions in there —
   * and a planner writing it wholesale would erase everything it did not think
   * to mention. WebsiteSectionService merges named keys instead.
   */
  sections: {
    table: 'website_blocks',
    meaning: 'the sections that make up a website page, in the order they appear',
    labels: {
      one: { en: 'section', he: 'מקטע', es: 'sección' },
      many: { en: 'sections', he: 'מקטעים', es: 'secciones' },
    },
    aliases: ['blocks', 'מקטעים', 'בלוקים', 'secciones'],
    userScope: { kind: 'relation', relation: 'page' },
    labelField: 'block_type',
    displayFields: ['block_type', 'position', 'enabled'],
    searchableFields: ['block_type'],
    defaultLimit: 50,
    maxLimit: 100,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      page_id: { column: 'page_id', type: 'uuid', labels: { en: 'page' }, references: 'pages' },
      block_type: {
        column: 'block_type',
        type: 'enum',
        format: 'enum',
        labels: { en: 'section', he: 'סוג מקטע', es: 'sección' },
        // Declared so the planner emits the STORED token.
        //
        // Left as a free string, "hide the FAQ section" produced
        // block_type = "FAQ" — which matches nothing, because the value on the
        // row is `faq`. The section would simply not be found, and the user
        // would be told they have no FAQ while looking at one.
        enumValues: [
          'header',
          'hero',
          'about',
          'services',
          'process',
          'testimonials',
          'faq',
          'cta',
          'contact_form',
          'booking_widget',
          'footer',
        ],
        enumLabels: {
          header: { en: 'header', he: 'כותרת עליונה', es: 'encabezado' },
          hero: { en: 'hero banner', he: 'באנר ראשי', es: 'banner principal' },
          about: { en: 'about', he: 'אודות', es: 'sobre nosotros' },
          services: { en: 'services', he: 'שירותים', es: 'servicios' },
          process: { en: 'how it works', he: 'איך זה עובד', es: 'cómo funciona' },
          testimonials: { en: 'testimonials', he: 'המלצות', es: 'testimonios' },
          faq: { en: 'FAQ', he: 'שאלות נפוצות', es: 'preguntas frecuentes' },
          cta: { en: 'call to action', he: 'קריאה לפעולה', es: 'llamada a la acción' },
          contact_form: { en: 'contact form', he: 'טופס יצירת קשר', es: 'formulario de contacto' },
          booking_widget: { en: 'booking widget', he: 'קביעת פגישה', es: 'reservas' },
          footer: { en: 'footer', he: 'כותרת תחתונה', es: 'pie de página' },
        },
      },
      position: {
        column: 'position',
        type: 'number',
        labels: { en: 'order on the page', he: 'סדר בעמוד', es: 'orden en la página' },
      },
      enabled: {
        column: 'enabled',
        type: 'boolean',
        format: 'boolean',
        labels: { en: 'shown', he: 'מוצג', es: 'visible' },
      },
    },

    relations: {
      page: {
        target: 'pages',
        cardinality: 'one',
        via: { column: 'page_id', side: 'local' },
        labels: { en: 'page', he: 'עמוד', es: 'página' },
      },
    },

    actions: {
      /**
       * "Rewrite the about section's text."
       *
       * ONE named field. The generator returns a string, so a whole-section
       * rewrite would write that string over an object and take an FAQ's
       * questions with it. Refuses a field the section does not have, rather
       * than adding a key the renderer ignores and reporting success.
       */
      regenerate: {
        labels: {
          en: 'rewrite part of a section with AI',
          he: 'שכתב חלק ממקטע באמצעות AI',
          es: 'reescribir parte de una sección con IA',
        },
        risk: 'update',
        requiresConfirmation: true,
        writesRow: false,
        requiredFields: ['field'],
      },
      /**
       * Add a section to a page.
       *
       * Appended at the end: "add a testimonials section" says nothing about
       * where, and inserting it mid-page would silently shift everything below.
       */
      add: {
        labels: { en: 'add a section to a page', he: 'הוסף מקטע לעמוד', es: 'añadir una sección' },
        risk: 'create',
        requiresConfirmation: true,
        writesRow: false,
        requiredFields: ['page_id', 'block_type'],
        optionalFields: ['heading', 'text'],
      },
      /**
       * Remove a section and its words for good. `hide` is the reversible
       * option and the one to prefer.
       */
      delete: {
        labels: { en: 'delete a section', he: 'מחק מקטע', es: 'eliminar una sección' },
        risk: 'delete',
        requiresConfirmation: true,
        writesRow: false,
      },
      /**
       * Move a section up or down. Relative rather than an absolute position,
       * because that is how people say it and it needs no knowledge of the
       * current numbering.
       */
      move: {
        labels: { en: 'move a section up or down', he: 'הזז מקטע', es: 'mover una sección' },
        risk: 'update',
        requiresConfirmation: true,
        writesRow: false,
        requiredFields: ['direction'],
      },
      /**
       * "Change the about section to say …"
       *
       * Heading and body are named separately rather than as raw JSON, and the
       * service decides which key each one lands in by looking at the section —
       * a hero calls its heading `headline`, an about calls it `title`.
       */
      set_content: {
        labels: {
          en: "change a section's wording",
          he: 'שנה את התוכן של מקטע',
          es: 'cambiar el texto de una sección',
        },
        risk: 'update',
        requiresConfirmation: true,
        writesRow: false,
        optionalFields: ['heading', 'text'],
      },
      /** "Take the FAQ off the site for now." Reversible, and the words survive. */
      hide: {
        labels: {
          en: 'hide a section from the site',
          he: 'הסתר מקטע מהאתר',
          es: 'ocultar una sección del sitio',
        },
        risk: 'update',
        requiresConfirmation: true,
        writesRow: false,
      },
      /** Put a hidden section back. */
      show: {
        labels: {
          en: 'show a hidden section again',
          he: 'הצג מקטע מוסתר',
          es: 'mostrar una sección oculta',
        },
        risk: 'update',
        requiresConfirmation: true,
        writesRow: false,
      },
    },
  },

  /**
   * The stages a contact moves through, as THIS business defines them.
   *
   * Already read at query time — `contacts.stage` declares this table as its
   * `enumSource`, which is how "my leads" resolves correctly for a tutor whose
   * stages are inquiry/family_enrolled and a consultant whose stages are
   * closed_won/active_project. Exposing it as an entity makes the vocabulary
   * itself visible and editable rather than only implied.
   */
  pipeline_stages: {
    table: 'crm_pipeline_stages',
    meaning: 'the stages this business moves contacts through, in order',
    labels: {
      one: { en: 'pipeline stage', he: 'שלב בתהליך', es: 'etapa' },
      many: { en: 'pipeline stages', he: 'שלבים בתהליך', es: 'etapas' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'stage_label',
    displayFields: ['stage_label', 'position', 'stage_type'],
    searchableFields: ['stage_label'],
    defaultLimit: 50,
    maxLimit: 100,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      stage_key: {
        column: 'stage_key',
        type: 'string',
        labels: { en: 'key', he: 'מזהה', es: 'clave' },
        writable: true,
      },
      stage_label: {
        column: 'stage_label',
        type: 'string',
        labels: { en: 'name', he: 'שם', es: 'nombre' },
        writable: true,
      },
      stage_type: {
        column: 'stage_type',
        type: 'string',
        labels: { en: 'kind', he: 'סוג', es: 'tipo' },
        writable: true,
      },
      position: {
        column: 'position',
        type: 'number',
        labels: { en: 'order', he: 'סדר', es: 'orden' },
        writable: true,
      },
    },

    actions: {
      /**
       * Add a stage to the pipeline.
       *
       * `stage_type` classifies it into the stable vocabulary the semantic layer
       * reasons about — lead, prospect, client and so on — which is what lets
       * "my leads" keep working after a business invents a stage of its own.
       */
      create: {
        labels: { en: 'add a pipeline stage', he: 'הוסף שלב', es: 'añadir una etapa' },
        risk: 'create',
        requiresConfirmation: true,
        requiredFields: ['stage_label'],
        // The business vertical and the ordering come from the account, and the
        // key is derived from the label — none is a question worth asking.
        handlerSupplies: ['vertical', 'stage_key', 'position'],
        optionalFields: ['stage_type', 'position'],
      },
    },
  },

  // ===========================================================================
  // CHANNEL REACH — what the outside world saw
  // ===========================================================================
  /**
   * Daily per-platform reach, synced from the connected marketing accounts.
   *
   * One row per platform per day, so every question about it is an aggregate:
   * summing `reach` over a month is the answer to "how many people saw me on
   * Facebook", and the row for a single day rarely means anything on its own.
   */
  channel_metrics: {
    table: 'channel_metrics_daily',
    meaning: 'daily reach and engagement per connected platform — one row per platform per day, so totals need summing over a period',
    labels: {
      one: { en: 'channel day', he: 'יום ערוץ', es: 'día de canal' },
      many: { en: 'channel metrics', he: 'נתוני ערוצים', es: 'métricas de canal' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'platform',
    displayFields: ['platform', 'metric_date', 'reach', 'impressions', 'engagements'],
    searchableFields: ['platform'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      platform: {
        column: 'platform',
        type: 'string',
        labels: { en: 'platform', he: 'פלטפורמה', es: 'plataforma' },
      },
      metric_date: {
        column: 'metric_date',
        type: 'date',
        format: 'date',
        labels: { en: 'date', he: 'תאריך', es: 'fecha' },
      },
      reach: {
        column: 'reach',
        type: 'number',
        labels: { en: 'people reached', he: 'אנשים שנחשפו', es: 'personas alcanzadas' },
      },
      impressions: {
        column: 'impressions',
        type: 'number',
        labels: { en: 'impressions', he: 'חשיפות', es: 'impresiones' },
      },
      engagements: {
        column: 'engagements',
        type: 'number',
        labels: { en: 'engagements', he: 'אינטראקציות', es: 'interacciones' },
      },
      profile_views: {
        column: 'profile_views',
        type: 'number',
        labels: { en: 'profile views', he: 'צפיות בפרופיל', es: 'vistas del perfil' },
      },
      website_clicks: {
        column: 'website_clicks',
        type: 'number',
        labels: { en: 'website clicks', he: 'קליקים לאתר', es: 'clics al sitio' },
      },
      followers_count: {
        column: 'followers_count',
        type: 'number',
        labels: { en: 'followers', he: 'עוקבים', es: 'seguidores' },
      },
      visitors: {
        column: 'visitors',
        type: 'number',
        labels: { en: 'visitors', he: 'מבקרים', es: 'visitantes' },
      },
    },
  },

  /**
   * Which marketing accounts are connected, and whether they are still syncing.
   *
   * `account_token` is DELIBERATELY NOT DECLARED. It is an OAuth credential, and
   * the compiler can only select fields the catalog names — so leaving it out
   * makes it unreachable by any question, phrased any way, rather than relying on
   * a `readable: false` flag somebody might later flip. The safest field is the
   * one that was never declared.
   *
   * No relation to `channel_metrics`: they line up on `platform` + `account_id`,
   * which is not a foreign key, and PostgREST cannot embed across one. Both are
   * scoped by `user_id` and filterable by platform, which answers the questions
   * people actually ask of them.
   */
  channel_connections: {
    table: 'channel_connections',
    meaning: 'the marketing accounts connected to this business, and the health of their data sync',
    labels: {
      one: { en: 'connected account', he: 'חשבון מחובר', es: 'cuenta conectada' },
      many: { en: 'connected accounts', he: 'חשבונות מחוברים', es: 'cuentas conectadas' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'account_name',
    displayFields: ['account_name', 'platform', 'last_synced_at', 'insights_enabled'],
    searchableFields: ['account_name', 'platform'],
    defaultLimit: 50,
    maxLimit: 100,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      account_name: {
        column: 'account_name',
        type: 'string',
        labels: { en: 'account', he: 'חשבון', es: 'cuenta' },
      },
      platform: {
        column: 'platform',
        type: 'string',
        labels: { en: 'platform', he: 'פלטפורמה', es: 'plataforma' },
      },
      insights_enabled: {
        column: 'insights_enabled',
        type: 'boolean',
        format: 'boolean',
        labels: { en: 'insights on', he: 'תובנות פעילות', es: 'informes activos' },
      },
      connected_at: {
        column: 'connected_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'connected', he: 'חובר', es: 'conectado' },
      },
      last_synced_at: {
        column: 'last_synced_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'last synced', he: 'סנכרון אחרון', es: 'última sincronización' },
      },
      last_sync_error: {
        column: 'last_sync_error',
        type: 'string',
        labels: { en: 'sync error', he: 'שגיאת סנכרון', es: 'error de sincronización' },
      },
    },
    actions: {
      /**
       * Disconnect an account and delete the history that came with it.
       *
       * Not reversible: the stored metrics go too, because leaving them would
       * mean numbers on the dashboard from an account the owner can no longer
       * reach a reconnect button for. Deliberately at delete risk.
       */
      disconnect: {
        labels: {
          en: 'disconnect an account and delete its data',
          he: 'נתק חשבון ומחק את הנתונים שלו',
          es: 'desconectar una cuenta y borrar sus datos',
        },
        risk: 'delete',
        requiresConfirmation: true,
        writesRow: false,
      },
      /**
       * "Refresh my Facebook numbers."
       *
       * Pulls fresh metrics for EVERY connected account, not one — the sync
       * service works per user, and refreshing a single channel while leaving
       * the others stale would make the totals beside them disagree.
       *
       * No target for the same reason.
       */
      sync: {
        labels: {
          en: 'refresh the numbers from connected accounts',
          he: 'רענן נתונים מהחשבונות המחוברים',
          es: 'actualizar los datos de las cuentas conectadas',
        },
        risk: 'update',
        requiresConfirmation: false,
        writesRow: false,
        needsTarget: false,
      },
    },

  },

  // ===========================================================================
  // AUTOMATIONS — the agents the owner built, and whether they are working
  // ===========================================================================
  agents: {
    table: 'agents',
    meaning: 'the automations this business has set up — the definitions, not their runs',
    labels: {
      one: { en: 'automation', he: 'אוטומציה', es: 'automatización' },
      many: { en: 'automations', he: 'אוטומציות', es: 'automatizaciones' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'name',
    displayFields: ['name', 'status', 'last_run'],
    searchableFields: ['name', 'description'],
    defaultLimit: 50,
    maxLimit: 200,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      name: {
        column: 'agent_name',
        type: 'string',
        labels: { en: 'name', he: 'שם', es: 'nombre' },
      },
      description: {
        column: 'description',
        type: 'string',
        labels: { en: 'description', he: 'תיאור', es: 'descripción' },
      },
      status: {
        column: 'status',
        type: 'string',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
      },
      last_run: {
        column: 'last_run',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'last run', he: 'ריצה אחרונה', es: 'última ejecución' },
      },
      next_run: {
        column: 'next_run',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'next run', he: 'ריצה הבאה', es: 'próxima ejecución' },
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'created', he: 'נוצר', es: 'creado' },
      },
    },

    relations: {
      runs: { target: 'agent_runs', cardinality: 'many', via: { column: 'agent_id', side: 'remote' }, labels: { en: 'runs' } },
    },
  },

  agent_runs: {
    table: 'agent_executions',
    meaning: 'every time an automation actually ran, and whether it succeeded',
    labels: {
      one: { en: 'automation run', he: 'ריצת אוטומציה', es: 'ejecución' },
      many: { en: 'automation runs', he: 'ריצות אוטומציה', es: 'ejecuciones' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'started_at',
    displayFields: ['started_at', 'status', 'duration_ms'],
    displayRelations: ['agent'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      agent_id: { column: 'agent_id', type: 'uuid', labels: { en: 'automation' }, references: 'agents' },
      status: {
        column: 'status',
        type: 'string',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
      },
      started_at: {
        column: 'started_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'started', he: 'התחיל', es: 'iniciada' },
      },
      completed_at: {
        column: 'completed_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'finished', he: 'הסתיים', es: 'finalizada' },
      },
      duration_ms: {
        column: 'execution_duration_ms',
        type: 'number',
        labels: { en: 'duration (ms)', he: 'משך (מ״ש)', es: 'duración (ms)' },
      },
      error_message: {
        column: 'error_message',
        type: 'string',
        labels: { en: 'error', he: 'שגיאה', es: 'error' },
      },
      created_at: {
        column: 'created_at',
        type: 'datetime',
        format: 'date',
        labels: { en: 'created', he: 'נוצר', es: 'creado' },
      },
    },

    relations: {
      agent: { target: 'agents', cardinality: 'one', via: { column: 'agent_id', side: 'local' }, labels: { en: 'automation' } },
    },
  },

  // ===========================================================================
  // EMAIL DELIVERY
  // ===========================================================================
  emails: {
    table: 'email_sends',
    labels: {
      one: { en: 'email', he: 'אימייל', es: 'correo' },
      many: { en: 'emails', he: 'אימיילים', es: 'correos' },
    },
    userScope: { kind: 'column', column: 'user_id' },
    labelField: 'subject',
    displayFields: ['subject', 'to_email', 'status', 'sent_at'],
    displayRelations: ['contact'],
    searchableFields: ['subject', 'to_email'],
    defaultLimit: 50,
    maxLimit: 500,

    fields: {
      id: { column: 'id', type: 'uuid', labels: { en: 'ID' } },
      contact_id: { column: 'contact_id', type: 'uuid', labels: { en: 'contact' } },
      subject: {
        column: 'subject',
        type: 'string',
        labels: { en: 'subject', he: 'נושא', es: 'asunto' },
      },
      to_email: {
        column: 'to_email',
        type: 'string',
        format: 'email',
        labels: { en: 'sent to', he: 'נשלח אל', es: 'enviado a' },
      },
      status: {
        column: 'status',
        type: 'string',
        labels: { en: 'status', he: 'סטטוס', es: 'estado' },
      },
      sent_at: {
        column: 'sent_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'sent', he: 'נשלח', es: 'enviado' },
      },
      opened_at: {
        column: 'opened_at',
        type: 'datetime',
        format: 'datetime',
        labels: { en: 'opened', he: 'נפתח', es: 'abierto' },
      },
      open_count: {
        column: 'open_count',
        type: 'number',
        labels: { en: 'opens', he: 'פתיחות', es: 'aperturas' },
      },
      click_count: {
        column: 'click_count',
        type: 'number',
        labels: { en: 'clicks', he: 'קליקים', es: 'clics' },
      },
      // body_html is not exposed: it is large, and no question needs the markup.
    },

    relations: {
      contact: {
        target: 'contacts',
        cardinality: 'one',
        via: { column: 'contact_id', side: 'local' },
        labels: { en: 'contact', he: 'איש קשר', es: 'contacto' },
      },
    },
  },
};
