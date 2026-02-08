# Fix: search_similar_memories Function Missing

## Problem
MemoryInjector shows warning: "RPC function not found, using manual query"

## Root Cause
The `search_similar_memories` PostgreSQL function hasn't been created in your Supabase database.

## Solution: Apply the SQL Migration

### Option 1: Supabase Dashboard (RECOMMENDED - Safest)

1. **Open Supabase Dashboard**
   - Go to https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "+ New query"

3. **Copy and Paste SQL**
   - Open file: `supabase/SQL Scripts/20251201000000_create_search_similar_memories_function.sql`
   - Copy the entire contents
   - Paste into the SQL Editor

4. **Run the SQL**
   - Click "Run" or press `Ctrl+Enter` / `Cmd+Enter`
   - Wait for confirmation: "Success. No rows returned"

5. **Verify**
   - The function `search_similar_memories` should now appear in:
     Database → Functions → search_similar_memories

### Option 2: Using Supabase CLI

```bash
# Make sure you're in the project root
cd /Users/yaelomer/Documents/neuronforge

# Copy migration to migrations folder
cp "supabase/SQL Scripts/20251201000000_create_search_similar_memories_function.sql" \
   "supabase/migrations/20251201000000_create_search_similar_memories_function.sql"

# Apply migration using Supabase CLI
supabase db push
```

### Option 3: Direct SQL Execution via psql

If you have direct database access:

```bash
# Run the SQL file directly
psql "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT].supabase.co:5432/postgres" \
  -f "supabase/SQL Scripts/20251201000000_create_search_similar_memories_function.sql"
```

## What This Function Does

The `search_similar_memories` function:
- Uses pgvector extension for semantic similarity search
- Finds memories similar to current execution input
- Returns top N most relevant past runs
- **Performance**: 10-100x faster than manual query fallback

## After Applying

1. Restart your Next.js dev server
2. Run a workflow
3. Verify the warning is gone
4. Memory search will now use optimized database function

## Verification

Check that the function exists:

```sql
-- Run this in Supabase SQL Editor
SELECT routine_name
FROM information_schema.routines
WHERE routine_name = 'search_similar_memories';
```

Should return:
```
routine_name
---------------------
search_similar_memories
```

## Notes

- **The system works without this function** - it just uses a slower fallback
- **This is a performance optimization** - not a breaking issue
- **Safe to apply** - the SQL includes DROP IF EXISTS to prevent conflicts
- **One-time operation** - only needs to be run once per database
