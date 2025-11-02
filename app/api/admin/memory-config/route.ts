// app/api/admin/memory-config/route.ts
// Admin API for managing memory system configuration

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MemoryConfigService } from '@/lib/memory/MemoryConfigService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Disable caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/memory-config
 *
 * Fetch all memory configuration settings
 */
export async function GET(request: NextRequest) {
  try {
    console.log('🔍 [GET] Fetching memory configs...');

    const { data: configs, error } = await supabase
      .from('memory_config')
      .select('*')
      .eq('is_active', true)
      .order('config_key');

    if (error) {
      console.error('Error fetching memory config:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // Load each config to return structured data
    const [
      summarization,
      embedding,
      injection,
      retention,
      importance
    ] = await Promise.all([
      MemoryConfigService.getSummarizationConfig(supabase),
      MemoryConfigService.getEmbeddingConfig(supabase),
      MemoryConfigService.getInjectionConfig(supabase),
      MemoryConfigService.getRetentionConfig(supabase),
      MemoryConfigService.getImportanceConfig(supabase)
    ]);

    return NextResponse.json({
      success: true,
      configs: {
        summarization,
        embedding,
        injection,
        retention,
        importance
      },
      raw_configs: configs
    });
  } catch (error: any) {
    console.error('Exception in GET /api/admin/memory-config:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/memory-config
 *
 * Update memory configuration settings
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, configKey, configValue } = body;

    if (action === 'update') {
      console.log('🔧 [API] Updating memory config:', configKey);

      if (!configKey || !configValue) {
        return NextResponse.json(
          { success: false, error: 'Missing configKey or configValue' },
          { status: 400 }
        );
      }

      // Validate config key
      const validKeys = ['summarization', 'embedding', 'injection', 'retention', 'importance'];
      if (!validKeys.includes(configKey)) {
        return NextResponse.json(
          { success: false, error: `Invalid config key: ${configKey}` },
          { status: 400 }
        );
      }

      // Update using service
      const result = await MemoryConfigService.updateConfig(
        supabase,
        configKey,
        configValue
      );

      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 500 }
        );
      }

      // Verify update
      const { data: verifyConfig } = await supabase
        .from('memory_config')
        .select('*')
        .eq('config_key', configKey)
        .single();

      console.log('✅ [API] Config updated successfully:', verifyConfig);

      return NextResponse.json({
        success: true,
        config: verifyConfig
      });
    }

    if (action === 'clearCache') {
      console.log('🗑️ [API] Clearing memory config cache');
      MemoryConfigService.clearCache();

      return NextResponse.json({
        success: true,
        message: 'Cache cleared successfully'
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Exception in POST /api/admin/memory-config:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/memory-config/stats
 *
 * Get memory system statistics
 */
export async function OPTIONS(request: NextRequest) {
  const url = new URL(request.url);

  if (url.pathname.endsWith('/stats')) {
    try {
      console.log('📊 [GET] Fetching memory stats...');

      // Get overall statistics
      const { data: totalMemories } = await supabase
        .from('run_memories')
        .select('id', { count: 'exact', head: true });

      const { data: agentStats } = await supabase
        .from('agent_memory_stats')
        .select('*')
        .order('total_memories', { ascending: false })
        .limit(10);

      // Get memory by importance distribution
      const { data: importanceDistribution } = await supabase
        .from('run_memories')
        .select('importance_score')
        .order('importance_score');

      // Calculate distribution
      const distribution: Record<number, number> = {};
      importanceDistribution?.forEach((row: any) => {
        const score = row.importance_score;
        distribution[score] = (distribution[score] || 0) + 1;
      });

      // Get embedding coverage
      const { data: embeddingStats } = await supabase.rpc('sql', {
        query: `
          SELECT
            COUNT(*) as total,
            COUNT(embedding) as with_embedding,
            COUNT(*) - COUNT(embedding) as without_embedding
          FROM run_memories
        `
      });

      return NextResponse.json({
        success: true,
        stats: {
          total_memories: totalMemories?.length || 0,
          top_agents: agentStats || [],
          importance_distribution: distribution,
          embedding_coverage: embeddingStats?.[0] || {}
        }
      });
    } catch (error: any) {
      console.error('Exception in GET /api/admin/memory-config/stats:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { success: false, error: 'Invalid endpoint' },
    { status: 404 }
  );
}
