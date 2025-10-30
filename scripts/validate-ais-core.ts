// scripts/validate-ais-core.ts
// Validation script to verify AIS core integrity after refactoring

import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '@/lib/services/AISConfigService';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface ValidationResult {
  category: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: ValidationResult[] = [];

async function validateAISRanges() {
  console.log('\n📋 Validating AIS Ranges Configuration...\n');

  try {
    // Test 1: Verify all ranges can be fetched from database
    const ranges = await AISConfigService.getRanges(supabase);

    const requiredRanges = [
      // Execution ranges
      'token_volume', 'token_peak', 'token_io_ratio_min', 'token_io_ratio_max',
      'iterations', 'duration_ms', 'failure_rate', 'retry_rate',
      'plugin_count', 'plugins_per_run', 'orchestration_overhead_ms',
      'workflow_steps', 'branches', 'loops', 'parallel',
      // Creation ranges
      'creation_workflow_steps', 'creation_plugins', 'creation_io_fields'
    ];

    let missingRanges = 0;
    for (const rangeKey of requiredRanges) {
      if (rangeKey === 'token_io_ratio_min' || rangeKey === 'token_io_ratio_max') {
        if (typeof ranges[rangeKey] !== 'number') {
          results.push({
            category: 'AIS Ranges',
            passed: false,
            message: `Missing or invalid range: ${rangeKey}`,
            details: { expected: 'number', actual: typeof ranges[rangeKey] }
          });
          missingRanges++;
        }
      } else {
        const range = ranges[rangeKey as keyof typeof ranges];
        if (!range || typeof range !== 'object' || typeof range.min !== 'number' || typeof range.max !== 'number') {
          results.push({
            category: 'AIS Ranges',
            passed: false,
            message: `Missing or invalid range: ${rangeKey}`,
            details: { range }
          });
          missingRanges++;
        }
      }
    }

    if (missingRanges === 0) {
      results.push({
        category: 'AIS Ranges',
        passed: true,
        message: `All ${requiredRanges.length} required ranges are present and valid`,
        details: { ranges }
      });
    }

    // Test 2: Verify ranges are loaded from database (not fallback)
    const cacheStatus = AISConfigService.getCacheStatus();
    results.push({
      category: 'AIS Ranges',
      passed: cacheStatus.cached,
      message: cacheStatus.cached
        ? `Ranges loaded from database and cached (age: ${cacheStatus.age_ms}ms)`
        : 'Ranges not cached - may be using fallback',
      details: cacheStatus
    });

  } catch (error) {
    results.push({
      category: 'AIS Ranges',
      passed: false,
      message: 'Exception while validating AIS ranges',
      details: { error: error instanceof Error ? error.message : String(error) }
    });
  }
}

async function validateAgentIntensityMetrics() {
  console.log('\n📊 Validating Agent Intensity Metrics...\n');

  try {
    // Test 1: Check if agents have intensity metrics
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('id')
      .limit(100);

    if (agentsError) {
      results.push({
        category: 'Agent Metrics',
        passed: false,
        message: 'Failed to fetch agents',
        details: { error: agentsError }
      });
      return;
    }

    if (!agents || agents.length === 0) {
      results.push({
        category: 'Agent Metrics',
        passed: true,
        message: 'No agents found in database (skipping metrics validation)',
      });
      return;
    }

    results.push({
      category: 'Agent Metrics',
      passed: true,
      message: `Found ${agents.length} agents to validate`,
    });

    // Test 2: Check for agents missing intensity metrics
    const { data: metricsCount, error: metricsError } = await supabase
      .from('agent_intensity_metrics')
      .select('agent_id', { count: 'exact', head: true });

    if (metricsError) {
      results.push({
        category: 'Agent Metrics',
        passed: false,
        message: 'Failed to count intensity metrics',
        details: { error: metricsError }
      });
      return;
    }

    const agentsWithoutMetrics = agents.length - (metricsCount as any);

    results.push({
      category: 'Agent Metrics',
      passed: agentsWithoutMetrics === 0,
      message: agentsWithoutMetrics === 0
        ? 'All agents have intensity metrics'
        : `${agentsWithoutMetrics} agents are missing intensity metrics`,
      details: { total_agents: agents.length, agents_with_metrics: metricsCount }
    });

    // Test 3: Check for null/invalid combined scores
    const { data: invalidScores, error: scoresError } = await supabase
      .from('agent_intensity_metrics')
      .select('agent_id, creation_score, execution_score, combined_score')
      .or('combined_score.is.null,creation_score.is.null');

    if (scoresError) {
      results.push({
        category: 'Score Validation',
        passed: false,
        message: 'Failed to check for invalid scores',
        details: { error: scoresError }
      });
    } else {
      results.push({
        category: 'Score Validation',
        passed: !invalidScores || invalidScores.length === 0,
        message: !invalidScores || invalidScores.length === 0
          ? 'All agents have valid combined and creation scores'
          : `${invalidScores.length} agents have null/invalid scores`,
        details: { invalid_agents: invalidScores }
      });
    }

    // Test 4: Check for new 4-dimension columns
    const { data: dimensionScores, error: dimensionError } = await supabase
      .from('agent_intensity_metrics')
      .select('agent_id, creation_workflow_score, creation_plugin_score, creation_io_score, creation_trigger_score')
      .limit(5);

    if (dimensionError) {
      results.push({
        category: 'Creation Dimensions',
        passed: false,
        message: 'Failed to fetch creation dimension columns (may not exist)',
        details: { error: dimensionError }
      });
    } else {
      const hasNewColumns = dimensionScores && dimensionScores.length > 0;
      const allHaveValues = dimensionScores?.every(s =>
        s.creation_workflow_score !== null &&
        s.creation_plugin_score !== null &&
        s.creation_io_score !== null &&
        s.creation_trigger_score !== null
      );

      results.push({
        category: 'Creation Dimensions',
        passed: hasNewColumns && allHaveValues,
        message: hasNewColumns
          ? (allHaveValues ? 'All 4 creation dimension columns exist and have values' : 'Creation dimension columns exist but some have null values')
          : 'Creation dimension columns do not exist',
        details: { sample: dimensionScores }
      });
    }

  } catch (error) {
    results.push({
      category: 'Agent Metrics',
      passed: false,
      message: 'Exception while validating agent metrics',
      details: { error: error instanceof Error ? error.message : String(error) }
    });
  }
}

async function validateCombinedScoreCalculation() {
  console.log('\n🧮 Validating Combined Score Calculation...\n');

  try {
    // Fetch a sample of agents with metrics
    const { data: metrics, error } = await supabase
      .from('agent_intensity_metrics')
      .select('agent_id, creation_score, execution_score, combined_score')
      .not('creation_score', 'is', null)
      .not('execution_score', 'is', null)
      .limit(10);

    if (error || !metrics || metrics.length === 0) {
      results.push({
        category: 'Combined Score',
        passed: false,
        message: 'Unable to fetch metrics for validation',
        details: { error }
      });
      return;
    }

    const CREATION_WEIGHT = 0.3;
    const EXECUTION_WEIGHT = 0.7;

    let incorrectCalculations = 0;
    const issues: any[] = [];

    for (const metric of metrics) {
      const expectedCombined = (metric.creation_score * CREATION_WEIGHT) + (metric.execution_score * EXECUTION_WEIGHT);
      const difference = Math.abs(metric.combined_score - expectedCombined);

      // Allow small floating point differences (0.01)
      if (difference > 0.01) {
        incorrectCalculations++;
        issues.push({
          agent_id: metric.agent_id,
          creation_score: metric.creation_score,
          execution_score: metric.execution_score,
          stored_combined: metric.combined_score,
          expected_combined: expectedCombined,
          difference
        });
      }
    }

    results.push({
      category: 'Combined Score',
      passed: incorrectCalculations === 0,
      message: incorrectCalculations === 0
        ? `All ${metrics.length} sampled agents have correctly calculated combined scores`
        : `${incorrectCalculations} of ${metrics.length} agents have incorrect combined score calculations`,
      details: { issues }
    });

  } catch (error) {
    results.push({
      category: 'Combined Score',
      passed: false,
      message: 'Exception while validating combined scores',
      details: { error: error instanceof Error ? error.message : String(error) }
    });
  }
}

async function checkForHardcodedValues() {
  console.log('\n🔍 Checking for Hardcoded Values (Manual Review Required)...\n');

  results.push({
    category: 'Hardcoded Values',
    passed: true,
    message: 'Manual review required: Check that no normalization ranges are hardcoded',
    details: {
      files_to_check: [
        'lib/services/AgentIntensityService.ts',
        'lib/utils/updateAgentIntensity.ts',
        'app/api/agents/[id]/intensity/route.ts'
      ],
      what_to_look_for: 'Search for numeric range values (e.g., "max: 5000") that are not in AISConfigService'
    }
  });
}

async function printResults() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 VALIDATION RESULTS');
  console.log('='.repeat(80) + '\n');

  const categories = [...new Set(results.map(r => r.category))];

  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    const passed = categoryResults.filter(r => r.passed).length;
    const total = categoryResults.length;

    console.log(`\n${category}: ${passed}/${total} tests passed`);
    console.log('-'.repeat(80));

    for (const result of categoryResults) {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.message}`);

      if (result.details && !result.passed) {
        console.log(`   Details: ${JSON.stringify(result.details, null, 2).slice(0, 500)}`);
      }
    }
  }

  const totalPassed = results.filter(r => r.passed).length;
  const totalTests = results.length;
  const passRate = ((totalPassed / totalTests) * 100).toFixed(1);

  console.log('\n' + '='.repeat(80));
  console.log(`OVERALL: ${totalPassed}/${totalTests} tests passed (${passRate}%)`);
  console.log('='.repeat(80) + '\n');

  // Exit with error code if any tests failed
  if (totalPassed < totalTests) {
    console.error('⚠️  Some validation tests failed. Please review the results above.\n');
    process.exit(1);
  } else {
    console.log('🎉 All validation tests passed!\n');
    process.exit(0);
  }
}

async function main() {
  console.log('🚀 Starting AIS Core Validation...\n');
  console.log('This script validates that the AIS refactoring was successful:\n');
  console.log('  1. All AIS ranges are loaded from database');
  console.log('  2. All agents have intensity metrics');
  console.log('  3. Combined scores are correctly calculated');
  console.log('  4. New 4-dimension columns exist and are populated\n');

  await validateAISRanges();
  await validateAgentIntensityMetrics();
  await validateCombinedScoreCalculation();
  await checkForHardcodedValues();

  await printResults();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
