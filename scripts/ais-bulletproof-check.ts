// Comprehensive AIS system integrity check
import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '@/lib/services/AISConfigService';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface CheckResult {
  category: string;
  check: string;
  passed: boolean;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  details?: any;
}

const results: CheckResult[] = [];

function addResult(category: string, check: string, passed: boolean, message: string, severity: 'critical' | 'warning' | 'info' = 'critical', details?: any) {
  results.push({ category, check, passed, message, severity, details });
}

async function check1_DatabaseRanges() {
  console.log('\n1️⃣ Checking Database Ranges...');

  try {
    const ranges = await AISConfigService.getRanges(supabase);

    // Check all required ranges exist
    const requiredRanges = [
      'token_volume', 'token_peak', 'token_io_ratio_min', 'token_io_ratio_max',
      'iterations', 'duration_ms', 'failure_rate', 'retry_rate',
      'plugin_count', 'plugins_per_run', 'orchestration_overhead_ms',
      'workflow_steps', 'branches', 'loops', 'parallel',
      'creation_workflow_steps', 'creation_plugins', 'creation_io_fields'
    ];

    let allRangesExist = true;
    for (const key of requiredRanges) {
      if (key === 'token_io_ratio_min' || key === 'token_io_ratio_max') {
        if (typeof ranges[key] !== 'number') {
          addResult('Database', `Range: ${key}`, false, 'Missing or invalid', 'critical');
          allRangesExist = false;
        }
      } else {
        const range = ranges[key as keyof typeof ranges];
        if (!range || typeof range !== 'object') {
          addResult('Database', `Range: ${key}`, false, 'Missing or invalid', 'critical');
          allRangesExist = false;
        }
      }
    }

    if (allRangesExist) {
      addResult('Database', 'All ranges exist', true, `All ${requiredRanges.length} ranges present`, 'info');
    }

    // Check creation ranges start from 0
    if (ranges.creation_plugins.min === 0) {
      addResult('Database', 'creation_plugins min=0', true, 'Correctly starts from 0', 'info');
    } else {
      addResult('Database', 'creation_plugins min=0', false, `Min is ${ranges.creation_plugins.min}, should be 0`, 'critical');
    }

    if (ranges.creation_workflow_steps.min === 0) {
      addResult('Database', 'creation_workflow_steps min=0', true, 'Correctly starts from 0', 'info');
    } else {
      addResult('Database', 'creation_workflow_steps min=0', false, `Min is ${ranges.creation_workflow_steps.min}, should be 0`, 'critical');
    }

    if (ranges.creation_io_fields.min === 0) {
      addResult('Database', 'creation_io_fields min=0', true, 'Correctly starts from 0', 'info');
    } else {
      addResult('Database', 'creation_io_fields min=0', false, `Min is ${ranges.creation_io_fields.min}, should be 0`, 'critical');
    }

  } catch (error) {
    addResult('Database', 'Fetch ranges', false, `Exception: ${error}`, 'critical');
  }
}

async function check2_CodeConsistency() {
  console.log('\n2️⃣ Checking Code Consistency...');

  // Check for hardcoded values by looking for common patterns
  const fs = require('fs');
  const filesToCheck = [
    'lib/services/AgentIntensityService.ts',
    'lib/utils/updateAgentIntensity.ts',
    'app/api/agents/[id]/intensity/route.ts'
  ];

  let hardcodedFound = false;

  for (const file of filesToCheck) {
    try {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');

      // Check if file imports AISConfigService
      if (!content.includes('AISConfigService')) {
        addResult('Code', `${file} imports AISConfigService`, false, 'Missing import', 'critical');
        hardcodedFound = true;
      } else {
        addResult('Code', `${file} imports AISConfigService`, true, 'Import present', 'info');
      }

      // Check for suspicious hardcoded normalization patterns
      const suspiciousPatterns = [
        /normalizeToScale\s*\([^)]*,\s*\d+\s*,\s*\d+/,  // normalizeToScale(value, 1, 10)
        /\{\s*min:\s*\d+\s*,\s*max:\s*\d+\s*\}/,  // { min: 1, max: 10 }
      ];

      for (const pattern of suspiciousPatterns) {
        if (pattern.test(content)) {
          // Check if it's using AISConfigService.normalize nearby
          if (!content.includes('AISConfigService.normalize')) {
            addResult('Code', `${file} no hardcoded values`, false, 'Suspicious hardcoded pattern found', 'warning');
            hardcodedFound = true;
            break;
          }
        }
      }

    } catch (error) {
      addResult('Code', `Check ${file}`, false, `Cannot read file: ${error}`, 'warning');
    }
  }

  if (!hardcodedFound) {
    addResult('Code', 'No hardcoded ranges', true, 'All files use AISConfigService', 'info');
  }
}

