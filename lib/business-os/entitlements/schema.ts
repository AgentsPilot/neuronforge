// lib/business-os/entitlements/schema.ts
//
// Zod validation for the entitlement configuration.
//
// Requirement FR-7, workplan §4.7.
//
// ── WHY THIS EXISTS WHEN THE TYPES ALREADY SAY IT ───────────────────────────
// `next.config.js` sets `typescript.ignoreBuildErrors: true`, and Jest runs
// transpile-only. A type error in this module would therefore reach production
// unnoticed — the compiler is a comfort while you write, not a gate.
//
// These schemas are the gate. They are BUILT FROM THE CATALOG rather than
// hand-written, so a new capability is validated the moment it is added, with no
// second list to keep in step. They run once at first load and, in CI, on every
// config test.
//
// The rules below are the ones from workplan §4.7, each with the mistake it is
// there to catch.

import { z } from 'zod';
import { CAPABILITIES } from './config/catalog';
import type { CapabilityId } from './config/catalog';
import { rankValue } from './snapshot';
import type { CapabilityDef, CapabilityShape, CapabilityValue, QuantityValue } from './types';

/**
 * A catalog to validate against.
 *
 * Every schema below takes one rather than importing the shipped catalog
 * directly. That is what makes `validateEntitlementConfig(config)` validate the
 * cohorts against THAT config's catalog — so a test (or a future DB-backed
 * source) that adds a capability gets the rule applied to it, instead of the
 * rules silently continuing to describe the version compiled into this file.
 */
export type CatalogLike = Readonly<Record<string, CapabilityDef>>;

function idsOf(catalog: CatalogLike): string[] {
  return Object.keys(catalog);
}

/**
 * Does this value GRANT the capability, as opposed to withholding it?
 *
 * "Granted" is anything above the bottom of the capability's own scale: `true`
 * for a boolean or a group, any variant other than the first, `purchasable` or
 * `included` for an add-on, and any non-zero quantity, allowance or ceiling.
 *
 * `purchasable` counts as granting on purpose. It is an offer to sell, and
 * offering to sell something that does not exist is the failure this rule is
 * about — the customer pays and then finds out.
 *
 * A value the scale cannot rank is treated as granting: if we cannot tell, we
 * do not hand it out.
 */
export function isGrantingValue(value: CapabilityValue, definition: CapabilityDef): boolean {
  // QA B-1: `{ included: 0, purchasable: true }` ranks 0 — nothing is included —
  // but it still OFFERS TO SELL more. That is the same failure `purchasable` on
  // an add-on is treated as granting for: the customer pays, and finds out
  // afterwards. The quantity shape is the only other place the word appears.
  if (definition.shape.kind === 'quantity' && (value as QuantityValue)?.purchasable === true) return true;

  const rank = rankValue(value, definition);
  return rank === null ? true : rank > 0;
}

/**
 * The user's rule, 2026-09-22: **if a feature does not exist it cannot be
 * allocated.**
 *
 * `lifecycle: 'not_built'` already means "never entitled" at resolution time
 * (FR-13), so a tier that grants one would be a promise the resolver silently
 * refuses to keep — a plan whose feature list does not match what the customer
 * gets, discovered by the customer. Rejecting it at load makes the two
 * impossible to disagree.
 *
 * Reported as a list rather than one issue at a time: someone adding a tier
 * wants to know about all of them at once, not one release at a time.
 */
function addNotBuiltGrantIssues(
  row: Record<string, unknown>,
  catalog: CatalogLike,
  where: string,
  ctx: z.RefinementCtx
): void {
  for (const [capability, value] of Object.entries(row)) {
    const definition = catalog[capability];
    if (!definition || definition.lifecycle !== 'not_built') continue;
    if (!isGrantingValue(value as CapabilityValue, definition)) continue;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        `${where} grants "${capability}" (${JSON.stringify(value)}), but that capability is ` +
        `not_built — it does not exist yet, so it cannot be allocated. Either withhold it ` +
        `(${JSON.stringify(withheldValueFor(definition))}) or change its lifecycle in the catalog, ` +
        `which means proving a customer gets the outcome.`,
    });
  }
}

/** The value that withholds a capability, for the error message above. */
function withheldValueFor(definition: CapabilityDef): CapabilityValue {
  const shape = definition.shape;
  switch (shape.kind) {
    case 'boolean':
    case 'group':
      return false;
    case 'variant':
      return shape.variants[0];
    case 'addon':
      return 'unavailable';
    case 'metered':
      return { perMonth: 0 };
    case 'quantity':
      return { included: 0 };
    case 'fair_use':
      return { ceilingPerMonth: 0 };
  }
}

