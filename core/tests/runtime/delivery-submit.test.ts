import { describe, expect, it } from "vitest";

import * as delivery from "../../src/runtime/delivery";

describe("runtime delivery boundary", () => {
  it("does not export the retired Delivery class", () => {
    expect("Delivery" in delivery).toBe(false);
  });

  it("keeps timing and event helpers available", () => {
    expect(delivery.planDeliveryTiming).toBeTypeOf("function");
    expect(delivery.createDeliveryEvent).toBeTypeOf("function");
  });
});