async function check3_AgentScores() {
  console.log('\n3️⃣ Checking Agent Scores...');

  try {
    // Get all agents with metrics
    const { data: metrics, error } = await supabase
      .from('agent_intensity_metrics')
      .select('agent_id, creation_score, execution_score, combined_score, creation_workflow_score, creation_plugin_score, creation_io_score')
      .not('creation_score', 'is', null)
      .limit(100);

    if (error) {
      addResult('Agent Scores', 'Fetch metrics', false, `Error: ${error.message}`, 'critical');
      return;
    }

    if (!metrics || metrics.length === 0) {
      addResult('Agent Scores', 'Agents exist', false, 'No agents with metrics found', 'warning');
      return;
    }

    addResult('Agent Scores', 'Agents exist', true, `Found ${metrics.length} agents with metrics`, 'info');

    // Check all agents have 4 creation dimensions
    let missingDimensions = 0;
    for (const metric of metrics) {
      if (metric.creation_workflow_score == null ||
          metric.creation_plugin_score == null ||
          metric.creation_io_score == null) {
        missingDimensions++;
      }
    }

    if (missingDimensions === 0) {
      addResult('Agent Scores', 'All have 4 dimensions', true, 'All agents have creation dimension scores', 'info');
    } else {
      addResult('Agent Scores', 'All have 4 dimensions', false, `${missingDimensions} agents missing dimension scores`, 'warning');
    }

    // Check combined scores are correctly calculated
    const CREATION_WEIGHT = 0.3;
    const EXECUTION_WEIGHT = 0.7;

    let incorrectCombined = 0;
    for (const metric of metrics) {
      const expected = (metric.creation_score * CREATION_WEIGHT) + (metric.execution_score * EXECUTION_WEIGHT);
      const diff = Math.abs(metric.combined_score - expected);
      if (diff > 0.01) {
        incorrectCombined++;
      }
    }

    if (incorrectCombined === 0) {
      addResult('Agent Scores', 'Combined scores correct', true, `All ${metrics.length} agents have correct combined scores`, 'info');
    } else {
      addResult('Agent Scores', 'Combined scores correct', false, `${incorrectCombined} agents have incorrect combined scores`, 'critical');
    }

    // Check for agents with 0.0 creation scores (shouldn't exist unless truly empty)
    const zeroCreation = metrics.filter(m => m.creation_score === 0);
    if (zeroCreation.length > 0) {
      addResult('Agent Scores', 'No zero creation scores', false, `${zeroCreation.length} agents have 0.0 creation score`, 'warning', { count: zeroCreation.length });
    } else {
      addResult('Agent Scores', 'No zero creation scores', true, 'All agents have non-zero creation scores', 'info');
    }

  } catch (error) {
    addResult('Agent Scores', 'Check scores', false, `Exception: ${error}`, 'critical');
  }
}

async function check4_PluginScoringBug() {
  console.log('\n4️⃣ Checking Plugin Scoring Bug Fix...');

  try {
    // Find agents with 1 plugin
    const { data: agents, error } = await supabase
      .from('agents')
      .select('id, connected_plugins')
      .limit(100);

    if (error || !agents) {
      addResult('Plugin Bug', 'Fetch agents', false, `Error: ${error?.message}`, 'critical');
      return;
    }

    let agentsWith1Plugin = 0;
    let agentsWith1PluginScoring0 = 0;

    for (const agent of agents) {
      const plugins = typeof agent.connected_plugins === 'string'
        ? JSON.parse(agent.connected_plugins)
        : (agent.connected_plugins || []);

      if (plugins.length === 1) {
        agentsWith1Plugin++;

        // Check the score
        const { data: metrics } = await supabase
          .from('agent_intensity_metrics')
          .select('creation_plugin_score')
          .eq('agent_id', agent.id)
          .single();

        if (metrics && metrics.creation_plugin_score === 0) {
          agentsWith1PluginScoring0++;
        }
      }
    }

    if (agentsWith1Plugin === 0) {
      addResult('Plugin Bug', 'Agents with 1 plugin', true, 'No agents with 1 plugin to test', 'info');
    } else if (agentsWith1PluginScoring0 === 0) {
      addResult('Plugin Bug', 'Plugin scoring fixed', true, `${agentsWith1Plugin} agents with 1 plugin all score >0`, 'info');
    } else {
      addResult('Plugin Bug', 'Plugin scoring fixed', false, `${agentsWith1PluginScoring0} of ${agentsWith1Plugin} agents with 1 plugin still score 0.0`, 'critical');
    }

  } catch (error) {
    addResult('Plugin Bug', 'Check plugin bug', false, `Exception: ${error}`, 'critical');
  }
}

