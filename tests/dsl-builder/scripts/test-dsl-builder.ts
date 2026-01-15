/**
 * DSL Builder CLI Test Script
 *
 * Directly calls V5WorkflowGenerator without needing the server running.
 * Mimics the test page flow from command line.
 *
 * Usage:
 *   npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/technical-workflow-email.json
 *   npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/input.json -o output/result.json
 *   npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/input.json --skip-dsl-builder
 *   npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/input.json --reviewed-workflow tests/dsl-builder/fixtures/reviewed.json
 *
 * Options:
 *   --input, -i       Path to input JSON file (required)
 *   --output, -o      Path to save output JSON (optional, defaults to stdout)
 *   --reviewed-workflow  Path to pre-reviewed workflow JSON (skips LLM reviewer)
 *   --skip-dsl-builder  Return only LLM review, skip DSL building
 *   --provider        AI provider (default: openai)
 *   --model           Model name (default: gpt-4o)
 *   --user-id         User ID for plugin context (default: test_user_cli)
 *   --verbose, -v     Show detailed logging
 */

import * as fs from 'fs';
import * as path from 'path';
import { PluginManagerV2 } from '../../../lib/server/plugin-manager-v2';
import {
  V5WorkflowGenerator,
  WorkflowGenerationInput,
  V5GenerationResult,
  TechnicalWorkflowInput,
  ReviewedTechnicalWorkflowInput,
} from '../../../lib/agentkit/v4/v5-generator';
import { ProviderName } from '../../../lib/ai/providerFactory';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CLIOptions {
  input: string;
  output?: string;
  reviewedWorkflow?: string;
  skipDslBuilder: boolean;
  provider: ProviderName;
  model: string;
  userId: string;
  verbose: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    input: '',
    output: undefined,
    reviewedWorkflow: undefined,
    skipDslBuilder: false,
    provider: 'openai' as ProviderName,
    model: 'gpt-4o',
    userId: 'test_user_cli',
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--input':
      case '-i':
        options.input = nextArg;
        i++;
        break;
      case '--output':
      case '-o':
        options.output = nextArg;
        i++;
        break;
      case '--reviewed-workflow':
        options.reviewedWorkflow = nextArg;
        i++;
        break;
      case '--skip-dsl-builder':
        options.skipDslBuilder = true;
        break;
      case '--provider':
        options.provider = nextArg as ProviderName;
        i++;
        break;
      case '--model':
        options.model = nextArg;
        i++;
        break;
      case '--user-id':
        options.userId = nextArg;
        i++;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  if (!options.input) {
    console.error('Error: --input is required\n');
    printHelp();
    process.exit(1);
  }

  return options;
}

function printHelp() {
  console.log(`
DSL Builder CLI Test Script

Usage:
  npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts --input <file> [options]

Options:
  --input, -i <file>        Path to input JSON file (required)
  --output, -o <file>       Save output to file (default: stdout)
  --reviewed-workflow <file> Path to pre-reviewed workflow JSON (skips LLM reviewer)
  --skip-dsl-builder        Return LLM review only, skip DSL building
  --provider <name>         AI provider: openai, anthropic, kimi (default: openai)
  --model <name>            Model name (default: gpt-4o)
  --user-id <id>            User ID for plugin context (default: test_user_cli)
  --verbose, -v             Show detailed logging
  --help, -h                Show this help message

Examples:
  # Basic usage - output to console
  npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/technical-workflow-email.json

  # Save output to file
  npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/technical-workflow-email.json -o output/result.json

  # Test LLM review only (skip DSL builder)
  npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/input.json --skip-dsl-builder

  # Skip LLM reviewer (use pre-reviewed workflow for deterministic testing)
  npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/input.json --reviewed-workflow tests/dsl-builder/fixtures/reviewed-workflow.json

  # Use different provider/model
  npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/input.json --provider anthropic --model claude-sonnet-4-20250514
`);
}

// ============================================================================
// Input File Structure (matches test page input)
// ============================================================================

