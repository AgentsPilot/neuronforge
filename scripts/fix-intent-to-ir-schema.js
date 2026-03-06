/**
 * Fix IntentToIRConverter schema to match IR v4.0
 *
 * Changes:
 * 1. outputs: { result: { var, type } } → outputs: [{ variable }]
 * 2. next_nodes: [] → (removed, will use next field)
 * 3. .next_nodes = [...] → .next = ... (in connection logic)
 */

const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '../lib/agentkit/v6/compiler/IntentToIRConverter.ts')

let content = fs.readFileSync(filePath, 'utf-8')

console.log('🔧 Fixing IntentToIRConverter schema mismatches...\n')

// Fix 1: Replace outputs object with outputs array
// Pattern: outputs: { result: { var: X, type: Y } }
// Replace with: outputs: [{ variable: X }]
const outputsRegex = /outputs:\s*\{\s*result:\s*\{\s*var:\s*(\w+),\s*type:\s*['"]?\w+['"]?\s*\}\s*\}/g
let match
let count = 0

while ((match = outputsRegex.exec(content)) !== null) {
  count++
  console.log(`  Found outputs object at position ${match.index}`)
  console.log(`    Variable: ${match[1]}`)
}

content = content.replace(outputsRegex, 'outputs: [{ variable: $1 }]')
console.log(`\n✅ Fixed ${count} outputs fields\n`)

// Fix 2: Remove next_nodes: [] field from node creation
// We'll remove it entirely and let the connection logic set the next field
content = content.replace(/,?\s*next_nodes:\s*\[\]\s*,?/g, '')
console.log(`✅ Removed next_nodes: [] initializations\n`)

// Fix 3: Replace .next_nodes = [...] with .next = ...
// For single next node: node.next_nodes = [nodeId] → node.next = nodeId
content = content.replace(/\.next_nodes\s*=\s*\[([^\]]+)\]/g, '.next = $1')
console.log(`✅ Fixed node.next_nodes assignments\n`)

// Write back
fs.writeFileSync(filePath, content, 'utf-8')

console.log('✅ IntentToIRConverter schema fixed!')
console.log(`   File: ${filePath}\n`)

console.log('📝 Summary of changes:')
console.log(`   - Fixed ${count} outputs fields (object → array)`)
console.log('   - Removed next_nodes initialization')
console.log('   - Updated connection logic to use next field')
