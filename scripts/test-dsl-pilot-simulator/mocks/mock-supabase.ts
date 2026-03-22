/**
 * B2: Mock SupabaseClient
 *
 * Minimal stub that satisfies StepExecutor's constructor type.
 * Returns empty results for all queries — no DB calls made.
 */

const noopChain = (): any => new Proxy({}, {
  get: () => noopChain
})

export function createMockSupabase(): any {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ neq: () => ({ single: () => ({ data: null, error: null }), data: [], error: null }), single: () => ({ data: null, error: null }), data: [], error: null }), single: () => ({ data: null, error: null }), data: [], error: null }),
      insert: () => ({ data: null, error: null }),
      update: () => ({ eq: () => ({ data: null, error: null }), data: null, error: null }),
      upsert: () => ({ data: null, error: null }),
      delete: () => ({ eq: () => ({ data: null, error: null }) }),
    }),
    rpc: () => ({ data: null, error: null }),
    auth: {
      getUser: () => ({ data: { user: null }, error: null }),
    },
  }
}
