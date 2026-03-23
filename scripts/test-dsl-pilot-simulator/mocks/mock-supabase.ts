/**
 * B2/D2: Mock SupabaseClient
 *
 * Proxy-based mock that handles any Supabase query chain.
 * Returns empty results for most queries, but provides specific
 * responses for critical system config lookups (e.g., pilot_enabled).
 */

/**
 * System config values the WorkflowPilot needs to run.
 * These simulate what would be in the system_settings_config table.
 */
const MOCK_SYSTEM_CONFIG: Record<string, string> = {
  pilot_enabled: 'true',
  pilot_max_parallel_steps: '3',
  pilot_enable_optimizations: 'true',
  pilot_enable_caching: 'false',
  pilot_continue_on_error: 'false',
  pilot_enable_progress_tracking: 'false',
  pilot_enable_real_time_updates: 'false',
  pilot_cache_step_results: 'false',
}

/**
 * Build a chainable query mock that tracks .eq() filters
 * and returns appropriate data at terminal calls (.single(), await, etc.)
 */
function createQueryBuilder(table: string, defaultData: any = null): any {
  const filters: Record<string, any> = {}
  let selectFields = '*'

  const builder: any = {
    select: (fields?: string) => {
      if (fields) selectFields = fields
      return builder
    },
    eq: (field: string, value: any) => {
      filters[field] = value
      return builder
    },
    neq: () => builder,
    in: () => builder,
    gt: () => builder,
    lt: () => builder,
    gte: () => builder,
    lte: () => builder,
    like: () => builder,
    ilike: () => builder,
    is: () => builder,
    not: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    range: () => builder,
    match: () => builder,
    filter: () => builder,

    single: () => {
      // system_settings_config — return config values based on key filter
      if (table === 'system_settings_config' && filters.key) {
        const configValue = MOCK_SYSTEM_CONFIG[filters.key]
        if (configValue !== undefined) {
          return { data: { key: filters.key, value: configValue }, error: null }
        }
        return { data: null, error: { message: `Config key '${filters.key}' not found` } }
      }
      return { data: defaultData, error: null }
    },

    // Terminal — return array data
    then: (resolve: any) => {
      // For .in() queries on system_settings_config (PilotConfigService)
      if (table === 'system_settings_config') {
        const configEntries = Object.entries(MOCK_SYSTEM_CONFIG).map(([k, v]) => ({ key: k, value: v }))
        resolve({ data: configEntries, error: null })
        return
      }
      resolve({ data: defaultData || [], error: null })
    },

    // Direct access (destructuring { data, error })
    get data() {
      if (table === 'system_settings_config') {
        return Object.entries(MOCK_SYSTEM_CONFIG).map(([k, v]) => ({ key: k, value: v }))
      }
      return defaultData || []
    },
    get error() { return null },
  }

  return builder
}

/**
 * Create a mock Supabase client that handles all query patterns.
 * WorkflowPilot, StateManager, PilotConfigService, SystemConfigService
 * all work against this mock without real DB connections.
 */
export function createMockSupabase(): any {
  return {
    from: (table: string) => {
      const builder = createQueryBuilder(table)

      // Also support insert/update/upsert/delete
      builder.insert = () => ({ select: () => ({ single: () => ({ data: { id: 'mock-id' }, error: null }), data: [{ id: 'mock-id' }], error: null }), data: [{ id: 'mock-id' }], error: null })
      builder.update = () => createQueryBuilder(table)
      builder.upsert = () => ({ data: [{ id: 'mock-id' }], error: null })
      builder.delete = () => createQueryBuilder(table)

      return builder
    },
    rpc: () => ({ data: null, error: null }),
    auth: {
      getUser: () => ({ data: { user: null }, error: null }),
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
  }
}
