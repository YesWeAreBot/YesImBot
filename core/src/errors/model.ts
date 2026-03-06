import { AthenaError, ErrorContext } from "./base";

export class ModelError extends AthenaError {
  constructor(message: string, code: string, operation: string, cause?: Error) {
    const context: ErrorContext = {
      service: "model",
      operation,
    };
    super(message, code, context, cause);
    this.name = "ModelError";
  }
}
