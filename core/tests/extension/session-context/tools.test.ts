import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFindChannelsTool,
  createSearchSessionTool,
  createListSessionsTool,
  createReadSessionWindowTool,
} from "../../../src/extension/session-context/tools";
import { SessionContextConfig } from "../../../src/extension/session-context/types";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "session-context-barrel-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides?: Partial<SessionContextConfig>): SessionContextConfig {
  return {
    sessionsDir: tmpDir,
    isolation: false,
    defaultLimit: 20,
    maxLimit: 100,
    ...overrides,
  };
}

describe("tools barrel", () => {
  it("exports all session-context tool factories", () => {
    expect(typeof createFindChannelsTool).toBe("function");
    expect(typeof createSearchSessionTool).toBe("function");
    expect(typeof createListSessionsTool).toBe("function");
    expect(typeof createReadSessionWindowTool).toBe("function");
  });

  it("createFindChannelsTool returns correct name", () => {
    const tool = createFindChannelsTool(makeConfig(), null);
    expect(tool.name).toBe("find_channels");
  });

  it("createSearchSessionTool returns correct name", () => {
    const tool = createSearchSessionTool(makeConfig(), "test:1");
    expect(tool.name).toBe("search_session");
  });

  it("createListSessionsTool returns correct name", () => {
    const tool = createListSessionsTool(makeConfig(), null);
    expect(tool.name).toBe("list_sessions");
  });
});
