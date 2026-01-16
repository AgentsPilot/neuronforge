// Quick test of literal expression resolution
const testExpression = "[\"{{email.gmail_message_link_id}}\"]";

console.log('Testing literal expression pattern detection:');
console.log('Expression:', testExpression);
console.log('Contains {{:', testExpression.includes('{{'));
console.log('Matches /^\\{\\{[^}]+\\}$/:', testExpression.match(/^\{\{[^}]+\}\}$/));
console.log('Should trigger resolveLiteralWithVariables:', !testExpression.match(/^\{\{[^}]+\}\}$/));

// Test quoted pattern detection
const fullMatch = "{{email.gmail_message_link_id}}";
const quotedPattern1 = `"${fullMatch}"`;
const quotedPattern2 = `'${fullMatch}'`;

console.log('\nQuoted pattern checks:');
console.log('Expression includes "{{var}}":', testExpression.includes(quotedPattern1));
console.log('Expression includes \'{{var}}\':', testExpression.includes(quotedPattern2));

// Test escaped patterns
const escapedQuotedPattern1 = `\\"${fullMatch}\\"`;
console.log('Expression includes \\"{{var}}\\":', testExpression.includes(escapedQuotedPattern1));

// Simulate resolution
console.log('\nSimulated resolution:');
let resolvedExpression = testExpression;
const resolvedValue = "msg_ABC123"; // simulated resolved value

// Try the quoted pattern replacement
if (resolvedExpression.includes(quotedPattern1)) {
  console.log('Found quoted pattern, replacing...');
  resolvedExpression = resolvedExpression.replace(quotedPattern1, JSON.stringify(resolvedValue));
  console.log('After replacement:', resolvedExpression);

  try {
    const result = JSON.parse(resolvedExpression);
    console.log('Parsed result:', result);
    console.log('Is array:', Array.isArray(result));
    console.log('Length:', result.length);
  } catch (e) {
    console.log('Parse error:', e.message);
  }
}
