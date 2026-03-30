/**
 * Test script to verify parameter mismatch error detection logic
 */

// Test the regex pattern matching
const errorMessage = "Fetching from file_url not implemented. Please pass file_content parameter directly for better performance and plugin-agnosticism.";

const paramMismatchPattern = /(\w+)\s+not implemented.*?(?:pass|use)\s+(\w+)\s+parameter/i;
const paramMatch = errorMessage.match(paramMismatchPattern);

console.log('=== PARAMETER MISMATCH DETECTION TEST ===\n');
console.log('Error message:', errorMessage);
console.log('\nRegex pattern:', paramMismatchPattern.toString());
console.log('\nMatch result:', paramMatch);

if (paramMatch) {
  const wrongParam = paramMatch[1];
  const correctParam = paramMatch[2];

  console.log('\n✅ MATCH FOUND');
  console.log('Wrong parameter:', wrongParam);
  console.log('Correct parameter:', correctParam);

  console.log('\nThis should trigger auto-fixable issue:');
  console.log(`  - Category: parameter_error`);
  console.log(`  - Auto-repair available: true`);
  console.log(`  - Proposed fix: Rename "${wrongParam}" to "${correctParam}"`);
} else {
  console.log('\n❌ NO MATCH - Pattern needs adjustment');
}

// Test with step config structure
const testStep = {
  id: "step6",
  type: "action",
  config: {
    fields: [],
    file_url: "{{attachment_content.data}}"
  },
  plugin: "document-extractor",
  operation: "extract_structured_data"
};

console.log('\n=== STEP CONFIG TEST ===\n');
console.log('Step config:', JSON.stringify(testStep.config, null, 2));

const wrongParam = "file_url";
const correctParam = "file_content";

if (wrongParam in testStep.config) {
  console.log(`\n✅ Found "${wrongParam}" in config`);
  console.log(`Value: ${testStep.config.file_url}`);

  // Simulate the fix
  const newConfig = { ...testStep.config };
  newConfig[correctParam] = newConfig[wrongParam];
  delete newConfig[wrongParam];

  console.log('\nAfter fix:', JSON.stringify(newConfig, null, 2));
  console.log(`\n✅ Successfully renamed "${wrongParam}" to "${correctParam}"`);
} else {
  console.log(`\n❌ "${wrongParam}" not found in config`);
}
