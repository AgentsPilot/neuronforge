/**
 * Schema reconciliation core (Phase 0).
 *
 * The single, deterministic, plugin-agnostic comparator + name-normaliser +
 * reconciler that all four field-fidelity call sites share (requirement
 * §Cross-Cutting Constraints #5): generation (Phase 3), compiler (Phase 3),
 * calibration detection (Phase 1 — Item 5b / cal-side Item 3), and calibration
 * correction (Phase 1 — Item 7).
 *
 * No call sites are wired inside this module; it is pure logic + types.
 */

export {
  normalizeFieldName,
  isSameFieldDifferentSpelling,
} from './field-name-normalizer';

export {
  indexProducerFields,
  indexProducerFieldNames,
  type ProducerFieldIndex,
} from './schema-field-extractor';

export {
  reconcileFields,
  reconcileFieldNames,
  reconcileAgainstIndex,
  type ReconciliationAction,
  type FieldReconciliation,
  type FieldRename,
  type ReconciliationResult,
} from './reconciler';
