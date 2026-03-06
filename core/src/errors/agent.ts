import { AthenaError, ErrorContext } from "./base";

export class AgentError extends AthenaError {
  constructor(message: string, code: string, operation: string, cause?: Error) {
    const context: ErrorContext = {
      service: "agent",
      operation,
    };
    super(message, code, context, cause);
    this.name = "AgentError";
  }
}
