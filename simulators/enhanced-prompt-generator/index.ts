/**
 * CLI entry point for the Enhanced Prompt Generator simulator.
 *
 * Usage:
 *   npx tsx simulators/enhanced-prompt-generator/index.ts --scenario gmail-summary
 *   npx tsx simulators/enhanced-prompt-generator/index.ts --all
 *   npx tsx simulators/enhanced-prompt-generator/index.ts --all --verbose
 *
 * Environment variables (loaded from .env.local):
 *   SIMULATOR_USER_EMAIL      - Test user email
 *   SIMULATOR_USER_PASSWORD   - Test user password
 *   SIMULATOR_BASE_URL        - API base URL (default: http://localhost:3000)
 *   SIMULATOR_LLM_PROVIDER    - LLM provider for answerer/validator (default: openai)
 *   SIMULATOR_LLM_MODEL       - LLM model (default: provider's default)
 */

// Load .env.local BEFORE any imports that read process.env (e.g., ProviderFactory)
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import * as fs from 'fs';
import { createSimulatorLogger } from '@/simulators/shared/logger';
import type { SummaryRow } from '@/simulators/shared/types';
import { ScenarioSchema } from './types';
import type { Scenario, SimulatorConfig, SimulatorOutput } from './types';
import { runScenario } from './simulator';

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  scenario: string | null;
  all: boolean;
  verbose: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { scenario: null, all: false, verbose: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      result.scenario = args[i + 1];
      i++; // skip next arg
    } else if (args[i] === '--all') {
      result.all = true;
    } else if (args[i] === '--verbose') {
      result.verbose = true;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scenario Loading
// ---------------------------------------------------------------------------

function loadScenario(scenarioPath: string, logger: ReturnType<typeof createSimulatorLogger>): Scenario | null {
  try {
    const raw = fs.readFileSync(scenarioPath, 'utf-8');
    const json = JSON.parse(raw);
    const parsed = ScenarioSchema.safeParse(json);

    if (!parsed.success) {
      logger.error(`Invalid scenario file: ${scenarioPath}`, {
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return null;
    }

    return parsed.data;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load scenario: ${scenarioPath}: ${msg}`);
    return null;
  }
}

function discoverScenarios(scenariosDir: string): string[] {
  if (!fs.existsSync(scenariosDir)) {
    return [];
  }
  return fs.readdirSync(scenariosDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(scenariosDir, f))
    .sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cliArgs = parseArgs();
  const logger = createSimulatorLogger(cliArgs.verbose ? 'debug' : 'info');

  logger.info('Enhanced Prompt Generator Simulator v1.0.0');
  logger.info('==========================================');

  // Validate CLI arguments
  if (!cliArgs.scenario && !cliArgs.all) {
    logger.error('Usage: npx tsx simulators/enhanced-prompt-generator/index.ts --scenario <name> | --all [--verbose]');
    process.exit(1);
  }

  // Build config from environment
  const config: SimulatorConfig = {
    baseUrl: process.env.SIMULATOR_BASE_URL || 'http://localhost:3000',
    verbose: cliArgs.verbose,
    llmProvider: process.env.SIMULATOR_LLM_PROVIDER || 'openai',
    llmModel: process.env.SIMULATOR_LLM_MODEL || '',
  };

  logger.info('Configuration', {
    baseUrl: config.baseUrl,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel || '(provider default)',
    verbose: config.verbose,
  });

  // Discover scenario files
  const scenariosDir = path.join(__dirname, 'scenarios');
  let scenarioPaths: string[] = [];

  if (cliArgs.all) {
    scenarioPaths = discoverScenarios(scenariosDir);
    if (scenarioPaths.length === 0) {
      logger.error(`No scenario files found in ${scenariosDir}`);
      process.exit(1);
    }
    logger.info(`Found ${scenarioPaths.length} scenarios`);
  } else if (cliArgs.scenario) {
    const scenarioFile = path.join(scenariosDir, `${cliArgs.scenario}.json`);
    if (!fs.existsSync(scenarioFile)) {
      logger.error(`Scenario file not found: ${scenarioFile}`);
      process.exit(1);
    }
    scenarioPaths = [scenarioFile];
  }

  // Run scenarios sequentially
  const results: SimulatorOutput[] = [];
  const summaryRows: SummaryRow[] = [];

  for (const scenarioPath of scenarioPaths) {
    const scenario = loadScenario(scenarioPath, logger);
    if (!scenario) {
      summaryRows.push({
        scenario: path.basename(scenarioPath, '.json'),
        status: 'error',
        duration: '0ms',
        validation: 'Load failed',
      });
      continue;
    }

    logger.info('');
    logger.info(`--- Running scenario: ${scenario.name} ---`);
    logger.info(`Prompt: "${scenario.user_prompt}"`);

    try {
      const output = await runScenario(scenario, config, logger);
      results.push(output);

      summaryRows.push({
        scenario: scenario.name,
        status: output.status,
        duration: `${output.run.duration_ms}ms`,
        validation: output.validation
          ? (output.validation.pass ? 'Passed' : `Failed (${output.validation.issues.length} issues)`)
          : 'Skipped',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Scenario "${scenario.name}" crashed: ${msg}`);
      summaryRows.push({
        scenario: scenario.name,
        status: 'error',
        duration: '?',
        validation: 'Crashed',
      });
    }
  }

  // Print summary table
  logger.info('');
  logger.info('=== Run Summary ===');
  logger.table(summaryRows);

  // Determine exit code
  const hasError = summaryRows.some((r) => r.status === 'error');
  const hasWarning = summaryRows.some((r) => r.status === 'warning');

  if (hasError) {
    logger.info('');
    logger.error('One or more scenarios errored. Exit code: 1');
    process.exit(1);
  } else if (hasWarning) {
    logger.info('');
    logger.warn('All scenarios completed but some have validation warnings. Exit code: 0');
    process.exit(0);
  } else {
    logger.info('');
    logger.info('All scenarios passed. Exit code: 0');
    process.exit(0);
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nFatal error: ${msg}\n`);
  process.exit(1);
});
