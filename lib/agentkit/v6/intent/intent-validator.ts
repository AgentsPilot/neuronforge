/* lib/intent/intent-validator.ts */
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { INTENT_CONTRACT_SCHEMA } from "./intent-json-schema";
import type { IntentContract } from "./intent-schema-types";

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);

const validate = ajv.compile(INTENT_CONTRACT_SCHEMA);

export type IntentValidationResult =
  | { ok: true; value: IntentContract }
  | { ok: false; errors: string[]; rawErrors?: unknown };

export function validateIntentContract(input: unknown): IntentValidationResult {
  const ok = validate(input);
  if (!ok) {
    const errors = (validate.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}`);
    return { ok: false, errors, rawErrors: validate.errors };
  }
  return { ok: true, value: input as IntentContract };
}
