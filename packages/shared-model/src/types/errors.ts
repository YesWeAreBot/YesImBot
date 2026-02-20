export enum ErrorCategory {
  TRANSIENT = "transient",
  AUTH = "auth",
  RATE_LIMIT = "rate-limit",
  PERMANENT = "permanent",
}

export class ModelError extends Error {
  constructor(
    message: string,
    public category: ErrorCategory,
    public providerName: string,
    public modelId: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export function classifyError(error: unknown): ErrorCategory {
  if (!error) return ErrorCategory.PERMANENT;

  const err = error as Error & { name?: string; status?: number; statusCode?: number };
  const name = err.name || "";
  const status = err.status || err.statusCode || 0;

  if (name === "AI_RetryError" || name.includes("Network") || name.includes("Timeout")) {
    return ErrorCategory.TRANSIENT;
  }
  if (status === 401 || status === 403) return ErrorCategory.AUTH;
  if (status === 429) return ErrorCategory.RATE_LIMIT;
  if (status === 503) return ErrorCategory.TRANSIENT;

  return ErrorCategory.PERMANENT;
}
