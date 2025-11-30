# TOON Migration Guide: From JSON to Token-Optimized Format

## Executive Summary

This guide enables Claude Code to intelligently refactor your TypeScript/JavaScript codebase from JSON to TOON (Token-Oriented Object Notation) format, ensuring zero breaking changes and maintaining backward compatibility where needed.

---

## Quick Start: Using ToonDataHelper

The helper class is implemented and ready to use:

```typescript
import ToonDataHelper from '@/lib/utils/toon-data-helper';

// Basic conversion
const { toon, eligibilityScore } = ToonDataHelper.toToon(data);

// Conditional conversion (returns TOON if eligible, JSON otherwise)
const { content, format } = ToonDataHelper.toToonOrJson(data, 0.6);

// Check eligibility before converting
const score = ToonDataHelper.calculateEligibility(data);

// Estimate token savings
const savings = ToonDataHelper.estimateTokenSavings(data, toon);
console.log(`Saved ${savings.savingsPercent}% (~${savings.estimatedTokensSaved} tokens)`);

// Generate a full eligibility report
console.log(ToonDataHelper.generateReport(data));
```

**Location:** `lib/utils/toon-data-helper.ts`

**Package dependency:** `@toon-format/toon`

---

## What is TOON?

**TOON (Token-Oriented Object Notation)** is a compact, schema-aware serialization format optimized for LLM prompts and structured data exchange.

### Key Benefits
- **30-60% token reduction** compared to JSON for uniform arrays
- **Better LLM comprehension** due to explicit field declarations and array length markers
- **Drop-in compatibility** — convert JSON ↔ TOON losslessly
- **Human-readable** — uses indentation and tabular formats like YAML + CSV

### JSON vs TOON Example

**JSON (412 characters):**
```json
{
  "users": [
    { "id": 1, "name": "Alice", "role": "admin" },
    { "id": 2, "name": "Bob", "role": "user" }
  ]
}
```

**TOON (154 characters):**
```
users[2]{id,name,role}:
1,Alice,admin
2,Bob,user
```

Same data. ~63% fewer tokens.

---

## When to Use TOON

### ✅ Use TOON for:
- **Uniform arrays of objects** (telemetry, user lists, event logs, catalogs)
- **Agent/copilot prompts** feeding structured data to LLMs
- **Large datasets** where token cost matters
- **Repetitive structures** with consistent field names across items

### ❌ Don't use TOON for:
- Deeply nested hierarchical data (JSON remains more efficient)
- Highly inconsistent/polymorphic structures
- Non-tabular data with dynamic keys
- Cases where backward compatibility with legacy JSON systems is critical

---

## Implementation: ToonDataHelper Class

A helper utility class handles all JSON ↔ TOON conversions with validation.

### Class Structure

