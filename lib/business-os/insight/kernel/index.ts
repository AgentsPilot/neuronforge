/**
 * Kernel Integration Module
 *
 * Exports kernel trigger and process registry.
 */

export { KernelTrigger } from './KernelTrigger';
export type { KernelTriggerRequest, KernelTriggerResult, GuardrailCheckResult } from './KernelTrigger';

export {
  TRIGGERABLE_PROCESSES,
  DETECTOR_TO_PROCESS,
  getProcessForDetector,
  getAllProcesses,
  getAutomatableProcesses,
} from './TriggerableProcesses';
export type { TriggerableProcess } from './TriggerableProcesses';
