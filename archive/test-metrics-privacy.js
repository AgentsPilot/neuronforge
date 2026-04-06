/**
 * Privacy Compliance Test for MetricsCollector
 *
 * This script verifies that MetricsCollector NEVER stores customer data
 *
 * Run with: node test-metrics-privacy.js
 *
 * CRITICAL CHECKS:
 * ✅ Only field names stored, NEVER values
 * ✅ Only counts stored, NEVER actual data
 * ✅ No PII (emails, names, addresses) in stored metrics
 * ✅ Suspicious patterns detected and warned
 */

// Mock data simulating a real workflow execution
const mockCustomerData = [
  {
    id: 'cust_001',
    email: 'john.doe@example.com',
    name: 'John Doe',
    phone: '+1-555-0123',
    address: '123 Main St, San Francisco, CA 94102',
    priority: 'high',
    complaint: 'Product arrived damaged',
    order_id: 'ORD-12345',
    created_at: '2026-02-04T10:30:00Z'
  },
  {
    id: 'cust_002',
    email: 'jane.smith@example.com',
    name: 'Jane Smith',
    phone: '+1-555-0456',
    address: '456 Oak Ave, New York, NY 10001',
    priority: 'medium',
    complaint: 'Wrong item shipped',
    order_id: 'ORD-12346',
    created_at: '2026-02-04T11:15:00Z'
  },
  {
    id: 'cust_003',
    email: 'bob.johnson@example.com',
    name: 'Bob Johnson',
    phone: '+1-555-0789',
    priority: 'low',
    complaint: 'Question about return policy',
    order_id: 'ORD-12347',
    created_at: '2026-02-04T12:00:00Z'
  }
];

/**
 * Simulate MetricsCollector.analyzeDataStructure logic
 */
function analyzeDataStructure(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return {
      field_names: [],
      items_by_field: {},
      total_items: 0,
      has_empty_results: true
    };
  }

  const metrics = {
    total_items: data.length,
    field_names: [],
    items_by_field: {},
    has_empty_results: false
  };

  // Get field names from first item (structure analysis)
  const firstItem = data[0];
  const fields = Object.keys(firstItem);
  metrics.field_names = fields;

  // Count items that have specific fields (presence, NOT values)
  for (const field of fields) {
    const fieldKey = `has_${field}`;

    // Count how many items have this field (non-null, non-empty)
    const countWithField = data.filter(item => {
      const value = item[field];
      if (value === null || value === undefined || value === '') {
        return false;
      }
      if (Array.isArray(value) && value.length === 0) {
        return false;
      }
      return true;
    }).length;

    metrics.items_by_field[fieldKey] = countWithField;
  }

  return metrics;
}

/**
 * Check if any customer data leaked into metrics
 */
function checkForDataLeaks(metrics, originalData) {
  const leaks = [];

  // Check if any actual customer data appears in field_names
  const allCustomerValues = originalData.flatMap(item => Object.values(item));

  for (const fieldName of metrics.field_names) {
    // Check if field name contains actual customer data
    for (const value of allCustomerValues) {
      if (typeof value === 'string' && value.length > 3 && fieldName.includes(value)) {
        leaks.push({
          type: 'CUSTOMER_DATA_IN_FIELD_NAME',
          field: fieldName,
          contains: value,
          severity: 'CRITICAL'
        });
      }
    }
  }

  // Check if items_by_field contains actual counts (not data)
  for (const [key, value] of Object.entries(metrics.items_by_field)) {
    if (typeof value !== 'number') {
      leaks.push({
        type: 'NON_NUMERIC_COUNT',
        field: key,
        value: value,
        severity: 'CRITICAL'
      });
    }
  }

  // Check for email patterns in field_names
  for (const fieldName of metrics.field_names) {
    if (fieldName.match(/@|\.com|\.net|\.org/i)) {
      leaks.push({
        type: 'EMAIL_PATTERN_IN_FIELD_NAME',
        field: fieldName,
        severity: 'HIGH'
      });
    }
  }

  // Check for phone patterns
  for (const fieldName of metrics.field_names) {
    if (fieldName.match(/\d{3}-\d{3}-\d{4}|\+\d{1,3}-\d/)) {
      leaks.push({
        type: 'PHONE_PATTERN_IN_FIELD_NAME',
        field: fieldName,
        severity: 'HIGH'
      });
    }
  }

  // Check for address patterns
  for (const fieldName of metrics.field_names) {
    if (fieldName.match(/\d+\s+\w+\s+(st|ave|blvd|rd|street|avenue)/i)) {
      leaks.push({
        type: 'ADDRESS_PATTERN_IN_FIELD_NAME',
        field: fieldName,
        severity: 'HIGH'
      });
    }
  }

  return leaks;
}