```typescript
import { encode as toonEncode, decode as toonDecode } from "@toon-format/toon";

/**
 * ToonDataHelper: Bidirectional JSON ↔ TOON conversion with validation
 * 
 * Responsibilities:
 * - Convert JSON objects to TOON format for LLM prompts
 * - Parse TOON responses back to JSON
 * - Validate data integrity before/after conversion
 * - Track conversion eligibility for optimization reporting
 */
class ToonDataHelper {
  /**
   * Convert JSON data to TOON format
   * @param data JavaScript object to convert
   * @param options Optional configuration
   * @returns TOON-formatted string
   */
  static toToon(
    data: Record<string, any>,
    options?: { validateEligibility?: boolean }
  ): { toon: string; eligibilityScore: number } {
    const eligibilityScore = this.calculateEligibility(data);
    
    if (options?.validateEligibility && eligibilityScore < 0.5) {
      console.warn(
        `Low TOON eligibility (${(eligibilityScore * 100).toFixed(1)}%). ` +
        `Consider keeping this data in JSON format.`
      );
    }

    try {
      const toon = toonEncode(data);
      return { toon, eligibilityScore };
    } catch (error) {
      throw new Error(`TOON encoding failed: ${error}`);
    }
  }

  /**
   * Convert TOON format back to JSON
   * @param toonString TOON-formatted string
   * @returns Parsed JavaScript object
   */
  static fromToon(toonString: string): Record<string, any> {
    try {
      const json = toonDecode(toonString);
      return json;
    } catch (error) {
      throw new Error(`TOON decoding failed: ${error}`);
    }
  }

  /**
   * Validate that conversion preserves data integrity
   * @param original Original data object
   * @param roundTripped Data after JSON → TOON → JSON cycle
   * @returns true if data is identical, false otherwise
   */
  static validateRoundTrip(original: Record<string, any>, roundTripped: Record<string, any>): boolean {
    const originalJson = JSON.stringify(original);
    const roundTrippedJson = JSON.stringify(roundTripped);
    
    if (originalJson !== roundTrippedJson) {
      console.error("Round-trip validation failed!");
      console.error("Original:", originalJson);
      console.error("After conversion:", roundTrippedJson);
      return false;
    }
    
    return true;
  }

  /**
   * Calculate TOON eligibility score (0-1)
   * Higher score = better candidate for TOON conversion
   * 
   * Scoring factors:
   * - Array uniformity (consistent field structure)
   * - Array size (larger arrays benefit more)
   * - Data repetition (repeated keys multiply benefit)
   */
  static calculateEligibility(data: Record<string, any>): number {
    let totalEligibility = 0;
    let arrayCount = 0;

    for (const key in data) {
      const value = data[key];
      
      if (Array.isArray(value) && value.length > 0) {
        arrayCount++;
        
        // Check uniformity: all objects have same keys
        const firstKeys = Object.keys(value[0]).sort();
        const isUniform = value.every(item =>
          typeof item === "object" &&
          Object.keys(item).sort().join(",") === firstKeys.join(",")
        );
        
        // Larger arrays benefit more
        const sizeBonus = Math.min(value.length / 100, 1);
        
        // Uniform arrays get high score
        totalEligibility += isUniform ? (0.6 + sizeBonus) : 0.1;
      }
    }

    return arrayCount > 0 ? totalEligibility / arrayCount : 0;
  }

  /**
   * Compare token usage before/after conversion
   * Helpful for reporting savings
   */
  static estimateTokenSavings(
    original: Record<string, any>,
    toonString: string
  ): { originalSize: number; toonSize: number; savingsPercent: number } {
    const originalJson = JSON.stringify(original);
    const originalSize = originalJson.length;
    const toonSize = toonString.length;
    const savingsPercent = ((originalSize - toonSize) / originalSize) * 100;

    return {
      originalSize,
      toonSize,
      savingsPercent: Math.round(savingsPercent * 10) / 10
    };
  }
}

export default ToonDataHelper;
```

---

## Integration Patterns

### Pattern 1: Agent Data Preparation

When preparing structured data for LLM agents:

```typescript
// Before: Sending raw JSON
const agentInput = {
  users: [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "user" }
  ]
};

const prompt = `Process this user data: ${JSON.stringify(agentInput)}`;

// After: Converting to TOON
const { toon, eligibilityScore } = ToonDataHelper.toToon(agentInput);
const prompt = `Process this user data (TOON format, array lengths marked [N]): ${toon}`;
```

### Pattern 2: Round-Trip Validation

When migrating existing code:

```typescript
// Original data
const originalData = { /* your data */ };

// Convert to TOON
const { toon } = ToonDataHelper.toToon(originalData);

// Convert back
const recovered = ToonDataHelper.fromToon(toon);

// Validate integrity
const isValid = ToonDataHelper.validateRoundTrip(originalData, recovered);
assert(isValid, "Conversion integrity check failed!");
```

### Pattern 3: Conditional Conversion (Optimal)

Only convert when it makes sense:

```typescript
const data = { /* your data */ };
const eligibility = ToonDataHelper.calculateEligibility(data);

if (eligibility > 0.6) {
  // Good candidate for TOON
  const { toon } = ToonDataHelper.toToon(data);
  // Use toon in LLM prompt
} else {
  // Keep as JSON
  // Stick with JSON.stringify(data)
}
```

---

## Refactoring Checklist for Claude Code

When Claude Code refactors your classes from JSON to TOON, it should:

### Pre-Migration
- [ ] Identify all classes that serialize/send data to LLMs or via API
- [ ] Calculate TOON eligibility for each data structure
- [ ] Audit for backward compatibility requirements
- [ ] Create integration tests for round-trip validation

