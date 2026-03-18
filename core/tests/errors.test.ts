import { describe, it, expect } from "vitest";

import { AgentError } from "../src/errors/agent";
import { AthenaError } from "../src/errors/base";
import { HorizonError } from "../src/errors/horizon";
import { ModelError } from "../src/errors/model";
import { PromptError } from "../src/errors/prompt";

describe("AthenaError", () => {
  it("should accept message, code, context, and optional cause", () => {
    const cause = new Error("Original error");
    const error = new AthenaError(
      "Test error",
      "ERR_TEST_001",
      {
        service: "test",
        operation: "testOp",
      },
      cause,
    );

    expect(error.message).toBe("Test error");
    expect(error.code).toBe("ERR_TEST_001");
    expect(error.context.service).toBe("test");
    expect(error.context.operation).toBe("testOp");
    expect(error.cause).toBe(cause);
  });

  it("should include timestamp if not provided in context", () => {
    const before = new Date();
    const error = new AthenaError("Test error", "ERR_TEST_002", {
      service: "test",
      operation: "testOp",
    });
    const after = new Date();

    expect(error.context.timestamp).toBeDefined();
    expect(error.context.timestamp!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(error.context.timestamp!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should preserve provided timestamp", () => {
    const customTimestamp = new Date("2026-01-01T00:00:00Z");
    const error = new AthenaError("Test error", "ERR_TEST_003", {
      service: "test",
      operation: "testOp",
      timestamp: customTimestamp,
    });

    expect(error.context.timestamp).toBe(customTimestamp);
  });

  it("should preserve proper stack trace", () => {
    const error = new AthenaError("Test error", "ERR_TEST_004", {
      service: "test",
      operation: "testOp",
    });

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("AthenaError");
    expect(error.stack).toContain("Test error");
  });

  it("should serialize all error properties including cause via toJSON", () => {
    const cause = new Error("Original error");
    const error = new AthenaError(
      "Test error",
      "ERR_TEST_005",
      {
        service: "test",
        operation: "testOp",
        traceId: "trace-123",
        metadata: { key: "value" },
      },
      cause,
    );

    const json = error.toJSON();

    expect(json.name).toBe("AthenaError");
    expect(json.message).toBe("Test error");
    expect(json.code).toBe("ERR_TEST_005");
    expect(json.context.service).toBe("test");
    expect(json.context.operation).toBe("testOp");
    expect(json.context.traceId).toBe("trace-123");
    expect(json.context.metadata).toEqual({ key: "value" });
    expect(json.stack).toBeDefined();
    expect(json.cause).toBeDefined();
  });

  it("should include traceId in context when provided", () => {
    const error = new AthenaError("Test error", "ERR_TEST_006", {
      service: "test",
      operation: "testOp",
      traceId: "trace-456",
    });

    expect(error.context.traceId).toBe("trace-456");
  });
});

describe("Service-specific errors", () => {
  it("AgentError should auto-fill service='agent' in context", () => {
    const error = new AgentError("Agent failed", "ERR_AGENT_001", "processMessage");

    expect(error.name).toBe("AgentError");
    expect(error.context.service).toBe("agent");
    expect(error.context.operation).toBe("processMessage");
  });

  it("ModelError should auto-fill service='model' in context", () => {
    const error = new ModelError("Model failed", "ERR_MODEL_001", "generateResponse");

    expect(error.name).toBe("ModelError");
    expect(error.context.service).toBe("model");
    expect(error.context.operation).toBe("generateResponse");
  });

  it("HorizonError should auto-fill service='horizon' in context", () => {
    const error = new HorizonError("Horizon failed", "ERR_HORIZON_001", "buildContext");

    expect(error.name).toBe("HorizonError");
    expect(error.context.service).toBe("horizon");
    expect(error.context.operation).toBe("buildContext");
  });

  it("PromptError should auto-fill service='prompt' in context", () => {
    const error = new PromptError("Prompt failed", "ERR_PROMPT_001", "renderTemplate");

    expect(error.name).toBe("PromptError");
    expect(error.context.service).toBe("prompt");
    expect(error.context.operation).toBe("renderTemplate");
  });

  it("Service errors should preserve cause chain", () => {
    const cause = new Error("Original error");
    const error = new AgentError("Agent failed", "ERR_AGENT_002", "processMessage", cause);

    expect(error.cause).toBe(cause);
  });
});
