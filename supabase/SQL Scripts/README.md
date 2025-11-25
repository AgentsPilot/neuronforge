# Database Migrations

This directory contains SQL migration files for the AgentsPilot database schema.

## Running Migrations

### Option 1: Supabase CLI (Recommended)
```bash
# Run all pending migrations
supabase db push

# Or run a specific migration
supabase db execute --file ./supabase/migrations/create_agent_prompt_threads.sql
```

### Option 2: Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of the migration file
4. Paste and execute

### Option 3: Direct PostgreSQL Connection
```bash
psql -h your-project.supabase.co -U postgres -d postgres -f ./supabase/migrations/create_agent_prompt_threads.sql
```

## Migration Files

### `create_audit_trail.sql`
Creates the `audit_trail` table for enterprise-grade audit logging with SOC2, GDPR, HIPAA compliance support.

### `add_last_refreshed_at_to_plugin_connections.sql`
Adds `last_refreshed_at` timestamp column to the `plugin_connections` table.

### `create_agent_prompt_threads.sql`
Creates the `agent_prompt_threads` table for OpenAI thread-based agent creation flow:
- Stores thread state for phases 1-3 (analyze, clarify, enhance)
- Enables resume capability on page refresh
- Includes TTL-based expiration (24-hour default)
- Row-level security policies
- Automatic cleanup functions

## Cleanup Tasks

### Expire Old Threads
Run this periodically (or set up a cron job):

```sql
SELECT expire_agent_prompt_threads();
```

This will mark all threads past their `expires_at` timestamp as 'expired'.

### Delete Expired Threads (Optional)
To clean up expired threads after a retention period:

```sql
DELETE FROM public.agent_prompt_threads
WHERE status = 'expired'
  AND expires_at < now() - INTERVAL '7 days';
```

## Notes

- All migrations use `IF NOT EXISTS` to prevent errors on re-runs
- Row Level Security (RLS) is enabled on all tables
- Users can only access their own data
- Service role has full access for backend operations
