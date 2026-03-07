import type { Context } from "@koishijs/core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { AthenaError } from "../../core/src/errors/base";
import { AgentError } from "../../core/src/errors/agent";
import { ModelError } from "../../core/src/errors/model";
import { HorizonError } from "../../core/src/errors/horizon";
import { PromptError } from "../../core/src/errors/prompt";
import { retryWithBackoff, isRetryableError } from "../../core/src/utils/retry";
import { createTestApp } from "../setup";

describe("Error Handling E2E", () => {
  let app: Context;

  beforeAll(async () => {
    app = createTestApp();
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  describe("Error class integration", () => {
    it("should create and throw AthenaError with full context in running app", () => {
      const error = new AthenaError("Service failed", "ERR_TEST_E2E", {
        service: "test",
        operation: "e2eValidation",
        traceId: "trace-e2e-001",
        metadata: { appActive: app.lifecycle.isActive },
      });

      expect(error.code).toBe("ERR_TEST_E2E");
      expect(error.context.service).toBe("test");
      expect(error.context.traceId).toBe("trace-e2e-001");
      expect(error.context.metadata?.appActive).toBe(true);
      expect(error.context.timestamp).toBeInstanceOf(Date);
    });

    it("should chain errors across service boundaries", () => {
      const rootCause = new Error("Network timeout");
      const modelError = new ModelError("LLM call failed", "ERR_MODEL_001", "generateResponse", rootCause);
      const agentError = new AgentError("Agent loop failed", "ERR_AGENT_001", "processMessage", modelError);

      expect(agentError.cause).toBe(modelError);
      expect((agentError.cause as ModelError).cause).toBe(rootCause);
      expect(agentError.context.service).toBe("agent");
      expect((agentError.cause as ModelError).context.service).toBe("model");
    });

    it("should serialize error chain to JSON", () => {
      const cause = new ModelError("Model timeout", "ERR_MODEL_002", "callProvider");
      const error = new AgentError("Agent failed", "ERR_AGENT_002", "thinkAct", cause);

      const json = error.toJSON();

      expect(json.name).toBe("AgentError");
      expect(json.code).toBe("ERR_AGENT_002");
      expect(json.cause).toBeDefined();
      expect((json.cause as ModelError).code).toBe("ERR_MODEL_002");
    });

    it("should create all service-specific error types", () => {
      const errors = [
        new AgentError("agent fail", "ERR_AGENT_003", "op1"),
        new ModelError("model fail", "ERR_MODEL_003", "op2"),
        new HorizonError("horizon fail", "ERR_HORIZON_001", "op3"),
        new PromptError("prompt fail", "ERR_PROMPT_001", "op4"),
      ];

      const services = errors.map((e) => e.context.service);
      expect(services).toEqual(["agent", "model", "horizon", "prompt"]);

      errors.forEach((e) => {
        expect(e).toBeInstanceOf(AthenaError);
        expect(e.context.timestamp).toBeInstanceOf(Date);
      });
    });
  });

  describe("Retry utility integration", () => {
    it("should retry transient failures and succeed", async () => {
      let attempts = 0;

      const result = await retryWithBackoff(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error("503 Service Unavailable");
          return "success";
        },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, factor: 2 },
        isRetryableError,
      );

      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should fail immediately on non-retryable errors", async () => {
      let attempts = 0;

      await expect(
        retryWithBackoff(
          async () => {
            attempts++;
            throw new Error("401 Unauthorized");
          },
          { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, factor: 2 },
          isRetryableError,
        ),
      ).rejects.toThrow("401 Unauthorized");

      expect(attempts).toBe(1);
    });

    it("should work with AthenaError subclasses", async () => {
      let attempts = 0;

      await expect(
        retryWithBackoff(
          async () => {
            attempts++;
            throw new ModelError("Model 503", "ERR_MODEL_004", "callAPI");
          },
          { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50, factor: 2 },
          (error) => error.message.includes("503"),
        ),
      ).rejects.toThrow("Model 503");

      expect(attempts).toBe(3);
    });
  });

  describe("Error handling in middleware context", () => {
    it("should catch errors from middleware handlers gracefully", async () => {
      const errors: Error[] = [];

      app.middleware((session, next) => {
        try {
          throw new AgentError("Processing failed", "ERR_AGENT_E2E", "middleware");
        } catch (e) {
          errors.push(e as Error);
        }
        return next();
      });

      const client = app.mock.client("error-user");
      await client.receive("trigger error");

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(AgentError);
      expect((errors[0] as AgentError).context.service).toBe("agent");
    });
  });
});