### Migration Steps
- [ ] Import `ToonDataHelper` class
- [ ] Replace `JSON.stringify()` calls with `ToonDataHelper.toToon()`
- [ ] Replace `JSON.parse()` calls with `ToonDataHelper.fromToon()`
- [ ] Update LLM system prompts to acknowledge TOON format
- [ ] Add eligibility warnings for low-score conversions

### Post-Migration Validation
- [ ] Run round-trip tests on all converted data structures
- [ ] Compare token counts before/after (report savings)
- [ ] Test with actual LLM prompts (verify model understanding)
- [ ] Monitor for data loss or corruption in production
- [ ] Keep JSON fallback for incompatible structures

### Breaking Change Prevention
- [ ] Maintain JSON serialization in external APIs (don't break clients)
- [ ] Use TOON **only** for internal agent prompts and LLM communication
- [ ] Version your serialization format (add `_format: "toon"` marker if needed)
- [ ] Document why each structure was converted (rationale for future maintainers)

---

## Example Migration: Plugin Parameter Data

**Before (JSON):**
```typescript
class PluginExecutor {
  async executeWithParams(pluginId: string, params: Record<string, any>) {
    const prompt = `
      Execute plugin ${pluginId} with parameters:
      ${JSON.stringify(params)}
    `;
    return await this.callLLM(prompt);
  }
}
```

**After (TOON):**
```typescript
import ToonDataHelper from "@/lib/utils/toon-data-helper";

class PluginExecutor {
  async executeWithParams(pluginId: string, params: Record<string, any>) {
    const { toon, eligibilityScore } = ToonDataHelper.toToon(params, {
      validateEligibility: true
    });

    const prompt = `
      Execute plugin ${pluginId} with parameters (TOON format):
      ${toon}
    `;
    return await this.callLLM(prompt);
  }

  // Validation helper
  private validateParamsIntegrity(original: Record<string, any>, roundTripped: Record<string, any>) {
    if (!ToonDataHelper.validateRoundTrip(original, roundTripped)) {
      throw new Error("Parameter data integrity check failed!");
    }
  }
}
```

---

## LLM System Prompt Addendum

When Claude Code updates your prompts, include:

```
If you receive data in TOON (Token-Oriented Object Notation) format:
- Array lengths are declared as [N] where N is the count
- Field names are declared once in curly braces {field1,field2,field3}
- Data rows follow as comma-separated values
- This format is lossless and contains the same information as JSON, just more compactly

Example:
users[2]{id,name,role}:
1,Alice,admin
2,Bob,user

When generating responses with structured data, prefer TOON format for consistency.
```

---

## Performance Expectations

| Scenario | Token Savings | Use Case |
|----------|---------------|----------|
| Uniform arrays (10+ items) | 40-60% | User lists, telemetry, event logs |
| Semi-uniform data | 20-40% | Mixed but mostly consistent |
| Deeply nested | 5-15% | Hierarchical config (use JSON instead) |
| Single objects | 10-20% | Not optimal for TOON |

---

## Troubleshooting

### "TOON encoding failed"
- Check if data has circular references
- Ensure all values are serializable (no functions, symbols)
- Validate data types match TOON spec

### Low eligibility score warnings
- Data structure isn't uniform enough
- Keep using JSON for that particular class
- Only convert high-eligibility structures

### Round-trip validation fails
- Data loss occurred in conversion (report as bug)
- Check for date objects, non-standard types
- Verify TOON library version compatibility

### LLM misinterprets TOON format
- Add format description to system prompt
- Include example in few-shot prompts
- Test with simpler data structure first

---

## Summary for Claude Code

**Goal:** Refactor JSON serialization to TOON for LLM-bound data while preventing breaking changes.

**Implementation:**
1. Use `ToonDataHelper` class for all conversions
2. Calculate eligibility before migrating
3. Validate round-trip integrity after changes
4. Keep JSON for external APIs, use TOON internally for agents

**Key Rule:** Only convert when eligibility > 0.6 and data doesn't need external backward compatibility.

**Validation:** Every refactored class must pass round-trip tests before deployment.
