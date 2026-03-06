export interface ErrorContext {
  service: string;
  operation: string;
  traceId?: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export class AthenaError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly cause?: Error;

  constructor(message: string, code: string, context: ErrorContext, cause?: Error) {
    super(message);
    this.name = "AthenaError";
    this.code = code;
    this.context = {
      ...context,
      timestamp: context.timestamp ?? new Date(),
    };
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack,
      cause: this.cause,
    };
  }
}
