#!/bin/bash

# Apply Supabase migrations to hosted database
# Usage: ./scripts/apply-migrations.sh

set -e

# Load environment variables
source .env.local

SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL"
SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local"
  exit 1
fi

echo "🚀 Applying migrations to: $SUPABASE_URL"
echo ""

# Get list of migration files
MIGRATIONS=(
  "supabase/migrations/20260721_create_business_profiles.sql"
  "supabase/migrations/20260721_create_onboarding_conversations.sql"
  "supabase/migrations/20260721_create_website_tables.sql"
  "supabase/migrations/20260721_create_crm_tables.sql"
)

# Apply each migration
for MIGRATION in "${MIGRATIONS[@]}"; do
  if [ ! -f "$MIGRATION" ]; then
    echo "⚠️  Skipping: $MIGRATION (file not found)"
    continue
  fi

  FILENAME=$(basename "$MIGRATION")
  echo "📄 Applying: $FILENAME"

  # Read SQL file
  SQL=$(cat "$MIGRATION")

  # Execute via Supabase REST API
  RESPONSE=$(curl -s -X POST \
    "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(jq -Rs . <<< "$SQL")}")

  if echo "$RESPONSE" | grep -q "error"; then
    echo "❌ Error applying $FILENAME:"
    echo "$RESPONSE" | jq .
    exit 1
  fi

  echo "✅ Success: $FILENAME"
  echo ""
done

echo "🎉 All migrations applied successfully!"
