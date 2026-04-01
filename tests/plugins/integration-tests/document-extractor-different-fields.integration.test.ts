/**
 * Integration tests for DeterministicExtractor with different field combinations.
 *
 * Converted from scripts/test-different-fields.ts into proper Jest assertions.
 * Verifies the system is schema-driven: any field combination can be requested,
 * not just the standard invoice fields.
 *
 * Uses Invoice-ZYVUTAKJ-0003.pdf (Anthropic Max plan) as the test fixture.
 * LLMFieldMapper is mocked to prevent real API calls.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';
import type { OutputSchema } from '@/lib/extraction/types';

// Mock LLMFieldMapper to prevent real LLM API calls during integration tests.
jest.mock('@/lib/extraction/LLMFieldMapper', () => {
  return {
    LLMFieldMapper: jest.fn().mockImplementation(() => ({
      mapFields: jest.fn().mockResolvedValue({
        mappedFields: {},
        unmappedFields: [],
        confidence: 0,
      }),
    })),
  };
});

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'plugins', 'fixtures');
const TEST_PDF = 'Invoice-ZYVUTAKJ-0003 (1) (1).pdf';

/** Helper: read a PDF fixture as base64, or return null if missing */
function readFixture(filename: string): string | null {
  const fullPath = path.join(FIXTURES_DIR, filename);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath).toString('base64');
}

/** Helper: run DeterministicExtractor with a custom schema */
async function extractWithSchema(base64Content: string, schema: OutputSchema) {
  const extractor = new DeterministicExtractor(true);
  return extractor.extract({
    content: base64Content,
    mimeType: 'application/pdf',
    filename: TEST_PDF,
    config: {
      outputSchema: schema,
      ocrFallback: true,
    },
  });
}

const fixtureContent = readFixture(TEST_PDF);
const describeSuite = fixtureContent ? describe : describe.skip;

describeSuite('DeterministicExtractor -- different field combinations (integration)', () => {

  // -----------------------------------------------------------------------
  // Test 1: Payment/billing fields
  // -----------------------------------------------------------------------
  describe('payment and billing fields', () => {
    const schema: OutputSchema = {
      fields: [
        {
          name: 'payment_address',
          type: 'string',
          description: 'Payment address or mailing address',
          required: true,
        },
        {
          name: 'due_date',
          type: 'string',
          description: 'Due date or payment due date',
          required: true,
        },
        {
          name: 'subtotal',
          type: 'string',
          description: 'Subtotal amount',
          required: false,
        },
      ],
    };

    it('should return a result with the requested field names in data', async () => {
      const result = await extractWithSchema(fixtureContent!, schema);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // The result data keys should include all requested fields
      // (even if values are fallback/unknown, the keys must be present)
      for (const field of schema.fields) {
        expect(result.data).toHaveProperty(field.name);
      }

      expect(result.metadata.fieldsRequested).toBe(3);
    }, 30000);
  });

  // -----------------------------------------------------------------------
  // Test 2: Contact information fields
  // -----------------------------------------------------------------------
  describe('contact information fields', () => {
    const schema: OutputSchema = {
      fields: [
        {
          name: 'email',
          type: 'string',
          description: 'Email address or contact email',
          required: true,
        },
        {
          name: 'customer_name',
          type: 'string',
          description: 'Customer name or bill to name',
          required: true,
        },
        {
          name: 'customer_address',
          type: 'string',
          description: 'Customer address or billing address',
          required: true,
        },
      ],
    };

    it('should return a result with the requested field names in data', async () => {
      const result = await extractWithSchema(fixtureContent!, schema);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      for (const field of schema.fields) {
        expect(result.data).toHaveProperty(field.name);
      }

      expect(result.metadata.fieldsRequested).toBe(3);
    }, 30000);
  });

  // -----------------------------------------------------------------------
  // Test 3: Line item detail fields
  // -----------------------------------------------------------------------
  describe('line item detail fields', () => {
    const schema: OutputSchema = {
      fields: [
        {
          name: 'description',
          type: 'string',
          description: 'Product description or service description',
          required: true,
        },
        {
          name: 'quantity',
          type: 'string',
          description: 'Quantity or qty',
          required: false,
        },
        {
          name: 'unit_price',
          type: 'string',
          description: 'Unit price or price per item',
          required: false,
        },
      ],
    };

    it('should return a result with the requested field names in data', async () => {
      const result = await extractWithSchema(fixtureContent!, schema);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      for (const field of schema.fields) {
        expect(result.data).toHaveProperty(field.name);
      }

      expect(result.metadata.fieldsRequested).toBe(3);
    }, 30000);
  });

  // -----------------------------------------------------------------------
  // Test 4: Unusual fields that may not exist in the document
  // -----------------------------------------------------------------------
  describe('unusual fields (may not exist in document)', () => {
    const schema: OutputSchema = {
      fields: [
        {
          name: 'tax_amount',
          type: 'string',
          description: 'Tax amount or sales tax',
          required: false,
        },
        {
          name: 'discount',
          type: 'string',
          description: 'Discount amount or discount applied',
          required: false,
        },
        {
          name: 'payment_method',
          type: 'string',
          description: 'Payment method or how to pay',
          required: false,
        },
      ],
    };

    it('should return a result with fallback values for missing fields', async () => {
      const result = await extractWithSchema(fixtureContent!, schema);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // All requested fields should have keys in data
      for (const field of schema.fields) {
        expect(result.data).toHaveProperty(field.name);
      }

      // Missing fields list should contain fields that could not be extracted
      expect(result.metadata.missingFields).toBeDefined();
      expect(Array.isArray(result.metadata.missingFields)).toBe(true);

      expect(result.metadata.fieldsRequested).toBe(3);
    }, 30000);
  });

  // -----------------------------------------------------------------------
  // Schema-driven behavior: field count matches request
  // -----------------------------------------------------------------------
  describe('schema-driven behavior', () => {
    it('should return exactly the number of fields requested', async () => {
      const smallSchema: OutputSchema = {
        fields: [
          { name: 'invoice_number', type: 'string', description: 'Invoice number', required: true },
        ],
      };

      const result = await extractWithSchema(fixtureContent!, smallSchema);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.metadata.fieldsRequested).toBe(1);
      // The data should contain the requested field
      expect(result.data).toHaveProperty('invoice_number');
    }, 30000);

    it('fieldsRequested should match the schema length for larger requests', async () => {
      const largeSchema: OutputSchema = {
        fields: [
          { name: 'field_a', type: 'string', description: 'Field A', required: false },
          { name: 'field_b', type: 'string', description: 'Field B', required: false },
          { name: 'field_c', type: 'string', description: 'Field C', required: false },
          { name: 'field_d', type: 'string', description: 'Field D', required: false },
          { name: 'field_e', type: 'string', description: 'Field E', required: false },
        ],
      };

      const result = await extractWithSchema(fixtureContent!, largeSchema);

      expect(result).toBeDefined();
      // These fictional fields won't be found, so success may be false --
      // but fieldsRequested must still reflect the schema size
      expect(result.metadata.fieldsRequested).toBe(5);
    }, 30000);
  });
});
