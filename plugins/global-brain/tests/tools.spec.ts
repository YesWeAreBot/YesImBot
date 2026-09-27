import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FunctionTool } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

import { createGlobalBrainStore } from "../src/store.js";
import { createBrainTools } from "../src/tools.js";

const scopeA = { type: "guild", platform: "onebot", channelId: "group-a", guildId: "group-a" };

const scopeB = { type: "guild", platform: "onebot", channelId: "group-b", guildId: "group-b" };

/** Tool execution only needs `toolCallId`/`messages`; the brain tools never read the options argument. */
const executionOptions = { toolCallId: "tool-call", messages: [] } as never;

const call = (tool: FunctionTool<any, any>, input: unknown): Promise<any> => Promise.resolve(tool.execute!(input, executionOptions));

function createMemoryAssets() {
  const entries = new Map<string, Uint8Array>();
  return {
    entries,
    put: vi.fn<(bytes: Uint8Array) => Promise<string>>(async (bytes) => {
      const id = `asset-${entries.size + 1}`;
      entries.set(id, bytes.slice());
      return id;
    }),
    get: vi.fn<(id: string) => Promise<Uint8Array>>(async (id) => {
      const bytes = entries.get(id);
      if (!bytes) throw new Error("Asset not found");
      return bytes;
    }),
    clear: vi.fn<() => Promise<void>>(async () => entries.clear()),
  };
}

