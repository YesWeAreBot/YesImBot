import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentMessage, AssistantMessage } from "../../src/agent/types.js";
import type { HookContext, HookError } from "../../src/session/hook-runner.js";
import { HookRunner } from "../../src/session/hook-runner.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal mock HookContext. */
function mockContext(): HookContext {
  return {
    sessionManager: {} as any,
    model: undefined,
    isIdle: () => false,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "base-prompt",
  };
}

function makeRunner(): HookRunner {
  return new HookRunner(() => mockContext());
}

function makeAgentMessage(text: string, role: "user" | "assistant" = "user"): AgentMessage {
  if (role === "user") {
    return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as any;
  }
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    usage: {},
    finishReason: "stop",
    timestamp: Date.now(),
  } as any;
}

// ============================================================================
// Tests
// ============================================================================

describe("HookRunner", () => {
  describe("reducer hooks chaining", () => {
    it("chains systemPrompt through multiple beforeAgentStart handlers", async () => {
      const runner = makeRunner();

      runner.on("agent:before-start", (event) => ({
        systemPrompt: event.systemPrompt + "|handler1",
      }));
      runner.on("agent:before-start", (event) => ({
        systemPrompt: event.systemPrompt + "|handler2",
      }));

      const result = await runner.beforeAgentStart({
        prompt: "hello",
        systemPrompt: "base",
        systemPromptOptions: {
          cwd: "/tmp",
          baseSystemPrompt: "base",
          selectedTools: [],
          toolSnippets: {},
          promptGuidelines: [],
        },
      });

      expect(result?.systemPrompt).toBe("base|handler1|handler2");
    });

    it("collects messages from multiple beforeAgentStart handlers", async () => {
      const runner = makeRunner();

      runner.on("agent:before-start", () => ({
        message: { customType: "a", content: [{ type: "text" as const, text: "msg-a" }] },
      }));
      runner.on("agent:before-start", () => ({
        message: { customType: "b", content: [{ type: "text" as const, text: "msg-b" }] },
      }));

      const result = await runner.beforeAgentStart({
        prompt: "hello",
        systemPrompt: "base",
        systemPromptOptions: {
          cwd: "/tmp",
          baseSystemPrompt: "base",
          selectedTools: [],
          toolSnippets: {},
          promptGuidelines: [],
        },
      });

      expect(result?.messages).toHaveLength(2);
      expect(result?.messages?.[0].customType).toBe("a");
      expect(result?.messages?.[1].customType).toBe("b");
    });

    it("chains transformContext through multiple handlers", async () => {
      const runner = makeRunner();
      const input = [makeAgentMessage("hello")];

      runner.on("context:build", (messages) => [...messages, makeAgentMessage("added-1")]);
      runner.on("context:build", (messages) => [...messages, makeAgentMessage("added-2")]);

      const result = await runner.transformContext(input);

      expect(result).toHaveLength(3);
      expect((result[1] as any).content[0].text).toBe("added-1");
      expect((result[2] as any).content[0].text).toBe("added-2");
    });

    it("chains afterToolCall modifications through multiple handlers", async () => {
      const runner = makeRunner();

      runner.on("tool:result", () => ({ details: "detail-1" }));
      runner.on("tool:result", () => ({ isError: true }));

      const result = await runner.afterToolCall({
        toolName: "test",
        toolCallId: "tc-1",
        input: {},
        content: [{ type: "text", text: "ok" }],
        details: undefined,
        isError: false,
      });

      expect(result).toBeDefined();
      expect(result!.details).toBe("detail-1");
      expect(result!.isError).toBe(true);
    });

    it("chains beforeProviderRequest through multiple handlers", async () => {
      const runner = makeRunner();

      runner.on("provider:before-request", (payload: any) => ({
        ...payload,
        modified: "handler1",
      }));
      runner.on("provider:before-request", (payload: any) => ({
        ...payload,
        extra: "handler2",
      }));

      const result = await runner.beforeProviderRequest({ original: true });

      expect(result).toEqual({ original: true, modified: "handler1", extra: "handler2" });
    });
  });

  describe("fail-open", () => {
    it("continues to next handler when a beforeAgentStart handler throws", async () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      runner.onError((e) => errors.push(e));

      runner.on("agent:before-start", () => {
        throw new Error("boom");
      });
      runner.on("agent:before-start", (event) => ({
        systemPrompt: event.systemPrompt + "|ok",
      }));

      const result = await runner.beforeAgentStart({
        prompt: "hello",
        systemPrompt: "base",
        systemPromptOptions: {
          cwd: "/tmp",
          baseSystemPrompt: "base",
          selectedTools: [],
          toolSnippets: {},
          promptGuidelines: [],
        },
      });

      expect(result?.systemPrompt).toBe("base|ok");
      expect(errors).toHaveLength(1);
      expect(errors[0].event).toBe("agent:before-start");
      expect(errors[0].error).toBe("boom");
    });

    it("continues to next handler when a transformContext handler throws", async () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      runner.onError((e) => errors.push(e));

      runner.on("context:build", () => {
        throw new Error("context-boom");
      });
      runner.on("context:build", (messages) => [...messages, makeAgentMessage("added")]);

      const result = await runner.transformContext([makeAgentMessage("hello")]);

      expect(result).toHaveLength(2);
      expect(errors).toHaveLength(1);
      expect(errors[0].event).toBe("context:build");
    });

    it("continues to next handler when a beforeToolCall handler throws", async () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      runner.onError((e) => errors.push(e));

      runner.on("tool:call", () => {
        throw new Error("tc-boom");
      });
      runner.on("tool:call", () => ({ block: true, reason: "blocked-after-error" }));

      const result = await runner.beforeToolCall({
        toolName: "test",
        toolCallId: "tc-1",
        input: {},
      });

      expect(result?.block).toBe(true);
      expect(result?.reason).toBe("blocked-after-error");
      expect(errors).toHaveLength(1);
    });

    it("continues to next handler when a lifecycle handler throws", async () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      runner.onError((e) => errors.push(e));
      const calls: number[] = [];

      runner.on("agent:start", () => {
        calls.push(1);
        throw new Error("lifecycle-boom");
      });
      runner.on("agent:start", () => {
        calls.push(2);
      });

      await runner.emitLifecycle({ type: "agent:start" });

      expect(calls).toEqual([1, 2]);
      expect(errors).toHaveLength(1);
      expect(errors[0].event).toBe("agent:start");
    });

    it("reports non-Error throws as string in HookError", async () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      runner.onError((e) => errors.push(e));

      runner.on("agent:start", () => {
        throw "string-error";
      });

      await runner.emitLifecycle({ type: "agent:start" });

      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe("string-error");
      expect(errors[0].stack).toBeUndefined();
    });
  });

  describe("block/cancel via explicit return values", () => {
    it("beforeToolCall returns block result from first blocking handler", async () => {
      const runner = makeRunner();

      runner.on("tool:call", () => ({ block: true, reason: "not-allowed" }));

      const result = await runner.beforeToolCall({
        toolName: "dangerous",
        toolCallId: "tc-1",
        input: {},
      });

      expect(result).toEqual({ block: true, reason: "not-allowed" });
    });

    it("beforeToolCall returns undefined when no handler blocks", async () => {
      const runner = makeRunner();

      runner.on("tool:call", () => undefined);

      const result = await runner.beforeToolCall({
        toolName: "safe",
        toolCallId: "tc-1",
        input: {},
      });

      expect(result).toBeUndefined();
    });

    it("beforeToolCall stops at first blocking handler", async () => {
      const runner = makeRunner();
      const calls: string[] = [];

      runner.on("tool:call", () => {
        calls.push("first");
        return { block: true, reason: "blocked" };
      });
      runner.on("tool:call", () => {
        calls.push("second");
      });

      await runner.beforeToolCall({ toolName: "t", toolCallId: "tc-1", input: {} });

      // After the block returns, the generator yields the next handler,
      // but the for-of loop breaks because the result was returned.
      // Actually looking at the code: it returns immediately on block.
      expect(calls).toEqual(["first"]);
    });

    it("beforeCompact returns cancel result", async () => {
      const runner = makeRunner();

      runner.on("session:before-compact", () => ({ cancel: true }));

      const result = await runner.beforeCompact({
        preparation: {} as any,
        branchEntries: [],
        signal: AbortSignal.abort(),
      });

      expect(result?.cancel).toBe(true);
    });

    it("beforeCompact returns compaction result", async () => {
      const runner = makeRunner();

      runner.on("session:before-compact", () => ({
        compaction: {
          summary: "pre-compacted",
          messagesToSummarize: [],
          tokensBefore: 100,
        } as any,
      }));

      const result = await runner.beforeCompact({
        preparation: {} as any,
        branchEntries: [],
        signal: AbortSignal.abort(),
      });

      expect(result?.compaction).toBeDefined();
      expect((result?.compaction as any).summary).toBe("pre-compacted");
    });

    it("beforeCompact stops at first cancel/compaction result", async () => {
      const runner = makeRunner();
      const calls: string[] = [];

      runner.on("session:before-compact", () => {
        calls.push("first");
        return { cancel: true };
      });
      runner.on("session:before-compact", () => {
        calls.push("second");
      });

      await runner.beforeCompact({
        preparation: {} as any,
        branchEntries: [],
        signal: AbortSignal.abort(),
      });

      expect(calls).toEqual(["first"]);
    });
  });

  describe("lifecycle emit broadcast", () => {
    it("calls all registered handlers for a lifecycle event", async () => {
      const runner = makeRunner();
      const calls: string[] = [];

      runner.on("turn:start", () => {
        calls.push("a");
      });
      runner.on("turn:start", () => {
        calls.push("b");
      });
      runner.on("turn:start", () => {
        calls.push("c");
      });

      await runner.emitLifecycle({ type: "turn:start", turnIndex: 0, timestamp: Date.now() });

      expect(calls).toEqual(["a", "b", "c"]);
    });

    it("delivers the event object to each handler", async () => {
      const runner = makeRunner();
      const received: any[] = [];

      runner.on("tool:execution:end", (event) => {
        received.push(event);
      });

      const event = {
        type: "tool:execution:end" as const,
        toolCallId: "tc-1",
        toolName: "my-tool",
        result: { value: 42 },
        isError: false,
      };

      await runner.emitLifecycle(event);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(event);
    });

    it("does nothing when no handlers are registered", async () => {
      const runner = makeRunner();

      // Should not throw
      await runner.emitLifecycle({ type: "session:shutdown", reason: "quit" });
    });

    it("supports all lifecycle event types", async () => {
      const runner = makeRunner();
      const received: string[] = [];

      const eventTypes = [
        "agent:start",
        "agent:end",
        "turn:start",
        "turn:end",
        "message:start",
        "message:update",
        "message:end",
        "tool:execution:start",
        "tool:execution:end",
        "session:start",
        "session:compact",
        "session:shutdown",
      ] as const;

      for (const type of eventTypes) {
        runner.on(type, () => {
          received.push(type);
        });
      }

      // Emit each event type
      for (const type of eventTypes) {
        const event: any = { type };
        if (type === "agent:end") event.messages = [];
        if (type === "turn:start" || type === "turn:end") {
          event.turnIndex = 0;
          event.timestamp = Date.now();
        }
        if (type === "turn:end") {
          event.message = {};
          event.toolResults = [];
        }
        if (type === "message:start" || type === "message:update" || type === "message:end")
          event.message = {};
        if (type === "message:update") event.assistantMessageEvent = {};
        if (type === "tool:execution:start" || type === "tool:execution:end") {
          event.toolCallId = "tc-1";
          event.toolName = "t";
        }
        if (type === "tool:execution:start") event.args = {};
        if (type === "tool:execution:end") {
          event.result = {};
          event.isError = false;
        }
        if (type === "session:start") event.reason = "startup";
        if (type === "session:compact") {
          event.compactionEntry = {};
          event.fromExtension = false;
        }
        if (type === "session:shutdown") event.reason = "quit";

        await runner.emitLifecycle(event);
      }

      expect(received).toEqual([...eventTypes]);
    });
  });

  describe("lifecycle emit error isolation", () => {
    it("one throwing handler does not prevent subsequent handlers from running", async () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      runner.onError((e) => errors.push(e));
      const calls: string[] = [];

      runner.on("turn:start", () => {
        calls.push("before-error");
      });
      runner.on("turn:start", () => {
        throw new Error("handler-failure");
      });
      runner.on("turn:start", () => {
        calls.push("after-error");
      });

      await runner.emitLifecycle({ type: "turn:start", turnIndex: 0, timestamp: Date.now() });

      expect(calls).toEqual(["before-error", "after-error"]);
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe("handler-failure");
    });

    it("multiple throwing handlers each report independently", async () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      runner.onError((e) => errors.push(e));

      runner.on("agent:start", () => {
        throw new Error("err-1");
      });
      runner.on("agent:start", () => {
        throw new Error("err-2");
      });
      runner.on("agent:start", () => {
        /* ok */
      });

      await runner.emitLifecycle({ type: "agent:start" });

      expect(errors).toHaveLength(2);
      expect(errors[0].error).toBe("err-1");
      expect(errors[1].error).toBe("err-2");
    });

    it("reducer hook fail-open also reports to error listeners", async () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      runner.onError((e) => errors.push(e));

      runner.on("tool:result", () => {
        throw new Error("result-handler-fail");
      });
      runner.on("tool:result", () => ({ isError: true }));

      const result = await runner.afterToolCall({
        toolName: "t",
        toolCallId: "tc-1",
        input: {},
        content: [{ type: "text", text: "ok" }],
        details: undefined,
        isError: false,
      });

      expect(result?.isError).toBe(true);
      expect(errors).toHaveLength(1);
      expect(errors[0].event).toBe("tool:result");
    });
  });

  describe("stable ordering", () => {
    it("handlers execute in registration order for reducer hooks", async () => {
      const runner = makeRunner();
      const order: number[] = [];

      runner.on("context:build", (msgs) => {
        order.push(1);
        return msgs;
      });
      runner.on("context:build", (msgs) => {
        order.push(2);
        return msgs;
      });
      runner.on("context:build", (msgs) => {
        order.push(3);
        return msgs;
      });

      await runner.transformContext([]);

      expect(order).toEqual([1, 2, 3]);
    });

    it("handlers execute in registration order for lifecycle events", async () => {
      const runner = makeRunner();
      const order: string[] = [];

      runner.on("agent:start", () => {
        order.push("first");
      });
      runner.on("agent:start", () => {
        order.push("second");
      });
      runner.on("agent:start", () => {
        order.push("third");
      });

      await runner.emitLifecycle({ type: "agent:start" });

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("handlers registered via multiple on() calls maintain insertion order", async () => {
      const runner = makeRunner();
      const order: string[] = [];

      // Register in specific order
      for (const name of ["a", "b", "c", "d"]) {
        runner.on("turn:end", () => {
          order.push(name);
        });
      }

      await runner.emitLifecycle({
        type: "turn:end",
        turnIndex: 0,
        message: {} as any,
        toolResults: [],
      });

      expect(order).toEqual(["a", "b", "c", "d"]);
    });
  });

  describe("payload/result preservation", () => {
    it("transformContext returns original messages when no handlers modify them", async () => {
      const runner = makeRunner();
      const input = [makeAgentMessage("hello"), makeAgentMessage("world")];

      runner.on("context:build", () => undefined); // no-op

      const result = await runner.transformContext(input);

      expect(result).toHaveLength(2);
      // Should be a clone, not the same reference
      expect(result).not.toBe(input);
      expect((result[0] as any).content[0].text).toBe("hello");
    });

    it("afterToolCall returns undefined when no handler modifies anything", async () => {
      const runner = makeRunner();

      runner.on("tool:result", () => undefined);

      const result = await runner.afterToolCall({
        toolName: "t",
        toolCallId: "tc-1",
        input: {},
        content: [{ type: "text", text: "original" }],
        details: "orig-details",
        isError: false,
      });

      expect(result).toBeUndefined();
    });

    it("afterToolCall preserves partial modifications", async () => {
      const runner = makeRunner();

      // Only modify content, leave details and isError untouched
      runner.on("tool:result", () => ({
        content: [{ type: "text", text: "modified" }],
      }));

      const result = await runner.afterToolCall({
        toolName: "t",
        toolCallId: "tc-1",
        input: {},
        content: [{ type: "text", text: "original" }],
        details: "keep-this",
        isError: false,
      });

      expect(result).toBeDefined();
      expect(result!.content).toEqual([{ type: "text", text: "modified" }]);
      // details and isError should be from the (unmodified) copy
      expect(result!.details).toBe("keep-this");
      expect(result!.isError).toBe(false);
    });

    it("beforeProviderRequest returns original payload when no handlers modify", async () => {
      const runner = makeRunner();

      runner.on("provider:before-request", () => undefined);

      const payload = { model: "test", messages: [] };
      const result = await runner.beforeProviderRequest(payload);

      expect(result).toBe(payload);
    });
  });

  describe("onError / emitError", () => {
    it("registers and calls error listeners", () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      runner.onError((e) => errors.push(e));

      runner.emitError({ event: "test", error: "test-error" });

      expect(errors).toHaveLength(1);
      expect(errors[0].event).toBe("test");
    });

    it("supports multiple error listeners", () => {
      const runner = makeRunner();
      const a: HookError[] = [];
      const b: HookError[] = [];
      runner.onError((e) => a.push(e));
      runner.onError((e) => b.push(e));

      runner.emitError({ event: "x", error: "y" });

      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });

    it("returns unsubscribe function", () => {
      const runner = makeRunner();
      const errors: HookError[] = [];
      const unsub = runner.onError((e) => errors.push(e));

      runner.emitError({ event: "a", error: "1" });
      expect(errors).toHaveLength(1);

      unsub();
      runner.emitError({ event: "b", error: "2" });
      expect(errors).toHaveLength(1); // still 1
    });
  });

  describe("hasHandlers", () => {
    it("returns false when no handlers registered", () => {
      const runner = makeRunner();
      expect(runner.hasHandlers("agent:start")).toBe(false);
    });

    it("returns true after registering a handler", () => {
      const runner = makeRunner();
      runner.on("agent:start", () => {});
      expect(runner.hasHandlers("agent:start")).toBe(true);
    });

    it("returns false after clear()", () => {
      const runner = makeRunner();
      runner.on("agent:start", () => {});
      runner.clear();
      expect(runner.hasHandlers("agent:start")).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all handlers from all events", async () => {
      const runner = makeRunner();
      const calls: string[] = [];

      runner.on("agent:start", () => {
        calls.push("a");
      });
      runner.on("turn:start", () => {
        calls.push("b");
      });

      runner.clear();

      await runner.emitLifecycle({ type: "agent:start" });
      await runner.emitLifecycle({ type: "turn:start", turnIndex: 0, timestamp: Date.now() });

      expect(calls).toEqual([]);
    });
  });

  describe("async handlers", () => {
    it("supports async reducer handlers", async () => {
      const runner = makeRunner();

      runner.on("context:build", async (messages) => {
        await new Promise((r) => setTimeout(r, 1));
        return [...messages, makeAgentMessage("async-added")];
      });

      const result = await runner.transformContext([makeAgentMessage("hello")]);

      expect(result).toHaveLength(2);
      expect((result[1] as any).content[0].text).toBe("async-added");
    });

    it("supports async lifecycle handlers", async () => {
      const runner = makeRunner();
      const order: string[] = [];

      runner.on("agent:start", async () => {
        await new Promise((r) => setTimeout(r, 1));
        order.push("async-1");
      });
      runner.on("agent:start", () => {
        order.push("sync-2");
      });

      await runner.emitLifecycle({ type: "agent:start" });

      expect(order).toEqual(["async-1", "sync-2"]);
    });
  });
});
