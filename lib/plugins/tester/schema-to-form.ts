// lib/plugins/tester/schema-to-form.ts
//
// PURE helpers for the schema-driven Plugin API Tester. No React, no fetch, no I/O —
// fully unit-testable. Everything is derived from the plugin-definition JSON Schema;
// there is NO per-plugin or per-action hardcoding anywhere in this file (F5).
//
// Two responsibilities:
//   1. buildFormFields(actionSchema)  → typed, render-ready field descriptors (FR3)
//   2. getConfirmation(actionSchema)  → destructive-action classification (FR6 / CR1)

import type {
  ActionSchema,
  ConfirmationDecision,
  FormControl,
  FormFieldDescriptor,
  JsonSchemaProperty,
  RuleDefinition,
} from './tester-types';

/** Humanize a snake_case / camelCase parameter name into a label. */
function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean']);

function isScalarArray(prop: JsonSchemaProperty): boolean {
  const it = prop.items?.type;
  return !!it && SCALAR_TYPES.has(it) && !prop.items?.properties;
}

function isObjectArray(prop: JsonSchemaProperty): boolean {
  return prop.items?.type === 'object' || !!prop.items?.properties;
}

function isMatrix(prop: JsonSchemaProperty): boolean {
  return prop.items?.type === 'array';
}

/**
 * Recursively build a render-ready descriptor for one property.
 *
 * The default form is entirely free-text/simple: nested objects flatten into a
 * titled group of labeled inputs; arrays-of-objects become an add/remove-row
 * repeater of flattened inputs; 2-D arrays become a repeater of comma-separated
 * rows. NO JSON editing anywhere in the default form. Fully schema-generic (F5).
 *
 * @param requiredHere true when this field is required at its own level
 *                     (top-level: from required_params; nested: parent required AND
 *                     the field is in the parent object's `required` array).
 */
function buildDescriptor(
  name: string,
  prop: JsonSchemaProperty,
  path: string[],
  requiredHere: boolean
): FormFieldDescriptor {
  const dynamic = prop['x-dynamic-options'];
  const base: FormFieldDescriptor = {
    name,
    path,
    control: 'text',
    required: requiredHere,
    label: humanize(name),
    description: prop.description,
    defaultValue: prop.default,
  };

  // x-dynamic-options fields are single scalar IDs → labeled free-text (D4).
  if (dynamic) {
    return { ...base, control: 'text', isDynamicOption: true, dynamicOptionSource: dynamic.source };
  }

  const type = prop.type;

  if (type === 'string' || type === undefined) {
    if (prop.enum && prop.enum.length > 0) return { ...base, control: 'enum', enumValues: prop.enum };
    return { ...base, control: 'text' };
  }
  if (type === 'number' || type === 'integer') {
    return {
      ...base,
      control: 'number',
      min: typeof prop.minimum === 'number' ? prop.minimum : undefined,
      max: typeof prop.maximum === 'number' ? prop.maximum : undefined,
    };
  }
  if (type === 'boolean') return { ...base, control: 'boolean', defaultValue: prop.default ?? false };

  if (type === 'array') {
    if (isScalarArray(prop)) return { ...base, control: 'scalar-array', itemType: prop.items?.type };
    if (isMatrix(prop)) return { ...base, control: 'scalar-matrix', itemType: prop.items?.items?.type };
    if (isObjectArray(prop)) {
      return { ...base, control: 'object-array', itemFields: buildChildren(prop.items || {}, path) };
    }
    // Unknown array shape → treat as a scalar-array of free-text (never JSON).
    return { ...base, control: 'scalar-array', itemType: 'string' };
  }

  if (type === 'object') {
    return { ...base, control: 'object', children: buildChildren(prop, path) };
  }

  // Unknown scalar shape → free-text.
  return { ...base, control: 'text' };
}

/** Build descriptors for every property of an object schema, at the given base path. */
function buildChildren(objectSchema: JsonSchemaProperty, basePath: string[]): FormFieldDescriptor[] {
  const props = objectSchema.properties || {};
  const requiredNames = new Set(objectSchema.required || []);
  return Object.entries(props).map(([childName, childProp]) =>
    buildDescriptor(childName, childProp as JsonSchemaProperty, [...basePath, childName], requiredNames.has(childName))
  );
}

