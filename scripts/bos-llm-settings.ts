/**
 * bos-llm-settings — read, change and verify the Business OS LLM area settings
 * (FR-17, DEC-10, RC-9).
 *
 * Until the admin screen ships, this script and the seed migration are the ONLY
 * ways an area row changes: the generic `PUT /api/admin/system-config` refuses
 * every `bos_llm_area_*` key. Everything it writes has already passed the
 * resolver's own schema and guardrails, so a row the resolver would refuse to
 * honour can never reach the database.
 *
 *   npm run bos:llm-settings -- get <area>
 *   npm run bos:llm-settings -- set <area> --file row.json [--dry-run]
 *   npm run bos:llm-settings -- set <area> --enabled false [--include-calls] [--dry-run]
 *   npm run bos:llm-settings -- verify-stored        (read-only, apply pre-check P-3)
 *   npm run bos:llm-settings -- verify-equivalence   (read-only, post-seed check P-5b)
 *
 * ENVIRONMENT — read this before changing the invocation (S1-1). Plain
 * `npx tsx scripts/bos-llm-settings.ts …` does NOT work: `lib/supabaseServer.ts`
 * builds the service-role client at *import*, and ES imports run before any
 * statement this file could execute, so the process dies with
 * `Error: supabaseUrl is required` before it can even print its usage. The
 * variables must be in the environment BEFORE the first import, which is what
 * the npm script above does. The long form, if you are not using npm:
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/bos-llm-settings.ts <command>
 *
 * Both read `.env.local` from the current working directory, so run them from
 * the repository root. Every command logs the Supabase host it is about to talk
 * to before doing anything — check it before acting on an exit code, because
 * P-3 and P-5b are normally run against production (S1-11).
 *
 * Exit code 0 means "nothing is wrong"; any other code means STOP — for
 * `verify-stored` and `verify-equivalence` that is an instruction, not advice
 * (§9 P-3 / P-5b).
 *
 * DATA ACCESS: through `SystemConfigRepository`, whose default client is the
 * service role. That is intentional and unavoidable here — `system_settings_config`
 * is platform-wide data with no tenant column, and since the Step 0 migration
 * only platform admins may write it. The script is run by an operator from a
 * shell with `.env.local`, never from a request path, and takes no user input
 * beyond its own arguments.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §3.6, §9
 * @module scripts/bos-llm-settings
 */

import * as fs from 'fs';
import * as path from 'path';

import { BOS_LLM_AREAS, type BosLlmArea } from '@/lib/business-os/llm/callCatalog';
import {
  bosLlmCodeDefaults,
  validateAreaRow,
  type BosLlmSettingIssue,
  type ResolvedBosLlmSettings,
} from '@/lib/business-os/llm/modelSettings';
import {
  BOS_LLM_SETTINGS_CATEGORY,
  bosLlmAreaKey,
  bosLlmSettingsCallNames,
} from '@/lib/business-os/llm/modelSettingsPolicy';
import { asRowObject } from '@/lib/business-os/llm/modelSettingsSchema';
import { createLogger } from '@/lib/logger';
import { systemConfigRepository } from '@/lib/repositories/SystemConfigRepository';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'BosLlmSettingsScript' });

const USAGE = [
  'get <area>',
  'set <area> --file <row.json> [--dry-run]',
  'set <area> --enabled <true|false> [--include-calls] [--dry-run]',
  'verify-stored',
  'verify-equivalence',
].join(' | ');

// ---------------------------------------------------------------------------
// The six single-purpose keys Layer 2 supersedes (F-3)
// ---------------------------------------------------------------------------

/**
 * Each legacy key, the call it becomes, and the reader that is deployed TODAY.
 *
 * `legacy()` deliberately calls the real getters the running code uses —
 * `SystemConfigService` for chat (deprecated, but that is what `Planner` and
 * `AnalysisService` call), the repository for leads, and the image
 * configuration reader for images. Re-implementing them here would test the
 * re-implementation, not the deploy.
 */
