// TODO: Implement execution output cache
export class ExecutionOutputCache {
  private cache: Map<string, any> = new Map();

  set(key: string, value: any): void {
    this.cache.set(key, value);
  }

  get(key: string): any {
    return this.cache.get(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  /**
   * Cache step output for resume flow
   * @param executionId - Execution ID
   * @param stepId - Step ID
   * @param output - Step output data
   * @param metadata - Optional metadata (plugin, action, success, etc.)
   */
  async setStepOutput(
    executionId: string,
    stepId: string,
    output: any,
    metadata?: Record<string, any>
  ): Promise<void> {
    const cacheKey = `${executionId}:${stepId}`;
    this.cache.set(cacheKey, {
      output,
      metadata,
      cachedAt: new Date().toISOString()
    });
  }

  /**
   * Get cached step output
   * @param executionId - Execution ID
   * @param stepId - Step ID
   */
  getStepOutput(executionId: string, stepId: string): any {
    const cacheKey = `${executionId}:${stepId}`;
    return this.cache.get(cacheKey);
  }

  /**
   * Clear all cached outputs for a specific execution
   * @param executionId - Execution ID
   */
  async clearExecution(executionId: string): Promise<void> {
    // Find and delete all cache keys for this execution
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${executionId}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
}

// Export singleton instance
export const executionOutputCache = new ExecutionOutputCache();
