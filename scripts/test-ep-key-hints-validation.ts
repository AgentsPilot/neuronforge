/**
 * Quick validation script for EP Key Hints (Phase 1)
 * Tests that buildVocabularyInjection correctly groups prefixed keys
 * and falls back to flat display for non-prefixed keys.
 */
import { buildIntentSystemPromptV2 } from '../lib/agentkit/v6/intent/intent-system-prompt-v2'

// Test 1: Prefixed keys - should group by plugin/capability
console.log('='.repeat(80))
console.log('TEST 1: Prefixed keys (grouped display)')
console.log('='.repeat(80))

const vocabPrefixed: any = {
  domains: ['email', 'storage', 'table'],
  capabilities: ['search', 'send_message', 'create'],
  plugins: [],
  userContext: [
    { key: 'gmail__search__filter_criteria', value: 'invoices with PDF attachments' },
    { key: 'gmail__search__time_window', value: 'last 24 hours' },
    { key: 'gmail__send_message__recipient', value: 'boss@company.com' },
    { key: 'gmail__send_message__subject', value: 'Daily Invoice Summary' },
    { key: 'google_sheets__create__sheet_name', value: 'Monthly Report' },
    { key: 'summary_columns', value: 'Type, Vendor, Amount' },
  ],
}

const resultPrefixed = buildIntentSystemPromptV2(vocabPrefixed)

// Extract just the user config section
const configStart = resultPrefixed.indexOf('**USER CONFIGURATION')
if (configStart === -1) {
  console.log('ERROR: USER CONFIGURATION section not found!')
} else {
  // Print from USER CONFIGURATION to end
  const configSection = resultPrefixed.substring(configStart)
  console.log(configSection)
}

console.log('')
console.log('--- Assertions ---')
const assertions1 = [
  ['Has grouped header', resultPrefixed.includes('grouped by plugin action')],
  ['Has gmail / search group', resultPrefixed.includes('gmail / search:')],
  ['Has gmail / send_message group', resultPrefixed.includes('gmail / send_message:')],
  ['Has google_sheets / create group', resultPrefixed.includes('google_sheets / create:')],
  ['Has filter_criteria param', resultPrefixed.includes('filter_criteria: "invoices with PDF attachments"')],
  ['Has General Configuration for non-prefixed', resultPrefixed.includes('General Configuration')],
  ['Has summary_columns in general', resultPrefixed.includes('summary_columns: Type, Vendor, Amount')],
  ['Has CONFIG KEY RULE', resultPrefixed.includes('CONFIG KEY RULE')],
  ['Has VALUE TRANSLATION RULE', resultPrefixed.includes('VALUE TRANSLATION RULE')],
  ['Has VALUE COMPOSITION RULE', resultPrefixed.includes('VALUE COMPOSITION RULE')],
]
let allPass = true
for (const [name, pass] of assertions1) {
  console.log(`  ${pass ? '✅' : '❌'} ${name}`)
  if (!pass) allPass = false
}

// Test 2: Non-prefixed keys - should use flat display (backward compatible)
console.log('')
console.log('='.repeat(80))
console.log('TEST 2: Non-prefixed keys (flat display - backward compatible)')
console.log('='.repeat(80))

const vocabFlat: any = {
  domains: ['email'],
  capabilities: ['search'],
  plugins: [],
  userContext: [
    { key: 'user_email', value: 'test@test.com' },
    { key: 'scan_time_window', value: 'last 24 hours' },
    { key: 'digest_fields_columns', value: 'Type, Vendor, Amount' },
  ],
}

const resultFlat = buildIntentSystemPromptV2(vocabFlat)

const configStartFlat = resultFlat.indexOf('**USER CONFIGURATION')
if (configStartFlat === -1) {
  console.log('ERROR: USER CONFIGURATION section not found!')
} else {
  console.log(resultFlat.substring(configStartFlat))
}

console.log('')
console.log('--- Assertions ---')
const assertions2 = [
  ['Has flat header', resultFlat.includes('**USER CONFIGURATION (resolved inputs):**')],
  ['Has Other Configuration Values', resultFlat.includes('Other Configuration Values')],
  ['Has Field Name Mappings', resultFlat.includes('Field Name Mappings')],
  ['Does NOT have grouped header', !resultFlat.includes('grouped by plugin action')],
  ['Does NOT have CONFIG KEY RULE', !resultFlat.includes('CONFIG KEY RULE:')],
  ['Has CRITICAL CONFIG KEY RULE', resultFlat.includes('CRITICAL CONFIG KEY RULE')],
]
for (const [name, pass] of assertions2) {
  console.log(`  ${pass ? '✅' : '❌'} ${name}`)
  if (!pass) allPass = false
}

// Test 3: Mixed keys - some prefixed, some not
console.log('')
console.log('='.repeat(80))
console.log('TEST 3: Mixed keys (from test-intent-contract-generation-enhanced-prompt.json)')
console.log('='.repeat(80))

const vocabMixed: any = {
  domains: ['email', 'storage', 'table'],
  capabilities: ['search', 'send_message', 'create'],
  plugins: [],
  userContext: [
    { key: 'gmail__send_message__recipient', value: 'meiribarak@gmail.com' },
    { key: 'gmail__search__filter_criteria', value: 'subject include: Invoice or Expenses or Bill' },
    { key: 'gmail__search__time_window', value: 'last 24 hours' },
    { key: 'gmail__search__attachment_type', value: 'PDF attachments' },
    { key: 'google_drive__create__base_folder_url', value: 'https://drive.google.com/...' },
    { key: 'google_drive__create__storage_rule', value: 'create a folder per vendor' },
    { key: 'google_sheets__create__sheet_id', value: '1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE' },
    { key: 'google_sheets__create__tab_name', value: 'Invoices, Expenses' },
    { key: 'google_sheets__create__write_rule', value: 'append only if amount > 50' },
    { key: 'gmail__send_message__delivery_style', value: 'single digest email' },
    { key: 'summary_columns', value: 'Type, Vendor / merchant, Date, Amount, Invoice/receipt #, Category, Drive link' },
    { key: 'missing_amount_handling', value: 'email + store; skip Sheet' },
  ],
}

const resultMixed = buildIntentSystemPromptV2(vocabMixed)
const configStartMixed = resultMixed.indexOf('**USER CONFIGURATION')
if (configStartMixed !== -1) {
  console.log(resultMixed.substring(configStartMixed))
}

console.log('')
console.log('--- Assertions ---')
const assertions3 = [
  ['Has grouped header (mixed has prefixed keys)', resultMixed.includes('grouped by plugin action')],
  ['Has 4 groups', resultMixed.includes('gmail / search:') && resultMixed.includes('gmail / send_message:') && resultMixed.includes('google_drive / create:') && resultMixed.includes('google_sheets / create:')],
  ['Has General Configuration for non-prefixed keys', resultMixed.includes('General Configuration')],
  ['gmail search has 3 params', resultMixed.includes('filter_criteria') && resultMixed.includes('time_window') && resultMixed.includes('attachment_type')],
]
for (const [name, pass] of assertions3) {
  console.log(`  ${pass ? '✅' : '❌'} ${name}`)
  if (!pass) allPass = false
}

console.log('')
console.log('='.repeat(80))
console.log(allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED')
console.log('='.repeat(80))