/** The value schema for one capability, derived from its declared shape. */
export function valueSchemaFor(shape: CapabilityShape): z.ZodTypeAny {
  switch (shape.kind) {
    case 'boolean':
    case 'group':
      return z.boolean();

    case 'variant':
      // A variant outside the declared list is the typo this catches:
      // `'unbrandeded'` would otherwise sit in config looking plausible.
      return z.enum(shape.variants as [string, ...string[]]);

    case 'metered':
      return z.union([
        z.object({ perMonth: z.number().int().nonnegative() }).strict(),
        z.object({ total: z.number().int().nonnegative() }).strict(),
      ]);

    case 'quantity':
      return z
        .object({
          included: z.number().int().nonnegative(),
          purchasable: z.boolean().optional(),
        })
        .strict();

    case 'fair_use':
      return z.object({ ceilingPerMonth: z.number().int().nonnegative() }).strict();

    case 'addon':
      return z.enum(['unavailable', 'purchasable', 'included']);
  }
}

/** A complete tier row: every capability, each with a value of its own shape. */
export function tierRowSchema(catalog: CatalogLike = CAPABILITIES): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const id of idsOf(catalog)) {
    shape[id] = valueSchemaFor(catalog[id].shape);
  }
  // `.strict()` rejects a capability that no longer exists — the other half of
  // "no implicit defaults" (FR-3). A tier that still lists a deleted capability
  // is as wrong as one that is missing a live one.
  return z.object(shape).strict();
}

/** A tier name, when there are tiers. When there are none, nothing is valid. */
function tierNameSchema(tierOrder: readonly string[]): z.ZodTypeAny {
  // `z.enum` needs a non-empty tuple. With no tiers configured, no tier name can
  // be valid — which is the truth, and is why the production matrix's `tiers`
  // and `removals` must both be empty.
  return tierOrder.length > 0 ? z.enum(tierOrder as [string, ...string[]]) : z.never();
}

/** The capability ids, as a Zod enum. */
export function capabilityIdSchema(catalog: CatalogLike = CAPABILITIES): z.ZodTypeAny {
  return z.enum(idsOf(catalog) as [string, ...string[]]);
}

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'not a parseable ISO timestamp' });

/**
 * A dated history: at least one entry, ordered, no duplicates.
 *
 * Unordered entries would make "the value in force at time T" ambiguous, and a
 * duplicate `effectiveFrom` would make it arbitrary.
 */
const historySchema = z
  .array(z.object({ effectiveFrom: isoDate, days: z.number().int().positive() }).strict())
  .min(1, 'a history needs at least one entry')
  .superRefine((entries, ctx) => {
    const times = entries.map((entry) => Date.parse(entry.effectiveFrom));
    for (let i = 1; i < times.length; i += 1) {
      if (times[i] <= times[i - 1]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `history entries must be in ascending order with no duplicates (entry ${i + 1})`,
        });
      }
    }
  });

/**
 * The tier matrix.
 *
 * @param tierOrder the configured tiers, which the schema validates against
 * @param allowRenewalGrandfather Slice 4 only — see below
 */
export function tierMatrixSchema(
  tierOrder: readonly string[],
  catalog: CatalogLike = CAPABILITIES,
  allowRenewalGrandfather = false
): z.ZodTypeAny {
  const tierName = tierNameSchema(tierOrder);
  const row = tierRowSchema(catalog);

  const grandfatherUntil = allowRenewalGrandfather
    ? z.union([z.literal('renewal'), isoDate])
    : isoDate.describe(
        // WC-19: before billing exists there is no renewal event, so 'renewal'
        // would quietly mean "forever". A removal must name a date.
        "an ISO date; 'renewal' is not accepted until billing ships"
      );

  return z
    .object({
      version: z.number().int().positive(),
      tiers: z.record(tierName, row),
      removals: z.array(
        z
          .object({
            version: z.number().int().positive(),
            tier: tierName,
            capability: capabilityIdSchema(catalog),
            previousValue: z.unknown(),
            grandfatherUntil,
          })
          .strict()
      ),
    })
    .strict()
    .superRefine((matrix, ctx) => {
      // Every configured tier has a row, and no row belongs to a tier that is
      // not configured.
      const configured = new Set(tierOrder);
      const rows = new Set(Object.keys(matrix.tiers as Record<string, unknown>));

      for (const tier of configured) {
        if (!rows.has(tier)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `tier "${tier}" has no row in the matrix` });
        }
      }
      for (const tier of rows) {
        if (!configured.has(tier)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `the matrix has a row for unconfigured tier "${tier}"` });
        }
      }

      // "If a feature does not exist it cannot be allocated."
      for (const [tier, row] of Object.entries(matrix.tiers as Record<string, Record<string, unknown>>)) {
        addNotBuiltGrantIssues(row, catalog, `tier "${tier}"`, ctx);
      }

      // A removal records what the subscriber KEEPS, so its value has to be a
      // legal value for that capability — otherwise grandfathering would restore
      // something the resolver cannot interpret.
      for (const [index, removal] of (matrix.removals as Array<Record<string, unknown>>).entries()) {
        const capability = removal.capability as CapabilityId;
        const definition = catalog[capability];
        if (!definition) continue; // already reported by the enum

        const parsed = valueSchemaFor(definition.shape).safeParse(removal.previousValue);
        if (!parsed.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `removals[${index}]: previousValue is not a valid value for ${capability}`,
          });
        }

        if ((removal.version as number) > (matrix.version as number)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `removals[${index}]: version ${removal.version} is ahead of the matrix version ${matrix.version}`,
          });
        }
      }
    });
}

