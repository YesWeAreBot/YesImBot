import { AthenaError, ErrorContext } from "./base";

export class PromptError extends AthenaError {
  constructor(message: string, code: string, operation: string, cause?: Error) {
    const context: ErrorContext = {
      service: "prompt",
      operation,
    };
    super(message, code, context, cause);
    this.name = "PromptError";
  }
}
