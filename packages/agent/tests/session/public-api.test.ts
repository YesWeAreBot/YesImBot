import { describe, expect, it } from "vitest";

import * as sessionApi from "../../src/session/index.js";

describe("@yesimbot/agent session public API", () => {
  it("does not export SettingsManager", () => {
    expect("SettingsManager" in sessionApi).toBe(false);
  });
});