/**
 * Map an action's input JSON Schema to a tree of typed field descriptors.
 * Required-ness at the top level keys off `required_params` (falling back to the
 * schema's own `required` array), NEVER off templates (SA Q5). Nested required-ness
 * uses each object schema's own `required` array.
 */
export function buildFormFields(actionSchema: ActionSchema): FormFieldDescriptor[] {
  const props = actionSchema.parameters?.properties || {};
  const requiredFromParams = actionSchema.required_params;
  const requiredSet = new Set<string>(
    requiredFromParams ? requiredFromParams : actionSchema.parameters?.required || []
  );

  return Object.entries(props).map(([name, prop]) =>
    buildDescriptor(name, prop, [name], requiredSet.has(name))
  );
}

// ---------------------------------------------------------------------------
// CR1 — Destructive-action detection by CONDITION SHAPE (static, no evaluation)
// ---------------------------------------------------------------------------
//
// Ground truth across all five Google Suite definitions shows a clean structural
// split in `rules.confirmations[*].condition`:
//
//   • Presence-check conditions  (`file_id != null`, `event_id != null`,
//     `spreadsheet_id != null`, `label_id != null`)  → the genuinely DESTRUCTIVE
//     actions (delete_file, revoke_access, clear_range, delete_rows, delete_label,
//     delete_event). These carry an effectively-unconditional confirm.
//
//   • Numeric-threshold conditions (`max_results > 50`, `estimated_cells > 1000`,
//     `text_length > 5000`) and boolean-equality (`send_notifications == true`)
//     → advisory/near-universal confirms on ordinary reads/sends. These must NOT
//     block, or the gate becomes always-on and induces confirm-fatigue (CR1).
//
// We classify the condition's SHAPE statically. We do NOT evaluate the condition
// against form values (that fragile-evaluation path is explicitly out of scope).
// This stays schema-generic (F5): it reads the condition string's operator shape,
// never an action-name list.

/**
 * True iff the condition is a presence/existence check of the form
 * `<field> != null` or `<field> == null` (whitespace-insensitive).
 * These mark destructive actions whose confirm should block Run.
 */
export function isPresenceCheckCondition(condition: string): boolean {
  if (!condition || typeof condition !== 'string') return false;
  // `identifier` (!= | ==) `null`  — nothing else on either side.
  return /^\s*[A-Za-z_][\w.]*\s*(!=|==)\s*null\s*$/.test(condition);
}

/**
 * Classify an action's confirmation rules into the blocking (destructive) gate
 * vs. non-blocking advisories, per CR1.
 *
 * - requiresConfirm === true  → at least one presence-check confirm → block Run
 *   until the user confirms; render that rule's authored message.
 * - advisories                → threshold/boolean confirms surfaced non-blocking.
 * - isDestructiveStyle        → red-flag visual, reserved for genuine data-loss
 *   (capability === 'delete'). Non-idempotent create/update actions are NOT flagged.
 */
export function getConfirmation(actionSchema: ActionSchema): ConfirmationDecision {
  const confirmations = actionSchema.rules?.confirmations || {};

  let blockingMessage: string | undefined;
  const advisories: string[] = [];

  for (const rule of Object.values(confirmations) as RuleDefinition[]) {
    if (!rule || rule.action !== 'confirm') continue;
    if (isPresenceCheckCondition(rule.condition)) {
      // First presence-check message wins as the gate copy.
      if (!blockingMessage) blockingMessage = rule.message;
    } else {
      advisories.push(rule.message);
    }
  }

  // Red "DESTRUCTIVE" badge is reserved for genuine data-loss operations (delete capability).
  // Non-idempotent create/update/send actions are NOT destructive — re-running one may create a
  // duplicate, but that is not a data-loss/red-flag concern, so they are not badged here. (This
  // is why e.g. create_contact, which is legitimately `idempotent: false`, is not flagged.)
  const isDestructiveStyle = actionSchema.capability === 'delete';

  return {
    requiresConfirm: blockingMessage !== undefined,
    message: blockingMessage,
    isDestructiveStyle,
    advisories,
  };
}
