export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  isRetryable: (error: Error) => boolean,
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (!isRetryable(lastError) || attempt > options.maxRetries) {
        throw lastError;
      }

      const delay = Math.min(
        options.baseDelayMs * Math.pow(options.factor, attempt - 1),
        options.maxDelayMs,
      );
      const jitter = delay * Math.random() * 0.2;
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }

  throw lastError!;
}

export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  if (message.includes("timeout") || message.includes("etimedout")) return true;
  if (message.includes("econnreset")) return true;
  if (message.includes("429") || message.includes("503")) return true;
  if (
    message.includes("400") ||
    message.includes("401") ||
    message.includes("403") ||
    message.includes("404")
  )
    return false;

  return false;
}
