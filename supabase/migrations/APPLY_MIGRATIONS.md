# How to Apply Supabase Migrations

## For Vercel/Production Deployment

### Option 1: Using Supabase Dashboard (Recommended for hosted Supabase)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of `20251201000000_create_search_similar_memories_function.sql`
4. Paste into the SQL Editor and click **Run**

### Option 2: Using Supabase CLI (Local or CI/CD)

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Apply migrations
supabase db push

# Or apply a specific migration
psql YOUR_DATABASE_URL < supabase/migrations/20251201000000_create_search_similar_memories_function.sql
```

### Option 3: Direct Database Connection

If you have direct access to your Supabase PostgreSQL database:

```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres" \
  -f supabase/migrations/20251201000000_create_search_similar_memories_function.sql
```

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
