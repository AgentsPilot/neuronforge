#!/bin/bash

# Script to add help dialog to remaining V2 pages

PAGES=(
  "/Users/yaelomer/Documents/neuronforge/app/v2/settings/page.tsx"
  "/Users/yaelomer/Documents/neuronforge/app/v2/billing/page.tsx"
  "/Users/yaelomer/Documents/neuronforge/app/v2/notifications/page.tsx"
)

for page in "${PAGES[@]}"; do
  echo "Processing $page..."

  # Check if file exists
  if [ ! -f "$page" ]; then
    echo "File not found: $page"
    continue
  fi

  # Add import after V2Header import (if not already there)
  if ! grep -q "ModernHelpDialog" "$page"; then
    sed -i.bak "/import { V2Logo, V2Controls } from '@\/components\/v2\/V2Header'/a\\
import { ModernHelpDialog } from '@/components/v2/ModernHelpDialog'
" "$page"
    echo "  - Added ModernHelpDialog import"
  fi

  echo "  - Done"
done

echo "Script completed"
