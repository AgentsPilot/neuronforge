// Test the output sanitization logic
// This tests what gets stored in final_output vs what gets returned to the user

function sanitizeOutputForStorage(finalOutput) {
  if (!finalOutput || typeof finalOutput !== 'object') {
    return finalOutput;
  }

  const sanitized = {};

  Object.keys(finalOutput).forEach(stepKey => {
    const stepData = finalOutput[stepKey];

    if (!stepData || typeof stepData !== 'object') {
      sanitized[stepKey] = stepData;
      return;
    }

    // Extract only metadata, not actual data
    const stepMetadata = {};

    Object.keys(stepData).forEach(key => {
      const value = stepData[key];

      // If it's an array, store count and type info, not actual data
      if (Array.isArray(value)) {
        stepMetadata[key] = {
          count: value.length,
          type: 'array',
          sample_keys: value.length > 0 && typeof value[0] === 'object'
            ? Object.keys(value[0]).slice(0, 5)  // First 5 keys for structure info
            : []
        };
      }
      // If it's a primitive value or small object, keep it
      else if (typeof value !== 'object' || value === null) {
        stepMetadata[key] = value;
      }
      // If it's an object, store only its structure
      else {
        stepMetadata[key] = {
          type: 'object',
          keys: Object.keys(value).slice(0, 10)  // First 10 keys
        };
      }
    });

    sanitized[stepKey] = stepMetadata;
  });

  return sanitized;
}

// Example 1: Email workflow
const emailOutput = {
  step1: {
    emails: [
      {
        id: "19c204edf997daa3",
        to: "user@example.com",
        from: "Chase <no.reply.alerts@chase.com>",
        subject: "You sent $220.00...",
        snippet: "Transfer alert You sent $220.00...",
        body: "Full email content here with sensitive information..."
      },
      {
        id: "28d305eef008ebb4",
        to: "user@example.com",
        from: "Bank <alerts@bank.com>",
        subject: "Account statement",
        snippet: "Your account statement...",
        body: "Full statement with account numbers..."
      }
    ]
  }
};

console.log('📧 EMAIL WORKFLOW TEST\n');
console.log('❌ BEFORE (contains sensitive client data):');
console.log(JSON.stringify(emailOutput, null, 2));
console.log('\n✅ AFTER sanitization (metadata only):');
const sanitizedEmail = sanitizeOutputForStorage(emailOutput);
console.log(JSON.stringify(sanitizedEmail, null, 2));

// Example 2: Spreadsheet workflow
const spreadsheetOutput = {
  step1: {
    rows: [
      { name: "John Doe", email: "john@example.com", phone: "555-1234" },
      { name: "Jane Smith", email: "jane@example.com", phone: "555-5678" }
    ],
    total_rows: 2,
    spreadsheet_name: "Customer List"
  }
};

console.log('\n\n📊 SPREADSHEET WORKFLOW TEST\n');
console.log('❌ BEFORE (contains PII):');
console.log(JSON.stringify(spreadsheetOutput, null, 2));
console.log('\n✅ AFTER sanitization (metadata only):');
const sanitizedSpreadsheet = sanitizeOutputForStorage(spreadsheetOutput);
console.log(JSON.stringify(sanitizedSpreadsheet, null, 2));

// Example 3: Mixed data types
const mixedOutput = {
  step1: {
    items: [1, 2, 3, 4, 5],
    status: "success",
    count: 42,
    config: {
      api_key: "secret123",
      endpoint: "https://api.example.com",
      timeout: 5000
    }
  }
};

console.log('\n\n🔧 MIXED DATA TYPES TEST\n');
console.log('❌ BEFORE:');
console.log(JSON.stringify(mixedOutput, null, 2));
console.log('\n✅ AFTER sanitization:');
const sanitizedMixed = sanitizeOutputForStorage(mixedOutput);
console.log(JSON.stringify(sanitizedMixed, null, 2));

console.log('\n\n📊 SIZE COMPARISON:');
console.log('Email workflow:');
console.log('  Before:', JSON.stringify(emailOutput).length, 'bytes');
console.log('  After:', JSON.stringify(sanitizedEmail).length, 'bytes');
console.log('  Reduction:', Math.round((1 - JSON.stringify(sanitizedEmail).length / JSON.stringify(emailOutput).length) * 100) + '%');
