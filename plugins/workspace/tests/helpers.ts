import { vi } from "vitest";

import type { Workspace } from "../src/workspace";

export interface MockBash {
  exec: ReturnType<typeof vi.fn>;
}

export function createMockWorkspace(): { workspace: Workspace; bash: MockBash } {
  const bash: MockBash = {
    exec: vi.fn(),
  };

  const workspace = {
    bash,
    defaultTimeoutMs: 30000,
  } as unknown as Workspace;

  return { workspace, bash };
}

export function execOk(stdout: string, stderr = "") {
  return { stdout, stderr, exitCode: 0 };
}

export function execFail(stderr: string, exitCode = 1) {
  return { stdout: "", stderr, exitCode };
}
