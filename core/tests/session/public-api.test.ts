import { describe, expect, it } from "vitest";

import * as sessionManager from "../../src/services/session/session-manager";

describe("session manager public API", () => {
  it("exports AgentMessage terminology and conversion helpers", () => {
    expect(sessionManager).toHaveProperty("convertAgentMessagesToModelMessages");
    expect(sessionManager).not.toHaveProperty("athenaToModelMessage");
  });
});
