// lib/server/intake-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import { intakeRepository, type UserIntakeSettings } from '@/lib/repositories/IntakeRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

const pluginName = 'intake';

/**
 * Internal Intake plugin executor.
 *
 * Repository-backed: every operation delegates to `intakeRepository` (the sole data path for the
 * two owned intake tables). `businessProfileRepository` is used to resolve the account's `vertical`
 * for template listing. No external API and no OAuth — gated by the `db_active` access strategy, so
 * `connection.user_id` is a verified BOS tenant by the time an action runs.
 *
 * This is a CONFIGURATION surface only: a global read-only template catalog plus a single per-user
 * settings row. It never reads or writes client form responses (that booking-response flow belongs
 * to Scheduling). The only trigger on the owned tables is an `updated_at` maintenance trigger — no
 * cross-capability side-effects, so nothing to delegate.
 *
 * GUARDRAILS:
 * - **M1 (settings patch allow-list).** `update_intake_settings` builds the patch from an EXPLICIT
 *   4-field allow-list (`template_id` / `is_enabled` / `collect_during_booking` /
 *   `send_after_booking`) picked individually from `params` — the raw `params` object is NEVER
 *   forwarded to `upsertSettings`. `upsertSettings` spreads `...settings` and `parameters` is `any`,
 *   so forwarding raw params would let a caller-supplied `params.user_id` reach the
 *   `onConflict:'user_id'` target and overwrite another tenant's row. (Repo-side defense-in-depth
 *   also moves `user_id` after the spread — see IntakeRepository.)
 * - **M2 (global catalog).** Template reads pass NO `userId` — `intake_form_templates` has no
 *   `user_id` column and the repo methods take no such arg. There is nothing to scope; no defensive
 *   phantom filter is added.
 */
export class IntakePluginExecutor extends BasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    const userId: string | undefined = connection?.user_id;
    if (!userId) {
      throw new Error('access_denied: missing user context for Intake operation');
    }
    const params = parameters || {};

    switch (actionName) {
      // ---------------- TEMPLATES (global catalog — no userId) ----------------
      case 'list_intake_templates':
        return this.listTemplates(userId);

      case 'get_intake_template': {
        this.requireParam(params.id, 'id');
        const template = this.unwrap(await intakeRepository.getTemplateById(params.id));
        // getTemplateById returns { data: null, error: null } for PGRST116 (not found) — treat a
        // missing template as an error result, mirroring templates/[id]/route.ts:54.
        if (!template) {
          throw new Error('not_found: no intake template with that id');
        }
        return template;
      }

      // ---------------- SETTINGS (per-user row) ----------------
      case 'get_intake_settings':
        return this.getSettings(userId);

      case 'update_intake_settings':
        return this.updateSettings(userId, params);

      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  /** Internal plugins hold no token — trivial active status. */
  protected async performConnectionTest(connection: any): Promise<any> {
    return { status: 'active', internal: true, user_id: connection?.user_id };
  }

  // ---------------- list_intake_templates ----------------

  /**
   * Resolve the account's vertical from its business profile (NEVER from params) and list that
   * vertical's templates merged with the generic 'other' set — mirroring templates/route.ts:40-47.
   */
  private async listTemplates(userId: string): Promise<any> {
    const profile = this.unwrap(await businessProfileRepository.findByUserId(userId));
    const vertical = (profile as { vertical?: string } | null)?.vertical || 'other';

    const verticalTemplates = this.unwrap(await intakeRepository.listTemplatesByVertical(vertical)) || [];

    let allTemplates = verticalTemplates;
    if (vertical !== 'other') {
      const genericTemplates = this.unwrap(await intakeRepository.listTemplatesByVertical('other')) || [];
      if (genericTemplates.length > 0) {
        allTemplates = [...allTemplates, ...genericTemplates];
      }
    }

    return { vertical, templates: allTemplates };
  }

  // ---------------- get_intake_settings ----------------

  /**
   * Return the settings row (with template) or SYNTHESIZE the disabled defaults when no row exists,
   * mirroring settings/route.ts:50-61 — never returns null.
   */
  private async getSettings(userId: string): Promise<any> {
    const settings = this.unwrap(await intakeRepository.getSettingsWithTemplate(userId));
    if (!settings) {
      return {
        is_enabled: false,
        template_id: null,
        template: null,
        collect_during_booking: true,
        send_after_booking: false,
      };
    }
    return settings;
  }

  // ---------------- update_intake_settings (M1) ----------------

  /**
   * M1 (load-bearing): build the settings patch from an EXPLICIT 4-field allow-list — never forward
   * raw `params`. If a template_id is supplied, validate it against the global catalog first (a
   * PGRST116 not-found comes back as { data: null } → check `!template`), mirroring
   * settings/route.ts:114-126.
   */
  private async updateSettings(userId: string, params: any): Promise<any> {
    const patch: Partial<Pick<UserIntakeSettings, 'template_id' | 'is_enabled' | 'collect_during_booking' | 'send_after_booking'>> = {};
    if (params.template_id !== undefined) patch.template_id = params.template_id;
    if (params.is_enabled !== undefined) patch.is_enabled = params.is_enabled;
    if (params.collect_during_booking !== undefined) patch.collect_during_booking = params.collect_during_booking;
    if (params.send_after_booking !== undefined) patch.send_after_booking = params.send_after_booking;

    // Validate template_id exists (truthy — null/clear needs no lookup).
    if (patch.template_id) {
      const template = this.unwrap(await intakeRepository.getTemplateById(patch.template_id));
      if (!template) {
        throw new Error('not_found: no intake template with that id');
      }
    }

    return this.unwrap(await intakeRepository.upsertSettings(userId, patch));
  }

  // ---------------- helpers ----------------

  private unwrap<T>(result: { data: T | null; error: Error | null }): T | null {
    if (result.error) throw result.error;
    return result.data;
  }

  private requireParam(value: unknown, name: string): void {
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required parameter: ${name}`);
    }
  }
}