/** The capabilities a cohort must give an explicit number for. */
export function explicitValueCapabilityIds(catalog: CatalogLike = CAPABILITIES): string[] {
  return idsOf(catalog).filter((id) => {
    const kind = catalog[id].shape.kind;
    return kind === 'quantity' || kind === 'metered' || kind === 'fair_use';
  });
}

/** Cohort configuration (trial, champion). */
export function cohortsSchema(tierOrder: readonly string[], catalog: CatalogLike = CAPABILITIES): z.ZodTypeAny {
  const explicit = explicitValueCapabilityIds(catalog);

  const valuesShape: Record<string, z.ZodTypeAny> = {};
  for (const id of explicit) {
    valuesShape[id] = valueSchemaFor(catalog[id].shape);
  }

  const base = z.union([
    z.object({ tier: z.string() }).strict(),
    z.object({ all: z.literal(true) }).strict(),
  ]);

  const cohort = z
    .object({
      base,
      includeLifecycle: z.array(z.enum(['available', 'beta', 'not_built'])),
      // `.strict()` both ways: every explicit-value capability must be present
      // (so adding a metered capability fails until champions get a number), and
      // nothing else may appear here.
      values: z.object(valuesShape).strict(),
      graceHistory: historySchema,
      durationHistory: historySchema.optional(),
      clockStartsAt: z.enum(['first_onboarding_message', 'profile_created']).optional(),
    })
    .strict()
    .superRefine((cohortConfig, ctx) => {
      const cohortBase = cohortConfig.base as { tier?: string };
      if (cohortBase.tier !== undefined && !tierOrder.includes(cohortBase.tier)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `base tier "${cohortBase.tier}" is not a configured tier`,
        });
      }

      // `not_built` means the feature does not exist. A cohort cannot include
      // what has not been written (FR-13).
      if ((cohortConfig.includeLifecycle as string[]).includes('not_built')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'includeLifecycle may not contain "not_built": a cohort cannot grant a feature that does not exist',
        });
      }

      // The same rule on the numeric side. `{ all: true }` derives booleans and
      // variants and skips `not_built` by construction — but the quantities and
      // allowances are written by hand here, so a champion could be handed 500
      // SMS messages that nothing can send. Zero is the only legal value for a
      // capability that does not exist.
      addNotBuiltGrantIssues(
        cohortConfig.values as Record<string, unknown>,
        catalog,
        'the cohort',
        ctx
      );
    });

  return z
    .object({ trial: cohort, champion: cohort })
    .strict()
    .superRefine((cohorts, ctx) => {
      const trial = cohorts.trial as { durationHistory?: unknown };
      if (trial.durationHistory === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'the trial needs a durationHistory: without one there is nothing to end it',
        });
      }
    });
}

const overlayOutcome = z.enum(['allow', 'allow_with_warning', 'read_only', 'paused_public', 'suppress']);

const SURFACE_KINDS = [
  'owner_read',
  'owner_write',
  'owner_ai',
  'public_business',
  'public_self_service',
  'send:transactional:client',
  'send:transactional:system',
  'send:marketing',
] as const;

const LIFECYCLE_STATES = ['trial', 'champion', 'active', 'past_due', 'grace', 'paused', 'unknown'] as const;

