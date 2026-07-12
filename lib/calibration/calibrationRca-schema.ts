// lib/calibration/calibrationRca-schema.ts
// Zod schema for the automated calibration RCA object (FR-15).
//
// The shape mirrors the Troubleshooter (TS) conclusion so the auto-generated
// RCA is routable by the TL identically to a hand-written TS conclusion:
//   - 8 fields (symptom, evidence, earliest failing step, root-cause layer,
//     root cause, fix-owner, suggested solutions, remediation path)
//   - root-cause layer constrained to exactly the 5 TS values.
//
// This is the boundary contract for the LLM output: the service validates the
// model's JSON against `CalibrationAutoRcaSchema` before it is ever persisted
// or rendered into the admin email. If validation fails the service returns a
// typed "no RCA" result and the caller falls back to deterministic-only.

import { z } from 'zod';

/**
 * The 5 Troubleshooter root-cause layers (Q5 / FR-15). Kept identical to the TS
 * set so a calibration-scoped RCA routes exactly like a TS conclusion — a
 * calibration failure will almost always land in one of the first four, with
 * `creation chat flow` available when the earliest cause traces to creation.
 */
export const ROOT_CAUSE_LAYERS = [
  'input/data',
  'V6 generation',
  'runtime/external API',
  'calibration-detection',
  'creation chat flow',
] as const;

export type RootCauseLayer = (typeof ROOT_CAUSE_LAYERS)[number];

/**
 * The recommended remediation path — a hotfix (SA→Dev) vs a full cycle (BA→…).
 * Kept as a small enum so the TL can route without parsing free text.
 */
export const REMEDIATION_PATHS = ['hotfix', 'full cycle'] as const;
export type RemediationPath = (typeof REMEDIATION_PATHS)[number];

export const CalibrationAutoRcaSchema = z
  .object({
    /** (1) The reported symptom — what the calibration run surfaced. */
    symptom: z.string().min(1),
    /** (2) Evidence gathered (calibration outcome + workflow definition). */
    evidence: z.string().min(1),
    /** (3) Earliest failing step + how the failure cascaded downstream. */
    earliestFailingStep: z.string().min(1),
    /** (4) Classified root-cause layer — exactly one of the 5 TS values. */
    rootCauseLayer: z.enum(ROOT_CAUSE_LAYERS),
    /** (5) Defensible root cause (the "why", with references to the evidence). */
    rootCause: z.string().min(1),
    /** (6) Named fix-owner (e.g. v6-pipeline, calibration, plugin executor, input/data). */
    fixOwner: z.string().min(1),
    /** (7) One or more suggested solutions. */
    suggestedSolutions: z.array(z.string().min(1)).min(1),
    /** (8) Recommended remediation path — hotfix vs full cycle. */
    remediationPath: z.enum(REMEDIATION_PATHS),
  })
  // Reject unknown keys so a malformed/hallucinated payload can't smuggle extra
  // content past the boundary into persistence or the email.
  .strict();

export type CalibrationAutoRca = z.infer<typeof CalibrationAutoRcaSchema>;
