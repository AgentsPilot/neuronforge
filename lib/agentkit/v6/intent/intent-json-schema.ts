/* lib/intent/intent-json-schema.ts */
import type { JSONSchema7 } from "json-schema";

export const INTENT_CONTRACT_SCHEMA: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["version", "created_at", "goal", "summary", "unit_of_work", "plugins", "data_sources", "steps", "outputs", "constraints"],
  properties: {
    version: { const: "1.0" },
    created_at: { type: "string" },
    goal: { type: "string", minLength: 5 },
    summary: { type: "string", minLength: 5 },
    unit_of_work: { enum: ["email", "attachment", "row", "record", "ticket", "event", "file"] },

    plugins: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["plugin_key", "role", "capabilities", "required", "reason"],
        properties: {
          plugin_key: { type: "string", minLength: 1 },
          role: { enum: ["input", "output", "both"] },
          capabilities: { type: "array", items: { type: "string" } },
          required: { type: "boolean" },
          reason: { type: "string" },
        },
      },
    },

    data_sources: {
      type: "array",
      items: { type: "object" }, // keep lenient; strictness is in TS + compiler
    },

    steps: { type: "array", items: { type: "object" } },

    outputs: { type: "array", items: { type: "object" } },

    constraints: { type: "array", items: { type: "object" } },

    questions: { type: "array", items: { type: "object" } },
    risks: { type: "array", items: { type: "string" } },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["score"],
      properties: {
        score: { type: "number", minimum: 0, maximum: 1 },
        notes: { type: "string" },
      },
    },
  },
};
