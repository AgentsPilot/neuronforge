# How to Apply Supabase Migrations

> This page describes one historical migration. For how **any** migration is applied today, follow the [`supabase-ops` skill](/.claude/skills/supabase-ops/SKILL.md) §4.

## Applying it

Paste the single file `20251201000000_create_search_similar_memories_function.sql` into the Supabase **SQL Editor** and run it — with a read-only pre-check before and a checker after, per the skill.

> ⚠️ **Do not run `supabase db push`, `supabase db execute`, `supabase migration up` or `psql` against a hosted project.** A bulk push applies every file in `supabase/migrations/`, and the migration ledger does not record SQL-editor applies, so the CLI cannot tell what is already applied.

## Verifying the Migration

After applying the migration, verify it worked:

```sql
-- Check if the function exists
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'search_similar_memories';

-- Test the function (should not error)
SELECT * FROM search_similar_memories(
  array_fill(0::float, ARRAY[1536])::vector,
  '00000000-0000-0000-0000-000000000000'::uuid,
  0.5,
  5
);
```

## What This Migration Does

Creates the `search_similar_memories` PostgreSQL function that:
- Uses pgvector for semantic similarity search
- Searches run_memories table for similar memories
- Returns results ranked by cosine similarity
- Filters by agent_id and similarity threshold

This eliminates the "RPC function not found" warning in your agent runs.
