/**
 * Clear Insight Data Script
 *
 * Deletes all data from insight-related tables so you can regenerate fresh insights.
 * This includes:
 * - Insights and insight history
 * - Derived metrics and baselines
 * - Business events
 * - Kernel execution logs
 * - Insight automations
 * - Business health summaries
 * - Source data (CRM activities, bookings, payments, etc.)
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/clear-insight-data.ts [userId]
 *
 * If no userId is provided, it will prompt for confirmation before clearing ALL data.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Tables in deletion order (respecting foreign key constraints)
const INSIGHT_TABLES = [
  // Insight system tables (delete first - they reference other tables)
  'owner_insight_history',
  'insight_automations',
  'insights',
  'business_health_summaries',

  // Kernel/execution tables
  'kernel_action_log',
  'kernel_executions',

  // Metrics tables
  'derived_metrics',

  // Business events
  'business_events',
];

// Source data tables that feed detectors (optional - controlled by flag)
// Order matters for foreign key constraints - delete child tables first
const SOURCE_DATA_TABLES = [
  // CRM (activities/tasks reference contacts)
  'crm_activities',
  'crm_tasks',

  // Scheduling (bookings may reference contacts/services)
  'scheduling_bookings',

  // Payments (transactions/invoices may reference contacts)
  'payment_transactions',
  'payment_invoices',
  'saved_payment_methods',
  'payment_plan_installments',

  // Website analytics
  'website_page_views',

  // CRM contacts (delete last - other tables reference it)
  'crm_contacts',

  // Scheduling services
  'scheduling_services',
];

interface ClearOptions {
  userId?: string;
  includeSourceData: boolean;
  dryRun: boolean;
}

async function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function deleteFromTable(
  tableName: string,
  userId?: string,
  dryRun = false
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    // First count existing rows
    let countQuery = supabase.from(tableName).select('*', { count: 'exact', head: true });
    if (userId) {
      countQuery = countQuery.eq('user_id', userId);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      // Table might not exist
      if (countError.message.includes('does not exist') || countError.code === '42P01') {
        return { success: true, count: 0, error: 'table does not exist (skipped)' };
      }
      return { success: false, count: 0, error: countError.message };
    }

    const rowCount = count || 0;

    if (dryRun) {
      return { success: true, count: rowCount };
    }

    if (rowCount === 0) {
      return { success: true, count: 0 };
    }

    // Delete rows
    let deleteQuery = supabase.from(tableName).delete();
    if (userId) {
      deleteQuery = deleteQuery.eq('user_id', userId);
    } else {
      // For tables without user_id, we need a different approach
      // Use a condition that matches all rows
      deleteQuery = deleteQuery.neq('id', '00000000-0000-0000-0000-000000000000');
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      return { success: false, count: rowCount, error: deleteError.message };
    }

    return { success: true, count: rowCount };
  } catch (err) {
    return { success: false, count: 0, error: (err as Error).message };
  }
}

async function clearInsightData(options: ClearOptions) {
  const { userId, includeSourceData, dryRun } = options;

  console.log('\n' + '='.repeat(60));
  console.log('CLEAR INSIGHT DATA');
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No data will be deleted\n');
  }

  if (userId) {
    console.log(`👤 User ID: ${userId}`);
  } else {
    console.log('⚠️  WARNING: Clearing data for ALL users');
  }

  console.log(`📊 Include source data: ${includeSourceData ? 'Yes' : 'No'}\n`);

  // Collect all tables to process
  const tablesToClear = [...INSIGHT_TABLES];
  if (includeSourceData) {
    tablesToClear.push(...SOURCE_DATA_TABLES);
  }

  let totalDeleted = 0;
  const results: Array<{ table: string; count: number; status: string }> = [];

  console.log('Processing tables...\n');

  for (const table of tablesToClear) {
    process.stdout.write(`  ${table.padEnd(35)}`);

    const result = await deleteFromTable(table, userId, dryRun);

    if (result.success) {
      if (result.count > 0) {
        console.log(`✅ ${result.count} rows ${dryRun ? 'found' : 'deleted'}`);
        totalDeleted += result.count;
      } else if (result.error) {
        console.log(`⏭️  ${result.error}`);
      } else {
        console.log('✅ empty');
      }
      results.push({ table, count: result.count, status: 'success' });
    } else {
      console.log(`❌ Error: ${result.error}`);
      results.push({ table, count: 0, status: `error: ${result.error}` });
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${totalDeleted} rows ${dryRun ? 'would be' : ''} deleted`);
  console.log('-'.repeat(60));

  if (!dryRun && totalDeleted > 0) {
    console.log('\n✅ Data cleared successfully!');
    console.log('   Run the seed script to regenerate test data:');
    console.log(`   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/seed-insight-test-data.ts ${userId || '<userId>'}`);
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let userId: string | undefined;
  let includeSourceData = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--include-source' || arg === '-s') {
      includeSourceData = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: npx tsx scripts/clear-insight-data.ts [userId] [options]

Options:
  --include-source, -s    Also delete source data (CRM activities, bookings, payments, etc.)
  --dry-run, -d          Show what would be deleted without actually deleting
  --help, -h             Show this help message

Examples:
  # Clear insight data for a specific user
  npx tsx scripts/clear-insight-data.ts abc123-user-id

  # Clear insight data AND source data for a user
  npx tsx scripts/clear-insight-data.ts abc123-user-id --include-source

  # Preview what would be deleted (dry run)
  npx tsx scripts/clear-insight-data.ts abc123-user-id --dry-run

  # Clear ALL users' insight data (requires confirmation)
  npx tsx scripts/clear-insight-data.ts
`);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      userId = arg;
    }
  }

  // Validate userId if provided
  if (userId) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error(`❌ Invalid user ID format: ${userId}`);
      console.error('   Expected UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
      process.exit(1);
    }
  }

  // Confirm if clearing all users
  if (!userId && !dryRun) {
    console.log('\n⚠️  No user ID provided - this will clear data for ALL users!');
    const confirmed = await promptConfirmation('Are you sure you want to continue?');
    if (!confirmed) {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  await clearInsightData({ userId, includeSourceData, dryRun });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
