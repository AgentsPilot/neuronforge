import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getAgentPromptThreadRepository } from '@/lib/agent-creation/agent-prompt-thread-repository';
import type {
  AgentPromptThread,
  ThreadStatus,
  ThreadErrorResponse
} from '@/components/agent-creation/types/agent-prompt-threads';

// Initialize repository
const threadRepository = getAgentPromptThreadRepository();

// Create logger instance for this route
const logger = createLogger({ module: 'API', route: '/api/agent-creation/threads' });

// Valid thread statuses for validation
const VALID_STATUSES: ThreadStatus[] = ['active', 'expired', 'completed', 'abandoned'];

export interface ThreadListResponse {
  success: boolean;
  threads: AgentPromptThread[];
  count: number;
}

/**
 * GET /api/agent-creation/threads
 *
 * Lists recent threads for the authenticated user.
 *
 * Query Parameters:
 * - limit: Maximum number of threads to return (default 10, max 50)
 * - status: Comma-separated list of statuses to filter by (e.g., "active,completed")
 */
export async function GET(request: NextRequest) {
  // Generate or extract correlation ID for request tracing
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const startTime = Date.now();

  requestLogger.info('Thread list request received');

  try {
    // Step 1: Authenticate user
    const user = await getUser();
    if (!user) {
      requestLogger.warn('Unauthorized access attempt');
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          details: 'User authentication required'
        } as ThreadErrorResponse,
        { status: 401 }
      );
    }

    requestLogger.debug({ userId: user.id }, 'User authenticated');

    // Step 2: Parse query parameters
    const searchParams = request.nextUrl.searchParams;

    // Parse limit (default 10, max 50)
    let limit = parseInt(searchParams.get('limit') || '10', 10);
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    // Parse status filter (comma-separated)
    let statusFilter: ThreadStatus[] | undefined;
    const statusParam = searchParams.get('status');
    if (statusParam) {
      const requestedStatuses = statusParam.split(',').map(s => s.trim().toLowerCase());
      // Filter to only valid statuses
      statusFilter = requestedStatuses.filter(
        (s): s is ThreadStatus => VALID_STATUSES.includes(s as ThreadStatus)
      );
      // If no valid statuses after filtering, clear the filter
      if (statusFilter.length === 0) {
        statusFilter = undefined;
      }
    }

    requestLogger.debug({ limit, statusFilter }, 'Query parameters parsed');

    // Step 3: Fetch threads from repository
    const threads = await threadRepository.getRecentThreadsByUser(
      user.id,
      limit,
      statusFilter
    );

    // Step 4: Return response
    const response: ThreadListResponse = {
      success: true,
      threads,
      count: threads.length
    };

    const totalDuration = Date.now() - startTime;
    requestLogger.info(
      {
        userId: user.id,
        count: threads.length,
        limit,
        statusFilter,
        duration: totalDuration
      },
      'Thread list retrieved'
    );

    return NextResponse.json(response);

  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    requestLogger.error(
      { err: error, duration: totalDuration },
      'Unexpected error in thread list retrieval'
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Unexpected server error',
        details: error.message
      } as ThreadErrorResponse,
      { status: 500 }
    );
  }
}
