/**
 * Effort Estimator — live integration test runner.
 *
 * Runs the production Effort Estimator end-to-end against an existing agent
 * row, using the real LLM and the real Supabase instance. Pre-release / spot-
 * check tool for engineers and the live tester — NOT a CI test.
 *
 * Behavior:
 *   1. Loads env vars from .env.local (project convention) via the co-located
 *      `_load-env.ts` bootstrap-import (see Env-load contract below).
 *   2. Reads the target agent (id from --agent-id; user_id is taken from the
 *      agent row itself — the script does NOT accept a --user-id override,
 *      per requirement § Integration Test Tooling — Safety #2).
 *   3. Hydrates an EffortEstimatorInput from the agent (user_prompt,
 *      enhanced_prompt fallback, workflow_steps).
 *   4. Builds user_context via buildUserContextFromProfile(user) (full path,
 *      per requirement § Integration Test Tooling — Behavior step 4).
 *   5. Calls estimateEffort(input). This writes agent_config.roi_estimate
 *      via the same code path production uses (so override semantics +
 *      EFFORT_ESTIMATE_GENERATED audit fire).
 *   6. Prints the result + override-log preview. In --dry-run mode the
 *      estimator is NOT called and no DB writes happen — we print what the
 *      hydrated input would have been instead.
 *   7. ALSO writes a per-run JSON-Lines log file capturing every Pino record
 *      emitted by the script AND every Pino record emitted by the estimator
 *      during the run, plus a synthetic final RUN_SUMMARY line. Default
 *      location: tests/effort-estimator/logs/; override with --log-dir=<path>.
 *      Spec: requirement MD § Per-run Log File (lines 272-285).
 *
 * Spec: docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md § Integration Test
 *       Tooling (lines 199-285) + AC-8 (line 326).
 *
 * Usage:
 *   npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid>
 *   npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid> --dry-run
 *   npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid> --log-dir=/tmp/ee-logs
 *
 * Env-load contract: the FIRST import below is a side-effect import of
 * `./_load-env`, which calls `dotenv.config({ path: '.env.local' })` at module
 * evaluation time. ES modules guarantee static side-effect imports are evaluated
 * to completion in source order, depth-first — so by the time any subsequent
 * import (including `@/lib/supabaseServer`) is resolved, `process.env` is
 * already populated. This closes the race that previously caused
 * `Error: supabaseUrl is required.` on every invocation: `lib/supabaseServer.ts`
 * constructs the Supabase client at module-load via
 * `export const supabaseServer = createServerSupabaseClient()`, and that
 * construction reads `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
 * eagerly. The earlier `--import ./scripts/env-preload.ts` approach worked but
 * was UX-fragile (one missed flag and the script crashes); the co-located
 * bootstrap-import makes the plain `npx tsx <script>` invocation Just Work.
 *
 * DO NOT reorder the imports below. `./_load-env` MUST stay first.
 *
 * Convention note: this is the same shape as
 *   tests/v6-regression/scripts/build-scenario-from-agent.ts
 *   tests/v6-regression/scripts/import-regression-scenarios-as-agents.ts
 * (those still use the `--import` hook). New scripts in this folder should
 * follow the co-located `_load-env.ts` pattern instead.
 */
// MUST be first — loads .env.local before any module that touches process.env.
// See _load-env.ts for the full explanation.
import './_load-env';

import { randomUUID, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolve } from 'path';
import pino from 'pino';
import { supabaseServer } from '@/lib/supabaseServer';
import { agentRepository } from '@/lib/repositories';
import { buildUserContextFromProfile } from '@/lib/user-context';
import { estimateEffort } from '@/lib/effort-estimator';
import { resolveEffortEstimatorModel } from '@/lib/effort-estimator/modelResolver';
import type { EffortEstimatorInput } from '@/lib/effort-estimator';

// ---------- CLI arg parsing -------------------------------------------------

interface CliArgs {
  agentId: string;
  dryRun: boolean;
  logDir: string;
}

