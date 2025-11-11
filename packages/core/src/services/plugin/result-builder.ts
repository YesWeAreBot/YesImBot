import { ToolResult, ToolStatus, ToolError, NextStep, ToolErrorType } from "./types";

/**
 * Tool result builder class.
 */
export class ToolResultBuilder<T> {
    result: ToolResult<T>;

    constructor(status: ToolStatus, data?: T, error?: ToolError) {
        this.result = {
            status,
            result: data,
            error,
        };
    }

    withError(error: ToolError): this {
        this.result.error = error;
        return this;
    }

    withWarning(warning: string): this {
        this.result.warnings ??= [];
        this.result.warnings.push(warning);
        return this;
    }

    withNextStep(step: NextStep): this {
        this.result.metadata ??= {};
        this.result.metadata.nextSteps ??= [];
        this.result.metadata.nextSteps.push(step);
        return this;
    }

    withMetadata(key: string, value: any): this {
        this.result.metadata ??= {};
        this.result.metadata[key] = value;
        return this;
    }

    build(): ToolResult<T> {
        return this.result;
    }
}

/**
 * Create a success result.
 *
 * Simple usage (no .build() required):
 *   return Success({ data: "result" });
 *
 * Advanced usage with builder pattern:
 *   return Success({ data: "result" })
 *       .withWarning("Warning message")
 *       .withNextStep({ toolName: "next_tool" })
 *       .build();
 */
export function Success<T>(result?: T): ToolResult<T> & ToolResultBuilder<T> {
    const builder = new ToolResultBuilder(ToolStatus.Success, result);
    const toolResult = builder.build();

    // Create a hybrid object that works both as ToolResult and Builder
    return Object.assign(toolResult, {
        withError: builder.withError.bind(builder),
        withWarning: builder.withWarning.bind(builder),
        withNextStep: builder.withNextStep.bind(builder),
        withMetadata: builder.withMetadata.bind(builder),
        build: builder.build.bind(builder),
    }) as ToolResult<T> & ToolResultBuilder<T>;
}

/**
 * Create a failure result.
 *
 * Simple usage (no .build() required):
 *   return Failed("Error message");
 *   return Failed({ type: "validation_error", message: "Invalid input" });
 *
 * Advanced usage with builder pattern:
 *   return Failed("Error message")
 *       .withMetadata("retry_after", 60)
 *       .build();
 */
export function Failed(error: ToolError | string): ToolResult<never> & ToolResultBuilder<never> {
    const toolError: ToolError = typeof error === "string" ? { type: "error", message: error } : error;
    const builder = new ToolResultBuilder(ToolStatus.Error, undefined, toolError);
    const toolResult = builder.build();

    return Object.assign(toolResult, {
        withError: builder.withError.bind(builder),
        withWarning: builder.withWarning.bind(builder),
        withNextStep: builder.withNextStep.bind(builder),
        withMetadata: builder.withMetadata.bind(builder),
        build: builder.build.bind(builder),
    }) as ToolResult<never> & ToolResultBuilder<never>;
}

/**
 * Create a partial success result.
 *
 * Simple usage (no .build() required):
 *   return PartialSuccess({ partial: "data" }, ["Warning 1", "Warning 2"]);
 *
 * Advanced usage with builder pattern:
 *   return PartialSuccess({ partial: "data" }, ["Warning"])
 *       .withNextStep({ toolName: "retry_tool" })
 *       .build();
 */
export function PartialSuccess<T>(result: T, warnings: string[]): ToolResult<T> & ToolResultBuilder<T> {
    const builder = new ToolResultBuilder(ToolStatus.PartialSuccess, result);
    warnings.forEach((w) => builder.withWarning(w));
    const toolResult = builder.build();

    return Object.assign(toolResult, {
        withError: builder.withError.bind(builder),
        withWarning: builder.withWarning.bind(builder),
        withNextStep: builder.withNextStep.bind(builder),
        withMetadata: builder.withMetadata.bind(builder),
        build: builder.build.bind(builder),
    }) as ToolResult<T> & ToolResultBuilder<T>;
}

/**
 * Tool execution error class.
 */
export class ToolExecutionError extends Error implements ToolError {
    constructor(
        public type: string,
        message: string,
        public retryable: boolean = false,
        public code?: string,
        public details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "ToolExecutionError";
    }

    toToolError(): ToolError {
        return {
            type: this.type,
            message: this.message,
            retryable: this.retryable,
            code: this.code,
            details: this.details,
        };
    }
}

/**
 * Helper functions for creating specific error types.
 */
export function ValidationError(message: string, details?: Record<string, unknown>) {
    return new ToolExecutionError(ToolErrorType.ValidationError, message, false, undefined, details);
}

export function NetworkError(message: string, retryable: boolean = true) {
    return new ToolExecutionError(ToolErrorType.NetworkError, message, retryable);
}

export function PermissionDeniedError(message: string) {
    return new ToolExecutionError(ToolErrorType.PermissionDenied, message, false);
}

export function ResourceNotFoundError(message: string) {
    return new ToolExecutionError(ToolErrorType.ResourceNotFound, message, false);
}

export function RateLimitError(message: string, retryAfter?: number) {
    return new ToolExecutionError(ToolErrorType.RateLimitExceeded, message, true, undefined, retryAfter ? { retryAfter } : undefined);
}

export function InternalError(message: string) {
    return new ToolExecutionError(ToolErrorType.InternalError, message, true);
}
