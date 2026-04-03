// lib/utils/request-deduplication.ts
// Simple request deduplication utility to prevent duplicate API calls

type CacheEntry<T> = {
  promise: Promise<T>;
  timestamp: number;
  expiresAt: number;
};

class RequestDeduplicator {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly DEFAULT_TTL = 1000; // 1 second cache
  private debug = process.env.NODE_ENV === 'development';

  /**
   * Deduplicate requests by caching in-flight promises
   * Multiple simultaneous calls with the same key will return the same promise
   * @param key - Unique cache key for the request
   * @param fetcher - Function that performs the actual request
   * @param ttl - Time-to-live in milliseconds (default: 1000ms)
   */
  async deduplicate<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = this.DEFAULT_TTL
  ): Promise<T> {
    const now = Date.now();

    // Check if we have a valid cached entry
    const cached = this.cache.get(key);
    if (cached && now < cached.expiresAt) {
      if (this.debug) {
        console.log(`[Dedup] Cache HIT for key: ${key} (${Math.round(cached.expiresAt - now)}ms remaining)`);
      }
      return cached.promise; // Return same promise (deduplicates concurrent requests)
    }

    if (this.debug) {
      console.log(`[Dedup] Cache MISS for key: ${key}, creating new request`);
    }

    // Create new promise and cache it
    const promise = fetcher().finally(() => {
      // Auto-clean cache after TTL
      setTimeout(() => {
        this.cache.delete(key);
        if (this.debug) {
          console.log(`[Dedup] Cache expired for key: ${key}`);
        }
      }, ttl);
    });

    this.cache.set(key, {
      promise,
      timestamp: now,
      expiresAt: now + ttl,
    });

    return promise;
  }

  /**
   * Clear cache for a specific key or all keys
   * @param key - Optional specific key to clear, or undefined to clear all
   */
  clear(key?: string) {
    if (key) {
      this.cache.delete(key);
      if (this.debug) {
        console.log(`[Dedup] Manually cleared cache for key: ${key}`);
      }
    } else {
      this.cache.clear();
      if (this.debug) {
        console.log(`[Dedup] Manually cleared all cache`);
      }
    }
  }

  /**
   * Get cache statistics (for debugging)
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Export singleton instance
export const requestDeduplicator = new RequestDeduplicator();
