/**
 * Run Insight Detection - Direct execution
 * This file imports dotenv FIRST before any other code runs
 */

// Must be the very first import
import 'dotenv/config';

// Now check if env vars are loaded
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: Missing environment variables');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.error('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  process.exit(1);
}

// Now we can import modules that depend on env vars
import { createClient } from '@supabase/supabase-js';

// Create client BEFORE importing DetectorEngine (which imports supabaseServer)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Mock the supabaseServer module to use our client
// This is a workaround for the module initialization order issue
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
  if (id.includes('supabaseServer') || id === '@/lib/supabaseServer') {
    return { supabaseServer: supabase, createServerSupabaseClient: () => supabase };
  }
  return originalRequire.apply(this, arguments);
};

// Now import the detector engine
import { DetectorEngine } from '../lib/business-os/insight/detectors/DetectorEngine';

async function main() {
  let userId = process.argv[2];

  if (!userId) {
    console.log('No userId provided, finding an active user...\n');

    const { data: users } = await supabase
      .from('crm_contacts')
      .select('user_id')
      .limit(1);

    if (!users || users.length === 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id')
        .limit(1);

      if (!profiles || profiles.length === 0) {
        console.error('No users found in database');
        process.exit(1);
      }
      userId = profiles[0].id;
    } else {
      userId = users[0].user_id;
    }
  }

  console.log('='.repeat(60));
  console.log('INSIGHT DETECTION SYSTEM');
  console.log('='.repeat(60));
  console.log(`\nRunning for user: ${userId}\n`);

  const engine = new DetectorEngine(supabase);

  console.log(`Total detectors registered: ${engine.getDetectorCount()}\n`);
  console.log('Detectors by category:');

  const categories = ['acquisition', 'conversion', 'sales', 'cash_flow', 'retention', 'operations', 'pricing'];
  for (const category of categories) {
    const detectors = engine.getDetectorsByCategory(category);
    console.log(`  ${category}: ${detectors.length} detectors`);
  }

  console.log('\n' + '-'.repeat(60));
  console.log('Running all detectors with correlation...');
  console.log('-'.repeat(60) + '\n');

  const startTime = Date.now();

  try {
    const summary = await engine.runWithCorrelation(userId);

    const duration = Date.now() - startTime;

    console.log('='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log(`\nExecution time: ${duration}ms`);
    console.log(`Patterns checked: ${summary.patternsChecked}`);
    console.log(`Patterns matched: ${summary.patternsMatched}`);
    console.log(`Total estimated impact: $${summary.totalImpactUsd.toLocaleString()}`);

    // Show correlated insights
    if (summary.correlatedInsights.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('CORRELATED INSIGHTS (Story-Driven)');
      console.log('='.repeat(60));

      for (const insight of summary.correlatedInsights) {
        console.log(`\n🔴 ${insight.patternName.toUpperCase()} [${insight.severity}]`);
        console.log(`   Category: ${insight.category}`);
        console.log(`   Impact: $${insight.totalImpactUsd.toLocaleString()}`);
        console.log(`\n   Story: "${insight.story}"`);
        console.log(`\n   Action: "${insight.action}"`);
        console.log(`\n   Contributing signals:`);
        for (const contrib of insight.contributingInsights) {
          console.log(`     - ${contrib.detectorName}: ${contrib.summary}`);
        }
      }
    } else {
      console.log('\n✅ No correlated patterns found - individual signals not connected.');
    }

    // Show standalone insights
    if (summary.standaloneInsights.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('STANDALONE INSIGHTS (Individual Signals)');
      console.log('='.repeat(60));

      for (const result of summary.standaloneInsights) {
        const impact = result.estimatedImpactUsd ? `$${result.estimatedImpactUsd.toLocaleString()}` : 'N/A';
        console.log(`\n📊 ${result.detectorId} [${result.severity}]`);
        console.log(`   Category: ${result.category}`);
        console.log(`   Metric: ${result.metricKey}`);
        console.log(`   Current: ${result.currentValue} | Baseline: ${result.baselineValue} | Change: ${result.percentChange}%`);
        console.log(`   Affected: ${result.affectedCount} ${result.affectedEntityType || 'items'}`);
        console.log(`   Impact: ${impact}`);
        if (result.processParameters) {
          const details = JSON.stringify(result.processParameters);
          console.log(`   Details: ${details.substring(0, 200)}${details.length > 200 ? '...' : ''}`);
        }
      }
    } else {
      console.log('\n✅ No standalone insights - all signals were correlated or no issues detected.');
    }

    // Summary
    const totalInsights = summary.correlatedInsights.length + summary.standaloneInsights.length;
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`\n  Correlated Insights: ${summary.correlatedInsights.length}`);
    console.log(`  Standalone Insights: ${summary.standaloneInsights.length}`);
    console.log(`  Total Insights: ${totalInsights}`);
    console.log(`  Total Impact: $${summary.totalImpactUsd.toLocaleString()}`);

    if (totalInsights === 0) {
      console.log('\n  ℹ️  No insights detected. This could mean:');
      console.log('     - The user has limited data in the system');
      console.log('     - All metrics are within normal thresholds');
      console.log('     - Detectors are on cooldown from recent runs');
    }

  } catch (error) {
    console.error('\n❌ Error running detection:', error);
    process.exit(1);
  }

  console.log('\n');
}

main();
