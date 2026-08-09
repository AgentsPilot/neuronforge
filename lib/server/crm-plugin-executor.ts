// lib/server/crm-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import { crmContactRepository, CRMContactUpdate } from '@/lib/repositories/CRMContactRepository';
import { crmTaskRepository, CRMTaskUpdate } from '@/lib/repositories/CRMTaskRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';

const pluginName = 'crm';

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
 * cross-capability side-effects. The existing Postgres triggers own them — in particular
 * trigger T8 logs a `contact_created` activity on every `crm_contacts` INSERT, so
 * `create_contact` must NOT also write that activity (would double-log). `update_contact` and
 * `move_stage` write no activity. `log_activity` is the ONLY activity-writing operation, and it
 * writes exactly the caller-supplied activity — nothing implicit.
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
        return this.unwrap(await crmContactRepository.delete(params.id, userId));

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
