// ============================================================================
// TOOL RESULT TYPES
// ============================================================================

/**
 * Tool execution status.
 */
export enum ToolStatus {
    Success = "success",
    Error = "error",
    PartialSuccess = "partial_success",
    Warning = "warning",
}

/**
 * Tool error types.
 */
export enum ToolErrorType {
    ValidationError = "validation_error",
    PermissionDenied = "permission_denied",
    ResourceNotFound = "resource_not_found",
    NetworkError = "network_error",
    RateLimitExceeded = "rate_limit_exceeded",
    InternalError = "internal_error",
}

/**
 * Structured error information.
 */
export interface ToolError {
    /** Error type/category */
    type: string;
    /** Human-readable message */
    message: string;
    /** Whether error is retryable */
    retryable?: boolean;
    /** Error code (for programmatic handling) */
    code?: string;
    /** Additional error details */
    details?: Record<string, unknown>;
}

/**
 * Recommended next step.
 */
export interface NextStep {
    toolName: string;
    description: string;
    prefilledParams?: Record<string, any>;
    confidence?: number;
}

/**
 * Tool execution result.
 */
export interface ToolResult<TResult = any> {
    /** Execution status */
    status: ToolStatus;
    /** Result data (on success/partial success) */
    result?: TResult;
    /** Error information (on error) */
    error?: ToolError;
    /** Warnings (even on success) */
    warnings?: string[];
    /** Metadata (workflow hints, next steps, etc.) */
    metadata?: {
        nextSteps?: NextStep[];
        [key: string]: unknown;
    };
}

/**
 * Alias for backward compatibility.
 */
export type ToolCallResult<TResult = any> = ToolResult<TResult>;