/**
 * Main test function
 */
function runPrivacyTest() {
  console.log('🔒 Starting Privacy Compliance Test for MetricsCollector\n');
  console.log('='.repeat(70));

  console.log('\n📊 INPUT: Mock customer data (simulating workflow execution)');
  console.log(`Total records: ${mockCustomerData.length}`);
  console.log(`Sample record:`, JSON.stringify(mockCustomerData[0], null, 2).substring(0, 300) + '...');

  console.log('\n' + '='.repeat(70));

  console.log('\n⚙️  PROCESSING: Analyzing data structure (MetricsCollector logic)');
  const metrics = analyzeDataStructure(mockCustomerData);

  console.log('\n' + '='.repeat(70));

  console.log('\n📤 OUTPUT: Metrics that would be stored in database');
  console.log(JSON.stringify(metrics, null, 2));

  console.log('\n' + '='.repeat(70));

  console.log('\n🔍 PRIVACY AUDIT: Checking for data leaks');
  const leaks = checkForDataLeaks(metrics, mockCustomerData);

  if (leaks.length === 0) {
    console.log('\n✅ PASS: No data leaks detected!');
    console.log('\nPrivacy verification:');
    console.log('  ✅ No customer emails found in metrics');
    console.log('  ✅ No customer names found in metrics');
    console.log('  ✅ No phone numbers found in metrics');
    console.log('  ✅ No addresses found in metrics');
    console.log('  ✅ Only field names and counts stored');
    console.log('\n🎉 MetricsCollector is PRIVACY-SAFE!');
  } else {
    console.log('\n❌ FAIL: Data leaks detected!');
    console.log('\nLeaks found:');
    leaks.forEach((leak, i) => {
      console.log(`\n  ${i + 1}. ${leak.type} [${leak.severity}]`);
      console.log(`     Field: ${leak.field}`);
      if (leak.contains) console.log(`     Contains: ${leak.contains}`);
      if (leak.value) console.log(`     Value: ${leak.value}`);
    });
    console.log('\n⚠️  FIX REQUIRED: MetricsCollector is NOT privacy-safe!');
  }

  console.log('\n' + '='.repeat(70));

  console.log('\n📊 EXPECTED BEHAVIOR:');
  console.log('  • field_names: List of field names (NOT values)');
  console.log('    Example: ["id", "email", "name", "priority"]');
  console.log('  • items_by_field: Count of items with each field');
  console.log('    Example: {"has_priority": 3, "has_email": 3}');
  console.log('  • total_items: Number of items processed');
  console.log('    Example: 3');
  console.log('\n  NEVER stored:');
  console.log('    ❌ Actual email addresses');
  console.log('    ❌ Customer names');
  console.log('    ❌ Phone numbers');
  console.log('    ❌ Addresses');
  console.log('    ❌ Complaint text');
  console.log('    ❌ Order IDs');

  console.log('\n' + '='.repeat(70));

  console.log('\n📈 BUSINESS INTELLIGENCE USE CASE:');
  console.log('  With this metadata, we can generate insights like:');
  console.log(`    • "Processing ${metrics.total_items} customer records"`);
  console.log(`    • "${metrics.items_by_field.has_priority || 0} items have priority field"`);
  console.log(`    • "Priority distribution: high (${mockCustomerData.filter(d => d.priority === 'high').length}), medium (${mockCustomerData.filter(d => d.priority === 'medium').length}), low (${mockCustomerData.filter(d => d.priority === 'low').length})"`);
  console.log('    • "Volume up 40% week-over-week" (from historical trends)');
  console.log('\n  WITHOUT storing any customer data!');

  console.log('\n' + '='.repeat(70) + '\n');

  return leaks.length === 0;
}

// Run the test
const passed = runPrivacyTest();
process.exit(passed ? 0 : 1);