function createMemoryArtifacts() {
  return {
    open: vi.fn<(uri: string) => Promise<{ bytes: Uint8Array; mediaType: string; filename: string }>>(async () => ({
      bytes: new Uint8Array([4, 5, 6]),
      mediaType: "application/pdf",
      filename: "report.pdf",
    })),
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "global-brain-tools-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("GlobalBrain tools", () => {
  it("exposes only the intended brain_* tools and minimal schemas", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({ filePath: path.join(dir, "brain.jsonl"), maxDigestThreads: 5, maxDigestReplies: 5 });
      await store.init();
      const tools = createBrainTools({ store, scope: scopeA as never, assets: createMemoryAssets(), artifacts: createMemoryArtifacts() });

      expect(Object.keys(tools)).toEqual(["brain_deposit", "brain_read", "brain_reply", "brain_resolve", "brain_status"]);
      const schema = JSON.stringify(Object.values(tools).map((tool) => tool.inputSchema));
      expect(schema).toContain("kind");
      expect(schema).toContain("content");
      expect(schema).toContain("replySource");
      expect(schema).toContain("assetId");
      expect(schema).toContain("artifactUri");
      expect(schema).toContain("forward");
      expect(schema).toContain("shareImmediately");
      for (const forbidden of ["sourceScope", "storageDir", "filePath", "store"]) {
        expect(schema).not.toContain(forbidden);
      }
    });
  });

  it("creates threads, reads replies, relays human answers, and resolves own threads", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({ filePath: path.join(dir, "brain.jsonl"), maxDigestThreads: 5, maxDigestReplies: 5 });
      await store.init();
      const tools = createBrainTools({ store, scope: scopeA as never, assets: createMemoryAssets(), artifacts: createMemoryArtifacts() });

      const created = await call(tools.brain_deposit, { kind: "question", content: "谁有 XX 的资料？", tags: ["search"] });
      expect(created.outcome).toBe("created");

      const reply = await call(tools.brain_reply, {
        threadId: created.thread.id,
        content: "我这边有资料。",
        replySource: "human",
        author: { id: "user-1", name: "Ada" },
      });
      expect(reply).toMatchObject({ outcome: "created", reply: { replySource: "human", author: { id: "user-1", name: "Ada" } } });

      const read = await call(tools.brain_read, { threadId: created.thread.id });
      expect(read).toMatchObject({ outcome: "ok", replies: [{ replySource: "human" }] });

      const resolved = await call(tools.brain_resolve, { threadId: created.thread.id });
      expect(resolved).toEqual({ outcome: "resolved" });

      const status = await call(tools.brain_status, {});
      expect(status).toMatchObject({ outcome: "ok", threads: [{ replyCount: 1 }] });
    });
  });

  it("deposits assets and materializes them into the target scope on read", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({ filePath: path.join(dir, "brain.jsonl"), maxDigestThreads: 5, maxDigestReplies: 5 });
      await store.init();
      const sourceAssets = createMemoryAssets();
      const assetId = "a".repeat(32);
      sourceAssets.entries.set(assetId, new Uint8Array([1, 2, 3]));
      const targetAssets = createMemoryAssets();
      const sourceTools = createBrainTools({ store, scope: scopeA as never, assets: sourceAssets, artifacts: createMemoryArtifacts() });
      const targetTools = createBrainTools({ store, scope: scopeB as never, assets: targetAssets, artifacts: createMemoryArtifacts() });

      const created = await call(sourceTools.brain_deposit, { kind: "share", assetId, content: "一张梗图", tags: ["meme"] });
      expect(created.outcome).toBe("created");
      expect(created.thread.payload).toMatchObject({ kind: "asset", blobId: expect.any(String) });

      const read = await call(targetTools.brain_read, { threadId: created.thread.id });
      expect(read.outcome).toBe("ok");
      expect(read.localAssetUri).toBe("asset://asset-1");
      expect(targetAssets.put).toHaveBeenCalledOnce();
    });
  });

  it("deposits artifact and forward metadata", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({ filePath: path.join(dir, "brain.jsonl"), maxDigestThreads: 5, maxDigestReplies: 5 });
      await store.init();
      const artifacts = createMemoryArtifacts();
      const tools = createBrainTools({ store, scope: scopeA as never, assets: createMemoryAssets(), artifacts });

      const artifact = await call(tools.brain_deposit, { kind: "share", artifactUri: "artifact://web-fetch/0192abcd-0192-7000-8000-000000000000" });
      expect(artifact.outcome).toBe("created");
      expect(artifact.thread.payload).toMatchObject({ kind: "artifact", mediaType: "application/pdf", filename: "report.pdf" });

      const forward = await call(tools.brain_deposit, { kind: "share", forward: { platform: "onebot", forwardId: "forward-1", summary: "炸裂转发" } });
      expect(forward.outcome).toBe("created");
      expect(forward.thread.payload).toMatchObject({ kind: "forward", forwardId: "forward-1" });

      const targetTools = createBrainTools({ store, scope: scopeB as never, assets: createMemoryAssets(), artifacts: createMemoryArtifacts() });
      const read = await call(targetTools.brain_read, { threadId: forward.thread.id });
      expect(read.outcome).toBe("ok");
      expect(read.localForward).toEqual({ forwardId: "forward-1", sendTool: "onebot_send_forward_message" });

      const discordTools = createBrainTools({
        store,
        scope: { ...scopeB, platform: "discord" } as never,
        assets: createMemoryAssets(),
        artifacts: createMemoryArtifacts(),
      });
      const crossRead = await call(discordTools.brain_read, { threadId: forward.thread.id });
      expect(crossRead.outcome).toBe("ok");
      expect(crossRead.localForward).toBeUndefined();
    });
  });

  it("dispatches immediate shares through the optional callback", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({ filePath: path.join(dir, "brain.jsonl"), maxDigestThreads: 5, maxDigestReplies: 5 });
      await store.init();
      const onImmediateShare = vi.fn<(thread: unknown) => Promise<void>>(async () => undefined);
      const tools = createBrainTools({
        store,
        scope: scopeA as never,
        assets: createMemoryAssets(),
        artifacts: createMemoryArtifacts(),
        defaultShareImmediately: true,
        onImmediateShare,
      });

      const created = await call(tools.brain_deposit, { kind: "share", content: "urgent", shareImmediately: true });
      expect(created.outcome).toBe("created");
      expect(onImmediateShare).toHaveBeenCalledTimes(1);
      expect(onImmediateShare).toHaveBeenCalledWith(expect.objectContaining({ id: created.thread.id, kind: "share", content: "urgent" }));

      onImmediateShare.mockClear();
      await call(tools.brain_deposit, { kind: "share", content: "waiting", shareImmediately: false });
      expect(onImmediateShare).not.toHaveBeenCalled();

      await call(tools.brain_deposit, { kind: "share", content: "default immediate" });
      expect(onImmediateShare).toHaveBeenCalledTimes(1);
    });
  });

  it("returns structured failures for unknown threads", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({ filePath: path.join(dir, "brain.jsonl"), maxDigestThreads: 5, maxDigestReplies: 5 });
      await store.init();
      const tools = createBrainTools({ store, scope: scopeA as never, assets: createMemoryAssets(), artifacts: createMemoryArtifacts() });

      const read = await call(tools.brain_read, { threadId: "missing" });
      expect(read).toEqual({ outcome: "failed", error: { code: "thread_not_found", message: "Thread does not exist" } });
    });
  });
});
