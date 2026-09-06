/**
 * Write execution for BizQL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS DOES NOT USE THE QUERY COMPILER
 *
 * Reads go through a generic compiler because a generic read is safe: the worst
 * outcome is the wrong rows come back. A generic WRITE is a different animal —
 * an LLM-authored `UPDATE ... WHERE` with a missing predicate is unrecoverable.
 *
 * So writes route through the existing repositories instead. That buys their
 * validation, their soft-delete semantics, their cascade handling and their
 * `user_id` filtering, all of which are already reviewed and in production. The
 * cost is a small dispatch table per entity; the benefit is that the AI cannot
 * invent a write path that nobody has looked at.
 *
 * Everything here is also gated by the catalog: an action that is not declared
 * simply does not exist, and a field that is not `writable: true` cannot be set.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/mutate
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmTaskRepository } from '@/lib/repositories/CRMTaskRepository';
import { settleInvoicePaid } from '@/lib/payments/invoiceSettlement';
import {
  paymentInvoiceRepository,
  paymentTransactionRepository,
} from '@/lib/repositories/PaymentRepository';
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import {
  schedulingBookingRepository,
  schedulingServiceRepository,
} from '@/lib/repositories/SchedulingRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import {
  cancelBooking,
  createBooking,
  rescheduleBooking,
} from '@/lib/services/BookingLifecycleService';
import {
  CATALOG,
  type ResolvedEntity,
  type ResolvedField,
} from '@/lib/business-os/catalog';
import { supabaseServer } from '@/lib/supabaseServer';
import { compileAndRunFind } from '../compiler';
import { resolveDateExpr } from '../dates';
import {
  BizQLValidationError,
  MissingFieldsError,
  isDateExpr,
  type MutateQuery,
  type MutateResult,
  type QueryContext,
  type QueryRow,
} from '../types';

const logger = createLogger({ module: 'BizQLMutate' });

/** Result shape shared by every repository in this codebase. */
type RepoResult<T> = { data: T | null; error: Error | null };

type Handler = (
  query: MutateQuery,
  data: Record<string, unknown>,
  ctx: QueryContext
) => Promise<RepoResult<unknown>>;

function requireTargetId(query: MutateQuery): string {
  const target = query.target as { id?: string; find?: unknown } | undefined;

  if (target?.find) {
    // A described target must be resolved to a concrete id BEFORE it reaches the
    // executor — that is what makes the user confirm a specific row. Reaching
    // here with one unresolved means a caller skipped resolveMutateTarget, and
    // executing it would mean writing to a row nobody was shown.
    throw new BizQLValidationError([
      `'${query.entity}.${query.action}' still has an unresolved target. ` +
        `Resolve it with resolveMutateTarget before executing.`,
    ]);
  }

  if (!target?.id) {
    throw new BizQLValidationError([
      `'${query.entity}.${query.action}' needs an explicit target id.`,
    ]);
  }
  return target.id;
}

/**
 * Dispatch table: catalog action → repository call.
 *
 * Adding an action means adding it to the catalog AND here. That is deliberate
 * friction: it forces a human to decide which reviewed repository method a new
 * write maps onto, rather than letting one be synthesised.
 */

/**
 * A stable key for a pipeline stage whose label may be in any script.
 *
 * Latin labels keep a readable key. Anything else — Hebrew, Arabic, Cyrillic —
 * gets a generated one, because a transliteration table would be a per-language
 * guess and a blank key is worse than an opaque one: `stage_key` is what
 * `contacts.stage` filters on, and two blanks are the same stage.
 */
function deriveStageKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  return slug || `stage_${randomUUID().slice(0, 8)}`;
}

