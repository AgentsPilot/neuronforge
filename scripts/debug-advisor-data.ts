/**
 * Debug script to extract and display the data being sent to AI Advisor
 *
 * Usage: npx ts-node scripts/debug-advisor-data.ts <user_id>
 *
 * This script shows:
 * 1. Organization settings
 * 2. Agents and their plugins
 * 3. Execution metrics (last 30 days)
 * 4. Active insights from execution_insights
 * 5. The exact prompt being sent to the LLM
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const userId = process.argv[2];

  if (!userId) {
    console.error('Usage: npx ts-node scripts/debug-advisor-data.ts <user_id>');
    console.error('\nTo find your user_id, check the profiles table or auth.users');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('AI ADVISOR DATA DEBUG');
  console.log('='.repeat(80));
  console.log(`User ID: ${userId}\n`);

  // 1. Get organization
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, settings')
    .eq('owner_user_id', userId)
    .single();

  if (!org) {
    console.error('No organization found for user');
    process.exit(1);
  }

  console.log('─'.repeat(80));
  console.log('1. ORGANIZATION SETTINGS');
  console.log('─'.repeat(80));
  console.log(`Organization: ${org.name} (${org.id})`);
  console.log('Settings:', JSON.stringify(org.settings, null, 2));
  console.log();

  // 2. Get agents
  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name, description, workflow_purpose, plugins_required, status, tags, manual_time_per_item_seconds, hourly_rate_usd')
    .eq('org_id', org.id)
    .neq('status', 'deleted');

  console.log('─'.repeat(80));
  console.log('2. AGENTS');
  console.log('─'.repeat(80));
  console.log(`Total: ${agents?.length || 0} agents\n`);

  const agentIds = agents?.map(a => a.id) || [];

  agents?.forEach((agent, i) => {
    console.log(`[${i + 1}] ${agent.agent_name}`);
    console.log(`    ID: ${agent.id}`);
    console.log(`    Status: ${agent.status}`);
    console.log(`    Plugins: ${JSON.stringify(agent.plugins_required)}`);
    console.log(`    Purpose: ${agent.workflow_purpose || 'N/A'}`);
    console.log(`    Manual time/item: ${agent.manual_time_per_item_seconds || 'N/A'}s`);
    console.log(`    Hourly rate: $${agent.hourly_rate_usd || 'N/A'}`);
    console.log(`    Tags: ${JSON.stringify(agent.tags)}`);
    console.log();
  });

  // 3. Get execution metrics (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('agent_id, total_items, time_saved_seconds, duration_ms, executed_at, failed_step_count, step_metrics')
    .in('agent_id', agentIds)
    .gte('executed_at', thirtyDaysAgo.toISOString())
    .order('executed_at', { ascending: false });

  console.log('─'.repeat(80));
  console.log('3. EXECUTION METRICS (Last 30 days)');
  console.log('─'.repeat(80));
  console.log(`Total executions: ${metrics?.length || 0}\n`);

  // Aggregate by agent
  const metricsByAgent = new Map<string, { runs: number; items: number; timeSaved: number; failed: number }>();

  metrics?.forEach(m => {
    const existing = metricsByAgent.get(m.agent_id) || { runs: 0, items: 0, timeSaved: 0, failed: 0 };
    existing.runs++;
    existing.items += m.total_items || 0;
    existing.timeSaved += m.time_saved_seconds || 0;
    existing.failed += m.failed_step_count || 0;
    metricsByAgent.set(m.agent_id, existing);
  });

  const agentNameMap = new Map(agents?.map(a => [a.id, a.agent_name]) || []);

  metricsByAgent.forEach((m, agentId) => {
    const name = agentNameMap.get(agentId) || 'Unknown';
    console.log(`${name}:`);
    console.log(`  Runs: ${m.runs}`);
    console.log(`  Items processed: ${m.items}`);
    console.log(`  Time saved: ${Math.round(m.timeSaved / 60)} minutes`);
    console.log(`  Failed steps: ${m.failed}`);
    console.log();
  });

  // Show step_metrics breakdown
  console.log('Step metrics breakdown (top 10 actions):');
  const stepAggregation = new Map<string, number>();
  metrics?.forEach(m => {
    const steps = m.step_metrics as { plugin?: string; action?: string; count?: number }[] | null;
    if (steps && Array.isArray(steps)) {
      steps.forEach(step => {
        if (step.plugin && step.action) {
          const key = `${step.plugin}:${step.action}`;
          stepAggregation.set(key, (stepAggregation.get(key) || 0) + (step.count || 0));
        }
      });
    }
  });

  Array.from(stepAggregation.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([key, count]) => {
      console.log(`  ${key}: ${count} items`);
    });
  console.log();

  // 4. Get active insights
  const { data: insights } = await supabase
    .from('execution_insights')
    .select(`
      id,
      agent_id,
      category,
      insight_type,
      title,
      description,
      severity,
      confidence,
      status,
      time_saved_hours_per_week,
      cost_saved_usd_per_week
    `)
    .in('agent_id', agentIds)
    .in('status', ['new', 'viewed'])
    .order('severity', { ascending: true })
    .limit(20);

  console.log('─'.repeat(80));
  console.log('4. ACTIVE INSIGHTS (from execution_insights)');
  console.log('─'.repeat(80));
  console.log(`Total active insights: ${insights?.length || 0}\n`);

  insights?.forEach((insight, i) => {
    const agentName = agentNameMap.get(insight.agent_id) || 'Unknown';
    console.log(`[${i + 1}] [${insight.severity.toUpperCase()}] ${insight.title}`);
    console.log(`    Agent: ${agentName}`);
    console.log(`    Category: ${insight.category}`);
    console.log(`    Type: ${insight.insight_type}`);
    console.log(`    Confidence: ${insight.confidence}`);
    console.log(`    Description: ${insight.description?.slice(0, 100)}...`);
    if (insight.time_saved_hours_per_week) {
      console.log(`    Time saved: ${insight.time_saved_hours_per_week} hrs/week`);
    }
    if (insight.cost_saved_usd_per_week) {
      console.log(`    Cost saved: $${insight.cost_saved_usd_per_week}/week`);
    }
    console.log();
  });

  // 5. Calculate trends
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const { data: previousMetrics } = await supabase
    .from('execution_metrics')
    .select('agent_id, total_items')
    .in('agent_id', agentIds)
    .gte('executed_at', sixtyDaysAgo.toISOString())
    .lt('executed_at', thirtyDaysAgo.toISOString());

  const currentItems = metrics?.reduce((sum, m) => sum + (m.total_items || 0), 0) || 0;
  const previousItems = previousMetrics?.reduce((sum, m) => sum + (m.total_items || 0), 0) || 0;
  const volumeChange = previousItems > 0 ? Math.round(((currentItems - previousItems) / previousItems) * 100) : 0;

  console.log('─'.repeat(80));
  console.log('5. TRENDS');
  console.log('─'.repeat(80));
  console.log(`Current period items: ${currentItems}`);
  console.log(`Previous period items: ${previousItems}`);
  console.log(`Volume change: ${volumeChange >= 0 ? '+' : ''}${volumeChange}%`);
  console.log();

  // 6. Show what prompt would look like
  console.log('─'.repeat(80));
  console.log('6. APPROXIMATE PROMPT SENT TO LLM');
  console.log('─'.repeat(80));

  const totalTimeSaved = metrics?.reduce((sum, m) => sum + (m.time_saved_seconds || 0), 0) || 0;
  const totalRuns = metrics?.length || 0;

  // Build workflow summary (ONLY workflows with actual runs)
  const workflowsWithRuns = agents
    ?.map(agent => {
      const m = metricsByAgent.get(agent.id) || { runs: 0, items: 0, timeSaved: 0, failed: 0 };
      return { agent, m };
    })
    .filter(({ m }) => m.runs > 0)  // Only include workflows that actually ran
    .sort((a, b) => b.m.items - a.m.items)  // Sort by items processed
    .slice(0, 5) || [];

  const workflowSummary = workflowsWithRuns.map(({ agent, m }) => {
    const successRate = m.runs > 0 ? Math.round((1 - m.failed / m.runs) * 100) : 100;
    const plugins = Array.isArray(agent.plugins_required)
      ? agent.plugins_required.join(',')
      : agent.plugins_required || '';
    return `${agent.agent_name}|${plugins}|${m.runs}runs|${successRate}%|${m.items}items|${agent.status}`;
  }).join('\n');

  const topInsights = insights
    ?.filter(i => i.severity === 'critical' || i.severity === 'high')
    .slice(0, 5)
    .map(i => `[${i.severity}] ${agentNameMap.get(i.agent_id)}: ${i.title}`)
    .join('\n') || '';

  const orgSettings = org.settings as Record<string, unknown> || {};
  const orgLine = `Org: ${orgSettings.industry || '?'}|${orgSettings.company_size || '?'}|Goal:${orgSettings.primary_goal || '?'}`;

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  console.log(`
You are a business automation advisor. Analyze this portfolio for a specific business.

## Business Context
${orgLine}
Use this context to frame your entire analysis:
- Industry tells you HOW to frame value (e.g., billable hours for agencies, order volume for ecommerce)
- Company size tells you the SCALE of impact (solo operator vs team efficiency)
- Goal tells you WHAT to prioritize in recommendations

## Portfolio Data
${agents?.length || 0} workflows, ${totalRuns} runs/30d, ${formatTime(totalTimeSaved)} saved, 96% success
Trends: Vol${volumeChange >= 0 ? '+' : ''}${volumeChange}%

Workflows (name|plugins|runs|success|items|status):
${workflowSummary || 'No data'}

${topInsights ? `Issues Detected:\n${topInsights}` : ''}

## Rules
- Write for a non-technical business owner
- Frame ALL analysis using language appropriate to their industry
- Prioritize recommendations that align with their stated goal
- The summary MUST mention their business type/industry
`);

  console.log('─'.repeat(80));
  console.log('END OF DEBUG OUTPUT');
  console.log('─'.repeat(80));
}

main().catch(console.error);
