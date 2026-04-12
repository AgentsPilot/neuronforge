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

  async setStepOutput(_executionId: string, stepId: string, value: any, _meta?: any): Promise<void> {
    this.cache.set(stepId, value);
  }
}

export const executionOutputCache = new ExecutionOutputCache();
