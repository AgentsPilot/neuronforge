// lib/server/business-os-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import { executeMutate } from '@/lib/business-os/bizql/mutate/MutateExecutor';
import { CATALOG } from '@/lib/business-os/catalog';
import type { FindQuery, MutateQuery, Predicate, SortSpec } from '@/lib/business-os/bizql/types';

const pluginName = 'business-os';

/**
 * Executor for the Business OS plugin — the user's OWN business records.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE BRIDGE, AND IT IS ALSO A TENANT BOUNDARY.
 *
 * Every other plugin reaches an external service the user has connected. This one
 * reaches the product's own tables, which means the usual protection — "they only
 * gave us a token for their own account" — does not apply. What protects the data
 * here is that `userId` comes from the CONNECTION, never from the parameters, and
 * is handed to the BizQL compiler which injects it into every query and refuses
 * to read it from the IR.
 *
 * So an agent cannot ask for another tenant's rows: there is no parameter that
 * would carry the request.
 *
 * NOTHING IS REIMPLEMENTED HERE. Reads go through the same compiler as the chat;
 * writes go through the same MutateExecutor. That is deliberate — every guard the
 * chat earned is a guard an agent inherits and cannot opt out of:
 *
 *   - unknown entity, field or action → hard error, never passed through
 *   - fields not marked writable → refused
 *   - required fields missing or blank → refused
 *   - foreign keys verified to belong to the caller before any write
 *   - actions declared but unwired → fail loudly, never a silent success
 *
 * A second implementation of any of those would be a second place for them to be
 * wrong, and this codebase has already paid for that lesson twice.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class BusinessOsPluginExecutor extends BasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // The ONLY source of tenant scoping. Deliberately not read from parameters:
    // a generated workflow must have no way to express "someone else's data".
    const userId: string | undefined = connection?.user_id;
    if (!userId) {
      throw new Error('business-os: no user context — refusing to run unscoped.');
    }

    const parsed = this.parseActionName(actionName);
    if (!parsed) {
      throw new Error(`Action ${actionName} not supported by business-os`);
    }

    const { verb, entityKey } = parsed;

    return verb === 'find'
      ? this.find(userId, entityKey, parameters)
      : this.write(userId, entityKey, verb, parameters);
  }

  /**
   * Split `send_contacts` into `{verb: 'send', entityKey: 'contacts'}`.
   *
   * Matched against the CATALOG rather than by splitting on the last underscore:
   * entity keys contain underscores (`page_views`), and a name-shaped guess would
   * turn `find_page_views` into the entity `views`, which does not exist. The
   * failure would be a confusing "unknown entity" rather than an obvious one.
   */
  private parseActionName(actionName: string): { verb: string; entityKey: string } | null {
    for (const entityKey of Object.keys(CATALOG.entities)) {
      const suffix = `_${entityKey}`;
      if (!actionName.endsWith(suffix)) continue;

      const verb = actionName.slice(0, -suffix.length);
      if (!verb) continue;

      const entity = CATALOG.entities[entityKey];
      if (verb === 'find' || entity.actions?.[verb]) return { verb, entityKey };
    }
    return null;
  }

  private async find(userId: string, entityKey: string, parameters: any): Promise<any> {
    const query: FindQuery = {
      op: 'find',
      entity: entityKey,
      where: (parameters?.filters ?? []) as Predicate[],
      order_by: parameters?.order_by as SortSpec[] | undefined,
      limit: typeof parameters?.limit === 'number' ? parameters.limit : undefined,
    };

    const result = await runBusinessQuery(query, { userId, consumer: 'kernel' });
    if (result.op !== 'find') throw new Error('business-os: expected a read result');

    return {
      rows: result.rows,
      count: result.rows.length,
      truncated: result.truncated,
      ...(result.collapsed ? { collapsed: result.collapsed } : {}),
    };
  }

  private async write(
    userId: string,
    entityKey: string,
    action: string,
    parameters: any
  ): Promise<any> {
    const query: MutateQuery = {
      op: 'mutate',
      entity: entityKey,
      action,
      ...(parameters?.target_id ? { target: { id: String(parameters.target_id) } } : {}),
      data: parameters?.data,
    };

    // No `utterance`, so the grounding check that stops the chat planner
    // inventing a value is not applied here — an agent's parameters come from a
    // reviewed workflow rather than a sentence, and there is no user request to
    // check them against. Blank and missing required fields are still refused.
    const result = await executeMutate(query, { userId, consumer: 'kernel' });

    return {
      applied: result.applied,
      summary: result.preview ?? `${entityKey}.${action}`,
      ...(result.row ? { row: result.row } : {}),
    };
  }
}
