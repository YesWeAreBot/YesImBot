import { describe, expect, it } from "vitest";

import { GenericAdapter } from "../../src/adapter/generic.js";

describe("GenericAdapter compatibility", () => {
  it("does not own platform message submission", () => {
    const adapter = new GenericAdapter({} as never, {});
    expect("submitMessage" in adapter).toBe(false);
  });
});
