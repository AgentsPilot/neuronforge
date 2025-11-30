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
