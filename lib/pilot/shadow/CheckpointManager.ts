// TODO: Implement checkpoint manager
export class CheckpointManager {
  private readonly executionId: string | null;

  constructor(executionId?: string) {
    this.executionId = executionId ?? null;
  }

  async createCheckpoint(workflowId: string, stepId: string, data: any): Promise<void> {
    // Stub implementation
  }

  async restoreCheckpoint(workflowId: string, stepId: string): Promise<any> {
    // Stub implementation
    return null;
  }

  async listCheckpoints(workflowId: string): Promise<any[]> {
    // Stub implementation
    return [];
  }

  createStepCheckpoint(_context: any, _stepId: string): void {
    // Stub implementation — checkpoint storage is for resume flows; no-op is safe
    // when resume is not required (Phase D/E validation).
  }

  createBatchCheckpoint(_context: any, _batchStepIds: string[]): void {
    // Stub implementation — see createStepCheckpoint.
  }

  clear(): void {
    // Stub implementation — in-memory checkpoint cache is empty, nothing to clear.
  }
}
