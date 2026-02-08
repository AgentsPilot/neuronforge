/**
 * Manually Trigger Business Intelligence Insight Generation
 * Run with: node trigger-insights.js [agentId]
 *
 * This script manually triggers the insight generation process that normally
 * happens automatically after each execution. Use this to generate insights
 * for agents that have historical data but no insights yet.
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function triggerInsights(agentId) {
  console.log('🤖 Triggering Business Intelligence Insight Generation');
  console.log('Agent ID:', agentId);
  console.log('='.repeat(80));

  // Import insight components
  const { InsightAnalyzer } = require('./lib/pilot/insight/InsightAnalyzer');
  const { InsightGenerator } = require('./lib/pilot/insight/InsightGenerator');
  const { InsightRepository } = require('./lib/repositories/InsightRepository');

  try {
    // Fetch agent details
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      console.error('❌ Agent not found:', agentError);
      process.exit(1);
    }

    console.log(`\n✅ Agent: ${agent.agent_name}`);
    console.log(`   User: ${agent.user_id}`);
    console.log(`   Insights Enabled: ${agent.insights_enabled !== false ? 'Yes' : 'No'}`);

    if (agent.insights_enabled === false) {
      console.log('\n⚠️  Insights are disabled for this agent');
      console.log('   Enable insights in the agent settings first');
      process.exit(0);
    }

    // Check execution count
    const { data: execMetrics, error: metricsError } = await supabase
      .from('execution_metrics')
      .select('id')
      .eq('agent_id', agentId);

    if (metricsError) {
      console.error('❌ Error checking execution metrics:', metricsError);
      process.exit(1);
    }

    const execCount = execMetrics?.length || 0;
    console.log(`\n📊 Execution metrics available: ${execCount}`);
    console.log(`   Required for business intelligence: 7`);

    if (execCount < 7) {
      console.log('\n⚠️  Not enough execution data for business intelligence');
      console.log(`   Need ${7 - execCount} more execution(s)`);
      console.log('   Technical insights will still be generated (if patterns detected)');
    } else {
      console.log('   ✅ Sufficient data for business intelligence');
    }

    // Check existing insights
    const repository = new InsightRepository(supabase);
    const existingInsights = await repository.findByAgent(agentId, 'new');

    console.log(`\n📝 Existing insights: ${existingInsights.length}`);
    if (existingInsights.length > 0) {
      console.log('   These will be compared against new patterns');
    }

    // Run insight analysis
    console.log('\n' + '─'.repeat(80));
    console.log('RUNNING INSIGHT ANALYSIS');
    console.log('─'.repeat(80));

    const analyzer = new InsightAnalyzer(supabase);
    const analysisResult = await analyzer.analyze(agentId, 20);

    console.log(`\n✅ Analysis complete!`);
    console.log(`   Patterns detected: ${analysisResult.patterns.length}`);
    console.log(`   Business insights: ${analysisResult.businessInsights?.length || 0}`);
    console.log(`   Confidence mode: ${analysisResult.confidence_mode}`);

    if (analysisResult.patterns.length === 0 && (!analysisResult.businessInsights || analysisResult.businessInsights.length === 0)) {
      console.log('\n✅ No issues detected - agent is running smoothly');
      process.exit(0);
    }

    // Generate insights from patterns
    if (analysisResult.patterns.length > 0) {
      console.log('\n' + '─'.repeat(80));
      console.log('GENERATING TECHNICAL INSIGHTS');
      console.log('─'.repeat(80));

      const generator = new InsightGenerator(supabase);
      const insights = await generator.generate(
        agent,
        analysisResult.patterns,
        analysisResult.confidence_mode
      );

      console.log(`\n✅ Generated ${insights.length} technical insight(s):`);
      insights.forEach((insight, idx) => {
        console.log(`\n   ${idx + 1}. [${insight.severity.toUpperCase()}] ${insight.title}`);
        console.log(`      Type: ${insight.insight_type}`);
        console.log(`      Category: ${insight.category}`);
      });
    }

    // Display business insights
    if (analysisResult.businessInsights && analysisResult.businessInsights.length > 0) {
      console.log('\n' + '─'.repeat(80));
      console.log('BUSINESS INTELLIGENCE INSIGHTS');
      console.log('─'.repeat(80));

      analysisResult.businessInsights.forEach((insight, idx) => {
        console.log(`\n   ${idx + 1}. [${insight.severity.toUpperCase()}] ${insight.title}`);
        console.log(`      ${insight.description}`);
        console.log(`\n      💡 Business Impact:`);
        console.log(`      ${insight.business_impact}`);
        console.log(`\n      🎯 Recommendation:`);
        console.log(`      ${insight.recommendation}`);
        console.log(`\n      Confidence: ${(insight.confidence * 100).toFixed(0)}%`);
      });
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));

    const totalInsights = analysisResult.patterns.length + (analysisResult.businessInsights?.length || 0);
    console.log(`\n✅ Generated ${totalInsights} insight(s) for agent ${agentId}`);
    console.log(`   Technical: ${analysisResult.patterns.length}`);
    console.log(`   Business: ${analysisResult.businessInsights?.length || 0}`);

    // Verify insights were stored
    const newInsights = await repository.findByAgent(agentId, 'new');
    console.log(`\n📝 Total insights in database: ${newInsights.length}`);

    console.log('\n🎉 Insight generation complete!');
    console.log('   View the agent page to see all insights');
    console.log(`   Or query: SELECT * FROM execution_insights WHERE agent_id = '${agentId}';`);

    console.log('\n' + '='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error generating insights:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

const agentId = process.argv[2];

if (!agentId) {
  console.error('❌ Error: Please provide an agent ID');
  console.error('Usage: node trigger-insights.js <agentId>');
  process.exit(1);
}

triggerInsights(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
