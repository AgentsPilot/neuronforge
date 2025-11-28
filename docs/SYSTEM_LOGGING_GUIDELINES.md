# System Logging Guidelines

## Table of Contents
- [Overview](#overview)
- [Logging Philosophy](#logging-philosophy)
- [Installation](#installation)
- [Project Setup](#project-setup)
- [Logger Configuration](#logger-configuration)
- [Server-Side Logging](#server-side-logging)
- [Client-Side Logging](#client-side-logging)
- [Log Levels](#log-levels)
- [Structured Logging Patterns](#structured-logging-patterns)
- [Correlation IDs](#correlation-ids)
- [Performance Metrics](#performance-metrics)
- [Sensitive Data Redaction](#sensitive-data-redaction)
- [Integration with AuditTrailService](#integration-with-audittrailservice)
- [Migration Guide](#migration-guide)
- [Best Practices](#best-practices)

---

## Overview

This document defines the structured logging standards for the NeuronForge application. We use **Pino** for operational logging alongside our existing **AuditTrailService** for compliance and audit requirements.

### Why Pino?
- ⚡ **Performance**: 3x faster than Winston, minimal overhead for Vercel serverless
- 🎨 **Developer Experience**: Beautiful readable logs in development via `pino-pretty`
- 📊 **Production Ready**: JSON output for log aggregation and monitoring
- 🔧 **TypeScript Native**: Excellent type definitions
- 🌐 **Vercel Optimized**: Stateless, fast cold starts

### Dual Logging Strategy

| Use Case | Tool | Purpose | Storage |
|----------|------|---------|---------|
| **Operational Logs** | Pino | Debugging, monitoring, performance tracking | stdout/stderr → Vercel logs |
| **Audit/Compliance** | AuditTrailService | GDPR compliance, change tracking, security events | Supabase database |

---

## Installation

```bash
npm install pino pino-pretty
```

### Dependencies
- `pino` - Core logging library
- `pino-pretty` - Optional: For pretty-printing logs externally

### Important Note: Next.js & Pino-Pretty

**Pino-pretty cannot be used as a transport in Next.js API routes** because it uses worker threads, which don't work reliably in serverless environments. Instead, we pipe the output through pino-pretty externally.

**Our Solution: NPM Scripts**

We've created npm scripts for different logging needs:

```json
{
  "scripts": {
    "dev:pretty:terminal": "next dev -p 3000 2>&1 | npx pino-pretty",
    "dev:pretty:file": "next dev -p 3000 2>&1 | npx pino-pretty --no-color --singleLine > dev.log",
    "dev:pretty": "next dev -p 3000 2>&1 | npx pino-pretty --no-color --singleLine > dev.log",
    "dev:log": "next dev -p 3000 > dev.log 2>&1"
  }
}
```

**Usage:**

| Command | Output | Format | Use When |
|---------|--------|--------|----------|
| `npm run dev:pretty:terminal` | Terminal | Colorized pretty logs | Watching logs in real-time during development |
| `npm run dev:pretty:file` | dev.log file | Single-line plain text | Saving logs for later review/searching |
| `npm run dev:pretty` | dev.log file | Single-line plain text | Default (same as :file) |
| `npm run dev:log` | dev.log file | Raw JSON | Need JSON for log aggregation tools |

**Windows Compatibility Note:**
- The `tee` command for duplicating output doesn't work in Windows Command Prompt
- Use separate scripts for terminal vs. file output instead
- Or run in Git Bash/WSL if you need both simultaneously

**Pino-Pretty Options:**
- `--no-color`: Removes ANSI color codes (essential for file output)
- `--singleLine`: Compact format with all fields on one line
- Default (no flags): Multi-line pretty format with colors

**Production:**
Use Vercel logs, Datadog, Grafana, or other log aggregation tools to view JSON logs.

---

## Project Setup

### 1. Create Logger Configuration

**File: `lib/logger/config.ts`**

```typescript
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
```

### 2. Create Base Logger

**File: `lib/logger/index.ts`**

```typescript
import pino from 'pino';
import { loggerConfig } from './config';

// Create base logger
export const logger = pino(loggerConfig);

// Create child logger with context
export function createLogger(context: {
  module?: string;
  service?: string;
  [key: string]: any;
}) {
  return logger.child(context);
}

// Export types
export type Logger = pino.Logger;
```

### 3. Create Client-Side Logger

**File: `lib/logger/client.ts`**

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: any;
}

class ClientLogger {
  private context: LogContext = {};
  private isDevelopment = process.env.NODE_ENV === 'development';

  setContext(context: LogContext) {
    this.context = { ...this.context, ...context };
  }

  clearContext() {
    this.context = {};
  }

  private log(level: LogLevel, message: string, data?: LogContext) {
    const logData = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...data,
    };

    // In development, use console with pretty formatting
    if (this.isDevelopment) {
      const emoji = {
        debug: '🔍',
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌',
      }[level];

      console[level === 'debug' ? 'log' : level](
        `${emoji} [${new Date().toLocaleTimeString()}] ${message}`,
        data || ''
      );
    } else {
      // In production, log JSON for aggregation
      console.log(JSON.stringify(logData));
    }

    // TODO: Send to external logging service if configured
    // this.sendToExternalService(logData);
  }

  debug(message: string, data?: LogContext) {
    this.log('debug', message, data);
  }

  info(message: string, data?: LogContext) {
    this.log('info', message, data);
  }

  warn(message: string, data?: LogContext) {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | LogContext, data?: LogContext) {
    const errorData: LogContext = {};

    if (error instanceof Error) {
      errorData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
      if (data) Object.assign(errorData, data);
    } else if (error) {
      Object.assign(errorData, error);
    }

    this.log('error', message, errorData);
  }
}

export const clientLogger = new ClientLogger();
```

---

## Logger Configuration

### Environment Variables

Add to `.env.local`:

```bash
# Log level: trace, debug, info, warn, error, fatal
LOG_LEVEL=debug

# Node environment
NODE_ENV=development
```

---

## Server-Side Logging

### Basic Usage

```typescript
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'AuthService' });

// Simple log
logger.info('User authentication started');

// Log with context
logger.info({ userId: '123', email: 'user@example.com' }, 'User authenticated successfully');

// Log errors
try {
  await authenticateUser(credentials);
} catch (error) {
  logger.error({ err: error, userId: credentials.userId }, 'Authentication failed');
  throw error;
}
```

### API Route Logging

```typescript
// app/api/auth/login/route.ts
import { createLogger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

const logger = createLogger({ module: 'API', route: '/api/auth/login' });

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();

  const requestLogger = logger.child({ correlationId });

  requestLogger.info('Login request received');

  try {
    const body = await request.json();
    requestLogger.debug({ email: body.email }, 'Parsing login credentials');

    const user = await authenticateUser(body);

    const duration = Date.now() - startTime;
    requestLogger.info(
      { userId: user.id, duration },
      'Login successful'
    );

    return NextResponse.json({ success: true, user });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error(
      { err: error, duration },
      'Login failed'
    );

    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 }
    );
  }
}
```

### Service Class Logging

```typescript
// lib/services/ExampleService.ts
import { createLogger, Logger } from '@/lib/logger';

export class ExampleService {
  private logger: Logger;

  constructor() {
    this.logger = createLogger({ service: 'ExampleService' });
  }

  async processData(userId: string, data: any) {
    const methodLogger = this.logger.child({ method: 'processData', userId });

    methodLogger.info('Starting data processing');

    try {
      const result = await this.heavyComputation(data);

      methodLogger.info(
        { resultSize: result.length },
        'Data processing completed'
      );

      return result;
    } catch (error) {
      methodLogger.error({ err: error }, 'Data processing failed');
      throw error;
    }
  }

  private async heavyComputation(data: any) {
    const startTime = Date.now();

    // ... computation logic ...

    const duration = Date.now() - startTime;
    this.logger.debug({ duration }, 'Heavy computation completed');

    return result;
  }
}
```

---

## Client-Side Logging

### Basic Usage

```typescript
import { clientLogger } from '@/lib/logger/client';

// Simple logs
clientLogger.info('Component mounted');
clientLogger.warn('Deprecated API usage detected');

// Logs with context
clientLogger.info('User action', { action: 'button-click', componentId: 'submit-btn' });

// Error logging
try {
  await fetchData();
} catch (error) {
  clientLogger.error('Failed to fetch data', error, { endpoint: '/api/data' });
}
```

### React Component Logging

```typescript
'use client';

import { useEffect } from 'react';
import { clientLogger } from '@/lib/logger/client';

export function UserDashboard({ userId }: { userId: string }) {
  useEffect(() => {
    // Set context for all logs in this component
    clientLogger.setContext({ component: 'UserDashboard', userId });

    clientLogger.info('Dashboard mounted');

    return () => {
      clientLogger.info('Dashboard unmounted');
      clientLogger.clearContext();
    };
  }, [userId]);

  const handleAction = async () => {
    const startTime = Date.now();
    clientLogger.debug('Action started', { action: 'export-data' });

    try {
      await exportUserData(userId);

      const duration = Date.now() - startTime;
      clientLogger.info('Action completed', { action: 'export-data', duration });
    } catch (error) {
      clientLogger.error('Action failed', error, { action: 'export-data' });
    }
  };

  return <div>...</div>;
}
```

### Custom Hook Logging

```typescript
// hooks/useDataFetcher.ts
import { clientLogger } from '@/lib/logger/client';

export function useDataFetcher(endpoint: string) {
  const logger = useMemo(() => {
    const log = { ...clientLogger };
    log.setContext({ hook: 'useDataFetcher', endpoint });
    return log;
  }, [endpoint]);

  const fetchData = useCallback(async () => {
    logger.debug('Fetching data');

    try {
      const response = await fetch(endpoint);
      logger.info('Data fetched successfully', { status: response.status });
      return response.json();
    } catch (error) {
      logger.error('Data fetch failed', error);
      throw error;
    }
  }, [endpoint, logger]);

  return { fetchData };
}
```

---

## Log Levels

### Numeric Log Levels

Pino uses **numeric log levels** based on the syslog severity standard. These numbers appear in JSON logs and allow efficient filtering and comparison.

| Level Number | Level Name | Method | When to Use | Example |
|--------------|-----------|--------|-------------|---------|
| **10** | `trace` | `logger.trace()` | Very detailed debugging (rarely used) | Function entry/exit, loop iterations |
| **20** | `debug` | `logger.debug()` | Detailed debugging information | Variable values, conditional branches, detailed flow |
| **30** | `info` | `logger.info()` | Normal operational messages ✅ | Request received, operation completed, state changes |
| **40** | `warn` | `logger.warn()` | Warning conditions that don't prevent operation ⚠️ | Deprecated API usage, fallback activated, retry attempts |
| **50** | `error` | `logger.error()` | Error conditions that need attention ❌ | Failed operations, caught exceptions, invalid state |
| **60** | `fatal` | `logger.fatal()` | Critical errors that crash the application 💀 | Unrecoverable errors, system failures |

### Why Numeric Levels?

1. **Performance**: Faster to compare numbers than strings in production
2. **Filtering**: Easy to filter logs (e.g., "show all logs >= 40" = warnings and errors only)
3. **Standard**: Based on syslog severity levels (industry standard)
4. **Compatibility**: Works with all log aggregation tools

### In JSON Logs

When you see this in your logs:
```json
{"level":30,"time":"2025-11-28T10:21:02.047Z","msg":"Thread creation request received"}
```

The `"level":30` means this is an **INFO** level log.

### In Pretty Logs

When using pino-pretty, the number is converted to the name:
```
[10:21:02.047] INFO: Thread creation request received    (internally: level 30)
[10:21:02.533] DEBUG: User authenticated                (internally: level 20)
[10:21:03.991] ERROR: Failed to create thread           (internally: level 50)
```

### Code Examples

```typescript
// trace (level: 10) - Very detailed (usually disabled in production)
logger.trace({ input }, 'Entering validation function');

// debug (level: 20) - Detailed debugging
logger.debug({ queryParams, filters }, 'Building database query');

// info (level: 30) - Normal operations
logger.info({ userId, credits: 100 }, 'User credits allocated');

// warn (level: 40) - Warnings
logger.warn({ userId, attemptCount: 3 }, 'Multiple failed login attempts');

// error (level: 50) - Errors
logger.error({ err: error, userId }, 'Payment processing failed');

// fatal (level: 60) - Critical failures
logger.fatal({ err: error }, 'Database connection lost');
```

### Filtering by Level

In production, you can easily filter logs by level:

```bash
# Show only warnings and errors (level >= 40)
cat logs.json | grep -E '"level":(4[0-9]|5[0-9]|6[0-9])'

# Show only errors and fatal (level >= 50)
cat logs.json | grep -E '"level":(5[0-9]|6[0-9])'

# Or use jq for cleaner filtering:
cat logs.json | jq 'select(.level >= 40)'
```

---

## Structured Logging Patterns

### Always Include Context

```typescript
// ❌ BAD: Unstructured, hard to query
logger.info('User 123 logged in from 192.168.1.1');

// ✅ GOOD: Structured, queryable
logger.info(
  { userId: '123', ipAddress: '192.168.1.1' },
  'User logged in'
);
```

### Use Consistent Field Names

```typescript
// ❌ BAD: Inconsistent naming
logger.info({ user_id: '123' }, 'Action 1');
logger.info({ userId: '123' }, 'Action 2');
logger.info({ id: '123' }, 'Action 3');

// ✅ GOOD: Consistent naming
logger.info({ userId: '123' }, 'Action 1');
logger.info({ userId: '123' }, 'Action 2');
logger.info({ userId: '123' }, 'Action 3');
```

### Standard Field Names

Use these standard field names across the codebase:

- `userId` - User identifier
- `correlationId` - Request correlation ID
- `duration` - Operation duration in milliseconds
- `method` - Class method name
- `service` - Service name
- `module` - Module/file name
- `route` - API route path
- `statusCode` - HTTP status code
- `err` - Error object (use Pino's serializer)

---

## Correlation IDs

Correlation IDs allow you to trace a request across multiple services and operations.

### Server-Side: Generate and Pass Correlation IDs

```typescript
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  // Get or generate correlation ID
  const correlationId =
    request.headers.get('x-correlation-id') ||
    crypto.randomUUID();

  // Clone response and add correlation ID to headers
  const response = NextResponse.next();
  response.headers.set('x-correlation-id', correlationId);

  return response;
}
```

### API Route with Correlation ID

```typescript
import { createLogger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const logger = createLogger({
    module: 'API',
    route: '/api/data',
    correlationId
  });

  logger.info('Request received');

  // Pass correlation ID to services
  const result = await dataService.getData({ correlationId });

  logger.info('Request completed');
  return NextResponse.json(result);
}
```

### Service with Correlation ID

```typescript
export class DataService {
  async getData(options: { correlationId: string }) {
    const logger = createLogger({
      service: 'DataService',
      correlationId: options.correlationId
    });

    logger.debug('Fetching data from database');

    // All logs will include the same correlationId
    const data = await this.fetchFromDB();

    logger.info({ recordCount: data.length }, 'Data fetched');
    return data;
  }
}
```

### Client-Side: Track User Sessions

```typescript
// lib/utils/session.ts
export function getSessionId(): string {
  if (typeof window === 'undefined') return '';

  let sessionId = sessionStorage.getItem('sessionId');

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('sessionId', sessionId);
  }

  return sessionId;
}

// Usage in component
import { clientLogger } from '@/lib/logger/client';
import { getSessionId } from '@/lib/utils/session';

export function MyComponent() {
  useEffect(() => {
    clientLogger.setContext({ sessionId: getSessionId() });
  }, []);

  // All logs will include sessionId
  clientLogger.info('User action performed');
}
```

---

## Performance Metrics

### Measure Operation Duration

```typescript
// Server-side
async function processLargeFile(fileId: string) {
  const logger = createLogger({ module: 'FileProcessor' });
  const startTime = Date.now();

  try {
    const result = await heavyOperation(fileId);

    const duration = Date.now() - startTime;
    logger.info(
      { fileId, duration, resultSize: result.length },
      'File processing completed'
    );

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      { err: error, fileId, duration },
      'File processing failed'
    );
    throw error;
  }
}
```

### Track API Response Times

```typescript
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const logger = createLogger({ route: '/api/process' });

  try {
    const result = await processRequest(request);

    const duration = Date.now() - startTime;

    // Log performance warning if slow
    if (duration > 1000) {
      logger.warn({ duration }, 'Slow request detected');
    } else {
      logger.info({ duration }, 'Request completed');
    }

    return NextResponse.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({ err: error, duration }, 'Request failed');
    throw error;
  }
}
```

### Memory Usage Tracking

```typescript
function logMemoryUsage() {
  const logger = createLogger({ module: 'MemoryMonitor' });

  const usage = process.memoryUsage();
  logger.debug({
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
    rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
  }, 'Memory usage snapshot');
}
```

---

## Sensitive Data Redaction

Sensitive data is automatically redacted based on the configuration in `lib/logger/config.ts`.

### Automatic Redaction

```typescript
// These fields are automatically redacted:
logger.info({
  userId: '123',
  password: 'secret123',      // → [REDACTED]
  apiKey: 'sk-abc123',        // → [REDACTED]
  token: 'jwt-token',         // → [REDACTED]
}, 'User data');

// Nested fields are also redacted:
logger.info({
  user: {
    email: 'user@example.com',
    password: 'secret',        // → [REDACTED]
  }
}, 'User created');
```

### Custom Redaction

```typescript
// For ad-hoc redaction, sanitize before logging
function sanitizeUserData(user: any) {
  const { password, ssn, creditCard, ...safe } = user;
  return safe;
}

logger.info(sanitizeUserData(userData), 'User data processed');
```

### Request Header Redaction

```typescript
// Authorization and Cookie headers are automatically redacted
logger.info({ req }, 'Incoming request');
// Output: { req: { headers: { authorization: '[REDACTED]', cookie: '[REDACTED]' } } }
```

---

## Integration with AuditTrailService

**Important**: Use both logging systems for their specific purposes:

- **Pino**: Operational logs (debugging, monitoring, performance)
- **AuditTrailService**: Compliance logs (user actions, data changes, security events)

### When to Use Each

```typescript
import { createLogger } from '@/lib/logger';
import { auditLog, AUDIT_EVENTS } from '@/lib/audit';

const logger = createLogger({ service: 'UserService' });

async function updateUserRole(userId: string, newRole: string, adminId: string) {
  // OPERATIONAL LOG: Track the operation
  logger.info({ userId, newRole, adminId }, 'Updating user role');

  const before = await getUserRole(userId);

  try {
    await updateRole(userId, newRole);

    // OPERATIONAL LOG: Track success
    logger.info({ userId, newRole, oldRole: before }, 'User role updated successfully');

    // AUDIT LOG: Compliance record (required for GDPR, security audits)
    await auditLog({
      userId: adminId,
      action: AUDIT_EVENTS.USER_ROLE_CHANGED,
      entityType: 'user',
      entityId: userId,
      changes: { before, after: newRole },
      severity: 'warning',
    });

  } catch (error) {
    // OPERATIONAL LOG: Track error
    logger.error({ err: error, userId, newRole }, 'Failed to update user role');

    // AUDIT LOG: Track failed security event
    await auditLog({
      userId: adminId,
      action: AUDIT_EVENTS.USER_ROLE_CHANGE_FAILED,
      entityType: 'user',
      entityId: userId,
      severity: 'error',
      metadata: { error: error.message },
    });

    throw error;
  }
}
```

### Decision Matrix

| Scenario | Pino | AuditTrail |
|----------|------|------------|
| User logged in | ✅ | ✅ |
| API request received | ✅ | ❌ |
| Database query executed | ✅ | ❌ |
| User role changed | ✅ | ✅ |
| Data exported (GDPR) | ✅ | ✅ |
| Configuration changed | ✅ | ✅ |
| Error occurred | ✅ | Only if security-related |
| Performance metric | ✅ | ❌ |
| Payment processed | ✅ | ✅ |

---

## Migration Guide

### Step 1: Install Dependencies

```bash
npm install pino pino-pretty
```

### Step 2: Create Logger Files

Create the files described in [Project Setup](#project-setup):
1. `lib/logger/config.ts`
2. `lib/logger/index.ts`
3. `lib/logger/client.ts`

### Step 3: Migrate Console Logs

#### Before (Unstructured Console Logging)

```typescript
// ❌ OLD: Unstructured console logs
console.log('✅ User authenticated:', userId);
console.error('❌ Authentication failed:', error);
console.log('🔍 Fetching data for user:', userId, 'with filters:', filters);
```

#### After (Structured Pino Logging)

```typescript
// ✅ NEW: Structured Pino logs
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'AuthService' });

logger.info({ userId }, 'User authenticated');
logger.error({ err: error }, 'Authentication failed');
logger.debug({ userId, filters }, 'Fetching data');
```

### Step 4: Migrate Service Classes

#### Before

```typescript
export class PluginService {
  async executePlugin(pluginId: string, params: any) {
    console.log('🔌 Executing plugin:', pluginId);

    try {
      const result = await this.run(pluginId, params);
      console.log('✅ Plugin executed successfully:', pluginId);
      return result;
    } catch (error) {
      console.error('❌ Plugin execution failed:', error);
      throw error;
    }
  }
}
```

#### After

```typescript
import { createLogger, Logger } from '@/lib/logger';

export class PluginService {
  private logger: Logger;

  constructor() {
    this.logger = createLogger({ service: 'PluginService' });
  }

  async executePlugin(pluginId: string, params: any) {
    const methodLogger = this.logger.child({ method: 'executePlugin', pluginId });

    methodLogger.info('Executing plugin');

    try {
      const startTime = Date.now();
      const result = await this.run(pluginId, params);

      const duration = Date.now() - startTime;
      methodLogger.info({ duration }, 'Plugin executed successfully');

      return result;
    } catch (error) {
      methodLogger.error({ err: error }, 'Plugin execution failed');
      throw error;
    }
  }
}
```

### Step 5: Migrate API Routes

#### Before

```typescript
export async function POST(request: NextRequest) {
  console.log('📥 Request received');

  try {
    const body = await request.json();
    const result = await processData(body);
    console.log('✅ Request processed');
    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ Request failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

#### After

```typescript
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', route: '/api/process' });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const startTime = Date.now();

  requestLogger.info('Request received');

  try {
    const body = await request.json();
    const result = await processData(body);

    const duration = Date.now() - startTime;
    requestLogger.info({ duration }, 'Request processed');

    return NextResponse.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Request failed');

    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

### Step 6: Migrate Client Components

#### Before

```typescript
export function Dashboard() {
  const handleClick = async () => {
    console.log('🖱️ Button clicked');
    try {
      await fetchData();
      console.log('✅ Data fetched');
    } catch (error) {
      console.error('❌ Failed to fetch:', error);
    }
  };

  return <button onClick={handleClick}>Fetch</button>;
}
```

#### After

```typescript
import { clientLogger } from '@/lib/logger/client';

export function Dashboard() {
  useEffect(() => {
    clientLogger.setContext({ component: 'Dashboard' });
    return () => clientLogger.clearContext();
  }, []);

  const handleClick = async () => {
    const startTime = Date.now();
    clientLogger.debug('Button clicked', { action: 'fetch-data' });

    try {
      await fetchData();

      const duration = Date.now() - startTime;
      clientLogger.info('Data fetched', { duration });
    } catch (error) {
      clientLogger.error('Failed to fetch data', error);
    }
  };

  return <button onClick={handleClick}>Fetch</button>;
}
```

---

## Best Practices

### 1. Always Use Structured Logging

```typescript
// ❌ BAD
logger.info('User 123 created order 456 for $99.99');

// ✅ GOOD
logger.info(
  { userId: '123', orderId: '456', amount: 99.99, currency: 'USD' },
  'Order created'
);
```

### 2. Create Child Loggers for Context

```typescript
// ✅ GOOD: Creates context that applies to all logs
const requestLogger = logger.child({ correlationId, userId });

requestLogger.info('Starting operation');  // Includes correlationId and userId
requestLogger.debug('Validating input');   // Includes correlationId and userId
requestLogger.info('Operation complete');  // Includes correlationId and userId
```

### 3. Log at Entry and Exit Points

```typescript
async function processOrder(orderId: string) {
  logger.info({ orderId }, 'Processing order started');

  try {
    const result = await performProcessing(orderId);
    logger.info({ orderId, itemCount: result.items.length }, 'Processing order completed');
    return result;
  } catch (error) {
    logger.error({ err: error, orderId }, 'Processing order failed');
    throw error;
  }
}
```

### 4. Include Performance Metrics

```typescript
const startTime = Date.now();
// ... operation ...
const duration = Date.now() - startTime;

logger.info({ duration }, 'Operation completed');

if (duration > 1000) {
  logger.warn({ duration }, 'Slow operation detected');
}
```

### 5. Don't Log Everything

```typescript
// ❌ BAD: Too verbose, no value
logger.debug('Entering function');
logger.debug('Exiting function');
logger.debug('Variable x =', x);

// ✅ GOOD: Meaningful logs at appropriate levels
logger.info({ batchSize: items.length }, 'Processing batch');
logger.warn({ retryCount: 3 }, 'Retrying failed operation');
```

### 6. Use Appropriate Log Levels

```typescript
logger.debug({ query }, 'Database query built');        // Development debugging
logger.info({ userId }, 'User logged in');               // Normal operations
logger.warn({ attemptCount: 3 }, 'Multiple retries');   // Warnings
logger.error({ err: error }, 'Operation failed');        // Errors
```

### 7. Sanitize Before Logging

```typescript
// ❌ BAD: Logs sensitive data
logger.info({ user }, 'User created');

// ✅ GOOD: Sanitize first
const { password, ssn, ...safeUser } = user;
logger.info({ user: safeUser }, 'User created');
```

### 8. Log Errors Properly

```typescript
// ❌ BAD: Loses stack trace
logger.error('Error occurred: ' + error.message);

// ✅ GOOD: Uses Pino's error serializer
logger.error({ err: error }, 'Error occurred');
```

### 9. Consistent Naming Conventions

Use consistent field names across your entire codebase:
- `userId` not `user_id` or `uid`
- `correlationId` not `requestId` or `traceId`
- `duration` not `time` or `elapsed`

### 10. Don't Block on Logging

Pino is async by default, which is good. Never wait for logs:

```typescript
// ❌ BAD: Waiting for logs
await logger.info('Message');  // logger.info doesn't return a promise

// ✅ GOOD: Fire and forget
logger.info('Message');
```

---

## Common Patterns

### Pattern 1: Request/Response Logging

```typescript
export async function handler(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  const logger = createLogger({ route: '/api/endpoint', correlationId });
  const startTime = Date.now();

  logger.info({ method: request.method }, 'Request received');

  try {
    const result = await processRequest(request);

    const duration = Date.now() - startTime;
    logger.info({ duration, statusCode: 200 }, 'Request completed');

    return NextResponse.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({ err: error, duration }, 'Request failed');

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Pattern 2: Service Layer Logging

```typescript
export class MyService {
  private logger: Logger;

  constructor() {
    this.logger = createLogger({ service: 'MyService' });
  }

  async operation(id: string, options: any) {
    const methodLogger = this.logger.child({ method: 'operation', id });

    methodLogger.debug({ options }, 'Operation started');

    try {
      const result = await this.executeOperation(id, options);
      methodLogger.info({ resultSize: result.length }, 'Operation completed');
      return result;
    } catch (error) {
      methodLogger.error({ err: error }, 'Operation failed');
      throw error;
    }
  }
}
```

### Pattern 3: Client-Side Event Tracking

```typescript
export function MyComponent() {
  useEffect(() => {
    clientLogger.setContext({
      component: 'MyComponent',
      sessionId: getSessionId()
    });

    clientLogger.info('Component mounted');

    return () => {
      clientLogger.info('Component unmounted');
      clientLogger.clearContext();
    };
  }, []);

  const handleUserAction = (action: string) => {
    const startTime = Date.now();
    clientLogger.debug('User action started', { action });

    try {
      performAction(action);

      const duration = Date.now() - startTime;
      clientLogger.info('User action completed', { action, duration });
    } catch (error) {
      clientLogger.error('User action failed', error, { action });
    }
  };
}
```

---

## Log Output Formats

Understanding what your logs will look like in different scenarios:

### Raw JSON Format (`dev:log`)

```json
{"level":30,"time":"2025-11-28T10:21:02.047Z","env":"development","module":"API","route":"/api/agent-creation/init-thread","correlationId":"8ffd7a2a-0712-41f4-8e7e-dd89f0b8d986","msg":"Thread creation request received"}
{"level":20,"time":"2025-11-28T10:21:02.533Z","env":"development","module":"API","route":"/api/agent-creation/init-thread","correlationId":"8ffd7a2a-0712-41f4-8e7e-dd89f0b8d986","userId":"868fda6a-59fa-4e99-8930-9951484078bf","msg":"User authenticated"}
{"level":30,"time":"2025-11-28T10:21:03.991Z","env":"development","module":"API","route":"/api/agent-creation/init-thread","correlationId":"8ffd7a2a-0712-41f4-8e7e-dd89f0b8d986","threadId":"thread_vYxLsxMtuoAKDvuMFEJEWW5W","userId":"868fda6a-59fa-4e99-8930-9951484078bf","duration":1455,"msg":"OpenAI thread created"}
```

**Use when:**
- Sending to log aggregation services
- Need to parse logs programmatically
- Production environments

---

### Single-Line Pretty Format (`dev:pretty`, `dev:pretty:file`)

```
[10:21:02.047] INFO: Thread creation request received env="development" module="API" route="/api/agent-creation/init-thread" correlationId="8ffd7a2a-0712-41f4-8e7e-dd89f0b8d986"
[10:21:02.533] DEBUG: User authenticated env="development" module="API" route="/api/agent-creation/init-thread" correlationId="8ffd7a2a-0712-41f4-8e7e-dd89f0b8d986" userId="868fda6a-59fa-4e99-8930-9951484078bf"
[10:21:03.991] INFO: OpenAI thread created env="development" module="API" route="/api/agent-creation/init-thread" correlationId="8ffd7a2a-0712-41f4-8e7e-dd89f0b8d986" threadId="thread_vYxLsxMtuoAKDvuMFEJEWW5W" userId="868fda6a" duration=1455
```

**Features:**
- ✅ Human-readable
- ✅ Compact (one line per log)
- ✅ No ANSI color codes (file-friendly)
- ✅ Easy to grep/search

**Use when:**
- Saving logs to file for review
- Searching/filtering logs
- Need readable text format

---

### Multi-Line Pretty Format (`dev:pretty:terminal`)

```
[10:21:02.047] INFO: Thread creation request received
    env: "development"
    module: "API"
    route: "/api/agent-creation/init-thread"
    correlationId: "8ffd7a2a-0712-41f4-8e7e-dd89f0b8d986"

[10:21:02.533] DEBUG: User authenticated
    env: "development"
    module: "API"
    route: "/api/agent-creation/init-thread"
    correlationId: "8ffd7a2a-0712-41f4-8e7e-dd89f0b8d986"
    userId: "868fda6a-59fa-4e99-8930-9951484078bf"

[10:21:03.991] INFO: OpenAI thread created
    env: "development"
    module: "API"
    route: "/api/agent-creation/init-thread"
    correlationId: "8ffd7a2a-0712-41f4-8e7e-dd89f0b8d986"
    threadId: "thread_vYxLsxMtuoAKDvuMFEJEWW5W"
    userId: "868fda6a-59fa-4e99-8930-9951484078bf"
    duration: 1455
```

**Features:**
- ✅ Most readable
- ✅ Color-coded (terminal only)
- ✅ Each field on separate line
- ❌ Takes more vertical space

**Use when:**
- Watching logs in real-time during development
- Need maximum readability
- Working in terminal

---

### Quick Reference

| Format | Command | Readability | Searchability | File-Safe | Best For |
|--------|---------|-------------|---------------|-----------|----------|
| **JSON** | `dev:log` | ⭐ | ⭐⭐⭐⭐⭐ | ✅ | Production, automation |
| **Single-line** | `dev:pretty:file` | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ | File review, searching |
| **Multi-line** | `dev:pretty:terminal` | ⭐⭐⭐⭐⭐ | ⭐⭐ | ❌ | Terminal watching |

---

## Summary

1. **Install**: `npm install pino pino-pretty`
2. **Setup**: Create logger config and instances for server/client
3. **Configure**: Add npm scripts for different log formats
4. **Use**: Import and use structured logging everywhere
5. **Migrate**: Gradually replace console.log with structured logs
6. **Monitor**: Use correlation IDs and performance metrics
7. **Integrate**: Use Pino for operations, AuditTrailService for compliance

**Key Takeaways**:
- Always use structured logging (objects, not strings)
- Use appropriate log levels (understand numeric values 10-60)
- Include correlation IDs for request tracing
- Track performance metrics (duration, memory)
- Redact sensitive data automatically
- Use both Pino (operations) and AuditTrailService (compliance)
- Choose the right format for your use case (JSON for production, pretty for development)

---

**Questions or Issues?**
Refer to the [Pino documentation](https://getpino.io/) for advanced usage and configuration options.
