import { Redis } from 'ioredis';

let redis: Redis | null = null;
let workerRedis: Redis | null = null;

// Redis connection configuration
const redisConfig = {
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  enableReadyCheck: true,
  enableOfflineQueue: true,
  lazyConnect: false,
  keepAlive: 30000,
  family: 4, // Force IPv4
  connectTimeout: 10000,
  commandTimeout: 5000,
  reconnectOnError: (err: Error) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    return targetErrors.some(target => err.message.includes(target));
  },
};

export function getRedisConnection(): Redis {
  if (!redis || redis.status === 'end') {
    redis = new Redis(process.env.REDIS_URL!, redisConfig);

    redis.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('✅ Redis connected');
    });

    redis.on('ready', () => {
      console.log('✅ Redis ready');
    });
  }
  return redis;
}

// Separate connection for BullMQ workers with longer timeouts
export function getWorkerRedisConnection(): Redis {
  if (!workerRedis || workerRedis.status === 'end') {
    workerRedis = new Redis(process.env.REDIS_URL!, {
      ...redisConfig,
      commandTimeout: 30000, // 30 seconds for long-running commands
    });

    workerRedis.on('error', (err) => {
      console.error('Worker Redis connection error:', err.message);
    });

    workerRedis.on('connect', () => {
      console.log('✅ Worker Redis connected');
    });

    workerRedis.on('ready', () => {
      console.log('✅ Worker Redis ready');
    });
  }
  return workerRedis;
}

// Cleanup function to close all connections
export async function closeRedisConnections() {
  const promises: Promise<void>[] = [];

  if (redis) {
    promises.push(
      redis.quit()
        .then(() => {})
        .catch((err) => console.error('Error closing Redis:', err))
    );
    redis = null;
  }

  if (workerRedis) {
    promises.push(
      workerRedis.quit()
        .then(() => {})
        .catch((err) => console.error('Error closing Worker Redis:', err))
    );
    workerRedis = null;
  }

  await Promise.all(promises);
  console.log('✅ All Redis connections closed');
}