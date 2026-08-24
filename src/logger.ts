/**
 * Simple structured logger.
 *
 * Provides request-scoped logging with consistent formatting.
 * In production you'd swap this for pino/winston — this is intentionally
 * minimal to avoid over-engineering.
 */

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function formatLog(
  level: string,
  message: string,
  data?: Record<string, unknown>,
): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] ${level}: ${message}`;
  if (data && Object.keys(data).length > 0) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export function createLogger(): Logger {
  return {
    info(message: string, data?: Record<string, unknown>) {
      console.log(formatLog("INFO", message, data));
    },
    warn(message: string, data?: Record<string, unknown>) {
      console.warn(formatLog("WARN", message, data));
    },
    error(message: string, data?: Record<string, unknown>) {
      console.error(formatLog("ERROR", message, data));
    },
  };
}
