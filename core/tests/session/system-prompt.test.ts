import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { InstructionAssembler } from "../../src/services/session/instruction-assembler";
import type { InstructionContributor } from "../../src/services/session/instruction-contributor";
import {
  AGENTS_FILE,
  PERSONA_FILE,
  TOOLS_FILE,
  USER_FILE,
} from "../../src/services/session/instruction-state/layout";
import { InstructionStateService } from "../../src/services/session/instruction-state/service";

const tempDirs: string[] = [];

function createAssemblerSetup(options?: {
  builtInInstructions?: string;
  contributors?: InstructionContributor[];
}): {
  rootDir: string;
  assembler: InstructionAssembler;
  instructionStateService: InstructionStateService;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "athena-system-prompt-assembler-"));
  tempDirs.push(tempDir);

  const instructionStateService = new InstructionStateService(tempDir);
  const assembler = new InstructionAssembler({
    instructionStateService,
    getBuiltInInstructions: (fallback) => options?.builtInInstructions ?? fallback,
    contributors: options?.contributors,
  });

  return { rootDir: tempDir, assembler, instructionStateService };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("InstructionAssembler system prompt assembly", () => {
  it("loads global/channel PERSONA and AGENTS in deterministic order with optional TOOLS", async () => {
    const { rootDir, assembler, instructionStateService } = createAssemblerSetup({
      builtInInstructions: "builtin prompt line",
    });

    instructionStateService.ensureGlobalState();
    instructionStateService.ensureChannelState("discord", "channel-1");

    const globalDir = instructionStateService.getGlobalInstructionsDir();
    const channelDir = instructionStateService.getChannelInstructionsDir("discord", "channel-1");

    writeFileSync(join(globalDir, PERSONA_FILE), "global persona\n", "utf8");
    writeFileSync(join(globalDir, AGENTS_FILE), "global agents\n", "utf8");
    writeFileSync(join(globalDir, TOOLS_FILE), "global tools\n", "utf8");
    writeFileSync(join(channelDir, PERSONA_FILE), "channel persona\n", "utf8");
    writeFileSync(join(channelDir, AGENTS_FILE), "channel agents\n", "utf8");
    writeFileSync(join(channelDir, TOOLS_FILE), "channel tools\n", "utf8");

    const workspaceDir = join(rootDir, "discord-channel-1", "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(workspaceDir, PERSONA_FILE),
      "workspace persona should be ignored\n",
      "utf8",
    );

    const prompt = await assembler.buildSystemPrompt({
      platform: "discord",
      channelId: "channel-1",
      turn: {
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "msg-1",
        timestamp: 1713072000000,
        content: "hello",
        sender: {
          userId: "user-1",
          username: "alice",
          nickname: "Alice",
        },
        isDirect: false,
        atSelf: true,
        isReplyToBot: false,
      },
    });

    expect(prompt).toContain("builtin prompt line");
    expect(prompt).toContain("global persona");
    expect(prompt).toContain("global agents");
    expect(prompt).toContain("global tools");
    expect(prompt).toContain("channel persona");
    expect(prompt).toContain("channel agents");
    expect(prompt).toContain("channel tools");
    expect(prompt).not.toContain("workspace persona should be ignored");

    const globalPersonaIndex = prompt.indexOf("global persona");
    const globalAgentsIndex = prompt.indexOf("global agents");
    const globalToolsIndex = prompt.indexOf("global tools");
    const channelPersonaIndex = prompt.indexOf("channel persona");
    const channelAgentsIndex = prompt.indexOf("channel agents");
    const channelToolsIndex = prompt.indexOf("channel tools");

    expect(globalPersonaIndex).toBeGreaterThanOrEqual(0);
    expect(globalAgentsIndex).toBeGreaterThan(globalPersonaIndex);
    expect(globalToolsIndex).toBeGreaterThan(globalAgentsIndex);
    expect(channelPersonaIndex).toBeGreaterThan(globalToolsIndex);
    expect(channelAgentsIndex).toBeGreaterThan(channelPersonaIndex);
    expect(channelToolsIndex).toBeGreaterThan(channelAgentsIndex);
  });

  it("loads all private/direct instructions from the user state path", async () => {
    const { assembler, instructionStateService } = createAssemblerSetup();
    const userDir = instructionStateService.ensureUserState("discord", "user-1");
    writeFileSync(join(userDir, PERSONA_FILE), "direct persona\n", "utf8");
    writeFileSync(join(userDir, AGENTS_FILE), "direct agents\n", "utf8");
    writeFileSync(join(userDir, TOOLS_FILE), "direct tools\n", "utf8");
    writeFileSync(join(userDir, USER_FILE), "private profile\n", "utf8");

    const baseTurn = {
      kind: "channel_message" as const,
      platform: "discord",
      channelId: "channel-1",
      messageId: "msg-1",
      timestamp: 1713072000000,
      content: "hello",
      sender: {
        userId: "user-1",
        username: "alice",
      },
      atSelf: false,
      isReplyToBot: false,
    };

    const groupPrompt = await assembler.buildSystemPrompt({
      platform: "discord",
      channelId: "channel-1",
      turn: {
        ...baseTurn,
        isDirect: false,
      },
    });
    expect(groupPrompt).not.toContain("direct persona");
    expect(groupPrompt).not.toContain("direct agents");
    expect(groupPrompt).not.toContain("direct tools");
    expect(groupPrompt).not.toContain("private profile");

    const directPrompt = await assembler.buildSystemPrompt({
      platform: "discord",
      channelId: "channel-1",
      turn: {
        ...baseTurn,
        isDirect: true,
      },
    });
    expect(directPrompt).toContain("direct persona");
    expect(directPrompt).toContain("direct agents");
    expect(directPrompt).toContain("direct tools");
    expect(directPrompt).toContain("private profile");
    const runtimeIndex = directPrompt.indexOf("## Runtime Environment");
    const userIndex = directPrompt.indexOf("private profile");
    expect(runtimeIndex).toBeGreaterThanOrEqual(0);
    expect(userIndex).toBeGreaterThan(runtimeIndex);
  });

  it("includes runtime environment block", async () => {
    const { assembler } = createAssemblerSetup();
    const prompt = await assembler.buildSystemPrompt({
      platform: "discord",
      channelId: "channel-1",
      turn: {
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "msg-env-1",
        timestamp: 1713072000000,
        content: "hello",
        sender: {
          userId: "user-1",
          username: "alice",
          nickname: "Alice",
          identity: "title:moderator",
        },
        isDirect: false,
        atSelf: true,
        isReplyToBot: true,
        replyTo: {
          username: "yesimbot",
          nickname: "Athena",
          summary: "quoted",
        },
      },
    });

    expect(prompt).toContain("## Runtime Environment");
    expect(prompt).toContain("Platform: discord");
    expect(prompt).toContain("Conversation type: group");
    expect(prompt).toContain("Mentioned bot: yes");
    expect(prompt).toContain("Reply-to-bot: yes");
    expect(prompt).toContain("Participant identity: title:moderator");
  });

  it("skips TOOLS.md when absent without placeholder sections", async () => {
    const { assembler, instructionStateService } = createAssemblerSetup({
      builtInInstructions: "builtin prompt line",
    });

    instructionStateService.ensureGlobalState();
    instructionStateService.ensureChannelState("discord", "channel-1");

    const globalDir = instructionStateService.getGlobalInstructionsDir();
    const channelDir = instructionStateService.getChannelInstructionsDir("discord", "channel-1");

    writeFileSync(join(globalDir, PERSONA_FILE), "global persona\n", "utf8");
    writeFileSync(join(globalDir, AGENTS_FILE), "global agents\n", "utf8");
    writeFileSync(join(channelDir, PERSONA_FILE), "channel persona\n", "utf8");
    writeFileSync(join(channelDir, AGENTS_FILE), "channel agents\n", "utf8");

    const prompt = await assembler.buildSystemPrompt({
      platform: "discord",
      channelId: "channel-1",
      turn: {
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "msg-no-tools-1",
        timestamp: 1713072000000,
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

    expect(prompt).not.toContain("Global TOOLS.md");
    expect(prompt).not.toContain("Channel TOOLS.md");
    expect(prompt).not.toContain("## Project Context");

    const globalAgentsIndex = prompt.indexOf("global agents");
    const channelPersonaIndex = prompt.indexOf("channel persona");
    expect(globalAgentsIndex).toBeGreaterThanOrEqual(0);
    expect(channelPersonaIndex).toBeGreaterThan(globalAgentsIndex);
  });

  it("sorts contributor blocks deterministically by layer, priority, and key", async () => {
    const contributors: InstructionContributor[] = [
      {
        name: "zeta",
        collect: async () => [
          {
            key: "beta",
            title: "Zeta Beta",
            content: "zeta beta",
            layer: "extension",
            priority: 0,
          },
        ],
      },
      {
        name: "alpha",
        collect: async () => [
          {
            key: "alpha",
            title: "Alpha Alpha",
            content: "alpha alpha",
            layer: "extension",
            priority: 0,
          },
        ],
      },
    ];
    const { assembler } = createAssemblerSetup({ contributors });
    const prompt = await assembler.buildSystemPrompt({
      platform: "discord",
      channelId: "channel-1",
      turn: {
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "msg-order-1",
        timestamp: 1713072000000,
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

    const alphaIndex = prompt.indexOf("alpha alpha");
    const zetaIndex = prompt.indexOf("zeta beta");
    const runtimeIndex = prompt.indexOf("## Runtime Environment");
    expect(runtimeIndex).toBeGreaterThanOrEqual(0);
    expect(alphaIndex).toBeGreaterThan(runtimeIndex);
    expect(zetaIndex).toBeGreaterThan(runtimeIndex);
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(zetaIndex).toBeGreaterThan(alphaIndex);
  });
});
