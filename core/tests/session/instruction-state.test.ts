import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AGENTS_FILE,
  PERSONA_FILE,
  TOOLS_FILE,
  USER_FILE,
  decodeStateKey,
  encodeStateKey,
} from "../../src/services/session/instruction-state/layout";
import { InstructionStateService } from "../../src/services/session/instruction-state/service";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("instruction state layout", () => {
  it("resolves global instruction root to <base>/state/global/instructions", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-instruction-state-global-"));
    tempDirs.push(tempDir);

    const service = new InstructionStateService(join(tempDir, "athena"));

    expect(service.getGlobalInstructionsDir()).toBe(
      join(tempDir, "athena", "state", "global", "instructions"),
    );
  });

  it("resolves channel instruction root to <base>/state/channels/<platform>/<encoded-channel-key>/instructions", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-instruction-state-channel-"));
    tempDirs.push(tempDir);

    const service = new InstructionStateService(join(tempDir, "athena"));
    const encodedChannelId = encodeStateKey("channel/with:special#chars");

    expect(service.getChannelInstructionsDir("discord", "channel/with:special#chars")).toBe(
      join(tempDir, "athena", "state", "channels", "discord", encodedChannelId, "instructions"),
    );
  });

  it("resolves user instruction root to <base>/state/users/<platform>/<encoded-user-key>/instructions", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-instruction-state-user-"));
    tempDirs.push(tempDir);

    const service = new InstructionStateService(join(tempDir, "athena"));
    const encodedUserId = encodeStateKey("user/with:special#chars");

    expect(service.getUserInstructionsDir("discord", "user/with:special#chars")).toBe(
      join(tempDir, "athena", "state", "users", "discord", encodedUserId, "instructions"),
    );
  });

  it("encodes path-safe reversible keys", () => {
    const raw = "user/channel:abc-123_中文/空间";
    const encoded = encodeStateKey(raw);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("/");
    expect(decodeStateKey(encoded)).toBe(raw);
  });

  it("ensure methods create directories but not canonical files", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-instruction-state-ensure-"));
    tempDirs.push(tempDir);

    const service = new InstructionStateService(join(tempDir, "athena"));

    service.ensureGlobalState();
    service.ensureChannelState("discord", "channel-1");
    service.ensureUserState("discord", "user-1");

    const globalInstructionsDir = service.getGlobalInstructionsDir();
    const channelInstructionsDir = service.getChannelInstructionsDir("discord", "channel-1");
    const userInstructionsDir = service.getUserInstructionsDir("discord", "user-1");

    expect(existsSync(globalInstructionsDir)).toBe(true);
    expect(existsSync(channelInstructionsDir)).toBe(true);
    expect(existsSync(userInstructionsDir)).toBe(true);

    expect(existsSync(join(globalInstructionsDir, PERSONA_FILE))).toBe(false);
    expect(existsSync(join(globalInstructionsDir, AGENTS_FILE))).toBe(false);
    expect(existsSync(join(globalInstructionsDir, TOOLS_FILE))).toBe(false);
    expect(existsSync(join(userInstructionsDir, USER_FILE))).toBe(false);
  });

  it("writes meta.json with raw ids and display metadata", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-instruction-state-meta-"));
    tempDirs.push(tempDir);

    const service = new InstructionStateService(join(tempDir, "athena"));

    const channelMetaPath = service.writeChannelMeta({
      platform: "discord",
      channelId: "123456",
      channelName: "project-room",
      kind: "group",
    });
    const userMetaPath = service.writeUserMeta({
      platform: "discord",
      userId: "998877",
      username: "alice",
      displayName: "Alice",
      kind: "private-user",
    });

    expect(JSON.parse(readFileSync(channelMetaPath, "utf8"))).toEqual({
      platform: "discord",
      channelId: "123456",
      channelName: "project-room",
      kind: "group",
    });
    expect(JSON.parse(readFileSync(userMetaPath, "utf8"))).toEqual({
      platform: "discord",
      userId: "998877",
      username: "alice",
      displayName: "Alice",
      kind: "private-user",
    });
  });
});
