/**
 * Centralized logging utility
 * This provides a consistent logging interface that can be easily replaced
 * with a production logging service (Winston, Pino, Sentry, etc.)
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private formatMessage(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  info(message: string, context?: LogContext): void {
    // In development, use console. In production, replace with proper logging service
    if (process.env.NODE_ENV === "production") {
      // TODO: Replace with production logging service (e.g., Winston, Pino)
      console.log(this.formatMessage("info", message, context));
    } else {
      console.log(this.formatMessage("info", message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage("warn", message, context));
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext = {
      ...context,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : error,
    };
    console.error(this.formatMessage("error", message, errorContext));
  }

  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== "production") {
      console.log(this.formatMessage("debug", message, context));
    }
  }
}

export const logger = new Logger();
