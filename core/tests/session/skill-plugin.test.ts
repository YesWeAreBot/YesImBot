import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context, Logger } from "koishi";
import SkillPlugin from "koishi-plugin-yesimbot-skill";
import { buildWorkspacePluginToolDefinitions } from "koishi-plugin-yesimbot-workspace";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  const createChain = () => ({
    default: () => createChain(),
    required: () => createChain(),
    role: () => createChain(),
    description: () => createChain(),
  });

  class Service<TConfig = unknown> {
    protected ctx: unknown;
    protected config!: TConfig;
    protected logger: Logger;

    constructor(ctx: Context, name: string) {
      this.ctx = ctx;
      this.logger = ctx.logger(name);
    }
  }

  return {
    Context: class {},
    Schema: {
      object: () => createChain(),
      const: () => createChain(),
      boolean: () => createChain(),
      path: () => createChain(),
      array: () => createChain(),
      union: () => createChain(),
    },
    Service,
  };
});

import { PluginService } from "../../src/services/plugin/service";
import { InstructionAssembler } from "../../src/services/session/instruction-assembler";
import type { InstructionContributor } from "../../src/services/session/instruction-contributor";
import { InstructionStateService } from "../../src/services/session/instruction-state/service";

function createLoggerMock(): Logger {
  return {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createContextMock(baseDir: string): Context {
  return {
    baseDir,
    logger: vi.fn(() => createLoggerMock()),
    on: vi.fn(),
  } as unknown as Context;
}

describe("skill plugin", () => {
  it("has no skill tools when the plugin is absent", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-skill-absent-"));
    try {
      const service = new PluginService(createContextMock(baseDir));
      const assembly = await service.assembleTools({
        runtime: {
          channelKey: "discord:channel-1",
          platform: "discord",
          channelId: "channel-1",
          modelId: "test:model",
          basePath: baseDir,
          turn: {
            messageId: "msg-1",
            timestamp: Date.now(),
            isDirect: true,
            atSelf: true,
            isReplyToBot: false,
          },
        },
        hostInput: {},
        scope: "discord:channel-1",
      });

      expect(assembly.supportedTools).not.toHaveProperty("skill");
      expect(assembly.supportedTools).not.toHaveProperty("skill_read");
      expect(assembly.supportedTools).not.toHaveProperty("skill_search");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("keeps runtime workspace-style assembly free of skill tools when standalone plugin is absent", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-runtime-workspace-no-skill-"));
    try {
      const definitions = await buildWorkspacePluginToolDefinitions({
        channelDir: baseDir,
        logger: createLoggerMock(),
        config: {
          enableWorkspace: true,
          enableFilesystem: true,
        },
      });
      const toolNames = new Set(definitions.map((definition) => definition.name));

      expect(toolNames.has("skill")).toBe(false);
      expect(toolNames.has("skill_read")).toBe(false);
      expect(toolNames.has("skill_search")).toBe(false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("exposes skill, skill_read, and skill_search when plugin is installed", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-skill-present-"));
    try {
      const skillsRoot = join(baseDir, "skills");
      const skillRoot = join(skillsRoot, "code-review");
      mkdirSync(join(skillRoot, "references"), { recursive: true });
      writeFileSync(
        join(skillRoot, "SKILL.md"),
        "# Code Review\nReview with confidence and context.",
        "utf8",
      );
      writeFileSync(join(skillRoot, "references", "guide.md"), "Guide content", "utf8");

      const ctx = createContextMock(baseDir);
      const service = new PluginService(ctx);
      const plugin = new SkillPlugin(ctx, { skills: ["skills"] });
      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });

      const assembly = await service.assembleTools({
        runtime: {
          channelKey: "discord:channel-1",
          platform: "discord",
          channelId: "channel-1",
          modelId: "test:model",
          basePath: baseDir,
          turn: {
            messageId: "msg-2",
            timestamp: Date.now(),
            isDirect: true,
            atSelf: true,
            isReplyToBot: false,
          },
        },
        hostInput: {},
        scope: "discord:channel-1",
        toolSettings: {
          enabled: ["skill", "skill_read", "skill_search"],
        },
      });

      expect(assembly.supportedTools).toHaveProperty("skill");
      expect(assembly.supportedTools).toHaveProperty("skill_read");
      expect(assembly.supportedTools).toHaveProperty("skill_search");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("contributes available-skills block without inlining full skill contents", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-skill-contributor-"));
    try {
      const skillsRoot = join(baseDir, "skills");
      const skillRoot = join(skillsRoot, "code-review");
      mkdirSync(skillRoot, { recursive: true });
      writeFileSync(
        join(skillRoot, "SKILL.md"),
        "# Code Review\nShort summary line\n\nFULL_SKILL_CONTENT_SHOULD_NOT_INLINE",
        "utf8",
      );

      const ctx = createContextMock(baseDir);
      const plugin = new SkillPlugin(ctx, { skills: ["skills"] });
      await plugin.init();

      const instructionStateService = new InstructionStateService(baseDir);
      const contributors = plugin.getInstructionContributors() as InstructionContributor[];
      const assembler = new InstructionAssembler({
        instructionStateService,
        getBuiltInInstructions: (fallback) => fallback,
        contributors,
      });

      const prompt = await assembler.buildSystemPrompt({
        platform: "discord",
        channelId: "channel-1",
        turn: {
          kind: "channel_message",
          platform: "discord",
          channelId: "channel-1",
          messageId: "msg-3",
          timestamp: Date.now(),
          content: "hello",
          sender: {
            userId: "user-1",
            username: "alice",
          },
          isDirect: false,
          atSelf: false,
          isReplyToBot: false,
        },
      });

      expect(prompt).toContain("## Available Skills");
      expect(prompt).toContain("code-review");
      expect(prompt).not.toContain("FULL_SKILL_CONTENT_SHOULD_NOT_INLINE");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("rejects skill_read path traversal even without workspace access", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-skill-traversal-"));
    try {
      const skillsRoot = join(baseDir, "skills");
      const skillRoot = join(skillsRoot, "code-review");
      mkdirSync(skillRoot, { recursive: true });
      writeFileSync(join(skillRoot, "SKILL.md"), "# Code Review\nSafe skill root", "utf8");

      const ctx = createContextMock(baseDir);
      const service = new PluginService(ctx);
      const plugin = new SkillPlugin(ctx, { skills: ["skills"] });
      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });

      await expect(
        service.invoke({
          name: "skill_read",
          input: {
            name: "code-review",
            path: "../../etc/passwd",
          },
          runtime: {
            channelKey: "discord:channel-1",
            platform: "discord",
            channelId: "channel-1",
            modelId: "test:model",
            basePath: baseDir,
            turn: {
              messageId: "msg-4",
              timestamp: Date.now(),
              isDirect: true,
              atSelf: true,
              isReplyToBot: false,
            },
          },
          hostInput: {},
          scope: "discord:channel-1",
          toolSettings: {
            enabled: ["skill_read"],
          },
        }),
      ).rejects.toThrow(/outside configured skill root/i);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("rejects skill_read symlink escape outside skill root", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-skill-symlink-escape-"));
    try {
      const skillsRoot = join(baseDir, "skills");
      const skillRoot = join(skillsRoot, "code-review");
      const outsideRoot = join(baseDir, "outside");
      mkdirSync(skillRoot, { recursive: true });
      mkdirSync(outsideRoot, { recursive: true });
      writeFileSync(join(skillRoot, "SKILL.md"), "# Code Review\nSafe skill root", "utf8");
      writeFileSync(join(outsideRoot, "secret.txt"), "secret", "utf8");
      symlinkSync(join(outsideRoot, "secret.txt"), join(skillRoot, "leak.txt"));

      const ctx = createContextMock(baseDir);
      const service = new PluginService(ctx);
      const plugin = new SkillPlugin(ctx, { skills: ["skills"] });
      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });

      await expect(
        service.invoke({
          name: "skill_read",
          input: {
            name: "code-review",
            path: "leak.txt",
          },
          runtime: {
            channelKey: "discord:channel-1",
            platform: "discord",
            channelId: "channel-1",
            modelId: "test:model",
            basePath: baseDir,
            turn: {
              messageId: "msg-5",
              timestamp: Date.now(),
              isDirect: true,
              atSelf: true,
              isReplyToBot: false,
            },
          },
          hostInput: {},
          scope: "discord:channel-1",
          toolSettings: {
            enabled: ["skill_read"],
          },
        }),
      ).rejects.toThrow(/outside configured skill root/i);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("handles missing configured skill roots without leaking raw filesystem errors", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-skill-missing-root-"));
    try {
      const ctx = createContextMock(baseDir);
      const service = new PluginService(ctx);
      const plugin = new SkillPlugin(ctx, { skills: ["missing-skills-root"] });
      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });

      await expect(
        service.invoke({
          name: "skill",
          input: {
            name: "code-review",
          },
          runtime: {
            channelKey: "discord:channel-1",
            platform: "discord",
            channelId: "channel-1",
            modelId: "test:model",
            basePath: baseDir,
            turn: {
              messageId: "msg-6",
              timestamp: Date.now(),
              isDirect: true,
              atSelf: true,
              isReplyToBot: false,
            },
          },
          hostInput: {},
          scope: "discord:channel-1",
          toolSettings: {
            enabled: ["skill"],
          },
        }),
      ).rejects.toThrow(/Skill not found: code-review/);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("rejects SKILL.md symlink escapes and prevents contributor/search leakage", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-skill-file-symlink-escape-"));
    try {
      const skillsRoot = join(baseDir, "skills");
      const skillRoot = join(skillsRoot, "code-review");
      const outsideRoot = join(baseDir, "outside");
      const outsideSkillFile = join(outsideRoot, "outside-skill.md");
      mkdirSync(skillRoot, { recursive: true });
      mkdirSync(outsideRoot, { recursive: true });
      writeFileSync(outsideSkillFile, "# Outside Skill\nLEAKED_CONTENT", "utf8");
      symlinkSync(outsideSkillFile, join(skillRoot, "SKILL.md"));

      const ctx = createContextMock(baseDir);
      const service = new PluginService(ctx);
      const plugin = new SkillPlugin(ctx, { skills: ["skills"] });
      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });

      await expect(
        service.invoke({
          name: "skill",
          input: {
            name: "code-review",
          },
          runtime: {
            channelKey: "discord:channel-1",
            platform: "discord",
            channelId: "channel-1",
            modelId: "test:model",
            basePath: baseDir,
            turn: {
              messageId: "msg-7",
              timestamp: Date.now(),
              isDirect: true,
              atSelf: true,
              isReplyToBot: false,
            },
          },
          hostInput: {},
          scope: "discord:channel-1",
          toolSettings: {
            enabled: ["skill"],
          },
        }),
      ).rejects.toThrow(/outside configured skill root/i);

      await expect(
        service.invoke({
          name: "skill_search",
          input: {
            query: "LEAKED_CONTENT",
          },
          runtime: {
            channelKey: "discord:channel-1",
            platform: "discord",
            channelId: "channel-1",
            modelId: "test:model",
            basePath: baseDir,
            turn: {
              messageId: "msg-8",
              timestamp: Date.now(),
              isDirect: true,
              atSelf: true,
              isReplyToBot: false,
            },
          },
          hostInput: {},
          scope: "discord:channel-1",
          toolSettings: {
            enabled: ["skill_search"],
          },
        }),
      ).resolves.toEqual({ matches: [] });

      const instructionStateService = new InstructionStateService(baseDir);
      const contributors = plugin.getInstructionContributors() as InstructionContributor[];
      const assembler = new InstructionAssembler({
        instructionStateService,
        getBuiltInInstructions: (fallback) => fallback,
        contributors,
      });

      const prompt = await assembler.buildSystemPrompt({
        platform: "discord",
        channelId: "channel-1",
        turn: {
          kind: "channel_message",
          platform: "discord",
          channelId: "channel-1",
          messageId: "msg-9",
          timestamp: Date.now(),
          content: "hello",
          sender: {
            userId: "user-1",
            username: "alice",
          },
          isDirect: false,
          atSelf: false,
          isReplyToBot: false,
        },
      });

      expect(prompt).not.toContain("LEAKED_CONTENT");
      expect(prompt).not.toContain("## Available Skills");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
