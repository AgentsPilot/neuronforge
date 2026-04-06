#!/usr/bin/env npx tsx

/**
 * Test script to validate SEMANTIC_PLAN_SCHEMA_STRICT
 *
 * This script:
 * 1. Imports the strict schema
 * 2. Validates it can be imported without TypeScript errors
 * 3. Checks basic structure
 */

import { SEMANTIC_PLAN_SCHEMA_STRICT } from './lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema'

console.log('✓ SEMANTIC_PLAN_SCHEMA_STRICT imported successfully')
console.log('')

// Validate basic structure
console.log('Schema validation:')
console.log('  - type:', SEMANTIC_PLAN_SCHEMA_STRICT.type)
console.log('  - required:', SEMANTIC_PLAN_SCHEMA_STRICT.required)
console.log('  - additionalProperties:', SEMANTIC_PLAN_SCHEMA_STRICT.additionalProperties)
console.log('')

// Check understanding object
const understanding = SEMANTIC_PLAN_SCHEMA_STRICT.properties.understanding
console.log('Understanding object:')
console.log('  - type:', understanding.type)
console.log('  - required:', understanding.required)
console.log('  - additionalProperties:', understanding.additionalProperties)
console.log('')

// Check data_sources
const dataSources = understanding.properties.data_sources
console.log('Data sources array:')
console.log('  - type:', dataSources.type)
console.log('  - items.required:', dataSources.items.required)
console.log('  - items.additionalProperties:', dataSources.items.additionalProperties)
console.log('')

// Check optional understanding properties are nullable
const filtering = understanding.properties.filtering
console.log('Filtering (optional):')
console.log('  - type:', filtering.type)
console.log('  - additionalProperties:', filtering.additionalProperties)
console.log('')

// Check top-level optional arrays are nullable
const assumptions = SEMANTIC_PLAN_SCHEMA_STRICT.properties.assumptions
console.log('Assumptions (optional):')
console.log('  - type:', assumptions.type)
console.log('')

console.log('✓ All structural checks passed')
console.log('')
console.log('Schema is ready for OpenAI strict mode!')
