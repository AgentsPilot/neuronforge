import { Redis } from 'ioredis';

let redis: Redis | null = null;
let workerRedis: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      retryDelayOnFailover: 100,
    });
  }
  return redis;
}

// Separate connection for BullMQ workers
export function getWorkerRedisConnection(): Redis {
  if (!workerRedis) {
    workerRedis = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // Required for BullMQ workers
      commandTimeout: 120000, // 2 minutes
      connectTimeout: 10000,  // 10 seconds
      retryDelayOnFailover: 100,
    });
  }
  return workerRedis;
}