interface LegacyField {
  key: string;
  area: BosLlmArea;
  callName: string;
  field: 'model' | 'enabled';
  legacy: () => Promise<string | boolean>;
}

const LEGACY_FIELDS: readonly LegacyField[] = [
  {
    key: 'bizchat_planner_model',
    area: 'chat',
    callName: 'planner',
    field: 'model',
    legacy: () => SystemConfigService.getString(supabaseServer, 'bizchat_planner_model', 'gpt-4o-mini'),
  },
  {
    key: 'bizchat_analysis_model',
    area: 'chat',
    callName: 'analysis',
    field: 'model',
    legacy: () => SystemConfigService.getString(supabaseServer, 'bizchat_analysis_model', 'gpt-4o-mini'),
  },
  {
    key: 'bizchat_analysis_enabled',
    area: 'chat',
    callName: 'analysis',
    field: 'enabled',
    legacy: () => SystemConfigService.getBoolean(supabaseServer, 'bizchat_analysis_enabled', true),
  },
  {
    key: 'lead_reply_recommender_model',
    area: 'leads',
    callName: 'reply_recommendation',
    field: 'model',
    legacy: () => systemConfigRepository.getString('lead_reply_recommender_model', 'gpt-4o-mini'),
  },
  {
    key: 'lead_reply_recommender_enabled',
    area: 'leads',
    callName: 'reply_recommendation',
    field: 'enabled',
    legacy: () => systemConfigRepository.getBoolean('lead_reply_recommender_enabled', true),
  },
  {
    key: 'image_generation_model',
    area: 'images',
    callName: 'image_generation',
    field: 'model',
    legacy: async () => (await systemConfigRepository.getImageGenerationConfig()).model,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isArea(value: string): value is BosLlmArea {
  return (BOS_LLM_AREAS as readonly string[]).includes(value);
}

/**
 * Name the database before doing anything (S1-11).
 *
 * P-3 and P-5b are run by hand, usually against production, from a worktree
 * whose `.env.local` was copied in. An operator must be able to see WHICH
 * project an exit code refers to before acting on it. Host only — never a key.
 */
function logTarget(command: string): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  let host = 'unknown';
  try {
    host = url ? new URL(url).host : 'unset';
  } catch {
    host = 'unparseable';
  }
  logger.info({ command, supabaseHost: host }, 'Business OS LLM settings script');
}

function describeIssues(issues: readonly BosLlmSettingIssue[]): Array<Record<string, unknown>> {
  return issues.map((issue) => ({
    level: issue.level,
    callName: issue.callName,
    field: issue.field,
    kind: issue.kind,
    reason: issue.reason,
    value: issue.value,
  }));
}

function resolvedToPlain(resolved: Map<string, ResolvedBosLlmSettings>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [callName, settings] of resolved) {
    out[callName] = {
      enabled: settings.enabled,
      provider: settings.provider,
      model: settings.model,
      // `undefined` disappears from a JSON log line, so "not set" is explicit.
      temperature: settings.temperature === undefined ? 'not set' : settings.temperature,
    };
  }
  return out;
}

/**
 * Is a stored legacy value one that today's reader and the seed SQL agree on
 * (RC-W1a)?
 *
 * The seed's unwrap rules map anything unrecognised to NULL, which becomes the
 * code default — but today's readers map an unrecognised boolean-ish value
 * (`"no"`, `"0"`, `0`) to **false**. Seeding such a value would silently switch
 * a feature back ON, so the apply stops instead.
 */
