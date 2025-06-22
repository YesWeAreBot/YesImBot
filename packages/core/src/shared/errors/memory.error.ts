import { BaseError, ErrorContext, ErrorSeverity, ErrorType } from "./base.error";

export class MemoryError extends BaseError {
    constructor(message: string, context: ErrorContext = {}, cause?: Error) {
        super(message, "MEMORY_ERROR", ErrorType.RESOURCE_CONFLICT, ErrorSeverity.MEDIUM, context, cause);
        this.name = "MemoryError";
        // Ensure the prototype chain is correct for custom errors
        Object.setPrototypeOf(this, MemoryError.prototype);
    }

    toUserMessage(): string {
        return "";
    }
}
