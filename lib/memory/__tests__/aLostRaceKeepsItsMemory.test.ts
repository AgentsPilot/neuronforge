/**
 * A summarization that loses the run_number race still keeps its memory.
 *
 * Production, agent 2216fc3c: two summarizations for one agent were both
 * handed run_number 1 by `get_next_run_number` (it releases its advisory lock
 * before the caller inserts), the second insert hit
 * `run_memories_agent_id_run_number_key` with 23505, and the memory was
 * dropped on the floor — the LLM call that produced it was already paid for.
 *
 * Migration 20261106 renumbers a colliding row inside the database. These
 * tests cover the app side of the same fix: the insert is retried with a fresh
 * number instead of the memory being lost, and a failure that is NOT a unique
 * violation is still raised straight away rather than retried five times.
 */

const ORIGINAL_ENV = { ...process.env };

/** Captures what MemorySummarizer did to the database. */
interface FakeDb {
  client: any;
  insertedRunNumbers: number[];
  rpcCalls: number;
}

/**
 * @param insertErrors one entry per insert attempt: an error to return, or
 *   null for an insert that succeeds.
 */
function makeFakeDb(insertErrors: Array<{ code: string; message: string } | null>): FakeDb {
  const db: FakeDb = { client: null, insertedRunNumbers: [], rpcCalls: 0 };

  // What the real function does: MAX(run_number) + 1 over committed rows. The
  // competitor's row is already committed here, so it keeps answering 1 until
  // our own insert lands — exactly the production shape.
  const nextRunNumber = () => 1;

  db.client = {
    rpc: jest.fn(async (fn: string) => {
      expect(fn).toBe('get_next_run_number');
      db.rpcCalls += 1;
      return { data: nextRunNumber(), error: null };
    }),
    from: jest.fn((table: string) => ({
      insert: (row: any) => {
        expect(table).toBe('run_memories');
        db.insertedRunNumbers.push(row.run_number);
        const error = insertErrors.shift() ?? null;
        return {
          select: () => ({
            single: async () =>
              error
                ? { data: null, error }
                : { data: { id: 'memory-1', run_number: row.run_number }, error: null },
          }),
        };
      },
      // The embedding write that fires after a successful save
      update: () => ({ eq: async () => ({ error: null }) }),
    })),
  };

  return db;
}

const DUPLICATE = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "run_memories_agent_id_run_number_key"',
};

const MEMORY = {
  summary: 'Scanned the mailbox and found nothing new.',
  sentiment: 'neutral',
  key_outcomes: { success: true, items_processed: 0, errors: null, warnings: null },
  patterns_detected: {},
  suggestions: {},
};

const INPUT = {
  execution_id: 'eaeed20d-b26d-4026-a800-c3324a880cc0',
  agent_id: '2216fc3c-64f8-4ff4-ad2c-2fd0e2cd932d',
  user_id: 'eb4765cd-6b78-4aaa-bb24-d0ff998a2547',
  run_number: 0,
  agent_name: 'Mailbox watcher',
  agent_description: 'Watches the mailbox',
  input: {},
  output: {},
  status: 'success' as const,
  model_used: 'workflow_orchestrator',
  credits_consumed: 0,
  execution_time_ms: 1200,
};

/** Mocks every seam MemorySummarizer reaches, so no call leaves the process. */
function mockSeams(db: FakeDb) {
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => db.client),
  }));

  jest.doMock('@/lib/ai/providerFactory', () => ({
    PROVIDERS: { OPENAI: 'openai' },
    ProviderFactory: {
      getProvider: () => ({
        chatCompletion: async () => ({
          choices: [{ message: { content: JSON.stringify(MEMORY) } }],
          usage: { prompt_tokens: 100, completion_tokens: 40 },
        }),
        createEmbedding: async () => ({
          data: [{ embedding: new Array(1536).fill(0) }],
        }),
      }),
    },
  }));

  jest.doMock('../MemoryConfigService', () => ({
    MemoryConfigService: {
      getSummarizationConfig: async () => ({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 500,
      }),
      getImportanceConfig: async () => ({ base_score: 5 }),
      getEmbeddingConfig: async () => ({
        model: 'text-embedding-3-small',
        dimensions: 1536,
        batch_size: 100,
      }),
    },
  }));

  jest.doMock('@/lib/services/AuditTrailService', () => ({
    AuditTrailService: { getInstance: () => ({ log: jest.fn(async () => undefined) }) },
  }));
}

async function loadSummarizer(db: FakeDb) {
  jest.resetModules();
  mockSeams(db);
  const { MemorySummarizer } = await import('../MemorySummarizer');
  return new MemorySummarizer();
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

describe('a summarization that loses the run_number race', () => {
  it('asks for a fresh number and keeps the memory', async () => {
    const db = makeFakeDb([DUPLICATE, null]);
    const summarizer = await loadSummarizer(db);

    const result = await summarizer.summarizeExecution(INPUT);

    // Two attempts, each with its own trip to get_next_run_number
    expect(db.insertedRunNumbers).toEqual([1, 1]);
    expect(db.rpcCalls).toBe(2);
    // The memory survived, so the tokens that produced it were not wasted
    expect(result.tokensUsed.total).toBe(140);
  });

  it('gives up after the attempt budget rather than looping forever', async () => {
    const db = makeFakeDb([DUPLICATE, DUPLICATE, DUPLICATE, DUPLICATE, DUPLICATE]);
    const summarizer = await loadSummarizer(db);

    // summarizeExecution swallows a save failure by design: memory is
    // non-critical to the execution that produced it.
    await summarizer.summarizeExecution(INPUT);

    expect(db.insertedRunNumbers).toHaveLength(5);
  }, 15000);
});

describe('an error that is not a unique violation', () => {
  it('is raised on the first attempt, not retried', async () => {
    const db = makeFakeDb([{ code: '23502', message: 'null value in column "user_id"' }]);
    const summarizer = await loadSummarizer(db);

    await summarizer.summarizeExecution(INPUT);

    expect(db.insertedRunNumbers).toEqual([1]);
    expect(db.rpcCalls).toBe(1);
  });
});
