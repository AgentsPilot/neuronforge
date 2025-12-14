import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { systemConfigRepository } from '@/lib/repositories';

const logger = createLogger({ module: 'API', route: '/api/system-config' });

/**
 * GET /api/system-config
 *
 * Fetches system configuration values by category or specific keys.
 *
 * Query parameters:
 * - category: string (e.g., 'agent_creation', 'helpbot')
 * - keys: comma-separated list of specific keys (e.g., 'agent_creation_ai_provider,agent_creation_ai_model')
 *
 * Returns an object with key-value pairs.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const keysParam = searchParams.get('keys');

  logger.debug({ category, keys: keysParam }, 'System config request');

  try {
    let result;

    if (category) {
      // Fetch by category and return as map
      result = await systemConfigRepository.getByCategoryAsMap(category);
    } else if (keysParam) {
      // Fetch by specific keys
      const keys = keysParam.split(',').map(k => k.trim());
      const { data, error } = await systemConfigRepository.getByKeys(keys);

      if (error) {
        logger.error({ err: error }, 'Failed to fetch system config by keys');
        return NextResponse.json(
          { error: 'Failed to fetch configuration' },
          { status: 500 }
        );
      }

      // Transform array to object for easier client consumption
      const configMap: Record<string, any> = {};
      for (const row of data || []) {
        configMap[row.key] = row.value;
      }
      result = { data: configMap, error: null };
    } else {
      // No filter provided - return empty
      return NextResponse.json({});
    }

    if (result.error) {
      logger.error({ err: result.error }, 'Failed to fetch system config');
      return NextResponse.json(
        { error: 'Failed to fetch configuration' },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;
    logger.debug({ configKeys: Object.keys(result.data || {}), duration }, 'System config fetched');

    return NextResponse.json(result.data || {});
  } catch (error: any) {
    logger.error({ err: error }, 'Unexpected error fetching system config');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}