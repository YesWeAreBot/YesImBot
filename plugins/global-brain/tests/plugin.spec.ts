import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentPlugin, StepOptions, ToolSet } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

import GlobalBrainPlugin from "../src/index.js";

function createMemoryAssets() {
  return { put: vi.fn(async () => "asset-1"), get: vi.fn(async () => new Uint8Array()), clear: vi.fn(async () => undefined) };
}

function createMemoryArtifacts() {
  return { open: vi.fn(async () => ({ bytes: new Uint8Array(), mediaType: "text/plain" })) };
}

function createContext(baseDir: string) {
  const scopedLogger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const rootLogger = Object.assign(
    vi.fn(() => scopedLogger),
    scopedLogger,
  );
  const plugins: Array<{ init: (scope: unknown, bot: unknown) => Promise<AgentPlugin | null> }> = [];
  const dispose = vi.fn<() => void>();
  const trigger = vi.fn(async () => undefined);
  const resources = { assets: createMemoryAssets(), artifacts: createMemoryArtifacts(), path: baseDir };
  const ctx = {
    baseDir,
    logger: rootLogger,
    on: vi.fn(),
    yesimbot: {
      agent: {
        use: vi.fn((plugin: (typeof plugins)[number]) => {
          plugins.push(plugin);
          return dispose;
        }),
      },
      resource: { get: vi.fn(async () => resources) },
      messenger: { post: trigger },
    },
  };
  return { ctx, dispose, plugins, trigger };
}

function channelScope(channelId: string) {
  return { type: "guild", platform: "onebot", channelId, guildId: channelId };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "global-brain-plugin-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function getTools(plugin: AgentPlugin): Promise<ToolSet> {
  return (await plugin.extendTools?.()) ?? {};
}

describe("GlobalBrainPlugin", () => {
  it("loads the custom prompt through the named agent plugin", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, plugins } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(ctx as never, { storageDir: baseDir, brainPrompt: "custom global brain prompt" } as never);
      await plugin.start();
      const runtimePlugin = await plugins[0]!.setup(channelScope("group-a"), { selfId: "bot-a" });

      expect(String(await runtimePlugin?.extendInstructions?.())).toBe("custom global brain prompt");
    });
  });

  it("registers one named plugin and exposes brain tools per channel", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, plugins, dispose } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(
        ctx as never,
        { storageDir: baseDir, maxDigestThreads: 5, maxDigestReplies: 5, maxDigestContentLength: 80 } as never,
      );
      await plugin.start();
      const runtimePlugin = await plugins[0]!.setup(channelScope("group-a"), { selfId: "bot-a" });
      const tools = await getTools(runtimePlugin!);

      expect(ctx.yesimbot.agent.use).toHaveBeenCalledOnce();
      expect(Object.keys(tools)).toEqual(["brain_deposit", "brain_read", "brain_reply", "brain_resolve", "brain_status"]);
      await plugin.stop();
      expect(dispose).toHaveBeenCalledOnce();
    });
  });

  it("submits an immediate share through Messenger.post with the producing Bot identity", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, plugins, trigger } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(
        ctx as never,
        { storageDir: baseDir, maxDigestThreads: 5, maxDigestReplies: 5, maxDigestContentLength: 80 } as never,
      );
      await plugin.start();
      const runtimePlugin = await plugins[0]!.setup(channelScope("group-a"), { selfId: "bot-a" });
      await plugins[0]!.setup(channelScope("group-b"), { selfId: "bot-a" });
      const deposit = (await getTools(runtimePlugin!)).brain_deposit!;

      await deposit.execute({ kind: "share", content: "urgent", shareImmediately: true } as never, {} as never);
      await Promise.resolve();

      expect(trigger).toHaveBeenCalledOnce();
      expect(trigger.mock.calls[0]?.[0]).toMatchObject({ eventType: "global-brain.immediate", selfId: "bot-a" });
    });
  });

  it("appends the brain digest as a tail user message instead of prepending system content", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, plugins } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(
        ctx as never,
        { storageDir: baseDir, maxDigestThreads: 5, maxDigestReplies: 5, maxDigestContentLength: 80, maxBlobBytes: 5 * 1024 * 1024 } as never,
      );
      await plugin.start();
      const runtimePluginA = await plugins[0]!.setup(channelScope("group-a"), { selfId: "bot-a" });
      const runtimePluginB = await plugins[0]!.setup(channelScope("group-b"), { selfId: "bot-a" });
      const deposit = (await getTools(runtimePluginA!)).brain_deposit!;

      await deposit.execute({ kind: "share", content: "cache-safe global brain note" } as never, {} as never);

      const input = [{ role: "user", content: "hello" }];
      const result = (await runtimePluginB!.prepareStep!({ messages: input, turnId: "turn-1" } as unknown as StepOptions))!;

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toEqual(input[0]);
      expect(result.messages[1]).toMatchObject({ role: "user" });
      expect(String((result.messages[1] as { content?: string }).content)).toContain("全局脑摘要");
      expect(String((result.messages[1] as { content?: string }).content)).toContain("cache-safe global brain note");
    });
  });
});
