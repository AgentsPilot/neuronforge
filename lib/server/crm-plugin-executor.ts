// lib/server/crm-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import { crmContactRepository, CRMContactUpdate } from '@/lib/repositories/CRMContactRepository';
import { deleteContact as removeContact } from '@/lib/services/ContactLifecycleService';
import { crmTaskRepository, CRMTaskUpdate } from '@/lib/repositories/CRMTaskRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';

const pluginName = 'crm';

/** A template that may arrive as an object or as the JSON string of one. */
function readTemplateParam(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Internal CRM plugin executor.
 *
 * A repository-backed executor: every operation delegates 1:1 to the CRM repositories
 * (`lib/repositories/CRM*Repository.ts`), which are the sole data path for the CRM tables.
 * There is no external API and no OAuth — the plugin is gated by the `db_active` access
 * strategy (see lib/server/access-strategy.ts), so by the time an action runs the caller is a
 * verified BOS tenant and `connection.user_id` is the server-resolved user id.
 *
 * GUARDRAIL (SA feasibility review §2.5): this executor DELEGATES ONLY and must NOT re-emit
 * cross-capability side-effects. The conclusion still holds and the reason has changed:
 * `create_contact` must NOT write a `contact_created` activity, because
 * `CRMContactRepository.create` writes it for every creation path.
 *
 * It was trigger T8 that owned this. That trigger turned out not to be live (measured on
 * production 2026-10-08), which is why nine of the ten creation paths — this one included —
 * recorded nothing at all. Writing it here now would double-log.
 *
 * `update_contact` and `move_stage` write no activity. `log_activity` is the ONLY
 * activity-writing operation, and it writes exactly the caller-supplied activity — nothing
 * implicit.
 */
export class CRMPluginExecutor extends BasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // Defense-in-depth: the access strategy already resolved an eligible tenant, but never
    // execute a repository call without a concrete server-resolved user id.
    const userId: string | undefined = connection?.user_id;
    if (!userId) {
      throw new Error('access_denied: missing user context for CRM operation');
    }

    const params = parameters || {};

    switch (actionName) {
      // ---------------- CONTACTS ----------------
      case 'create_contact':
        // Delegates to repo.create ONLY. Trigger T8 logs `contact_created`; do not emit here.
        return this.unwrap(
          await crmContactRepository.create({
            user_id: userId,
            first_name: params.first_name ?? null,
            last_name: params.last_name ?? null,
            email: params.email ?? null,
            phone: params.phone ?? null,
            stage: params.stage,
            tags: params.tags,
            custom_fields: params.custom_fields,
            source: params.source ?? null,
          })
        );

      /*
       * ─────────────────────────────────────────────────────────────────────
       * AN ENQUIRY, NOT A ROW.
       *
       * `create_contact` above is a plain insert, and that is the wrong tool
       * for somebody who has just written in: it does not resolve the owner's
       * first pipeline stage, it duplicates a person who has enquired before,
       * and it files no message on the timeline. All three were got wrong
       * inline at least once before this moved into one function.
       *
       * Delegates to the SAME function the website's own contact form calls,
       * so an enquiry read out of a mailbox becomes a row indistinguishable
       * from one typed into the form — including on the day one of those
       * rules changes. That is the whole point of the action existing.
       *
       * `user_id` is the server-resolved connection owner, as everywhere else
       * in this file: the caller names the enquirer, never the business.
       * ─────────────────────────────────────────────────────────────────────
       */
      case 'capture_enquiry': {
        /*
         * ─────────────────────────────────────────────────────────────────
         * TWO CALLERS, TWO SHAPES.
         *
         * A web form already HAS the fields, so it sends them. A mailbox
         * agent has a message, so it sends that and the template learned
         * from the owner's own mail during setup — and our code reads it.
         *
         * Deliberately not a model: everything filed here is emailed to the
         * address found, fifteen minutes later, by the unanswered-enquiry
         * chase. `parseEnquiry` returns an address only when it appears
         * verbatim in the message, so a message we cannot read files
         * nothing and the agent leaves it UNREAD for a person — rather than
         * a plausible address nobody typed reaching a stranger.
         * ─────────────────────────────────────────────────────────────────
         */
        /*
         * A REFERENCE THAT DID NOT RESOLVE IS NOT CONTENT.
         *
         * Outlook returns ONE body per message — `body` for a text message,
         * `html` for an HTML one, never both — and the Outlook plan passes both
         * refs because it cannot know which it will get. So one of the two
         * arrives as the unsubstituted `{{current_email.html}}`.
         *
         * Left alone, that literal becomes the message text: `parseEnquiry`
         * finds no address in it, files nothing, and the enquiry stays unread
         * forever. It fails safe but it fails — so an unresolved reference is
         * read as the absence it actually is.
         */
        const resolved = (value: unknown): string | null => {
          if (typeof value !== 'string') return null;
          const trimmed = value.trim();
          if (!trimmed || /^\{\{[^}]*\}\}$/.test(trimmed)) return null;
          return value;
        };

        const rawBody = resolved(params.raw_body);
        const rawHtml = resolved(params.raw_html);

        if (rawBody || rawHtml) {
          const { captureEnquiryFromEmail } = await import(
            '@/lib/business-os/leads/captureEnquiry'
          );

          const outcome = await captureEnquiryFromEmail({
            ownerId: userId,
            subject: resolved(params.subject),
            body: rawBody,
            html: rawHtml,
            /* The headers that usually carry the enquirer. `from` is passed so
               it can be EXCLUDED — it is the business, never the lead. */
            replyTo: resolved(params.reply_to),
            cc: resolved(params.cc),
            from: resolved(params.from),
            /* The notification was sent TO the owner, so this IS the owner's
               address: free, already on the message, and what stops the
               business being filed as its own customer. */
            owner: resolved(params.to),
            provider: resolved(params.via),
            /*
             * Tolerant of a JSON string as well as an object.
             *
             * The schema says object and the stored value is one, but a
             * template that arrives stringified — an older agent, a hand-made
             * call — should be read rather than silently treated as a
             * template with no labels, which is indistinguishable from "this
             * form labels nothing" and quietly degrades every parse.
             */
            template: readTemplateParam(params.template),
            ...(params.source ? { source: params.source } : {}),
            ...(params.activity_key ? { activityKey: params.activity_key } : {}),
          });

          /* Reported, never thrown: "this message was not an enquiry" is an
             outcome the agent must be able to act on by leaving it unread. */
          return outcome.filed
            ? { contact_id: outcome.contactId, is_new_contact: outcome.isNewContact, filed: true }
            : { filed: false, reason: outcome.reason };
        }

        this.requireParam(params.email, 'email');
        this.requireParam(params.message, 'message');

        const { captureEnquiry } = await import('@/lib/business-os/leads/captureEnquiry');

        const captured = await captureEnquiry({
          ownerId: userId,
          email: params.email,
          message: params.message,
          name: params.name ?? null,
          phone: params.phone ?? null,
          serviceInterest: params.service_interest ?? null,
          referralSource: params.referral_source ?? null,
          pageUrl: params.page_url ?? null,
          ...(params.source ? { source: params.source } : {}),
          ...(params.activity_key ? { activityKey: params.activity_key } : {}),
        });

        return { contact_id: captured.contactId, is_new_contact: captured.isNewContact };
      }

      case 'get_contact':
        this.requireParam(params.id, 'id');
        return this.unwrap(await crmContactRepository.findById(params.id, userId));

      case 'list_contacts':
        return this.unwrap(
          await crmContactRepository.list(userId, {
            stage: params.stage,
            tags: params.tags,
            search: params.search,
            limit: params.limit,
            offset: params.offset,
            orderBy: params.order_by,
            orderDirection: params.order_direction,
          })
        );

      case 'count_contacts':
        return this.unwrap(
          await crmContactRepository.count(userId, {
            stage: params.stage,
            tags: params.tags,
            search: params.search,
          })
        );

      case 'update_contact':
        // Pure contact update — no activity emission.
        this.requireParam(params.id, 'id');
        return this.unwrap(
          await crmContactRepository.update(params.id, userId, this.buildContactUpdate(params))
        );

      case 'move_stage': {
        // Pure stage change — no activity emission. Stage validation is OFF by default (A3):
        // enabling it could reject a stage the legacy path accepted. Opt in with validate_stage.
        this.requireParam(params.id, 'id');
        this.requireParam(params.stage, 'stage');
        if (params.validate_stage === true) {
          const stages = this.unwrap(await crmPipelineStagesRepository.list(userId));
          const known = (stages || []).some((s: any) => s.stage_key === params.stage);
          if (!known) {
            throw new Error(`invalid_stage: "${params.stage}" is not a configured pipeline stage`);
          }
        }
        return this.unwrap(await crmContactRepository.updateStage(params.id, userId, params.stage));
      }

      case 'delete_contact':
        this.requireParam(params.id, 'id');
        // Via the service — see `ContactLifecycleService`: a contact with any
        // booking cannot be deleted directly, and money refuses the delete.
        return this.unwrap(await removeContact({ contactId: params.id, userId }));

      // ---------------- TASKS ----------------
      case 'add_task':
        this.requireParam(params.title, 'title');
        return this.unwrap(
          await crmTaskRepository.create({
            user_id: userId,
            contact_id: params.contact_id ?? null,
            title: params.title,
            description: params.description ?? null,
            priority: params.priority,
            status: params.status,
            due_date: params.due_date ?? null,
            reminder_at: params.reminder_at ?? null,
            tags: params.tags,
          })
        );

      case 'get_task':
        this.requireParam(params.id, 'id');
        return this.unwrap(await crmTaskRepository.findById(params.id, userId));

      case 'list_tasks':
        return this.unwrap(
          await crmTaskRepository.list(userId, {
            contact_id: params.contact_id,
            status: params.status,
            priority: params.priority,
            due_before: params.due_before,
            due_after: params.due_after,
            include_completed: params.include_completed,
            search: params.search,
            limit: params.limit,
            offset: params.offset,
            orderBy: params.order_by,
            orderDirection: params.order_direction,
          })
        );

      case 'count_tasks':
        return this.unwrap(await crmTaskRepository.countByStatus(userId, params.contact_id));

      case 'update_task':
        this.requireParam(params.id, 'id');
        return this.unwrap(
          await crmTaskRepository.update(params.id, userId, this.buildTaskUpdate(params))
        );

      case 'complete_task':
        this.requireParam(params.id, 'id');
        return this.unwrap(await crmTaskRepository.complete(params.id, userId));

      case 'delete_task':
        this.requireParam(params.id, 'id');
        return this.unwrap(await crmTaskRepository.delete(params.id, userId));

      // ---------------- ACTIVITIES ----------------
      case 'log_activity':
        // The ONLY activity-writing operation. Writes exactly the caller-supplied activity.
        this.requireParam(params.contact_id, 'contact_id');
        this.requireParam(params.activity_type, 'activity_type');
        this.requireParam(params.title, 'title');
        return this.unwrap(
          await crmActivityRepository.create({
            user_id: userId,
            contact_id: params.contact_id,
            activity_type: params.activity_type,
            title: params.title,
            description: params.description ?? null,
            source_capability: params.source_capability ?? 'manual',
            source_entity_id: params.source_entity_id ?? null,
            activity_date: params.activity_date,
          })
        );

      case 'list_activities':
        this.requireParam(params.contact_id, 'contact_id');
        return this.unwrap(
          await crmActivityRepository.getForContact(params.contact_id, userId, params.limit ?? 50)
        );

      // ---------------- PIPELINE ----------------
      case 'list_pipeline_stages':
        return this.unwrap(await crmPipelineStagesRepository.list(userId));

      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  /** Internal plugins hold no token — report a trivial active status instead of a token probe. */
  protected async performConnectionTest(connection: any): Promise<any> {
    return { status: 'active', internal: true, user_id: connection?.user_id };
  }

  /**
   * Unwrap a repository `{ data, error }` result: throw on error so BasePluginExecutor maps it
   * to a failure ExecutionResult; otherwise return the data.
   */
  private unwrap<T>(result: { data: T | null; error: Error | null }): T | null {
    if (result.error) {
      throw result.error;
    }
    return result.data;
  }

  private requireParam(value: unknown, name: string): void {
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required parameter: ${name}`);
    }
  }

  /** Only forward contact fields the repository update accepts (no user_id / no implicit churn). */
  private buildContactUpdate(params: any): CRMContactUpdate {
    const update: CRMContactUpdate = {};
    const keys: (keyof CRMContactUpdate)[] = ['first_name', 'last_name', 'email', 'phone', 'stage', 'tags', 'custom_fields'];
    for (const key of keys) {
      if (params[key] !== undefined) {
        update[key] = params[key];
      }
    }
    return update;
  }

  private buildTaskUpdate(params: any): CRMTaskUpdate {
    const update: CRMTaskUpdate = {};
    const keys: (keyof CRMTaskUpdate)[] = ['title', 'description', 'priority', 'status', 'due_date', 'reminder_at', 'contact_id', 'tags'];
    for (const key of keys) {
      if (params[key] !== undefined) {
        update[key] = params[key];
      }
    }
    return update;
  }
}