export function isCanonicalLegacyValue(field: 'model' | 'enabled', value: unknown): boolean {
  if (field === 'enabled') {
    if (typeof value === 'boolean') return true;
    if (typeof value !== 'string') return false;
    return ['true', 'false'].includes(value.trim().toLowerCase()) && value === value.trim();
  }
  if (typeof value !== 'string') return false;
  const text = value;
  if (text !== text.trim() || text.length === 0) return false;
  if (text.includes('"')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function commandGet(area: BosLlmArea): Promise<number> {
  const key = bosLlmAreaKey(area);
  const { data, error } = await systemConfigRepository.getByKey(key);
  if (error) {
    logger.error({ err: error, area, key }, 'Could not read the area row');
    return 2;
  }

  const validation = await validateAreaRow(area, data?.value);
  logger.info(
    {
      area,
      key,
      rowPresent: Boolean(data),
      rowUpdatedAt: (data as { updated_at?: string } | null)?.updated_at ?? null,
      row: data?.value ?? null,
      resolved: resolvedToPlain(validation.resolved),
      areaEnabled: validation.enabled,
      issues: describeIssues([...validation.rejected, ...validation.adjusted]),
    },
    'Business OS LLM area settings'
  );
  return 0;
}

interface SetOptions {
  file?: string;
  enabled?: boolean;
  includeCalls: boolean;
  dryRun: boolean;
}

async function commandSet(area: BosLlmArea, options: SetOptions): Promise<number> {
  const key = bosLlmAreaKey(area);
  const { data: stored, error: readError } = await systemConfigRepository.getByKey(key);
  if (readError) {
    logger.error({ err: readError, area, key }, 'Could not read the current row; nothing written');
    return 2;
  }

  let candidate: Record<string, unknown>;

  if (options.file) {
    const filePath = path.resolve(options.file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      logger.error({ err: error, file: filePath }, 'Could not read or parse the row file; nothing written');
      return 2;
    }
    const object = asRowObject(parsed);
    if (!object) {
      logger.error({ file: filePath }, 'The row file is not a JSON object; nothing written');
      return 2;
    }
    candidate = object;
  } else {
    const current = asRowObject(stored?.value) ?? {};
    candidate = { ...current, enabled: options.enabled };

    // RC-W8c: an emergency switch must do what it says. A call-level
    // `enabled: true` would keep that call running after `--enabled false`.
    if (options.enabled === false) {
      const calls = asRowObject(current.calls) ?? {};
      const stillOn = Object.entries(calls)
        .filter(([, entry]) => (asRowObject(entry) ?? {}).enabled === true)
        .map(([callName]) => callName);

      if (stillOn.length > 0 && !options.includeCalls) {
        logger.error(
          { area, callsStillEnabled: stillOn },
          'These call-level overrides would keep calls running; re-run with --include-calls. Nothing written'
        );
        return 1;
      }
      if (stillOn.length > 0) {
        const nextCalls: Record<string, unknown> = { ...calls };
        for (const callName of stillOn) {
          nextCalls[callName] = { ...(asRowObject(calls[callName]) ?? {}), enabled: false };
        }
        candidate.calls = nextCalls;
      }

      /*
       * The S1-7 "PARTIAL SWITCH" warning used to stand here, and Step 3
       * deleted it rather than letting it self-clear into a lie.
       *
       * It listed the calls of this area that `isSwitchableBosLlmCall` says
       * cannot be switched off, because between Steps 2 and 3 three website
       * calls had no "AI unavailable" path and kept spending after
       * `--enabled false`. Step 3 shipped those paths and made all three
       * switchable, so for `website` the list is now empty — but the predicate
       * would still have named `chat/planner`, which is NOT a call that keeps
       * spending: the planner has no switch of its own precisely because the
       * chat area switch stops it at route entry (D-27). Warning about it would
       * tell an operator their kill switch is partial when it is complete.
       *
       * What guards the underlying risk now is a test rather than a runtime
       * line nobody may read: `modelSettingsPolicy.test.ts` asserts that every
       * non-switchable call is either in an area that cannot be switched off at
       * all or is one of the calls a route-entry gate stops. A future call
       * added with `switchable: false` and no off path fails the suite.
       */
    }
  }

  const validation = await validateAreaRow(area, candidate);
  if (!validation.ok) {
    logger.error(
      { area, key, rejected: describeIssues(validation.rejected) },
      'The row was refused by the resolver guardrails; nothing written'
    );
    return 1;
  }
  if (validation.adjusted.length > 0) {
    logger.warn({ area, adjusted: describeIssues(validation.adjusted) }, 'Accepted, with adjustments');
  }

  if (options.dryRun) {
    logger.info(
      {
        area,
        key,
        before: stored?.value ?? null,
        after: candidate,
        resolved: resolvedToPlain(validation.resolved),
      },
      'Dry run: nothing written'
    );
    return 0;
  }

  const { error: writeError } = await systemConfigRepository.set(
    key,
    candidate,
    BOS_LLM_SETTINGS_CATEGORY,
    `Business OS LLM model settings for the ${area} area (Layer 2)`
  );
  if (writeError) {
    logger.error({ err: writeError, area, key }, 'Write failed');
    return 2;
  }

  logger.info(
    { area, key, row: candidate, resolved: resolvedToPlain(validation.resolved) },
    'Business OS LLM area settings written'
  );
  return 0;
}

/**
 * P-3, the pre-apply check: every stored legacy value must be canonical AND
 * pass the guardrails, or the seed would change behaviour on apply.
 */
async function commandVerifyStored(): Promise<number> {
  const keys = LEGACY_FIELDS.map((field) => field.key);
  const { data, error } = await systemConfigRepository.getByKeys(keys);
  if (error || !data) {
    logger.error({ err: error }, 'Could not read the stored legacy keys; STOP');
    return 2;
  }

  const byKey = new Map(data.map((row) => [row.key, row.value]));
  const problems: Array<Record<string, unknown>> = [];
  const present: string[] = [];
  const absent: string[] = [];

  for (const field of LEGACY_FIELDS) {
    if (!byKey.has(field.key)) {
      absent.push(field.key);
      logger.info({ key: field.key }, 'Not stored; the seed will use the code default');
      continue;
    }
    present.push(field.key);
    const value = byKey.get(field.key);

    if (!isCanonicalLegacyValue(field.field, value)) {
      problems.push({ key: field.key, reason: 'not_canonical', valueType: typeof value, value });
      continue;
    }

    if (field.field === 'model') {
      // Run the value through the same guardrails the resolver applies.
      const row = { calls: { [field.callName]: { model: value } } };
      // eslint-disable-next-line no-await-in-loop -- six fields, run once by an operator
      const validation = await validateAreaRow(field.area, row);
      if (!validation.ok) {
        problems.push({ key: field.key, reason: 'guardrail', value, rejected: describeIssues(validation.rejected) });
        continue;
      }
    }

    logger.info({ key: field.key, value }, 'Canonical and accepted');
  }

  if (problems.length > 0) {
    logger.error({ problems }, 'STOP: a stored value is non-canonical or would be refused. Do not apply the seed');
    return 1;
  }

  // D-Q3: "checked: 6" read as "six values examined" when six keys were simply
  // ABSENT. P-3 is the one hard stop between a non-canonical value and a
  // feature silently switching back on, so its success line must not flatter
  // itself: say how many were actually examined and how many will be written
  // from the code defaults instead.
  const checked = present.length;
  logger.info(
    { keys: LEGACY_FIELDS.length, checked, notStored: absent.length, present, absent },
    checked === 0
      ? 'No legacy value is stored: nothing to check, and the seed will write the code defaults for all six'
      : `${checked} stored legacy value(s) are canonical and accepted; ${absent.length} not stored (code defaults)`
  );
  return 0;
}

/**
 * P-5b, the post-seed parity check: what the still-deployed legacy readers
 * return must equal what the resolver returns from the seeded rows. Any
 * difference means the seed changed behaviour — roll it back at once
 * (`DELETE FROM system_settings_config WHERE key LIKE 'bos\\_llm\\_area\\_%'`,
 * safe while no code reads the rows) and escalate.
 */
async function commandVerifyEquivalence(): Promise<number> {
  const differences: Array<Record<string, unknown>> = [];

  for (const field of LEGACY_FIELDS) {
    // eslint-disable-next-line no-await-in-loop -- six fields, run once by an operator
    const legacyValue = await field.legacy();
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await systemConfigRepository.getByKey(bosLlmAreaKey(field.area));
    if (error) {
      logger.error({ err: error, area: field.area }, 'Could not read the seeded row; STOP');
      return 2;
    }
    // eslint-disable-next-line no-await-in-loop
    const validation = await validateAreaRow(field.area, data?.value);
    const resolved = validation.resolved.get(field.callName) ?? bosLlmCodeDefaults(field.area, field.callName);
    const resolvedValue = field.field === 'model' ? resolved.model : resolved.enabled;

    if (resolvedValue !== legacyValue) {
      differences.push({
        key: field.key,
        area: field.area,
        callName: field.callName,
        field: field.field,
        legacy: legacyValue,
        resolved: resolvedValue,
      });
    } else {
      logger.info(
        { key: field.key, area: field.area, callName: field.callName, field: field.field, value: legacyValue },
        'Legacy reader and resolver agree'
      );
    }
  }

  if (differences.length > 0) {
    logger.error(
      { differences },
      'STOP: the legacy readers and the resolver disagree. Roll the seed back and escalate'
    );
    return 1;
  }
  logger.info({ checked: LEGACY_FIELDS.length }, 'Legacy readers and resolver agree on every field');
  return 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Parse and run one invocation. Returns the process exit code; never throws. */
export async function runBosLlmSettingsCommand(argv: readonly string[]): Promise<number> {
  try {
    const [command, ...rest] = argv;
    logTarget(command ?? '(none)');

    if (command === 'verify-stored') return await commandVerifyStored();
    if (command === 'verify-equivalence') return await commandVerifyEquivalence();

    if (command === 'get' || command === 'set') {
      const area = rest[0];
      if (!area || !isArea(area)) {
        logger.error({ area, areas: BOS_LLM_AREAS }, `Unknown area. Usage: ${USAGE}`);
        return 2;
      }
      if (command === 'get') return await commandGet(area);

      const flags = rest.slice(1);
      const options: SetOptions = {
        includeCalls: flags.includes('--include-calls'),
        dryRun: flags.includes('--dry-run'),
      };
      const fileIndex = flags.indexOf('--file');
      if (fileIndex >= 0) options.file = flags[fileIndex + 1];
      const enabledIndex = flags.indexOf('--enabled');
      if (enabledIndex >= 0) {
        const raw = (flags[enabledIndex + 1] ?? '').toLowerCase();
        if (raw !== 'true' && raw !== 'false') {
          logger.error({ value: flags[enabledIndex + 1] }, 'Use --enabled true or --enabled false');
          return 2;
        }
        options.enabled = raw === 'true';
      }
      if (options.file === undefined && options.enabled === undefined) {
        logger.error({}, `Nothing to set. Usage: ${USAGE}`);
        return 2;
      }
      if (options.file !== undefined && options.enabled !== undefined) {
        logger.error({}, 'Use either --file or --enabled, not both');
        return 2;
      }
      return await commandSet(area, options);
    }

    logger.error({ command, areas: BOS_LLM_AREAS, calls: BOS_LLM_AREAS.map(bosLlmSettingsCallNames) }, `Usage: ${USAGE}`);
    return 2;
  } catch (error) {
    logger.error({ err: error }, 'Command failed; nothing written');
    return 2;
  }
}

/* istanbul ignore next -- CLI entry point */
if (require.main === module) {
  void runBosLlmSettingsCommand(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
