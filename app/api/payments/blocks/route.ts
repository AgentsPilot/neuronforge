/**
 * Payment Building Blocks API
 *
 * GET /api/payments/blocks - List all available payment building blocks
 *
 * This endpoint is designed for:
 * 1. AI automation kernel - to discover available payment actions
 * 2. UI components - to display available blocks for user configuration
 * 3. Automation rules - to show what actions can be triggered
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import {
  getAllBlocks,
  getBlocksByCategory,
  getBlocksForProcessor,
  getBlockSchemas,
  PaymentBlockCategory
} from '@/lib/payments/PaymentBuildingBlocks';
import { PaymentProcessorType } from '@/lib/services/PaymentEventService';
import { paymentProcessorService } from '@/lib/services/PaymentProcessorService';

const logger = createLogger({ module: 'PaymentBlocksAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') as PaymentBlockCategory | null;
    const processor = searchParams.get('processor') as PaymentProcessorType | null;
    const includeSchemas = searchParams.get('include_schemas') === 'true';
    const onlyAvailable = searchParams.get('only_available') !== 'false'; // Default true

    requestLogger.info({
      userId: user.id,
      category,
      processor,
      includeSchemas,
      onlyAvailable
    }, 'Fetching payment building blocks');

    // 3. Get blocks based on filters
    let blocks;
    if (category) {
      blocks = getBlocksByCategory(category);
    } else if (processor) {
      blocks = getBlocksForProcessor(processor);
    } else {
      blocks = getAllBlocks();
    }

    // 4. If only_available, filter by user's connected processors
    let connectedProcessors: PaymentProcessorType[] = ['manual']; // Manual is always available
    if (onlyAvailable) {
      const processorsResult = await paymentProcessorService.getConnectedProcessors(user.id);
      if (processorsResult.data) {
        connectedProcessors = [
          ...connectedProcessors,
          ...processorsResult.data.map(p => p.processor_type as PaymentProcessorType)
        ];
      }

      // Filter blocks to only those supported by connected processors
      blocks = blocks.filter(block => {
        if (!block.requires_processor) {
          return true;
        }
        return block.supported_processors.some(p => connectedProcessors.includes(p));
      });
    }

    // 5. Build response
    const response: {
      success: boolean;
      data: {
        blocks: typeof blocks;
        categories: string[];
        connected_processors: PaymentProcessorType[];
        schemas?: ReturnType<typeof getBlockSchemas>;
      };
    } = {
      success: true,
      data: {
        blocks,
        categories: ['collection', 'refund', 'plan', 'reminder', 'retry'],
        connected_processors: connectedProcessors
      }
    };

    // 6. Include schemas if requested (useful for AI)
    if (includeSchemas) {
      response.data.schemas = getBlockSchemas();
    }

    return NextResponse.json(response);

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch payment blocks');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch payment building blocks',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined
      },
      { status: 500 }
    );
  }
}
