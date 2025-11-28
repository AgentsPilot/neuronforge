import pino from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

export const loggerConfig: pino.LoggerOptions = {
  level: logLevel,

  // Note: We don't use pino-pretty transport in Next.js API routes because
  // worker threads don't work reliably in serverless environments.
  // Instead, we output JSON logs which can be:
  // 1. Read directly (they're fairly readable)
  // 2. Piped through pino-pretty externally: npm run dev | pino-pretty
  // 3. Sent to log aggregation services in production

  // Base configuration
  base: {
    env: process.env.NODE_ENV,
  },

  // Timestamp
  timestamp: pino.stdTimeFunctions.isoTime,

  // Serializers for common objects
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  // Redact sensitive fields
  redact: {
    paths: [
      'password',
      'token',
      'apiKey',
      'api_key',
      'authorization',
      'cookie',
      'accessToken',
      'refreshToken',
      'secret',
      '*.password',
      '*.token',
      '*.apiKey',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
};
