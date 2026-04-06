#!/bin/bash

echo "=== Testing Dynamic Dropdowns Implementation ==="
echo ""

echo "1. Testing schema metadata API..."
METADATA=$(curl -s http://localhost:3000/api/plugins/schema-metadata)

if echo "$METADATA" | grep -q "error"; then
  echo "❌ API Error:"
  echo "$METADATA" | jq '.'
  exit 1
fi

PARAM_COUNT=$(echo "$METADATA" | jq '.metadata | keys | length')
echo "✅ Found $PARAM_COUNT parameters with x-dynamic-options"
echo ""

echo "2. Parameters available:"
echo "$METADATA" | jq '.metadata | keys'
echo ""

echo "3. Sample parameter details (channel_id):"
echo "$METADATA" | jq '.metadata.channel_id'
echo ""

echo "4. Sample parameter details (spreadsheet_id):"
echo "$METADATA" | jq '.metadata.spreadsheet_id'
echo ""

echo "=== Next Steps ==="
echo "1. Open an agent run page with one of these input fields:"
echo "   - channel_id, spreadsheet_id, folder_id, file_id,"
echo "   - document_id, calendar_id, contact_id, company_id,"
echo "   - deal_id, base_id, table_name"
echo ""
echo "2. Open browser DevTools console"
echo "3. Look for these log messages:"
echo "   '[Run Page] Schema metadata loaded:'"
echo "   '[getDynamicOptions] Found match for <field_name>'"
echo ""
echo "4. The field should appear as a searchable dropdown instead of text input"