/** Lifecycle overlay, send registry seed and per-send overrides. */
export function lifecycleSchema(catalog: CatalogLike = CAPABILITIES): z.ZodTypeAny {
  const surfaceRow = z.object(
    Object.fromEntries(SURFACE_KINDS.map((kind) => [kind, overlayOutcome]))
  ).strict();

  const send = z
    .object({
      id: z.string().min(1),
      labels: z.object({ en: z.string().min(1), he: z.string().min(1), es: z.string().min(1) }).strict(),
      messageClass: z.enum(['transactional', 'marketing']),
      initiator: z.enum(['client', 'system']),
      capability: capabilityIdSchema(catalog).optional(),
      note: z.string().optional(),
    })
    .strict();

  return z
    .object({
      subscriptionGraceHistory: historySchema,
      // Every state × every surface kind. A missing cell would mean "what
      // happens here?" has no answer at the moment someone is paused.
      overlay: z.object(Object.fromEntries(LIFECYCLE_STATES.map((state) => [state, surfaceRow]))).strict(),
      sends: z.record(z.string(), send),
      sendPolicyOverrides: z.record(z.string(), z.record(z.enum(LIFECYCLE_STATES), overlayOutcome)),
    })
    .strict()
    .superRefine((config, ctx) => {
      const sends = config.sends as Record<string, { id: string }>;
      for (const [key, definition] of Object.entries(sends)) {
        if (definition.id !== key) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `send "${key}" declares a different id ("${definition.id}")` });
        }
      }
      // An override for a send nobody declared would look like a policy and do
      // nothing.
      for (const sendId of Object.keys(config.sendPolicyOverrides as Record<string, unknown>)) {
        if (!(sendId in sends)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `sendPolicyOverrides names unknown send "${sendId}"` });
        }
      }
    });
}

/** The chat mapping: entity domains, action overrides and the read rule. */
export function chatActionMapSchema(catalog: CatalogLike = CAPABILITIES): z.ZodTypeAny {
  const mapping = z.union([capabilityIdSchema(catalog), z.object({ ungated: z.string().min(3) }).strict()]);

  return z
    .object({
      entityDomain: z.record(z.string(), mapping),
      actionOverrides: z.record(z.string(), mapping),
      readRule: z.enum(['domain_group', 'read_only_plans_need_search']),
      planOps: z.record(z.string(), capabilityIdSchema(catalog)),
    })
    .strict()
    .superRefine((map, ctx) => {
      // An override key is `entity.action`; one without a dot would never match
      // a real operation and would silently do nothing.
      for (const key of Object.keys(map.actionOverrides as Record<string, unknown>)) {
        if (!key.includes('.')) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action override "${key}" is not of the form entity.action` });
        }
      }
    });
}

export function launchSchema(): z.ZodTypeAny {
  return z.object({ enforceRequiresConfiguredTier: z.boolean() }).strict();
}

/** The catalog itself: the one schema not derived from the catalog. */
export function catalogSchema(): z.ZodTypeAny {
  const labels = z.object({ en: z.string().min(1), he: z.string().min(1), es: z.string().min(1) }).strict();

  const shape = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('boolean') }).strict(),
    z
      .object({
        kind: z.literal('variant'),
        variants: z.array(z.string().min(1)).min(2, 'a variant capability needs at least two options'),
      })
      .strict(),
    z.object({ kind: z.literal('metered'), unit: z.enum(['ai_action', 'sms']), period: z.literal('month') }).strict(),
    z.object({ kind: z.literal('quantity'), unit: z.enum(['seat', 'location']) }).strict(),
    z.object({ kind: z.literal('fair_use'), unit: z.literal('email'), period: z.literal('month') }).strict(),
    z.object({ kind: z.literal('group') }).strict(),
    z.object({ kind: z.literal('addon') }).strict(),
  ]);

  const entry = z
    .object({
      labels,
      category: z.enum([
        'crm',
        'website_intake',
        'payments',
        'ai_chat',
        'marketing',
        'insights',
        'support',
        'platform',
        'addon',
      ]),
      shape,
      lifecycle: z.enum(['available', 'beta', 'not_built']),
      audience: z.enum(['owner', 'client', 'client_render', 'mixed']),
      messageClass: z.enum(['transactional', 'marketing']).optional(),
      atLimit: z.enum(['none', 'degrade_to_template', 'pause', 'block', 'alert_only', 'by_call_site_audience']),
      sellableAsAddon: z.boolean(),
      placeholder: z.literal('B-1').optional(),
      note: z.string().optional(),
    })
    .strict()
    .superRefine((capability, ctx) => {
      // S-1 / FR-39: an automated client SEND must declare what class it is,
      // because that is what decides whether it survives grace and pause.
      if (capability.audience === 'client' && capability.messageClass === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'a client-facing send must declare a messageClass (transactional | marketing)',
        });
      }
      // …and anything that is not a send must not pretend to be one. Branding is
      // visible to clients but is a render policy, not a message.
      if (capability.audience !== 'client' && capability.messageClass !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `audience "${capability.audience}" must not declare a messageClass`,
        });
      }
      if (capability.shape.kind === 'variant') {
        const variants = capability.shape.variants as string[];
        if (new Set(variants).size !== variants.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'variant options must be unique' });
        }
      }
    });

  return z.record(z.string().min(1), entry);
}