// Default per requirement § Per-run Log File. Resolved against the repo root
// (../../../ from tests/effort-estimator/scripts/) so the default is stable
// regardless of where `npx tsx` was invoked from.
const DEFAULT_LOG_DIR = resolve(__dirname, '../../../tests/effort-estimator/logs');

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let agentId: string | undefined;
  let dryRun = false;
  let logDir: string = DEFAULT_LOG_DIR;

  for (const arg of args) {
    if (arg.startsWith('--agent-id=')) {
      agentId = arg.slice('--agent-id='.length);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--log-dir=')) {
      const raw = arg.slice('--log-dir='.length).trim();
      if (!raw) {
        // eslint-disable-next-line no-console
        console.error('--log-dir requires a non-empty path');
        printUsageAndExit(1);
      }
      // Resolve relative paths against the current working directory so a
      // user-supplied `--log-dir=./out` behaves like the shell expects.
      logDir = path.isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit(0);
    } else {
      // Fail loud on unknown args so a typo doesn't silently no-op.
      // eslint-disable-next-line no-console
      console.error(`Unknown argument: ${arg}`);
      printUsageAndExit(1);
    }
  }

  if (!agentId) {
    // eslint-disable-next-line no-console
    console.error('Missing required --agent-id=<uuid>');
    printUsageAndExit(1);
  }

  // UUID sanity check — fail loud on a bad value rather than dragging Supabase
  // into reporting it.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(agentId!)) {
    // eslint-disable-next-line no-console
    console.error(`--agent-id is not a valid UUID: ${agentId}`);
    process.exit(1);
  }

  return { agentId: agentId!, dryRun, logDir };
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.error(
    [
      '',
      'Usage:',
      '  npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid> [--dry-run] [--log-dir=<path>]',
      '',
      'Flags:',
      '  --agent-id=<uuid>   Required. UUID of an existing agent row.',
      '  --dry-run           Optional. Print the hydrated input + resolved model',
      '                      without invoking the estimator or writing the DB.',
      '  --log-dir=<path>    Optional. Directory for the per-run JSON-Lines log file.',
      `                      Default: ${DEFAULT_LOG_DIR}`,
      '',
    ].join('\n')
  );
  process.exit(code);
}

// ---------- env validation --------------------------------------------------

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  // At least one provider key — OpenAI is the default per AC-7.
  'OPENAI_API_KEY',
];

function assertEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `Missing required env vars: ${missing.join(', ')}.\n` +
        'Add them to .env.local (project root) before running this script.'
    );
    process.exit(1);
  }
}

// ---------- per-run log file ------------------------------------------------
//
// Spec: requirement MD § Per-run Log File (lines 272-285). Every invocation
// writes a JSON-Lines log file capturing both the script's Pino records and
// the estimator's child-logger records during the run. The file is in ADDITION
// to the existing console output — pretty-printed JSON blocks the operator
// already relies on are untouched.
//
// Design choice: file capture is implemented by teeing `process.stdout.write`
// to the log-file stream. `lib/logger.ts` is intentionally NOT modified —
// file-stream wiring is a script-scoped concern, not a project-wide logger
// responsibility. Both the script's own Pino logger AND the estimator's
// child loggers (constructed from the shared `baseLogger` via `createLogger`
// in lib/logger.ts) write to `process.stdout` by default, so a single
// stdout-tee captures every JSON-Lines record uniformly. Console behavior is
// untouched — the operator's terminal still sees the same output because the
// tee is additive: it writes to the file first, then forwards to the original
// `process.stdout.write` so the terminal still receives the bytes too.
//
// Why not `pino.multistream([stdout, fileStream])` directly? With the stdout
// tee already in place, the multistream's separate write to the file stream
// would double-record every script-level log line.
// ---------------------------------------------------------------------------

interface LogFileSetup {
  logger: pino.Logger;
  filePath: string;
  fileStream: fs.WriteStream;
  /** Restore stdout.write to its original value. */
  restoreStdout: () => void;
}

