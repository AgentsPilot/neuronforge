/**
 * Insight System Verification Script
 *
 * 1. Clears existing insights
 * 2. Runs fresh detection
 * 3. Verifies no duplicates
 * 4. Reports detector coverage
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Get user ID from command line or use default test user
const userId = process.argv[2] || '08456106-aa50-4810-b12c-7ca84102da31';

async function clearInsights() {
  console.log('\n🧹 Step 1: Clearing existing insights...');

  const tables = [
    'insights',
    'business_health_summaries',
  ];

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.log(`   ⚠️  ${table}: ${error.message}`);
    } else {
      console.log(`   ✓ ${table} cleared`);
    }
  }
}

async function runDetection() {
  console.log('\n🔍 Step 2: Running detection (this may take a moment)...');

  // Import and run detection directly
  const { DetectorEngine } = await import('../lib/business-os/insight/detectors/DetectorEngine');
  const { getCorrelationEngine } = await import('../lib/business-os/insight/correlation');
  const { InsightPrioritizer } = await import('../lib/business-os/insight/prioritizer');
  const { InsightRepository } = await import('../lib/business-os/insight/repository');

  const engine = new DetectorEngine(supabase);
  const correlationEngine = getCorrelationEngine();
  const prioritizer = new InsightPrioritizer(supabase);
  const repository = new InsightRepository(supabase);
  const runId = crypto.randomUUID();

  // Get user language
  const { data: profile } = await supabase
    .from('business_profiles')
    .select('language')
    .eq('user_id', userId)
    .single();

  const language = profile?.language || 'en';
  correlationEngine.setLocale({ language: language as 'en' | 'es' | 'he', currency: language === 'he' ? 'ILS' : 'USD' });

  // Run all detectors
  const detections = await engine.runForUser(userId);
  console.log(`   ✓ ${detections.length} detections found from ${engine.getDetectors().length} detectors\n`);

  // Show which detectors fired
  console.log('   📊 Detectors that fired:');
  const detectorCounts = new Map<string, number>();
  for (const d of detections) {
    detectorCounts.set(d.detectorId, (detectorCounts.get(d.detectorId) || 0) + 1);
  }

  for (const [detectorId, count] of detectorCounts) {
    const detection = detections.find(d => d.detectorId === detectorId);
    console.log(`      - ${detectorId}: ${count} detection(s), severity=${detection?.severity}, impact=$${detection?.estimatedImpactUsd?.toFixed(0) || 0}`);
  }

  // Run correlation
  const correlationSummary = correlationEngine.correlate(detections);
  console.log(`\n   🔗 Correlation results:`);
  console.log(`      - Patterns checked: ${correlationSummary.patternsChecked}`);
  console.log(`      - Patterns matched: ${correlationSummary.patternsMatched}`);
  console.log(`      - Correlated insights: ${correlationSummary.correlatedInsights.length}`);
  console.log(`      - Standalone insights: ${correlationSummary.standaloneInsights.length}`);

  // Prioritize
  const prioritized = await prioritizer.getTopInsights(userId, detections, 20);
  console.log(`\n   🎯 Prioritized ${prioritized.length} insights`);

  // Save to database
  const result = await repository.createBatch(userId, prioritized, runId);
  if (result.error) {
    console.error(`   ❌ Error saving insights: ${result.error.message}`);
    return { detections, correlationSummary };
  }

  console.log(`   ✓ Saved ${result.data?.length || 0} individual insights`);

  // Build detector -> insight ID mapping
  const detectorToInsightId = new Map<string, string>();
  for (const insight of result.data || []) {
    detectorToInsightId.set(insight.detector_id, insight.id);
  }

  // Save correlated insights
  if (correlationSummary.correlatedInsights.length > 0) {
    const corrResult = await repository.saveCorrelationResults(
      userId,
      correlationSummary,
      detectorToInsightId,
      runId
    );
    if (corrResult.error) {
      console.error(`   ❌ Error saving correlated insights: ${corrResult.error.message}`);
    } else {
      console.log(`   ✓ Saved ${corrResult.data?.correlatedInsights.length || 0} correlated insights`);
    }
  }

  return { detections, correlationSummary };
}

async function checkDuplicates() {
  console.log('\n🔎 Step 3: Checking for duplicates...');

  // Check individual insights for duplicates
  const { data: insights } = await supabase
    .from('insights')
    .select('detector_id, id, title, is_correlated')
    .eq('user_id', userId)
    .in('status', ['new', 'viewed'])
    .order('detector_id');

  if (!insights || insights.length === 0) {
    console.log('   ⚠️  No insights found');
    return;
  }

  // Group by detector_id
  const groups = new Map<string, typeof insights>();
  for (const insight of insights) {
    const key = insight.detector_id;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(insight);
  }

  let duplicateCount = 0;
  for (const [detectorId, group] of groups) {
    if (group.length > 1) {
      duplicateCount += group.length - 1;
      console.log(`   ❌ DUPLICATE: ${detectorId} has ${group.length} insights`);
      for (const insight of group) {
        console.log(`      - ${insight.id}: ${insight.title?.substring(0, 50)}...`);
      }
    }
  }

  if (duplicateCount === 0) {
    console.log('   ✅ No duplicates found!');
  } else {
    console.log(`\n   ⚠️  Total duplicates: ${duplicateCount}`);
  }

  // Summary
  const correlatedCount = insights.filter(i => i.is_correlated).length;
  const standaloneCount = insights.filter(i => !i.is_correlated).length;

  console.log(`\n   📊 Final counts:`);
  console.log(`      - Total insights: ${insights.length}`);
  console.log(`      - Correlated: ${correlatedCount}`);
  console.log(`      - Standalone: ${standaloneCount}`);
  console.log(`      - Unique detector types: ${groups.size}`);
}

async function showFinalResults() {
  console.log('\n📋 Step 4: Final insight list...');

  const { data: insights } = await supabase
    .from('insights')
    .select('detector_id, severity, title, estimated_impact_usd, is_correlated')
    .eq('user_id', userId)
    .in('status', ['new', 'viewed'])
    .order('priority_score', { ascending: false });

  if (!insights) return;

  console.log('');
  for (const insight of insights) {
    const type = insight.is_correlated ? '🔗' : '📌';
    const sev = insight.severity?.toUpperCase().padEnd(8) || 'N/A';
    const impact = `$${(insight.estimated_impact_usd || 0).toLocaleString()}`.padStart(8);
    console.log(`   ${type} [${sev}] ${impact} | ${insight.title?.substring(0, 60)}`);
  }

  // Health summary
  const { data: health } = await supabase
    .from('business_health_summaries')
    .select('health_score, summary_title, critical_count, high_count, total_impact_usd')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (health) {
    console.log('\n   💚 Health Summary:');
    console.log(`      Score: ${health.health_score}/100`);
    console.log(`      Critical: ${health.critical_count} | High: ${health.high_count}`);
    console.log(`      Total Impact: $${health.total_impact_usd?.toLocaleString()}`);
  }
}

async function main() {
  console.log('============================================================');
  console.log('       INSIGHT SYSTEM VERIFICATION');
  console.log('============================================================');
  console.log(`User ID: ${userId}`);

  try {
    await clearInsights();
    await runDetection();
    await checkDuplicates();
    await showFinalResults();

    console.log('\n============================================================');
    console.log('       VERIFICATION COMPLETE');
    console.log('============================================================\n');
  } catch (error) {
    console.error('\n❌ Verification failed:', error);
    process.exit(1);
  }
}

main();