const HANDLERS: Record<string, Record<string, Handler>> = {
  contacts: {
    create: async (_q, data, ctx) =>
      crmContactRepository.create({
        user_id: ctx.userId,
        ...data,
      } as Parameters<typeof crmContactRepository.create>[0]) as Promise<RepoResult<unknown>>,

    update: async (q, data, ctx) =>
      crmContactRepository.update(requireTargetId(q), ctx.userId, data) as Promise<
        RepoResult<unknown>
      >,

    delete: async (q, _data, ctx) =>
      crmContactRepository.delete(requireTargetId(q), ctx.userId) as Promise<
        RepoResult<unknown>
      >,

    /*
     * The statement: open invoices and payments for one client.
     *
     * Returns data and sends nothing — the caller composes the wording and, if
     * it wants, hands it to `send` afterwards. Keeping the two apart means the
     * figures can be fetched, checked and shown without anything leaving.
     */
    statement: async (q, _data, ctx) => {
      const contactId = requireTargetId(q);
      const { buildContactStatement } = await import('@/lib/payments/contactStatement');

      const statement = await buildContactStatement({ userId: ctx.userId, contactId });
      return { data: statement as unknown as Record<string, unknown>, error: null };
    },

    /**
     * Email one contact.
     *
     * The same sender the BULK path has always used. `contacts.send` was
     * declared with `allowBulk`, so "email everyone who owes me money" worked
     * through ForEachExecutor while "email Ofir" — the simpler thing — failed as
     * unimplemented. The capability was present and unreachable, differing only
     * in how many people it was aimed at.
     *
     * Branding is resolved so a one-off email looks like the business that sent
     * it, exactly as a fan-out does.
     */
    send: async (q, data, ctx) => {
      const contactId = requireTargetId(q);

      const { data: contact, error } = await crmContactRepository.findById(contactId, ctx.userId);
      if (error) return { data: null, error };
      if (!contact) return { data: null, error: new Error('Contact not found') };

      if (!contact.email) {
        return {
          data: null,
          error: new Error(
            `${contact.first_name || 'That contact'} has no email address on file.`
          ),
        };
      }

      // Imported here, not at module scope: branding reaches the website
      // repositories, and a write dispatch table should stay cheap to load.
      const { resolveEmailBranding } = await import('@/lib/email/branding');
      const { performEmail } = await import('./emailSend');

      // QueryContext carries no locale, so branding resolves the business's own
      // default — which is the right language for mail the business is sending.
      const branding = await resolveEmailBranding(ctx.userId).catch(() => undefined);

      const outcome = await performEmail(
        {
          to: contact.email,
          subject: data.subject,
          body: data.body,
          // Present only when the caller supplied files; `performEmail` refuses
          // malformed ones rather than dropping them silently.
          ...(data.attachments ? { attachments: data.attachments } : {}),
        },
        branding
      );

      if (!outcome.ok) {
        return { data: null, error: new Error(outcome.error || 'Email was not sent') };
      }

      // The contact's timeline should show it, the same way an invoice send does.
      crmActivityRepository
        .create({
          user_id: ctx.userId,
          contact_id: contactId,
          activity_type: 'email',
          title: String(data.subject),
          description: String(data.body).slice(0, 500),
          auto_logged: true,
          source_capability: 'chat',
          source_entity_id: contactId,
        } as Parameters<typeof crmActivityRepository.create>[0])
        .catch((err) =>
          logger.warn({ err, contactId }, 'Activity logging failed (non-blocking)')
        );

      return { data: contact, error: null };
    },
  },

  invoices: {
    // Declared in the catalog since day one but never wired, so "create an
    // invoice for Ofir" planned correctly and then failed as unimplemented.
    // Failing loudly was right; leaving it unimplemented was not.
    create: async (_q, data, ctx) => {
      // `invoice_number` is NOT NULL and nothing was generating it, so this
      // action failed on every single call — "תפתח חשבונית" planned perfectly and
      // died at the insert with a not-null violation. It was declared, tested by
      // dry run, and never once executed: a dry run validates the plan and never
      // reaches this handler, which is exactly how it shipped broken.
      //
      // The same sequence in createBookingInvoice has always been right; this is
      // the one place that skipped it.
      const numbered = await paymentInvoiceRepository.getNextInvoiceNumber(ctx.userId);
      if (numbered.error) return { data: null, error: numbered.error };

      // The client's own details, so the invoice can be rendered and sent
      // without a second lookup. A chat-raised invoice is a draft until somebody
      // sends it, which is a separate, deliberate act.
      let clientName: string | null = null;
      let clientEmail: string | null = null;

      if (typeof data.contact_id === 'string') {
        const contact = await crmContactRepository.findById(data.contact_id, ctx.userId);
        if (contact.data) {
          clientName =
            `${contact.data.first_name || ''} ${contact.data.last_name || ''}`.trim() || null;
          clientEmail = contact.data.email ?? null;
        }
      }

      return paymentInvoiceRepository.create({
        user_id: ctx.userId,
        invoice_number: numbered.data!,
        status: 'draft',
        currency: 'USD',
        client_name: clientName,
        client_email: clientEmail,
        ...data,
      } as Parameters<typeof paymentInvoiceRepository.create>[0]) as Promise<
        RepoResult<unknown>
      >;
    },

    /**
     * Marking an invoice paid records a PAYMENT, not just a status.
     *
     * This called `markAsPaid` alone, which set `payment_invoices.status` and
     * nothing else — so the invoice looked settled while no
     * `payment_transactions` row existed. Revenue reads transactions, so that
     * money was invisible; refunds read transactions, so it could never be
     * given back. The same hole was closed in the invoice PUT route and the
     * retry service; this was the third way in.
     *
     * `settleInvoicePaid` writes the payment first and the invoice second, so a
     * failure leaves the invoice unpaid rather than settled-with-nothing-behind-it.
     */
    mark_paid: async (q, data, ctx) => {
      const invoiceId = requireTargetId(q);

      const { data: invoice } = await supabaseServer
        .from('payment_invoices')
        .select('id, contact_id, amount, currency, invoice_number')
        .eq('id', invoiceId)
        .eq('user_id', ctx.userId)
        .maybeSingle();

      if (!invoice) {
        return { data: null, error: new Error('Invoice not found') } as RepoResult<unknown>;
      }

      try {
        const result = await settleInvoicePaid(supabaseServer, {
          invoiceId,
          userId: ctx.userId,
          contactId: invoice.contact_id,
          amount: invoice.amount,
          currency: invoice.currency,
          // A person marking an invoice paid in conversation is recording money
          // that arrived some other way, so there is no processor involved.
          // Claiming 'stripe' would make the refund path try to return it
          // through an account that never received it.
          paymentMethod: (data.payment_method as string) ?? 'bank_transfer',
          processorType: 'manual',
          accountContext: {
            stripe_connect_account_id: null,
            charge_account_kind: 'platform',
            account_resolution: 'recorded',
          },
          description: `Invoice ${invoice.invoice_number}`,
          metadata: { source: 'chat_mark_paid', notes: (data.notes as string) ?? null },
        });

        return { data: result, error: null } as RepoResult<unknown>;
      } catch (error) {
        return { data: null, error: error as Error } as RepoResult<unknown>;
      }
    },

    update: async (q, data, ctx) =>
      paymentInvoiceRepository.update(requireTargetId(q), ctx.userId, data) as Promise<
        RepoResult<unknown>
      >,

    // Both go through invoiceLifecycle, which refuses a paid invoice and stops
    // the Stripe hosted page being payable before the local row changes.
    void: async (q, _data, ctx) => {
      const { voidInvoice } = await import('@/lib/payments/invoiceLifecycle');
      const result = await voidInvoice({ invoiceId: requireTargetId(q), userId: ctx.userId });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    delete: async (q, _data, ctx) => {
      const { deleteInvoice } = await import('@/lib/payments/invoiceLifecycle');
      const result = await deleteInvoice({ invoiceId: requireTargetId(q), userId: ctx.userId });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    /**
     * Declared in the catalog from the start with no handler behind it, so
     * "send that invoice to Ofir" planned correctly and then failed every time
     * with "declared but not implemented yet". Failing loudly was right;
     * leaving it unimplemented for this long was not.
     *
     * Through the service, never `update({status:'sent'})` — an invoice marked
     * sent that nobody received is worse than one that was never sent, because
     * the owner stops chasing it.
     */
    send: async (q, _data, ctx) => {
      // Imported HERE, not at the top of the file.
      //
      // Invoice delivery reaches a React-PDF renderer that registers fonts as a
      // side effect of being imported. At module scope that cost lands on
      // everything importing this dispatch table — the chat route's cold start,
      // and every unit test of write safety, which hung outright. A write table
      // should be cheap to load; only actually sending an invoice should pay for
      // a PDF engine.
      const { sendInvoice } = await import('@/lib/services/InvoiceDeliveryService');

      const result = await sendInvoice({
        invoiceId: requireTargetId(q),
        userId: ctx.userId,
        // Stripe raises its own invoice and emails a hosted payment page. From
        // chat we prefer the branded PDF: it works for every business, whether
        // or not they have finished Stripe onboarding.
        useStripe: false,
      });

      if (result.error) return { data: null, error: result.error };

      // The caller renders a row, so hand back the invoice as it now stands.
      return paymentInvoiceRepository.findById(
        result.data!.invoiceId,
        ctx.userId
      ) as Promise<RepoResult<unknown>>;
    },
  },

  tasks: {
    create: async (_q, data, ctx) =>
      crmTaskRepository.create({
        user_id: ctx.userId,
        ...data,
      } as Parameters<typeof crmTaskRepository.create>[0]) as Promise<RepoResult<unknown>>,

    update: async (q, data, ctx) =>
      crmTaskRepository.update(requireTargetId(q), ctx.userId, data) as Promise<
        RepoResult<unknown>
      >,

    delete: async (q, _data, ctx) =>
      crmTaskRepository.delete(requireTargetId(q), ctx.userId) as Promise<RepoResult<unknown>>,
  },

  transactions: {
    /**
     * Record money that arrived outside the system — cash, a bank transfer, a
     * card machine.
     *
     * `succeeded`, because a payment somebody is telling us about has already
     * happened; and `manual`, because no processor was involved. Claiming a
     * processor here would make the refund path try to return the money through
     * an account that never received it.
     */
    create: async (_q, data, ctx) =>
      paymentTransactionRepository.create({
        user_id: ctx.userId,
        status: 'succeeded',
        currency: 'USD',
        processor_type: 'manual',
        ...data,
      } as Parameters<typeof paymentTransactionRepository.create>[0]) as Promise<
        RepoResult<unknown>
      >,

    // Amount is not writable, so a correction cannot rewrite what a payment was
    // worth — that would desynchronise the business's revenue from the
    // processor's record of it.
    update: async (q, data, ctx) =>
      paymentTransactionRepository.update(requireTargetId(q), ctx.userId, data) as Promise<
        RepoResult<unknown>
      >,

    /**
     * Give money back.
     *
     * Straight to RefundService, which already owns everything that makes a
     * refund safe: which processor account the payment landed in, how much
     * remains unrefunded, and idempotency per client request so a repeated
     * confirmation cannot become a second refund.
     *
     * `source: 'app'` and `initiatedBy` record that a person asked for this in
     * conversation rather than a webhook or the reconciler replaying one.
     */
    refund: async (q, data, ctx) => {
      const { refund } = await import('@/lib/payments/RefundService');

      const result = await refund({
        userId: ctx.userId,
        transactionId: requireTargetId(q),
        amount: typeof data.amount === 'number' ? data.amount : undefined,
        reason: (data.reason as string) ?? undefined,
        source: 'app',
        initiatedBy: ctx.userId,
      });

      if (!result.ok) {
        return { data: null, error: new Error(result.message ?? 'The refund was refused.') };
      }

      return { data: result as unknown as QueryRow, error: null };
    },
  },

  links: {
    // The short code is generated by the repository, never supplied: one that
    // collided with an existing link would quietly send people to somebody
    // else's destination.
    // Note the signature: this repository takes the user id as its FIRST
    // argument rather than inside the row, unlike every other one here.
    create: async (_q, data, ctx) =>
      smartLinkRepository.create(
        ctx.userId,
        data as unknown as Parameters<typeof smartLinkRepository.create>[1]
      ) as Promise<RepoResult<unknown>>,

    update: async (q, data, ctx) =>
      smartLinkRepository.update(requireTargetId(q), ctx.userId, data) as Promise<
        RepoResult<unknown>
      >,

    // OFF, not gone. A shared link is out in the world, and deleting the row
    // makes every copy of it a dead end while destroying the click history that
    // says whether the campaign worked.
    deactivate: async (q, _data, ctx) =>
      smartLinkRepository.update(requireTargetId(q), ctx.userId, {
        is_active: false,
      }) as Promise<RepoResult<unknown>>,
  },

  pages: {
    /*
     * Create a page, with its blocks.
     *
     * Mirrors `POST /api/website/pages`: a homepage gets the standard section
     * set, and both paths share `convertTemplateBlockToInsert` so "what a new
     * page contains" has one answer. A theme is applied when a template is
     * named; without one the page inherits the business's look downstream.
     */
    create: async (_q, data, ctx) => {
      const [{ WebsitePageRepository }, { WebsiteBlockRepository }, templates, { convertTemplateBlockToInsert }] =
        await Promise.all([
          import('@/lib/repositories/WebsitePageRepository'),
          import('@/lib/repositories/WebsiteBlockRepository'),
          import('@/lib/website-builder/templates'),
          import('@/lib/website-builder/blockInsert'),
        ]);

      const title = String(data.title ?? '').trim();
      if (!title) {
        return { data: null, error: new Error('A page needs a title.') };
      }

      const pageType = String(data.page_type ?? 'landing');
      const language = String(data.website_language ?? 'en');

      const templateId = data.template_id ? String(data.template_id) : null;
      const template = templateId ? templates.getTemplateById(templateId) : undefined;
      if (templateId && !template) {
        return { data: null, error: new Error(`No template called '${templateId}'.`) };
      }

      // The same slug rule the API uses, so a page made here and a page made
      // there are addressable the same way.
      const slug =
        (data.slug ? String(data.slug) : '') ||
        `/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

      const pageRepo = new WebsitePageRepository(supabaseServer);
      const created = await pageRepo.create({
        user_id: ctx.userId,
        page_type: pageType,
        slug,
        title,
        template_id: templateId,
        status: 'draft',
        theme: template ? templates.templateToPageTheme(template) : undefined,
        website_language: language,
      } as Parameters<typeof pageRepo.create>[0]);

      if (created.error || !created.data) {
        return { data: null, error: created.error ?? new Error('Could not create the page') };
      }

      /*
       * A homepage without sections publishes as a blank screen, so it gets the
       * standard set. Other page types start empty on purpose — a landing page's
       * sections depend on what it is selling, and guessing them produces a page
       * the owner has to dismantle.
       */
      if (pageType === 'homepage') {
        const blockRepo = new WebsiteBlockRepository(supabaseServer);
        const blocks = templates
          .getStandardHomepageBlocks()
          .map((block, index) =>
            convertTemplateBlockToInsert(block, created.data!.id, index, language as never)
          );

        for (const block of blocks) {
          const result = await blockRepo.create(block);
          if (result.error) {
            logger.warn(
              { err: result.error, pageId: created.data.id },
              'A section could not be created (page kept)'
            );
          }
        }
      }

      return { data: created.data as unknown as Record<string, unknown>, error: null };
    },


    // Through the service: publishing checks the page has an address and
    // something on it, and refreshes the sections first. A bare status flip
    // would put a blank page live at no address and report success.
    publish: async (q, _data, ctx) => {
      const { publishPage } = await import('@/lib/services/WebsitePublishService');
      const result = await publishPage({ pageId: requireTargetId(q), userId: ctx.userId });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    update: async (q, data, ctx) => {
      const { WebsitePageRepository } = await import('@/lib/repositories/WebsitePageRepository');
      const repo = new WebsitePageRepository(supabaseServer);
      return repo.update(requireTargetId(q), ctx.userId, data) as Promise<RepoResult<unknown>>;
    },

    delete: async (q, _data, ctx) => {
      const { WebsitePageRepository } = await import('@/lib/repositories/WebsitePageRepository');
      const repo = new WebsitePageRepository(supabaseServer);
      return repo.delete(requireTargetId(q), ctx.userId) as Promise<RepoResult<unknown>>;
    },

    unpublish: async (q, _data, ctx) => {
      const { unpublishPage } = await import('@/lib/services/WebsitePublishService');
      const result = await unpublishPage({ pageId: requireTargetId(q), userId: ctx.userId });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },
  },

  sections: {
    // The words in one section of the site. Merged, never replaced — see
    // WebsiteSectionService for why writing the JSON wholesale would erase an
    // FAQ's questions while setting its heading.
    set_content: async (q, data, ctx) => {
      const { setSectionContent } = await import('@/lib/services/WebsiteSectionService');

      const result = await setSectionContent({
        blockId: requireTargetId(q),
        userId: ctx.userId,
        heading: data.heading,
        text: data.text,
      });

      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    // Every section write resolves ownership through the page first: the block
    // repository takes no user id, so a planner-supplied block id would
    // otherwise be acted on unchecked.
    add: async (_q, data, ctx) => {
      const { addSection } = await import('@/lib/services/WebsiteSectionService');
      const result = await addSection({
        pageId: data.page_id as string,
        userId: ctx.userId,
        blockType: data.block_type as string,
        heading: data.heading,
        text: data.text,
      });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    delete: async (q, _data, ctx) => {
      const { deleteSection } = await import('@/lib/services/WebsiteSectionService');
      const result = await deleteSection({ blockId: requireTargetId(q), userId: ctx.userId });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    regenerate: async (q, data, ctx) => {
      const { regenerateSectionField } = await import('@/lib/services/WebsiteSectionService');
      const result = await regenerateSectionField({
        blockId: requireTargetId(q),
        userId: ctx.userId,
        field: String(data.field ?? ''),
      });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    move: async (q, data, ctx) => {
      const { moveSection } = await import('@/lib/services/WebsiteSectionService');
      const result = await moveSection({
        blockId: requireTargetId(q),
        userId: ctx.userId,
        direction: data.direction === 'up' ? 'up' : 'down',
      });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    // Hidden, not deleted: reversible, and the words survive to be turned back on.
    hide: async (q, _data, ctx) => {
      const { setSectionEnabled } = await import('@/lib/services/WebsiteSectionService');
      const result = await setSectionEnabled({
        blockId: requireTargetId(q),
        userId: ctx.userId,
        enabled: false,
      });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    show: async (q, _data, ctx) => {
      const { setSectionEnabled } = await import('@/lib/services/WebsiteSectionService');
      const result = await setSectionEnabled({
        blockId: requireTargetId(q),
        userId: ctx.userId,
        enabled: true,
      });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },
  },

  channel_connections: {
    // Per USER, not per connection: the sync service refreshes every connected
    // account together, and refreshing one while the others went stale would
    // make the totals shown beside each other disagree.
    // Metrics FIRST. If the connection row went first and this then failed, the
    // owner would be left with orphaned data and no reconnect button to reach a
    // delete through.
    disconnect: async (q, _data, ctx) => {
      const connectionId = requireTargetId(q);

      const { data: connection } = await supabaseServer
        .from('channel_connections')
        .select('id, platform, account_id')
        .eq('id', connectionId)
        .eq('user_id', ctx.userId)
        .maybeSingle();

      if (!connection) {
        return { data: null, error: new Error('That connected account was not found.') };
      }

      const { channelMetricsRepository } = await import(
        '@/lib/repositories/ChannelMetricsRepository'
      );
      const { channelConnectionRepository } = await import(
        '@/lib/repositories/ChannelConnectionRepository'
      );

      const metrics = await channelMetricsRepository.deleteForAccount(
        ctx.userId,
        connection.platform as Parameters<typeof channelMetricsRepository.deleteForAccount>[1],
        String(connection.account_id)
      );
      if (metrics.error) return { data: null, error: metrics.error as Error };

      const removed = await channelConnectionRepository.remove(ctx.userId, connectionId);
      if (removed.error) return { data: null, error: removed.error as Error };

      return { data: { disconnected: connection.platform } as unknown as QueryRow, error: null };
    },

    sync: async (_q, _data, ctx) => {
      const { channelMetricsSyncService } = await import(
        '@/lib/business-os/channel-insights/ChannelMetricsSyncService'
      );
      const results = await channelMetricsSyncService.syncUser(ctx.userId);
      // A per-connection `error` is how this service reports failure; there is
      // no ok flag. Counting them separately keeps a partial sync honest rather
      // than reporting every account refreshed.
      const failed = results.filter((r) => r.error);

      return {
        data: {
          synced: results.length - failed.length,
          failed: failed.length,
        } as unknown as QueryRow,
        error: null,
      };
    },
  },

  pipeline_stages: {
    // `position` defaults to the end: a new stage belongs after the ones that
    // exist unless somebody says otherwise, and defaulting it to 0 would put
    // every new stage at the front of the funnel.
    create: async (_q, data, ctx) => {
      const { crmPipelineStagesRepository } = await import(
        '@/lib/repositories/CRMPipelineStagesRepository'
      );

      const label = String(data.stage_label ?? '').trim();

      // `vertical` is NOT NULL with no default, and nothing was setting it — so
      // this action could never have inserted a row. It is a property of the
      // business, not of the stage, so it comes from the profile rather than
      // from the user being asked a question they would find baffling.
      const { data: profile } = await supabaseServer
        .from('business_profiles')
        .select('vertical')
        .eq('user_id', ctx.userId)
        .maybeSingle();

      const existing = await crmPipelineStagesRepository.list(ctx.userId);
      const position =
        typeof data.position === 'number'
          ? data.position
          : (existing.data?.length ?? 0);

      return crmPipelineStagesRepository.create({
        user_id: ctx.userId,
        vertical: (profile?.vertical as string) ?? 'other',
        // Derived from the label, because a key is a storage detail nobody says
        // out loud — and the label is what the user actually gave us.
        //
        // With a fallback, because the derivation is ASCII-only and this product
        // is used in Hebrew: "בדיקה זמנית" reduces to the EMPTY STRING, which is
        // not null so it inserts happily, and every Hebrew-named stage then
        // shares the same blank key. Found by running it in the language the
        // business actually speaks.
        stage_key: (data.stage_key as string) || deriveStageKey(label),
        stage_label: label,
        stage_type: (data.stage_type as string) || 'prospect',
        position,
      } as Parameters<typeof crmPipelineStagesRepository.create>[0]) as Promise<
        RepoResult<unknown>
      >;
    },
  },

  plan_subscriptions: {
    /*
     * Stop the remaining charges on a client's plan.
     *
     * `cancelPlan` is the reviewed path the payments screen uses; it cancels
     * the Stripe subscription or schedule and records the outcome.
     *
     * Its refund options are deliberately NOT passed through. `cancelPlan` can
     * return everything collected so far, and folding that into "cancel" would
     * let one sentence both stop a plan and move money out of the business.
     * Refunding stays its own decision, with its own capability and its own
     * confirmation.
     */
    cancel: async (q, data, ctx) => {
      const planId = requireTargetId(q);

      if (!process.env.STRIPE_SECRET_KEY) {
        return { data: null, error: new Error('Payments are not configured.') };
      }

      const [{ cancelPlan }, StripeModule] = await Promise.all([
        import('@/lib/payments/cancelPlan'),
        import('stripe'),
      ]);

      const Stripe = StripeModule.default;
      const result = await cancelPlan({
        planId,
        userId: ctx.userId,
        stripe: new Stripe(process.env.STRIPE_SECRET_KEY),
        reason: typeof data.reason === 'string' ? data.reason : undefined,
      });

      if (!result.ok) {
        // `message` is the field this result carries — it holds the reason a
        // human can act on ("This payment plan could not be found"), and
        // reaching for `.error` would have discarded it for a generic string.
        return {
          data: null,
          error: new Error(result.message ?? 'The plan could not be cancelled'),
        };
      }

      return { data: result as unknown as Record<string, unknown>, error: null };
    },
  },

  business_profile: {
    /*
     * The ledger for a period, as data.
     *
     * Returns the summary and the row count rather than a file: this is the
     * EXTRACTION half, and what a caller does with it — attach it to an email,
     * quote the totals back in chat, hand it to a scheduled digest — is the
     * caller's decision. The file is one call away via `ledgerToCsv` /
     * `ledgerToWorkbook` on the same report.
     *
     * A read, so no confirmation and nothing written. The send that usually
     * follows is a separate `contacts.send`, which keeps its own gate.
     */
    export_ledger: async (_q, data, ctx) => {
      const { buildLedgerReport } = await import('@/lib/payments/ledgerService');
      const { resolveLedgerPeriod, isLedgerPeriodId, ledgerPeriodLabel } = await import(
        '@/lib/payments/ledgerPeriod'
      );

      /*
       * A named period, explicit dates, or neither.
       *
       * Neither means the current month — the same default the export modal
       * opens on, so "export the ledger" means the same thing in both places.
       */
      const named = isLedgerPeriodId(data.period) ? data.period : null;
      const bounds = named ? resolveLedgerPeriod(named) : null;
      const fallback = resolveLedgerPeriod('this_month')!;

      const from = (data.from as string) || bounds?.from || fallback.from;
      const to = (data.to as string) || bounds?.to || fallback.to;

      // Absent means the modal's default, not "off" — a caller that says
      // nothing about refunds wants the refunds.
      const flag = (value: unknown, fallbackValue: boolean): boolean =>
        value === undefined || value === null ? fallbackValue : value === true || value === 'true';

      const report = await buildLedgerReport({
        userId: ctx.userId,
        from,
        to,
        options: {
          includePayments: flag(data.include_payments, true),
          includeRefunds: flag(data.include_refunds, true),
          includeInvoices: flag(data.include_invoices, false),
          includeFees: flag(data.include_fees, true),
          includeTax: flag(data.include_tax, true),
          includeReferences: flag(data.include_references, true),
        },
      });

      /*
       * What to hand back.
       *
       * The summary alone answers "how did last quarter go". It does NOT answer
       * "send my accountant the ledger", which needs the actual thing — so the
       * caller can ask for the rows, or for the rendered file, and the kernel
       * composes from there. Both are off by default: a ledger with thousands
       * of rows should not be inlined into every response that merely wanted a
       * total.
       */
      const wantRows = data.include_rows === true || data.include_rows === 'true';
      const wantFile = data.include_file === true || data.include_file === 'true';
      const format = (data.format as string) === 'csv' ? 'csv' : 'xlsx';

      // Enough for any real period; a bound so one call cannot return a table.
      const ROW_CAP = 500;

      let file: Record<string, unknown> | undefined;
      if (wantFile) {
        const { ledgerToCsv, ledgerToWorkbook, ledgerFilename } = await import(
          '@/lib/payments/ledgerService'
        );

        /*
         * base64, because that is what an attachment takes.
         *
         * `performEmail` accepts a base64 string for `content`, so the output of
         * this capability drops straight into the attachments of a send with no
         * conversion in between — which is the whole point of returning a file
         * rather than a download URL nothing on the server could fetch.
         */
        const content =
          format === 'csv'
            ? Buffer.from(ledgerToCsv(report), 'utf8').toString('base64')
            : (await ledgerToWorkbook(report)).toString('base64');

        file = {
          filename: ledgerFilename(report, format),
          contentType:
            format === 'csv'
              ? 'text/csv'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content,
          bytes: Buffer.from(content, 'base64').length,
        };
      }

      return {
        data: {
          period: ledgerPeriodLabel({ from, to }),
          from,
          to,
          format,
          rows: report.rows.length,
          invoices: report.invoiceRows.length,
          // Per currency, because summing two currencies invents a number.
          summary: report.summary,
          ...(wantRows
            ? {
                items: report.rows.slice(0, ROW_CAP),
                items_truncated: report.rows.length > ROW_CAP,
              }
            : {}),
          ...(file ? { file } : {}),
        },
        error: null,
      };
    },

    // "Change Tuesday to 9-2 only." One day replaced, the rest of the week
    // untouched — see AvailabilityService for why the map is never handed to a
    // planner to author.
    set_availability: async (_q, data, ctx) => {
      const { setDayAvailability } = await import('@/lib/services/AvailabilityService');

      const result = await setDayAvailability({
        userId: ctx.userId,
        day: data.day,
        start: data.start,
        end: data.end,
      });

      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    clear_availability: async (_q, data, ctx) => {
      const { setDayAvailability } = await import('@/lib/services/AvailabilityService');

      const result = await setDayAvailability({
        userId: ctx.userId,
        day: data.day,
        clear: true,
      });

      return { data: result.data as unknown as QueryRow, error: result.error };
    },
  },

  activities: {
    // A pure data write: nothing leaves the building, so it can be declared
    // straight against the repository. `activity_date` defaults to now because
    // "log that I called Moshe" is almost always about what just happened.
    create: async (_q, data, ctx) =>
      crmActivityRepository.create({
        user_id: ctx.userId,
        activity_type: 'note',
        activity_date: new Date().toISOString(),
        // Written by a person in conversation, not inferred by the system —
        // which is what `auto_logged` distinguishes on the contact's timeline.
        auto_logged: false,
        source_capability: 'chat',
        ...data,
      } as Parameters<typeof crmActivityRepository.create>[0]) as Promise<RepoResult<unknown>>,
  },

  services: {
    create: async (_q, data, ctx) =>
      schedulingServiceRepository.create({
        user_id: ctx.userId,
        // NOT NULL columns the catalog does not expose. A service created from
        // chat starts as a draft: publishing it to the booking page is a
        // separate, deliberate act.
        status: 'draft',
        source: 'chat',
        ...data,
      } as unknown as Parameters<typeof schedulingServiceRepository.create>[0]) as Promise<
        RepoResult<unknown>
      >,

    update: async (q, data, ctx) =>
      schedulingServiceRepository.update(requireTargetId(q), ctx.userId, data) as Promise<
        RepoResult<unknown>
      >,

    deactivate: async (q, _data, ctx) =>
      schedulingServiceRepository.update(requireTargetId(q), ctx.userId, {
        is_active: false,
      }) as Promise<RepoResult<unknown>>,

    // Outright removal. `deactivate` is the reversible one and the usual verb;
    // past bookings keep their service_id, so deleting a service a client has
    // booked leaves those rows pointing at nothing.
    delete: async (q, _data, ctx) =>
      schedulingServiceRepository.delete(requireTargetId(q), ctx.userId) as Promise<
        RepoResult<unknown>
      >,

    // The repository's own publish, which refuses anything that is not a draft.
    // `create` starts services as drafts, so without this the chat could invent
    // a service and then have no way to open it for bookings.
    publish: async (q, _data, ctx) =>
      schedulingServiceRepository.publish(requireTargetId(q), ctx.userId) as Promise<
        RepoResult<unknown>
      >,
  },

  bookings: {
    /*
     * Re-send the confirmation for a booking that already exists.
     *
     * `BookingEmailService.sendBookingConfirmation` does the work — the same
     * path the bookings screen uses — so the email a client receives on a
     * resend is byte-for-byte the one they were sent originally.
     */
    resend_confirmation: async (q, _data, ctx) => {
      const bookingId = requireTargetId(q);
      const { BookingEmailService } = await import('@/lib/services/BookingEmailService');

      const result = await BookingEmailService.sendBookingConfirmation(bookingId, ctx.userId, {
        // A resend is about the appointment, not a fresh request for money.
        skipInvoice: true,
      });

      if (!result?.success) {
        return {
          data: null,
          error: new Error(result?.error || 'The confirmation could not be sent'),
        };
      }

      return { data: { bookingId, sent: true } as Record<string, unknown>, error: null };
    },


    // NOT the repository's `cancel`, which is only a status update.
    //
    // Cancelling from the chat used to call it directly, so the row said
    // cancelled while the appointment stayed in the owner's calendar and the
    // client was never told — a write that looked done and was not. The service
    // holds the whole sequence; the route uses the same one.
    cancel: async (q, data, ctx) => {
      const result = await cancelBooking({
        bookingId: requireTargetId(q),
        userId: ctx.userId,
        reason: (data.cancellation_reason as string) ?? undefined,
      });

      // Unwrap to the booking row: the caller renders a row, and the extra
      // outcome flags are for the route's response, not the chat's.
      return { data: result.data?.booking ?? null, error: result.error };
    },

    complete: async (q, _data, ctx) =>
      schedulingBookingRepository.complete(requireTargetId(q), ctx.userId) as Promise<
        RepoResult<unknown>
      >,

    // A no-show changes a status and nothing else — the slot was used up
    // either way, so there is no calendar event to remove and nobody to tell.
    // The route does exactly this, which is why it can go straight to the
    // repository while cancel and reschedule cannot.
    no_show: async (q, _data, ctx) =>
      schedulingBookingRepository.markNoShow(requireTargetId(q), ctx.userId) as Promise<
        RepoResult<unknown>
      >,

    // Moving an appointment: the calendar has to follow it and the client has
    // to be told the time changed. Changing start_time alone would leave the
    // old slot in the owner's calendar and the client arriving at the old hour.
    reschedule: async (q, data, ctx) => {
      const result = await rescheduleBooking({
        bookingId: requireTargetId(q),
        userId: ctx.userId,
        startTime: data.start_time as string,
        endTime: data.end_time as string,
      });

      return { data: result.data?.booking ?? null, error: result.error };
    },

    // Refuses a booking that has been paid for, and takes its unpaid invoices
    // with it — an invoice left behind is an orphan that is still owed.
    delete: async (q, _data, ctx) => {
      const { deleteBooking } = await import('@/lib/services/BookingLifecycleService');
      const result = await deleteBooking({ bookingId: requireTargetId(q), userId: ctx.userId });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    send_intake: async (q, _data, ctx) => {
      const { sendIntakeForm } = await import('@/lib/services/BookingLifecycleService');
      const result = await sendIntakeForm({ bookingId: requireTargetId(q), userId: ctx.userId });
      return { data: result.data as unknown as QueryRow, error: result.error };
    },

    // Through the service, for the same reason as `cancel`: a booking row is
    // not an appointment until the slot has been checked, the calendar knows
    // about it and the client has been told.
    create: async (_q, data, ctx) => {
      const result = await createBooking({
        userId: ctx.userId,
        serviceId: data.service_id as string,
        contactId: data.contact_id as string,
        startTime: data.start_time as string,
        endTime: data.end_time as string,
        timezone: ctx.timezone,
        notes: data.notes as string | undefined,
        // So a booking made from the chat is traceable to the chat.
        bookingSource: 'chat',
      });

      return { data: result.data?.booking ?? null, error: result.error };
    },
  },
};

/**
 * Translate catalog field names to column names, rejecting anything not
 * declared writable.
 *
 * This is the check that stops a plan setting `stage` on an entity where it is
 * read-only, or writing to a column the catalog never exposed.
 */
function mapWritableData(
  entity: ResolvedEntity,
  data: Record<string, unknown> | undefined,
  timezone: string | undefined
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data ?? {})) {
    const field = entity.fields[key];

    if (!field) {
      throw new BizQLValidationError([
        `unknown field '${entity.key}.${key}'. ` +
          `Writable: ${Object.keys(entity.fields)
            .filter((f) => entity.fields[f].writable)
            .join(', ')}.`,
      ]);
    }
    if (!field.writable) {
      throw new BizQLValidationError([`field '${entity.key}.${key}' is not writable.`]);
    }

    mapped[field.column] = resolveWriteValue(entity, field, value, timezone);
  }

  return mapped;
}

/**
 * Turn a plan-level value into something a repository can actually store.
 *
 * Reads went through the compiler, which resolves `{"$date":"tomorrow"}` against
 * the user's timezone. Writes did not, so the object was handed to the repository
 * verbatim: EVERY write carrying a relative date — "add a task to call Moshe
 * tomorrow", the single most ordinary thing to ask a task manager — was writing
 * an object into a timestamp column.
 *
 * The unknown-object case throws rather than stringifying. `[object Object]` in a
 * user's data is worse than a failed write, and it is what stringifying quietly
 * produces.
 */
function resolveWriteValue(
  entity: ResolvedEntity,
  field: ResolvedField,
  value: unknown,
  timezone: string | undefined
): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (isDateExpr(value)) {
    const resolved = resolveDateExpr(value, timezone ?? 'UTC');
    // A date-only column must not be given a full timestamp.
    return field.type === 'date' ? resolved.slice(0, 10) : resolved;
  }

  throw new BizQLValidationError([
    `'${entity.key}.${field.key}' was given a value the compiler cannot store ` +
      `(${JSON.stringify(value).slice(0, 60)}). Give a literal, or {"$date":"…"} ` +
      `for a relative date.`,
  ]);
}

/**
 * Refuse a write whose foreign key points at a row the caller does not own.
 *
 * THIS IS A TENANT BOUNDARY, and a different one from every other check here.
 *
 * `user_id` scoping protects the row being WRITTEN. It says nothing about the row
 * that row POINTS AT. Before `contact_id` became writable this could not arise;
 * now a plan carrying someone else's contact uuid — copied from a shared link, a
 * pasted id, a model that hallucinated a plausible one — would create an invoice
 * in this account referencing a stranger's contact. Nothing would leak on the
 * way in, but the row is corrupt and the FK becomes a probe: create, then read
 * back the embedded relation.
 *
 * So every writable FK declares what it references (enforced at catalog build)
 * and every write verifies ownership through the same compiler that scopes reads.
 * Verification is by SELECT rather than by trusting the plan, because the plan is
 * the untrusted input.
 */
async function assertReferencesOwned(
  entity: ResolvedEntity,
  data: Record<string, unknown>,
  ctx: QueryContext
): Promise<void> {
  for (const field of Object.values(entity.fields)) {
    if (!field.references) continue;

    const value = data[field.column];
    if (value === undefined || value === null || value === '') continue;

    if (typeof value !== 'string') {
      throw new BizQLValidationError([
        `'${entity.key}.${field.key}' must be a row id, got ${typeof value}.`,
      ]);
    }

    const target = CATALOG.entities[field.references];
    if (!target) continue;

    const found = await compileAndRunFind(
      supabaseServer,
      { op: 'find', entity: field.references, where: [{ field: 'id', op: 'eq', value }], limit: 1 },
      ctx
    );

    if (found.rows.length === 0) {
      throw new BizQLValidationError([
        `'${entity.key}.${field.key}' references a ${field.references} row that does ` +
          `not exist in this account. Find the ${field.references} first and use the ` +
          `id from that result — never a guessed or remembered id.`,
      ]);
    }
  }
}

/**
 * Did this value come from the user's own words?
 *
 * Every significant token of the value must appear somewhere in the request.
 * Token-wise rather than substring so that reordering and light rephrasing still
 * pass, while outright invention does not: "משימה חדשה" shares "משימה" with
 * "הוסף משימה למשה" but not "חדשה", so it fails — correctly.
 *
 * Deliberately no stemming, no synonyms, no per-language anything. This asks one
 * question — were these words present? — and a wrong answer costs a clarifying
 * question, never a fabricated record.
 */
function isGroundedIn(value: string, utterance: string): boolean {
  const normalise = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const haystack = normalise(utterance);
  if (!haystack) return true; // No request to check against — do not block.

  const tokens = normalise(value)
    .split(' ')
    .filter((token) => token.length > 1);

  if (tokens.length === 0) return true;

  if (!tokens.every((token) => haystack.includes(token))) return false;

  // Grounded, but is it CONTENT or just an echo of the request?
  //
  // A task was created titled "הוסף משימה למשה משה" — the whole utterance,
  // command verb included. Every word was genuinely present, so the check above
  // passed it, and the user got a task whose title was their own instruction.
  //
  // The discriminator needs no language knowledge: a request to create something
  // always says more than the thing itself — "add", "create", "הוסף". So if the
  // value swallows every word of the request, nothing was extracted from it.
  const requestTokens = new Set(haystack.split(' ').filter((token) => token.length > 1));
  const valueTokens = new Set(tokens);

  return [...requestTokens].some((token) => !valueTokens.has(token));
}


/**
 * Confirmation text for an action carrying PARAMETERS rather than column values.
 *
 * `describe` renders each key by looking it up in `entity.fields` and drops
 * anything it cannot find — which is every parameter. So the card for "change
 * Tuesday to 9-2" read simply "set working hours": the user was asked to approve
 * a change without being shown WHICH DAY or WHAT HOURS, which is approving
 * blind, and is the exact failure `describe` was written to prevent.
 *
 * Parameters have no catalog labels, so the key is shown as written. That is
 * honest and readable — "day: Tuesday · start: 09:00 · end: 14:00" — and better
 * than a translated label that does not exist.
 */
function describeParams(
  entity: ResolvedEntity,
  query: MutateQuery,
  data: Record<string, unknown>,
  language: string
): string {
  const action = entity.actions?.[query.action];
  const label =
    action?.labels[language as 'en'] ?? action?.labels.en ?? `${query.action} ${entity.key}`;

  const parts = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`);

  return parts.length > 0 ? `${label} — ${parts.join(' · ')}` : label;
}

/** Short description of what a write will do, for the confirmation card. */
function describe(
  entity: ResolvedEntity,
  query: MutateQuery,
  data: Record<string, unknown>,
  language: string,
  names: { target?: string; references?: Record<string, string> } = {}
): string {
  const action = entity.actions?.[query.action];
  const label =
    action?.labels[language as 'en'] ?? action?.labels.en ?? `${query.action} ${entity.key}`;

  // VALUES, not field names.
  //
  // This string is the confirmation card — the last thing between a plan and the
  // user's real data. It read "add service (service_name, duration_minutes,
  // price)", which tells the user what KIND of thing is about to happen and
  // nothing about what will actually be written. Approving that is approving
  // blind, and it is the only backstop against a planner that fills a required
  // field with something plausible rather than something the user said.
  //
  // Labels come from the catalog in the user's language, and values through the
  // same formatter the result list uses, so a price reads "₪400.00" and a date
  // reads as a date — matching what they will see afterwards.
  const parts = Object.entries(data)
    .map(([column, value]) => {
      const field = Object.values(entity.fields).find((f) => f.column === column);
      if (!field) return null;

      const fieldLabel = field.labels[language as 'en'] ?? field.labels.en;
      // A resolved reference shows the row's NAME. "contact: 36c2ab05-…" is not
      // something a user can check, which makes approving it meaningless.
      const shown =
        names.references?.[field.key] ?? formatForPreview(value, field.format, language);

      return `${fieldLabel}: ${shown}`;
    })
    .filter((part): part is string => part !== null);

  // An update or a delete carries little or no data, so without the target's
  // name the card read just "mark as paid" — which invoice? The one thing the
  // user most needs to check was the one thing missing.
  const head = names.target ? `${label}: ${names.target}` : label;

  return parts.length > 0 ? `${head} — ${parts.join(' · ')}` : head;
}

/**
 * Format one value for the confirmation card.
 *
 * Deliberately small and local rather than reusing the renderer: that one is
 * built around a fetched row and its currency column, and a write's data is not
 * a row yet. Getting a wrong currency symbol onto an approval card would be a
 * worse bug than a plain number.
 */
function formatForPreview(value: unknown, format: string | undefined, language: string): string {
  if (value === null || value === undefined || value === '') return '—';

  // Date expressions are resolved before this point, so anything still an object
  // is unexpected — show a placeholder rather than "[object Object]" on the card
  // the user is about to approve.
  if (typeof value === 'object') return '…';

  if (format === 'date' || format === 'datetime') {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      try {
        return new Intl.DateTimeFormat(language || 'en', {
          dateStyle: 'medium',
          ...(format === 'datetime' ? { timeStyle: 'short' } : {}),
        }).format(date);
      } catch {
        return date.toISOString();
      }
    }
  }

  return String(value);
}

/**
 * Execute — or preview — a write.
 *
 * `dryRun` returns exactly what would happen without touching the database. The
 * confirmation flow depends on that being genuinely side-effect free, so no
 * handler is invoked on this path at all.
 */
export async function executeMutate(
  query: MutateQuery,
  ctx: QueryContext,
  options: {
    dryRun?: boolean;
    language?: string;
    /** Human name of the row being acted on, for the confirmation card. */
    targetName?: string;
    /** Field key → human name of each resolved reference, for the same reason. */
    referenceNames?: Record<string, string>;
    /**
     * What the user actually typed.
     *
     * Used to tell a supplied value from an invented one. Omit it and only blank
     * values are caught, which is the behaviour that let "add a task for Moshe"
     * create a task titled "new task".
     */
    utterance?: string;
  } = {}
): Promise<MutateResult> {
  const entity = CATALOG.entities[query.entity];
  if (!entity) {
    throw new BizQLValidationError([`unknown entity '${query.entity}'.`]);
  }

  const action = entity.actions?.[query.action];
  if (!action) {
    throw new BizQLValidationError([
      `'${query.entity}' has no action '${query.action}'. ` +
        `Available: ${Object.keys(entity.actions ?? {}).join(', ') || 'none'}.`,
    ]);
  }

  const handler = HANDLERS[query.entity]?.[query.action];
  if (!handler) {
    // Declared in the catalog but not wired to a repository. Fail loudly: a
    // silent success here is the exact bug that made the old chat claim it had
    // sent emails it never sent.
    //
    // The message leads with what the USER needs to know and keeps the
    // developer's version after it. Previously it said only "declared but not
    // implemented yet", which is a statement about our dispatch table — true,
    // and of no use to someone who just asked to email a client.
    const label = action.labels.en ?? query.action;
    throw new BizQLValidationError([
      `I can't ${label} yet — that action is listed but not built. ` +
        `('${query.entity}.${query.action}' is declared but not implemented yet.)`,
    ]);
  }

  // Some actions carry PARAMETERS, not a row update.
  //
  // `mapWritableData` exists to stop a plan writing to a column the catalog
  // never exposed, and it rejects any key that is not a writable field. That is
  // exactly right for create/update — and wrong for send, whose payload is a
  // subject and a body that are not columns of anything. Routing send through it
  // would reject "email Ofir about the invoice" as an attempt to write an
  // unknown field.
  //
  // So a send's data is passed through as message content and validated on its
  // own terms below. Nothing is written to the row either way, which is what
  // makes the exemption safe rather than a hole.
  const takesParams = action.writesRow === false;
  const data = takesParams
    ? { ...(query.data ?? {}) }
    : mapWritableData(entity, query.data, ctx.timezone);

  if (takesParams) {
    // The required-field loop below resolves each name against `entity.fields`
    // and skips anything it cannot find — which is EVERY parameter, since they
    // are not columns. So a parameter action's required list was silently
    // unenforced: "change my hours" with no day was accepted here and blew up
    // in the handler, instead of asking which day.
    //
    // Checked against the raw data, which is where parameters live.
    const missing = (action.requiredFields ?? []).filter(
      (key) => String(data[key] ?? '').trim() === ''
    );
    if (missing.length > 0) {
      throw new MissingFieldsError(query.entity, query.action, missing);
    }
  }

  // A required field must be MEANINGFULLY present, not merely a key.
  //
  // Asked "add a new service" with no details, the planner filled in
  // {service_name: "", duration_minutes: 0} — every required key present, every
  // value a placeholder. The old `=== undefined` check passed it, and the user
  // would have got a nameless zero-minute service instead of being asked.
  //
  // A required number of 0 is treated as missing too: a service of zero minutes
  // is not a thing anyone asked for. Optional numerics are untouched, so a
  // genuine zero price still works.
  const missingFields: string[] = [];

  for (const required of action.requiredFields ?? []) {
    const field = entity.fields[required];
    if (!field) continue;

    const value = data[field.column];
    const blank =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (typeof value === 'number' && value === 0);

    // A blank is the easy case. The harder one is a value that LOOKS supplied.
    //
    // Asked "הוסף משימה למשה" ("add a task for Moshe"), the planner wrote
    // title: "משימה חדשה" — literally "new task". Non-empty, so the blank check
    // passed it, and a task nobody described got created. Checking for emptiness
    // catches a lazy model; it does not catch a confident one.
    //
    // So a required TEXT value must be traceable to what the user actually said.
    // Not a synonym table and not a language rule — just: if none of these words
    // appear in the request, the user did not supply them, whatever language they
    // were speaking. Numbers are excluded because "an hour and a half" is a real
    // way to say 90.
    const invented =
      !blank &&
      typeof value === 'string' &&
      options.utterance !== undefined &&
      !isGroundedIn(value, options.utterance);

    if (blank || invented) missingFields.push(required);
  }

  // ALL of them, not the first. Asking "what is the name?" and then, one turn
  // later, "and the duration?" is a worse conversation than asking once.
  if (missingFields.length > 0) {
    throw new MissingFieldsError(query.entity, query.action, missingFields);
  }

  // Runs BEFORE the dry-run branch: a preview that quietly accepts a foreign
  // reference, and only rejects it after the user confirms, would be a confirm
  // dialog for something that was never going to work.
  await assertReferencesOwned(entity, data, ctx);

  const preview = takesParams
    ? describeParams(entity, query, data, options.language ?? 'en')
    : describe(entity, query, data, options.language ?? 'en', {
        target: options.targetName,
        references: options.referenceNames,
      });

  if (options.dryRun) {
    return { op: 'mutate', entity: query.entity, action: query.action, applied: false, preview };
  }

  const result = await handler(query, data, ctx);

  if (result.error) {
    logger.error(
      { err: result.error, entity: query.entity, action: query.action },
      'Write failed'
    );
    throw result.error;
  }

  logger.info(
    { userId: ctx.userId, entity: query.entity, action: query.action, consumer: ctx.consumer },
    'Write applied'
  );

  return {
    op: 'mutate',
    entity: query.entity,
    action: query.action,
    applied: true,
    row: (result.data as QueryRow) ?? undefined,
    preview,
  };
}

/** Whether the catalog says this write must be confirmed before it runs. */
export function requiresConfirmation(query: MutateQuery): boolean {
  const action = CATALOG.entities[query.entity]?.actions?.[query.action];
  // Unknown actions default to requiring confirmation. Failing safe matters
  // more than convenience on a write path.
  if (!action) return true;
  return action.requiresConfirmation || action.risk === 'delete' || action.risk === 'send';
}