/**
 * Set up the per-run log file + a multistream Pino logger that writes to BOTH
 * stdout (so existing console behavior is unchanged for the operator) AND the
 * log file. Also wraps `process.stdout.write` to tee any JSON-Lines bytes
 * emitted by other Pino loggers in the same process (e.g. the estimator's
 * child loggers obtained from `@/lib/logger`) into the file.
 *
 * Returns a teardown helper that restores stdout. The caller is responsible
 * for `await`ing `fileStream`'s `'finish'` event before exiting (see flushAndExit).
 */
function setUpLogFile(logDir: string, agentId: string): LogFileSetup {
  // Sanitize ISO timestamp for cross-platform filenames (Windows rejects ':').
  // e.g. 2026-06-11T14:32:05.123Z → 2026-06-11T14-32-05-123Z
  const isoSanitized = new Date().toISOString().replace(/[:.]/g, '-');
  const agentIdShort = agentId.slice(0, 8);
  let filePath = path.join(logDir, `run-${isoSanitized}-${agentIdShort}.log`);

  // Idempotently create the directory (recursive=true is a no-op if it exists).
  fs.mkdirSync(logDir, { recursive: true });

  // Edge case: two runs starting in the exact same millisecond against the
  // same agent would otherwise collide. Append a random 4-char suffix to
  // disambiguate. `fs.existsSync` is fine here — race window is microseconds.
  if (fs.existsSync(filePath)) {
    const suffix = randomBytes(2).toString('hex'); // 4 hex chars
    filePath = path.join(logDir, `run-${isoSanitized}-${agentIdShort}-${suffix}.log`);
  }

  const fileStream = fs.createWriteStream(filePath, { flags: 'a' });

  // Tee stdout to the file so any other Pino logger in this process (most
  // notably the estimator's child loggers) also lands in the JSON-Lines file.
  // We keep stdout writes intact — operators still see the same console output.
  const originalWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = ((chunk: any, encoding?: any, cb?: any) => {
    try {
      // Only mirror string-shaped chunks (pino writes utf-8 JSON-Lines strings).
      // For Buffer chunks we still write a string copy so the file stays JSON-Lines.
      if (typeof chunk === 'string') {
        fileStream.write(chunk);
      } else if (Buffer.isBuffer(chunk)) {
        fileStream.write(chunk.toString('utf8'));
      }
    } catch {
      // Never let log mirroring break stdout. Swallowing here is intentional.
    }
    return originalWrite(chunk, encoding, cb);
  }) as typeof process.stdout.write;

  const restoreStdout = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = originalWrite;
  };

  // Script's own Pino logger. Writes only to stdout — the stdout tee above
  // mirrors every line into the file. Writing the file stream directly here
  // too would double-record every script-level log line (once via multistream,
  // once via the stdout tee). The estimator's loggers (built from the shared
  // `baseLogger` in lib/logger.ts via `createLogger(...).child(...)`) also
  // write to stdout by default, so the single stdout-tee path captures them
  // uniformly with the script's own lines.
  const logger = pino({
    level: 'debug',
    base: { module: 'effort-estimator-runner' },
  });

  return { logger, filePath, fileStream, restoreStdout };
}

/**
 * Flush the log file stream and exit. Required because Node can otherwise
 * truncate buffered writes when the process exits — the spec mandates a
 * clean fsync-equivalent.
 */
async function flushAndExit(
  setup: LogFileSetup | null,
  code: number
): Promise<never> {
  if (setup) {
    setup.restoreStdout();
    await new Promise<void>((resolveFinish) => {
      setup.fileStream.once('finish', resolveFinish);
      setup.fileStream.end();
    });
  }
  process.exit(code);
}

