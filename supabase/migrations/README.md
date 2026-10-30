# Database Migrations

This directory contains SQL migration files for the AgentPilot database schema.

## Running Migrations

Migrations are applied **one at a time, by pasting the single migration file into the Supabase SQL Editor**, with a read-only pre-check before and a checker after. The full procedure — including when to apply relative to merge and deploy — is the [`supabase-ops` skill](/.claude/skills/supabase-ops/SKILL.md) §4.

> ⚠️ **Do not run `supabase db push`, `supabase db execute`, `supabase migration up` or `psql` against a hosted project.** A bulk push applies every file in this directory, and the migration ledger does not record SQL-editor applies, so the CLI cannot tell what is already applied. Reviewed migrations that must not be applied yet live in `supabase/held/`, not here.

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
