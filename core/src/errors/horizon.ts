import { AthenaError, ErrorContext } from "./base";

export class HorizonError extends AthenaError {
  constructor(message: string, code: string, operation: string, cause?: Error) {
    const context: ErrorContext = {
      service: "horizon",
      operation,
    };
    super(message, code, context, cause);
    this.name = "HorizonError";
  }
}
