export class MemoryError extends Error {
    constructor(message: string, public readonly context?: Record<string, unknown>) {
        super(message);
        this.name = 'MemoryError';
        // Ensure the prototype chain is correct for custom errors
        Object.setPrototypeOf(this, MemoryError.prototype);
    }
}
