/**
 * Unit tests for AgentPromptThreadRepository.
 *
 * Focus: R1 Phase 4 cleanup — defensive coercion of legacy `current_phase = 4`
 * rows to `current_phase = 3, status = 'completed'` on read. See
 * V2_AGENT_CREATION_R1_PHASE4_CLEANUP_REQUIREMENT.md FR10-12.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AgentPromptThreadRepository } from '@/lib/agent-creation/agent-prompt-thread-repository';
import type { AgentPromptThread } from '@/components/agent-creation/types/agent-prompt-threads';

/**
 * Minimal fixture builder. Use `phase` as a number to bypass the narrowed
 * ThreadPhase union (which no longer admits `4`) — this mirrors what Supabase
 * actually hands us for a legacy row.
 */
function buildThreadRow(
  overrides: Partial<Omit<AgentPromptThread, 'current_phase'>> & { current_phase: number }
): AgentPromptThread {
  const base: AgentPromptThread = {
    id: '00000000-0000-0000-0000-000000000001',
    user_id: '00000000-0000-0000-0000-0000000000aa',
    openai_thread_id: 'thread_test',
    status: 'active',
    current_phase: 1,
    agent_id: null,
    user_prompt: null,
    ai_provider: 'openai',
    ai_model: 'gpt-4o',
    created_at: '2026-05-24T00:00:00.000Z',
    updated_at: '2026-05-24T00:00:00.000Z',
    expires_at: '2026-05-25T00:00:00.000Z',
    metadata: {},
    ...(overrides as Partial<AgentPromptThread>),
  };
  // Force the (number) override through the narrowed union for legacy phase-4 rows.
  base.current_phase = overrides.current_phase as AgentPromptThread['current_phase'];
  return base;
}

/**
 * Minimal Supabase client mock that supports the chained call shape used by
 * `getThreadByOpenAIId` and `getThreadById`:
 *   .from(table).select('*').eq(...).eq(...).single()
 *   .from(table).select('*').eq(...).single()
 */
function mockSupabaseReturning(record: AgentPromptThread | null, error: any = null): SupabaseClient {
  const builder: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: record, error }),
  };
  const client = {
    from: jest.fn().mockReturnValue(builder),
  } as unknown as SupabaseClient;
  return client;
}

describe('AgentPromptThreadRepository — legacy phase-4 coercion (R1 FR10-12)', () => {
  describe('getThreadByOpenAIId', () => {
    it('coerces a row with current_phase=4 to current_phase=3, status=completed', async () => {
      const legacyRow = buildThreadRow({ current_phase: 4, status: 'active' });
      const supabaseMock = mockSupabaseReturning(legacyRow);
      const repo = new AgentPromptThreadRepository(supabaseMock);

      const result = await repo.getThreadByOpenAIId('thread_test', legacyRow.user_id);

      expect(result).not.toBeNull();
      expect(result!.current_phase).toBe(3);
      expect(result!.status).toBe('completed');
      // Non-mutated fields preserved
      expect(result!.id).toBe(legacyRow.id);
      expect(result!.openai_thread_id).toBe(legacyRow.openai_thread_id);
    });

    it('returns rows with current_phase 1, 2, or 3 unchanged', async () => {
      for (const phase of [1, 2, 3] as const) {
        const row = buildThreadRow({ current_phase: phase, status: 'active' });
        const supabaseMock = mockSupabaseReturning(row);
        const repo = new AgentPromptThreadRepository(supabaseMock);

        const result = await repo.getThreadByOpenAIId('thread_test', row.user_id);

        expect(result).not.toBeNull();
        expect(result!.current_phase).toBe(phase);
        expect(result!.status).toBe('active');
      }
    });

    it('returns null unchanged when no row is found (PGRST116)', async () => {
      const supabaseMock = mockSupabaseReturning(null, { code: 'PGRST116', message: 'No rows' });
      const repo = new AgentPromptThreadRepository(supabaseMock);

      const result = await repo.getThreadByOpenAIId('thread_missing', 'user_x');
      expect(result).toBeNull();
    });
  });

  describe('getThreadById', () => {
    it('coerces a row with current_phase=4 to current_phase=3, status=completed', async () => {
      const legacyRow = buildThreadRow({ current_phase: 4, status: 'active' });
      const supabaseMock = mockSupabaseReturning(legacyRow);
      const repo = new AgentPromptThreadRepository(supabaseMock);

      const result = await repo.getThreadById(legacyRow.id);

      expect(result).not.toBeNull();
      expect(result!.current_phase).toBe(3);
      expect(result!.status).toBe('completed');
    });

    it('returns rows with current_phase 1, 2, or 3 unchanged', async () => {
      for (const phase of [1, 2, 3] as const) {
        const row = buildThreadRow({ current_phase: phase, status: 'completed' });
        const supabaseMock = mockSupabaseReturning(row);
        const repo = new AgentPromptThreadRepository(supabaseMock);

        const result = await repo.getThreadById(row.id);

        expect(result).not.toBeNull();
        expect(result!.current_phase).toBe(phase);
        expect(result!.status).toBe('completed');
      }
    });

    it('returns null unchanged when no row is found (PGRST116)', async () => {
      const supabaseMock = mockSupabaseReturning(null, { code: 'PGRST116', message: 'No rows' });
      const repo = new AgentPromptThreadRepository(supabaseMock);

      const result = await repo.getThreadById('missing-id');
      expect(result).toBeNull();
    });
  });
});