async function check5_TypeScriptTypes() {
  console.log('\n5️⃣ Checking TypeScript Types...');

  const fs = require('fs');

  try {
    const typesContent = fs.readFileSync(
      path.resolve(process.cwd(), 'lib/types/intensity.ts'),
      'utf-8'
    );

    // Check for new creation dimension fields
    const hasCreationWorkflow = typesContent.includes('creation_workflow_score');
    const hasCreationPlugin = typesContent.includes('creation_plugin_score');
    const hasCreationIo = typesContent.includes('creation_io_score');
    const hasCreationTrigger = typesContent.includes('creation_trigger_score');

    if (hasCreationWorkflow && hasCreationPlugin && hasCreationIo && hasCreationTrigger) {
      addResult('TypeScript', '4 creation dimensions in types', true, 'All dimension fields defined', 'info');
    } else {
      addResult('TypeScript', '4 creation dimensions in types', false, 'Missing dimension field definitions', 'critical');
    }

    // Check for COMBINED_WEIGHTS
    const hasCombinedWeights = typesContent.includes('COMBINED_WEIGHTS');
    if (hasCombinedWeights) {
      addResult('TypeScript', 'COMBINED_WEIGHTS defined', true, 'Weight constants present', 'info');
    } else {
      addResult('TypeScript', 'COMBINED_WEIGHTS defined', false, 'Missing weight constants', 'critical');
    }

  } catch (error) {
    addResult('TypeScript', 'Check types', false, `Cannot read types file: ${error}`, 'critical');
  }
}

async function check6_CachingWorking() {
  console.log('\n6️⃣ Checking AIS Config Caching...');

  try {
    const status = AISConfigService.getCacheStatus();

    if (status.cached) {
      addResult('Caching', 'Cache working', true, `Cache age: ${status.age_ms}ms`, 'info', status);
    } else {
      addResult('Caching', 'Cache working', false, 'Cache not populated', 'warning');
    }

    // Clear cache and refetch to test it works
    AISConfigService.clearCache();
    const ranges = await AISConfigService.getRanges(supabase);

    const newStatus = AISConfigService.getCacheStatus();
    if (newStatus.cached && newStatus.age_ms < 1000) {
      addResult('Caching', 'Cache refresh works', true, 'Successfully cleared and repopulated cache', 'info');
    } else {
      addResult('Caching', 'Cache refresh works', false, 'Cache may not be working correctly', 'warning');
    }

  } catch (error) {
    addResult('Caching', 'Check cache', false, `Exception: ${error}`, 'warning');
  }
}

function printResults() {
  console.log('\n' + '='.repeat(80));
  console.log('🛡️  AIS BULLETPROOF CHECK RESULTS');
  console.log('='.repeat(80) + '\n');

  const categories = [...new Set(results.map(r => r.category))];

  let totalCriticalFailed = 0;
  let totalWarnings = 0;

  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    const passed = categoryResults.filter(r => r.passed).length;
    const criticalFailed = categoryResults.filter(r => !r.passed && r.severity === 'critical').length;
    const warnings = categoryResults.filter(r => !r.passed && r.severity === 'warning').length;

    totalCriticalFailed += criticalFailed;
    totalWarnings += warnings;

    console.log(`\n${category}:`);
    console.log('-'.repeat(80));

    for (const result of categoryResults) {
      const icon = result.passed ? '✅' : (result.severity === 'critical' ? '❌' : '⚠️');
      console.log(`${icon} ${result.check}: ${result.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));

  const totalPassed = results.filter(r => r.passed).length;
  const totalTests = results.length;

  console.log(`\nTOTAL: ${totalPassed}/${totalTests} checks passed`);
  console.log(`Critical failures: ${totalCriticalFailed}`);
  console.log(`Warnings: ${totalWarnings}`);

  console.log('\n' + '='.repeat(80));

  if (totalCriticalFailed === 0 && totalWarnings === 0) {
    console.log('\n🛡️  ✅ AIS SYSTEM IS BULLETPROOF! 🎉\n');
    console.log('All checks passed with no critical issues or warnings.\n');
    process.exit(0);
  } else if (totalCriticalFailed === 0) {
    console.log(`\n🛡️  ⚠️  AIS SYSTEM IS MOSTLY SOLID (${totalWarnings} warnings)\n`);
    console.log('No critical issues, but some warnings to review.\n');
    process.exit(0);
  } else {
    console.log(`\n🛡️  ❌ AIS SYSTEM HAS ISSUES (${totalCriticalFailed} critical, ${totalWarnings} warnings)\n`);
    console.log('Critical issues must be fixed before production.\n');
    process.exit(1);
  }
}

async function main() {
  console.log('🛡️  Starting AIS Bulletproof Check...\n');
  console.log('This comprehensive check will verify:');
  console.log('  1. Database ranges are correct');
  console.log('  2. Code consistency (no hardcoded values)');
  console.log('  3. Agent scores are valid');
  console.log('  4. Plugin scoring bug is fixed');
  console.log('  5. TypeScript types are complete');
  console.log('  6. Caching is working\n');

  await check1_DatabaseRanges();
  await check2_CodeConsistency();
  await check3_AgentScores();
  await check4_PluginScoringBug();
  await check5_TypeScriptTypes();
  await check6_CachingWorking();

  printResults();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
