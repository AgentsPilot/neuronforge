#!/usr/bin/env node
/**
 * Run Insight Detection - ESM version with proper env loading
 * Usage: node scripts/run-insights.mjs [userId]
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load env BEFORE any other imports
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

// Verify env is loaded
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Make sure .env.local exists');
  process.exit(1);
}

// Create supabase client
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// We need to dynamically import our TypeScript files through tsx
const { execSync } = require('child_process');
const path = require('path');

async function main() {
  let userId = process.argv[2];

  // If no userId provided, find one
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

  // Run each detector directly through database queries
  // This is a simpler approach that doesn't need TypeScript compilation

  const detectors = [
    // Acquisition
    { id: 'acq_traffic_drop', category: 'acquisition', table: 'website_page_views' },
    { id: 'acq_low_conversion', category: 'acquisition', table: 'crm_contacts' },

    // Conversion
    { id: 'crm_cold_leads', category: 'conversion', table: 'crm_contacts' },
    { id: 'conv_pipeline_stuck', category: 'conversion', table: 'crm_contacts' },
    { id: 'conv_followup_overdue', category: 'conversion', table: 'crm_tasks' },
    { id: 'conv_source_underperform', category: 'conversion', table: 'crm_contacts' },

    // Sales
    { id: 'sales_stalled', category: 'sales', table: 'business_events' },
    { id: 'sales_reply_slow', category: 'sales', table: 'derived_metrics' },

    // Cash Flow
    { id: 'cash_ar_overdue', category: 'cash_flow', table: 'payment_invoices' },
    { id: 'cash_payment_issues', category: 'cash_flow', table: 'payment_transactions' },
    { id: 'cash_cards_expiring', category: 'cash_flow', table: 'payment_methods' },
    { id: 'cash_ar_aging', category: 'cash_flow', table: 'payment_invoices' },
    { id: 'cash_refund_pattern', category: 'cash_flow', table: 'payment_transactions' },
    { id: 'cash_payout_blocked', category: 'cash_flow', table: 'stripe_connect_accounts' },

    // Retention
    { id: 'ret_no_show_spike', category: 'retention', table: 'scheduling_bookings' },
    { id: 'ret_cancellation_spike', category: 'retention', table: 'scheduling_bookings' },
    { id: 'ret_repeat_booking_low', category: 'retention', table: 'scheduling_bookings' },
    { id: 'crm_engagement_decay', category: 'retention', table: 'crm_contacts' },

    // Operations
    { id: 'ops_utilization_low', category: 'operations', table: 'derived_metrics' },
    { id: 'ops_service_performance', category: 'operations', table: 'scheduling_services' },
    { id: 'ops_peak_unutilized', category: 'operations', table: 'scheduling_availability' },
    { id: 'ops_last_minute_cancels', category: 'operations', table: 'scheduling_bookings' },

    // Pricing
    { id: 'pricing_discount_abuse', category: 'pricing', table: 'payment_transactions' },
    { id: 'pricing_intro_offer_stuck', category: 'pricing', table: 'scheduling_bookings' },

    // Website
    { id: 'web_missing_cta', category: 'acquisition', table: 'website_blocks' },
    { id: 'web_incomplete_content', category: 'acquisition', table: 'website_content' },
    { id: 'web_page_underperform', category: 'acquisition', table: 'website_page_views' },
    { id: 'web_mobile_issues', category: 'acquisition', table: 'website_page_views' },
  ];

  console.log(`Total detectors: ${detectors.length}\n`);

  const categories = ['acquisition', 'conversion', 'sales', 'cash_flow', 'retention', 'operations', 'pricing'];
  console.log('Detectors by category:');
  for (const cat of categories) {
    const count = detectors.filter(d => d.category === cat).length;
    console.log(`  ${cat}: ${count} detectors`);
  }

  console.log('\n' + '-'.repeat(60));
  console.log('Checking data availability...');
  console.log('-'.repeat(60) + '\n');

  // Check what data exists for this user
  const dataSummary = {};

  const tables = ['crm_contacts', 'crm_tasks', 'crm_activities', 'scheduling_bookings',
                  'scheduling_services', 'payment_transactions', 'payment_invoices',
                  'website_page_views', 'website_pages', 'website_blocks'];

  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (!error) {
        dataSummary[table] = count || 0;
      }
    } catch (e) {
      dataSummary[table] = 'error';
    }
  }

  console.log('Data for this user:');
  for (const [table, count] of Object.entries(dataSummary)) {
    const emoji = count > 0 ? '✅' : '⚠️';
    console.log(`  ${emoji} ${table}: ${count} records`);
  }

  // Now run the actual detector engine via the compiled code
  console.log('\n' + '-'.repeat(60));
  console.log('Running detector engine...');
  console.log('-'.repeat(60) + '\n');

  // Import and run the actual engine
  try {
    // We need to use tsx to run the TypeScript module
    const result = execSync(
      `NEXT_PUBLIC_SUPABASE_URL="${process.env.NEXT_PUBLIC_SUPABASE_URL}" ` +
      `SUPABASE_SERVICE_ROLE_KEY="${process.env.SUPABASE_SERVICE_ROLE_KEY}" ` +
      `npx tsx -e "
        const { DetectorEngine } = require('./lib/business-os/insight/detectors/DetectorEngine');
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const engine = new DetectorEngine(supabase);
        engine.runWithCorrelation('${userId}').then(summary => {
          console.log(JSON.stringify(summary, null, 2));
        }).catch(err => {
          console.error('Error:', err.message);
          process.exit(1);
        });
      "`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    const summary = JSON.parse(result);

    console.log('='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log(`Patterns checked: ${summary.patternsChecked}`);
    console.log(`Patterns matched: ${summary.patternsMatched}`);
    console.log(`Total estimated impact: $${(summary.totalImpactUsd || 0).toLocaleString()}`);

    if (summary.correlatedInsights?.length > 0) {
      console.log('\n🔴 CORRELATED INSIGHTS:');
      for (const insight of summary.correlatedInsights) {
        console.log(`\n  ${insight.patternName} [${insight.severity}]`);
        console.log(`    Impact: $${insight.totalImpactUsd?.toLocaleString()}`);
        console.log(`    Story: "${insight.story}"`);
      }
    }

    if (summary.standaloneInsights?.length > 0) {
      console.log('\n📊 STANDALONE INSIGHTS:');
      for (const result of summary.standaloneInsights) {
        const impact = result.estimatedImpactUsd ? `$${result.estimatedImpactUsd.toLocaleString()}` : 'N/A';
        console.log(`\n  ${result.detectorId} [${result.severity}]`);
        console.log(`    Metric: ${result.metricKey}`);
        console.log(`    Value: ${result.currentValue} (baseline: ${result.baselineValue})`);
        console.log(`    Affected: ${result.affectedCount} items`);
        console.log(`    Impact: ${impact}`);
      }
    }

    const total = (summary.correlatedInsights?.length || 0) + (summary.standaloneInsights?.length || 0);
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Total Insights: ${total}`);
    console.log(`  Total Impact: $${(summary.totalImpactUsd || 0).toLocaleString()}`);

    if (total === 0) {
      console.log('\n  ℹ️  No insights detected. Possible reasons:');
      console.log('     - User has no data or minimal data');
      console.log('     - All metrics within normal thresholds');
      console.log('     - Detectors on cooldown');
    }

  } catch (err) {
    console.error('Failed to run detector engine:', err.message);

    // Fall back to simple data check
    console.log('\nFalling back to data availability check...');
  }
}

main().catch(console.error);