// ---------- formatting helpers ---------------------------------------------

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`;
}

function pretty(label: string, payload: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`\n--- ${label} ---`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload, null, 2));
}

/**
 * Banner-printed JSON block for the load-bearing payloads (the resolved
 * estimate; the persisted-config re-read). The user reading the log after a
 * run should not have to grep — these are the values they came for, so we
 * surround them with a visible delimiter rather than burying them inside the
 * stream of routine `--- label ---` blocks. The Pino logger ALSO emits its
 * own JSON-Lines record for the same payload (so jq/log-tooling can find it
 * structurally), but this is what the human sees first.
 */
function prominent(label: string, payload: unknown): void {
  const bar = '='.repeat(78);
  // eslint-disable-next-line no-console
  console.log(`\n${bar}\n  ${label}\n${bar}`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload, null, 2));
  // eslint-disable-next-line no-console
  console.log(bar);
}

// ---------- main -----------------------------------------------------------

async function main(): Promise<void> {
  // Edge case (spec point 9): if env loading or arg parsing throws before the
  // logger exists, we cannot write to the file. The outer `main().catch(...)`
  // at the bottom falls back to console.error and exits non-zero. The block
  // below catches the same case for setup-time exits.
  let setup: LogFileSetup | null = null;

  try {
    const { agentId, dryRun, logDir } = parseArgs();
    assertEnv();

    // Set up file logging IMMEDIATELY after arg + env validation pass so the
    // earliest possible log line lands in the file too.
    setup = setUpLogFile(logDir, agentId);
    const { logger: rootLogger, filePath: logFilePath } = setup;
    const startedAtIso = new Date().toISOString();
    const startedAtMs = Date.now();

    const correlationId = randomUUID();
    const logger = rootLogger.child({ correlationId, agentId, dryRun });

    logger.info(
      { agentId, dryRun, logFilePath, logDir },
      'Effort Estimator runner starting'
    );

    // ---- 1. Resolve user_id from the agent row itself ----------------------
    //
    // We need the agent's user_id BEFORE we can call agentRepository.findById
    // (which requires both id + user_id and enforces the .eq('user_id', ...)
    // filter). This single direct supabaseServer read is intentional:
    //
    //   - Spec § Integration Test Tooling — Safety #2: the script must NEVER
    //     accept a --user-id override; the user_id MUST come from the row.
    //   - AgentRepository does not expose a "find-without-user-filter" method
    //     by design (that would be a security regression in production code).
    //   - Adding one for the sake of this script would extend the repo's
    //     surface area in a way SA would (rightly) push back on.
    //
    // This pattern is script-only and MUST NOT be copied into production paths.
    // The very next call goes back through the repository for the real fetch.
    const { data: userIdRow, error: userIdErr } = await supabaseServer
      .from('agents')
      .select('user_id')
      .eq('id', agentId)
      .maybeSingle();

    if (userIdErr || !userIdRow) {
      logger.error({ err: userIdErr, agentId }, 'Could not read user_id for agent');
      // eslint-disable-next-line no-console
      console.error(`\nFAIL: agent_id ${agentId} not found (or read error). See log above.`);
      await writeRunSummary(logger, {
        agent_id: agentId,
        dry_run: dryRun,
        success: false,
        attempts: 0,
        totalDurationMs: Date.now() - startedAtMs,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        log_file_path: logFilePath,
      });
      // eslint-disable-next-line no-console
      console.log(`\nLog file: ${logFilePath}`);
      return flushAndExit(setup, 1);
    }

    const userId = userIdRow.user_id as string;
    logger.info({ userId }, 'Resolved user_id from agent row');

    // ---- 2. Full agent fetch via the repository (script now behaves like prod)
    const { data: agent, error: agentErr } = await agentRepository.findById(agentId, userId);
    if (agentErr || !agent) {
      logger.error({ err: agentErr, agentId, userId }, 'AgentRepository.findById failed');
      // eslint-disable-next-line no-console
      console.error(`\nFAIL: AgentRepository.findById failed for agent_id=${agentId}.`);
      await writeRunSummary(logger, {
        agent_id: agentId,
        dry_run: dryRun,
        success: false,
        attempts: 0,
        totalDurationMs: Date.now() - startedAtMs,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        log_file_path: logFilePath,
      });
      // eslint-disable-next-line no-console
      console.log(`\nLog file: ${logFilePath}`);
      return flushAndExit(setup, 1);
    }

    // ---- 3. Hydrate the EffortEstimatorInput -------------------------------
    const agentConfig = (agent.agent_config as Record<string, unknown> | null | undefined) ?? {};
    const userPrompt = (agent.user_prompt as string | null) ?? '';
    const epFromConfig = (agentConfig.enhanced_prompt as string | null | undefined) ?? null;
    const epFromColumn = (agent as unknown as { enhanced_prompt?: string | null }).enhanced_prompt ?? null;

    // Prefer the dedicated column when present (post Open Follow-Up #9 fix);
    // fall back to agent_config.enhanced_prompt (where the V6 pipeline may have
    // stashed it during creation); finally fall back to user_prompt with a
    // visible NOTE so the live tester sees the persistence gap firsthand.
    let enhancedPrompt: string;
    let enhancedPromptSource: 'agents.enhanced_prompt' | 'agent_config.enhanced_prompt' | 'user_prompt fallback';
    if (epFromColumn && epFromColumn.trim().length > 0) {
      enhancedPrompt = epFromColumn;
      enhancedPromptSource = 'agents.enhanced_prompt';
    } else if (epFromConfig && epFromConfig.trim().length > 0) {
      enhancedPrompt = epFromConfig;
      enhancedPromptSource = 'agent_config.enhanced_prompt';
    } else {
      enhancedPrompt = userPrompt;
      enhancedPromptSource = 'user_prompt fallback';
      // eslint-disable-next-line no-console
      console.warn(
        '\nNOTE: enhanced_prompt is not persisted on this agent — falling back to user_prompt.\n' +
          '      This is the symptom of Open Follow-Up #9 in the requirement MD\n' +
          '      (persist V6 enhanced_prompt). Estimator quality on this run will be\n' +
          '      lower than it would be with the rich enhanced prompt available.'
      );
    }

    // workflow_steps lives on the agent row (see V6 save path in
    // app/api/create-agent/route.ts:167). It's typed as unknown[] in the route,
    // so we surface it as-is to the estimator-input log.
    const workflowSteps = (agent as unknown as { workflow_steps?: unknown[] | null }).workflow_steps ?? null;

    // ---- 4. Build user_context via the FULL profile path ------------------
    // Per requirement § Integration Test Tooling — Behavior step 4: use
    // buildUserContextFromProfile (NOT the auth fast path). For the live test
    // we want the richest persona possible so persona-quality regressions
    // are most visible.
    //
    // buildUserContextFromProfile takes a Supabase User. The auth admin API
    // gives us the canonical shape (email + user_metadata) without needing a
    // session cookie.
    const { data: authResult, error: authErr } = await supabaseServer.auth.admin.getUserById(userId);
    if (authErr || !authResult?.user) {
      logger.error({ err: authErr, userId }, 'auth.admin.getUserById failed');
      // eslint-disable-next-line no-console
      console.error(`\nFAIL: could not fetch auth user for user_id=${userId}.`);
      await writeRunSummary(logger, {
        agent_id: agentId,
        dry_run: dryRun,
        success: false,
        attempts: 0,
        totalDurationMs: Date.now() - startedAtMs,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        log_file_path: logFilePath,
      });
      // eslint-disable-next-line no-console
      console.log(`\nLog file: ${logFilePath}`);
      return flushAndExit(setup, 1);
    }
    const userContext = await buildUserContextFromProfile(authResult.user);

    const input: EffortEstimatorInput = {
      agentId,
      userId,
      enhancedPrompt,
      userContext,
      correlationId,
      reason: 'api_request',
    };

    // ---- 5. Print the hydrated input ---------------------------------------
    //
    // We deliberately truncate user_prompt / enhanced_prompt in the printed
    // SUMMARY so it stays readable for big prompts; the full strings still get
    // passed to the estimator unchanged.
    const inputSummary = {
      agentId: input.agentId,
      userId: input.userId,
      correlationId: input.correlationId,
      reason: input.reason,
      enhancedPromptSource,
      enhancedPromptPreview: truncate(input.enhancedPrompt, 200),
      enhancedPromptLength: input.enhancedPrompt?.length ?? 0,
      userPromptPreview: truncate(userPrompt, 200),
      userPromptLength: userPrompt.length,
      workflowStepsCount: Array.isArray(workflowSteps) ? workflowSteps.length : 0,
      userContext: {
        full_name: userContext.full_name || '(empty)',
        email: userContext.email || '(empty)',
        role: userContext.role || '(empty)',
        company: userContext.company || '(empty)',
        domain: userContext.domain || '(empty)',
        ...(userContext.timezone ? { timezone: userContext.timezone } : {}),
      },
    };
    pretty('Hydrated input (summary)', inputSummary);

    // ---- 6. Resolve the model so the runner reports what production will use
    // This call is cached inside the resolver, so the estimator's own resolution
    // hits the same value.
    const resolvedModel = await resolveEffortEstimatorModel();
    pretty('Resolved model (DB-driven, with gpt-4o-mini fallback per AC-7)', resolvedModel);

    // Snapshot the existing roi_estimate so the runner can print a
    // before-vs-after override preview (matches what production logs at INFO).
    const previousEstimate = (agentConfig.roi_estimate as Record<string, unknown> | undefined) ?? null;

    // ---- 7a. Dry run — invoke the estimator with skipPersist, print, exit -
    //
    // Earlier versions of this script short-circuited BEFORE the LLM call so
    // dry-run never paid for an LLM round-trip. That made dry-run nearly
    // useless to the live tester — they were left staring at a "would have
    // called estimateEffort(input)" placeholder. The user explicitly asked
    // (2026-06-11): "where is the output that will be added to the
    // agent_config? i want to see it."
    //
    // The correct shape per the requirement § Integration Test Tooling —
    // Behavior is: "--dry-run runs the estimator and prints the result but
    // does NOT write to agent_config.roi_estimate". So we DO call the
    // estimator, with the new `skipPersist: true` option that:
    //   - still calls the LLM and parses + validates the response
    //   - still emits the override-log preview at INFO (lands in the log file)
    //   - skips `AgentRepository.update` (no DB mutation)
    //   - skips the `EFFORT_ESTIMATE_GENERATED` audit event
    // Production callers MUST NOT pass `skipPersist` — see EffortEstimator.ts.
    if (dryRun) {
      logger.info(
        { agentId, userId, skipPersist: true },
        'Invoking estimateEffort with skipPersist=true (dry-run: LLM yes, DB no, audit no)'
      );
      const estimatorStartedAt = Date.now();
      const result = await estimateEffort(input, { skipPersist: true });
      const durationMs = Date.now() - estimatorStartedAt;

      // PROMINENT: the live tester opened the log to see THIS. Header it.
      prominent('ESTIMATOR RESULT (dry-run — what would be written to agent_config.roi_estimate)', {
        success: result.success,
        attempts: result.attempts,
        totalDurationMs: result.totalDurationMs,
        errorMessage: result.errorMessage,
        estimate: result.estimate,
        previousEstimate: result.previousEstimate,
      });

      if (result.success && result.estimate) {
        // Mirror what production logs at INFO (EffortEstimator.ts) so the
        // live tester sees the exact override semantics that would have
        // fired. NOT prominent — supplemental observability detail.
        pretty('Override log preview (matches production INFO log shape)', {
          agent_id: input.agentId,
          reason: input.reason,
          previous_present: previousEstimate !== null,
          previous_total_manual_time_seconds:
            (previousEstimate?.total_manual_time_seconds as number | undefined) ?? null,
          new_total_manual_time_seconds: result.estimate.total_manual_time_seconds,
          new_is_bulk_workflow: result.estimate.is_bulk_workflow,
          new_reasoning_preview: truncate(result.estimate.reasoning, 500),
          model: result.estimate.model,
          correlationId: input.correlationId,
          attempts: result.attempts,
        });

        // Explicit reassurance that no DB write happened. Re-read the row
        // to PROVE it — comparison print of the before vs. after roi_estimate.
        const { data: postAgent } = await agentRepository.findById(agentId, userId);
        const postConfig = (postAgent?.agent_config as Record<string, unknown> | null) ?? {};
        const postROI = (postConfig.roi_estimate as Record<string, unknown> | undefined) ?? null;
        pretty('DB row state AFTER dry-run (re-read to confirm slot is unchanged)', {
          note: 'DRY-RUN: estimator was invoked with skipPersist=true. No DB write was performed. No audit event was fired.',
          agent_config_roi_estimate_before: previousEstimate,
          agent_config_roi_estimate_after: postROI,
          slot_unchanged:
            JSON.stringify(previousEstimate) === JSON.stringify(postROI),
        });
      }

      logger.info(
        {
          agentId,
          userId,
          dryRun: true,
          success: result.success,
          attempts: result.attempts,
          durationMs,
        },
        'Effort Estimator runner finished (dry-run)'
      );

      // eslint-disable-next-line no-console
      console.log(
        result.success
          ? `\nPASS (dry-run): estimator returned a candidate estimate. ` +
              `model=${result.estimate?.model}, attempts=${result.attempts}, ` +
              `total_manual_time_seconds=${result.estimate?.total_manual_time_seconds}, ` +
              `script_duration_ms=${durationMs}. ` +
              `NO DB write. NO audit event.`
          : `\nFAIL (dry-run): estimator returned success=false ` +
              `(attempts=${result.attempts}, errorMessage=${result.errorMessage ?? '(none)'}, ` +
              `script_duration_ms=${durationMs}). NO DB write was attempted.`
      );

      await writeRunSummary(logger, {
        agent_id: agentId,
        dry_run: true,
        success: result.success,
        attempts: result.attempts,
        totalDurationMs: Date.now() - startedAtMs,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        log_file_path: logFilePath,
      });
      // eslint-disable-next-line no-console
      console.log(`\nLog file: ${logFilePath}`);
      await flushAndExit(setup, result.success ? 0 : 1);
    }

    // ---- 7b. Live run — invoke the production estimator -------------------
    // The estimator writes agent_config.roi_estimate directly via
    // AgentRepository.update and fires EFFORT_ESTIMATE_GENERATED (non-blocking)
    // — see lib/effort-estimator/EffortEstimator.ts. We do NOT double-write.
    logger.info('Invoking estimateEffort (real LLM + real DB write)');
    const estimatorStartedAt = Date.now();
    const result = await estimateEffort(input);
    const durationMs = Date.now() - estimatorStartedAt;

    // PROMINENT: same payload the live tester would have seen in dry-run,
    // surfaced the same way in live mode so the log file is uniform.
    prominent('ESTIMATOR RESULT (live — written to agent_config.roi_estimate)', {
      success: result.success,
      attempts: result.attempts,
      totalDurationMs: result.totalDurationMs,
      errorMessage: result.errorMessage,
      estimate: result.estimate,
      previousEstimate: result.previousEstimate,
    });

    if (result.success && result.estimate) {
      // Mirror what production logs at INFO (EffortEstimator.ts:281-297) so
      // the live-tester sees the exact override semantics they'll see in logs.
      pretty('Override log preview (matches production INFO log shape)', {
        agent_id: input.agentId,
        reason: input.reason,
        previous_present: previousEstimate !== null,
        previous_total_manual_time_seconds:
          (previousEstimate?.total_manual_time_seconds as number | undefined) ?? null,
        new_total_manual_time_seconds: result.estimate.total_manual_time_seconds,
        new_is_bulk_workflow: result.estimate.is_bulk_workflow,
        new_reasoning_preview: truncate(result.estimate.reasoning, 500),
        model: result.estimate.model,
        correlationId: input.correlationId,
        attempts: result.attempts,
      });

      // ---- 8. Confirm by re-reading the agent ------------------------------
      const { data: confirmAgent, error: confirmErr } = await agentRepository.findById(
        agentId,
        userId
      );
      if (confirmErr || !confirmAgent) {
        logger.error({ err: confirmErr }, 'Post-write re-read failed');
        // eslint-disable-next-line no-console
        console.error('\nFAIL: estimator returned success but re-read failed.');
        await writeRunSummary(logger, {
          agent_id: agentId,
          dry_run: false,
          success: false,
          attempts: result.attempts,
          totalDurationMs: Date.now() - startedAtMs,
          started_at: startedAtIso,
          finished_at: new Date().toISOString(),
          log_file_path: logFilePath,
        });
        // eslint-disable-next-line no-console
        console.log(`\nLog file: ${logFilePath}`);
        return flushAndExit(setup, 1);
      }
      const persistedConfig = (confirmAgent.agent_config as Record<string, unknown> | null) ?? {};
      prominent('PERSISTED agent_config.roi_estimate (re-read from DB)', persistedConfig.roi_estimate);

      // eslint-disable-next-line no-console
      console.log(
        `\nPASS: estimator wrote agent_config.roi_estimate for agent_id=${agentId} ` +
          `(model=${result.estimate.model}, attempts=${result.attempts}, ` +
          `total_manual_time_seconds=${result.estimate.total_manual_time_seconds}, ` +
          `script_duration_ms=${durationMs}).`
      );

      await writeRunSummary(logger, {
        agent_id: agentId,
        dry_run: false,
        success: true,
        attempts: result.attempts,
        totalDurationMs: Date.now() - startedAtMs,
        started_at: startedAtIso,
        finished_at: new Date().toISOString(),
        log_file_path: logFilePath,
      });
      // eslint-disable-next-line no-console
      console.log(`\nLog file: ${logFilePath}`);
      await flushAndExit(setup, 0);
    }

    // Failure path — estimator left the slot UNTOUCHED per AC-2.
    logger.error(
      { errorMessage: result.errorMessage, attempts: result.attempts, durationMs },
      'Effort Estimator returned failure'
    );
    // eslint-disable-next-line no-console
    console.error(
      `\nFAIL: estimator returned success=false ` +
        `(attempts=${result.attempts}, errorMessage=${result.errorMessage ?? '(none)'}, ` +
        `script_duration_ms=${durationMs}). ` +
        'agent_config.roi_estimate was NOT written (AC-2 contract).'
    );
    await writeRunSummary(logger, {
      agent_id: agentId,
      dry_run: false,
      success: false,
      attempts: result.attempts,
      totalDurationMs: Date.now() - startedAtMs,
      started_at: startedAtIso,
      finished_at: new Date().toISOString(),
      log_file_path: logFilePath,
    });
    // eslint-disable-next-line no-console
    console.log(`\nLog file: ${logFilePath}`);
    return flushAndExit(setup, 1);
  } catch (err) {
    // If setup is non-null we managed to open the file; route through the
    // logger so the failure lands in the file too. Otherwise the outer
    // `main().catch(...)` handler covers the no-logger fallback path.
    if (setup) {
      setup.logger.error({ err }, 'Effort Estimator runner crashed mid-run');
      // eslint-disable-next-line no-console
      console.error('\nFATAL error in effort-estimator runner:', err);
      // eslint-disable-next-line no-console
      console.log(`\nLog file: ${setup.filePath}`);
      return flushAndExit(setup, 1);
    }
    throw err;
  }
}

/**
 * Emit the synthetic RUN_SUMMARY line. The structured shape lets engineers
 * grep / jq across many run logs to spot patterns (e.g. attempts-distribution
 * for retry-budget tuning).
 */
async function writeRunSummary(
  logger: pino.Logger,
  summary: {
    agent_id: string;
    dry_run: boolean;
    success: boolean;
    attempts: number;
    totalDurationMs: number;
    started_at: string;
    finished_at: string;
    log_file_path: string;
  }
): Promise<void> {
  logger.info({ ...summary }, 'RUN_SUMMARY');
}

main().catch((err) => {
  // Setup-time fallback per spec point 9: if env loading or arg parsing
  // threw before the logger was wired up, we have no file to write to.
  // Surface the error to stderr and exit. (Mid-run crashes are handled
  // inside main() via the setup-aware try/catch.)
  // eslint-disable-next-line no-console
  console.error('\nFATAL error in effort-estimator runner (pre-logger):', err);
  process.exit(1);
});
