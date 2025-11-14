/**
 * StepCache - In-memory cache for step execution results
 *
 * Provides caching to avoid re-executing identical steps
 * Uses LRU eviction strategy with configurable size and TTL
 */

import type { StepOutput } from './types';

interface CacheEntry {
  output: StepOutput;
  cachedAt: number;
  accessCount: number;
  lastAccessed: number;
}

export class StepCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private ttlMs: number;
  private enabled: boolean;

  constructor(enabled: boolean = false, maxSize: number = 100, ttlMs: number = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.enabled = enabled;
  }

  /**
   * Generate cache key from step definition and input
   */
  private generateKey(stepId: string, stepType: string, params: any): string {
    // Create deterministic key from step definition
    const paramString = JSON.stringify(params, Object.keys(params).sort());
    return `${stepType}:${stepId}:${this.hashString(paramString)}`;
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.cachedAt > this.ttlMs;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (this.cache.size === 0) return;

    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log(`[StepCache] Evicted LRU entry: ${oldestKey}`);
    }
  }

  /**
   * Get cached result
   */
  get(stepId: string, stepType: string, params: any): StepOutput | null {
    if (!this.enabled) {
      return null;
    }

    const key = this.generateKey(stepId, stepType, params);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      console.log(`[StepCache] Expired cache entry for ${stepId}`);
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    console.log(`[StepCache] Cache HIT for ${stepId} (accessed ${entry.accessCount} times)`);
    return entry.output;
  }

  /**
   * Store result in cache
   */
  set(stepId: string, stepType: string, params: any, output: StepOutput): void {
    if (!this.enabled) {
      return;
    }

    const key = this.generateKey(stepId, stepType, params);

    // Evict if cache is full
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const entry: CacheEntry = {
      output,
      cachedAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    this.cache.set(key, entry);
    console.log(`[StepCache] Cached result for ${stepId} (cache size: ${this.cache.size}/${this.maxSize})`);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    console.log('[StepCache] Cache cleared');
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.cachedAt > this.ttlMs) {
        this.cache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      console.log(`[StepCache] Cleared ${expiredCount} expired entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    enabled: boolean;
    hitRate: number;
  } {
    let totalAccesses = 0;
    for (const entry of this.cache.values()) {
      totalAccesses += entry.accessCount;
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      enabled: this.enabled,
      hitRate: totalAccesses > 0 ? totalAccesses / (totalAccesses + this.cache.size) : 0,
    };
  }

  /**
   * Enable/disable caching
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
    console.log(`[StepCache] Caching ${enabled ? 'enabled' : 'disabled'}`);
  }
}