interface TestInput {
  // Option A: Enhanced Prompt (Phase 3 output)
  enhancedPrompt?: {
    plan_title: string;
    plan_description: string;
    sections?: {
      data?: string[];
      output?: string[];
      actions?: string[];
      delivery?: string[];
      processing_steps?: string[];
    };
    specifics: {
      services_involved: string[];
      resolved_user_inputs: Array<{ key: string; value: string }>;
    };
  };

  // Option B: Technical Workflow (Phase 4 output)
  // Using 'any' for arrays since this is parsed JSON passed to V5 generator which validates it
  technicalWorkflow?: {
    technical_workflow: any[];
    requiredServices?: string[];
    technical_inputs_required?: any[];
  };
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log('DSL Builder CLI Test\n');
  console.log('='.repeat(50));

  // 1. Load input file
  console.log(`Loading input: ${options.input}`);

  const inputPath = path.resolve(process.cwd(), options.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const inputContent = fs.readFileSync(inputPath, 'utf-8');
  let testInput: TestInput;

  try {
    testInput = JSON.parse(inputContent);
  } catch (e) {
    console.error('Error: Invalid JSON in input file');
    process.exit(1);
  }

  // 2. Validate input structure
  const hasEnhancedPrompt = !!testInput.enhancedPrompt;
  const hasTechnicalWorkflow = (testInput.technicalWorkflow?.technical_workflow?.length ?? 0) > 0;

  if (!hasEnhancedPrompt && !hasTechnicalWorkflow) {
    console.error('Error: Input must contain either enhancedPrompt or technicalWorkflow.technical_workflow');
    process.exit(1);
  }

  // Extract required services
  const requiredServices =
    testInput.enhancedPrompt?.specifics?.services_involved ||
    testInput.technicalWorkflow?.requiredServices ||
    [];

  if (requiredServices.length === 0) {
    console.error(
      'Error: No required services found. Provide via enhancedPrompt.specifics.services_involved or technicalWorkflow.requiredServices'
    );
    process.exit(1);
  }

  console.log(`  Input type: ${hasEnhancedPrompt ? 'Enhanced Prompt' : 'Technical Workflow'}`);
  console.log(`  Services: ${requiredServices.join(', ')}`);
  console.log(
    `  Steps: ${testInput.technicalWorkflow?.technical_workflow?.length || 'N/A (using enhancedPrompt)'}`
  );

  // 3. Load reviewed workflow if provided (for skipping LLM reviewer)
  let reviewedTechnicalWorkflow: ReviewedTechnicalWorkflowInput | undefined;

  if (options.reviewedWorkflow) {
    console.log(`\nLoading reviewed workflow: ${options.reviewedWorkflow}`);

    const reviewedPath = path.resolve(process.cwd(), options.reviewedWorkflow);
    if (!fs.existsSync(reviewedPath)) {
      console.error(`Error: Reviewed workflow file not found: ${reviewedPath}`);
      process.exit(1);
    }

    try {
      const reviewedContent = fs.readFileSync(reviewedPath, 'utf-8');
      reviewedTechnicalWorkflow = JSON.parse(reviewedContent);
      console.log(`  Loaded reviewed workflow with ${reviewedTechnicalWorkflow?.technical_workflow?.length || 0} steps`);
    } catch (e) {
      console.error('Error: Invalid JSON in reviewed workflow file');
      process.exit(1);
    }
  }

  // 4. Configuration
  console.log('\nConfiguration:');
  console.log(`  Provider: ${options.provider}`);
  console.log(`  Model: ${options.model}`);
  console.log(`  User ID: ${options.userId}`);
  console.log(`  Skip DSL Builder: ${options.skipDslBuilder}`);
  console.log(`  Skip LLM Reviewer: ${!!reviewedTechnicalWorkflow}`);

  // 5. Initialize Plugin Manager
  console.log('\nLoading plugins...');
  const pluginManager = await PluginManagerV2.getInstance();
  const userPlugins = await pluginManager.getAllActivePluginKeys(options.userId);
  console.log(`  User plugins: ${userPlugins.length > 0 ? userPlugins.join(', ') : '(none)'}`);

  // Load plugin contexts - use required services if user has no plugins
  const pluginKeysToLoad = userPlugins.length > 0 ? userPlugins : requiredServices;
  const pluginDefContexts = pluginManager.getPluginsDefinitionContext(pluginKeysToLoad);
  const connectedPluginContexts = pluginDefContexts.map((ctx) => ctx.toShortLLMContext());

  if (options.verbose) {
    console.log(`  Loaded plugin contexts: ${connectedPluginContexts.map((p) => p.key).join(', ')}`);
  }

  // 6. Build TechnicalWorkflowInput
  let fullTechnicalWorkflow: TechnicalWorkflowInput | undefined;

  if (testInput.enhancedPrompt) {
    fullTechnicalWorkflow = {
      technical_workflow: testInput.technicalWorkflow?.technical_workflow || [],
      enhanced_prompt: {
        plan_title: testInput.enhancedPrompt.plan_title,
        plan_description: testInput.enhancedPrompt.plan_description,
        specifics: {
          resolved_user_inputs: testInput.enhancedPrompt.specifics.resolved_user_inputs,
          services_involved: requiredServices,
        },
      },
      analysis: {
        agent_name: testInput.enhancedPrompt.plan_title,
        description: testInput.enhancedPrompt.plan_description,
      },
      requiredServices,
      technical_inputs_required: testInput.technicalWorkflow?.technical_inputs_required || [],
    };
  } else if (hasTechnicalWorkflow) {
    fullTechnicalWorkflow = {
      ...(testInput.technicalWorkflow as TechnicalWorkflowInput),
      requiredServices,
    };
  }

  // 7. Create generator and run
  console.log('\nRunning V5 Workflow Generator...');
  console.log('='.repeat(50));

  const generator = new V5WorkflowGenerator(pluginManager, {
    connectedPlugins: connectedPluginContexts,
    userId: options.userId,
    sessionTracking: {
      enabled: true,
      userId: options.userId,
    },
  });

  const generationInput: WorkflowGenerationInput = {
    enhancedPrompt: testInput.enhancedPrompt ? JSON.stringify(testInput.enhancedPrompt) : undefined,
    technicalWorkflow: fullTechnicalWorkflow,
    reviewedTechnicalWorkflow, // Skip LLM reviewer if provided
    provider: options.provider,
    model: options.model,
    required_services: requiredServices,
    skipDslBuilder: options.skipDslBuilder,
  };

  const result: V5GenerationResult = await generator.generateWorkflow(generationInput);

  const endTime = Date.now();
  const latencyMs = endTime - startTime;

  // 8. Output results
  console.log('\n' + '='.repeat(50));

  if (result.success) {
    console.log('SUCCESS\n');

    console.log('Metadata:');
    console.log(`  Total steps: ${result.metadata?.totalSteps || 0}`);
    console.log(`  Actions resolved: ${result.metadata?.actionsResolved || 0}`);
    console.log(`  Session ID: ${result.sessionId || 'N/A'}`);
    console.log(`  Reviewer skipped: ${result.reviewerSkipped || false}`);
    console.log(`  DSL Builder skipped: ${result.dslBuilderSkipped || false}`);
    console.log(`  Latency: ${latencyMs}ms`);

    if (result.warnings && result.warnings.length > 0) {
      console.log('\nWarnings:');
      result.warnings.forEach((w) => console.log(`  - ${w}`));
    }
  } else {
    console.log('FAILED\n');
    console.log('Errors:');
    result.errors?.forEach((e) => console.log(`  - ${e}`));
  }

  // 9. Prepare output
  const output = {
    success: result.success,
    workflow: result.workflow,
    reviewedWorkflow: result.reviewedWorkflow,
    reviewerSkipped: result.reviewerSkipped,
    dslBuilderSkipped: result.dslBuilderSkipped,
    sessionId: result.sessionId,
    metadata: result.metadata,
    errors: result.errors,
    warnings: result.warnings,
    latency_ms: latencyMs,
  };

  // 10. Save or print output
  if (options.output) {
    const outputPath = path.resolve(process.cwd(), options.output);
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nOutput saved to: ${options.output}`);
  } else {
    console.log('\nResult JSON:');
    console.log('='.repeat(50));
    console.log(JSON.stringify(output, null, 2));
  }

  process.exit(result.success ? 0 : 1);
}

// Run
main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
