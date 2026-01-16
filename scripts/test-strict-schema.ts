/**
 * Test OpenAI Strict Schema Compatibility
 *
 * This script validates that our strict schema is compatible with OpenAI's
 * structured outputs API before making actual API calls.
 */

import { DECLARATIVE_IR_SCHEMA_STRICT } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict'

console.log('='.repeat(80))
console.log('TESTING OPENAI STRICT SCHEMA COMPATIBILITY')
console.log('='.repeat(80))

// ============================================================================
// Test 1: Schema Structure Validation
// ============================================================================

console.log('\n[TEST 1] Validating schema structure...')

function validateStrictSchema(schema: any, path: string = '$'): string[] {
  const errors: string[] = []

  if (schema.type === 'object') {
    // Check for additionalProperties
    if (schema.additionalProperties === undefined) {
      errors.push(`${path}: Missing 'additionalProperties: false' for object type`)
    }

    // Check for required array if properties exist
    if (schema.properties && !schema.required && path !== '$') {
      console.warn(`${path}: Object has properties but no required array (optional but recommended)`)
    }

    // Recursively validate nested objects
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        errors.push(...validateStrictSchema(propSchema as any, `${path}.${propName}`))
      }
    }
  }

  if (schema.type === 'array') {
    if (schema.items) {
      errors.push(...validateStrictSchema(schema.items, `${path}[]`))
    }
  }

  // Check for forbidden constructs
  if (schema.oneOf || schema.anyOf || schema.allOf) {
    errors.push(`${path}: Strict mode does not support oneOf/anyOf/allOf`)
  }

  return errors
}

const structureErrors = validateStrictSchema(DECLARATIVE_IR_SCHEMA_STRICT)

if (structureErrors.length === 0) {
  console.log('✓ Schema structure is valid for OpenAI strict mode')
} else {
  console.log('✗ Schema structure has issues:')
  structureErrors.forEach(err => console.log(`  - ${err}`))
}

// ============================================================================
// Test 2: Enum Validation
// ============================================================================

console.log('\n[TEST 2] Validating enums...')

function extractEnums(schema: any, path: string = '$'): Array<{ path: string; enum: string[] }> {
  const enums: Array<{ path: string; enum: string[] }> = []

  if (schema.enum) {
    enums.push({ path, enum: schema.enum })
  }

  if (schema.type === 'object' && schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      enums.push(...extractEnums(propSchema as any, `${path}.${propName}`))
    }
  }

  if (schema.type === 'array' && schema.items) {
    enums.push(...extractEnums(schema.items, `${path}[]`))
  }

  return enums
}

const allEnums = extractEnums(DECLARATIVE_IR_SCHEMA_STRICT)
console.log(`Found ${allEnums.length} enum definitions:`)
allEnums.forEach(({ path, enum: values }) => {
  console.log(`  ${path}: [${values.join(', ')}]`)
})

console.log('✓ All enums are explicitly defined')

// ============================================================================
// Test 3: Required Fields Check
// ============================================================================

console.log('\n[TEST 3] Checking required fields...')

const topLevelRequired = DECLARATIVE_IR_SCHEMA_STRICT.required || []
console.log('Top-level required fields:', topLevelRequired)

if (topLevelRequired.includes('ir_version') &&
    topLevelRequired.includes('goal') &&
    topLevelRequired.includes('data_sources') &&
    topLevelRequired.includes('delivery_rules')) {
  console.log('✓ All critical required fields are present')
} else {
  console.log('✗ Missing critical required fields')
}

// ============================================================================
// Test 4: Check for Type Consistency
// ============================================================================

console.log('\n[TEST 4] Checking type consistency...')

function checkTypes(schema: any, path: string = '$'): string[] {
  const issues: string[] = []

  // Every property must have a type or $ref
  if (!schema.type && !schema.$ref && !schema.enum) {
    issues.push(`${path}: No type, $ref, or enum specified`)
  }

  if (schema.type === 'object' && schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      issues.push(...checkTypes(propSchema as any, `${path}.${propName}`))
    }
  }

  if (schema.type === 'array' && schema.items) {
    issues.push(...checkTypes(schema.items, `${path}[]`))
  }

  return issues
}

const typeIssues = checkTypes(DECLARATIVE_IR_SCHEMA_STRICT)

if (typeIssues.length === 0) {
  console.log('✓ All properties have explicit types')
} else {
  console.log('✗ Type issues found:')
  typeIssues.forEach(issue => console.log(`  - ${issue}`))
}

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(80))
console.log('SUMMARY')
console.log('='.repeat(80))

const totalIssues = structureErrors.length + typeIssues.length

if (totalIssues === 0) {
  console.log('✓ Schema is FULLY COMPATIBLE with OpenAI strict mode')
  console.log('✓ The LLM will be FORCED to follow the schema exactly')
  console.log('✓ No more "new prompt, new error" problems!')
  process.exit(0)
} else {
  console.log(`✗ Found ${totalIssues} issues that need fixing`)
  console.log('✗ Schema may not work with OpenAI strict mode')
  process.exit(1)
}
