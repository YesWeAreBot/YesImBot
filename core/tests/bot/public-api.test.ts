import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  AthenaEventMap,
  BotPresentation,
  EventObserver,
  HandleResult,
  ObservedEvent,
  ObserverInput,
  ObserverSource,
  SpeakAnomaly,
  SpeakElementDefinition,
  SpeakElementPromptInfo,
} from "../../src/index.js";
import {
  createDeliveryEvent,
  createSeededRandom,
  planDeliveryTiming,
  splitDeliverySegments,
} from "../../src/internal/delivery.js";

describe("Athena Bot public API boundary", () => {
  it("exports the Athena Bot interaction surface from the core entrypoint", () => {
    const entrypoint = readFileSync(join(process.cwd(), "src", "index.ts"), "utf-8");

    expect(entrypoint).toContain('export { AthenaBot } from "./internal/bot/bot.js";');
    expect(entrypoint).toContain(
      'export { createAthenaEvent, isAthenaEvent, serializeAthenaEvent } from "./internal/bot/events.js";',
    );
    expect(entrypoint).toContain("ExtensionContext");
    expect(entrypoint).toContain("ExtensionDefinition");
    expect(entrypoint).toContain("SpeakElementDefinition");
    expect(entrypoint).toContain("ObservedEvent");
  });

  it("does not export internal module names as stable root API", () => {
    const entrypoint = readFileSync(join(process.cwd(), "src", "index.ts"), "utf-8");
    const legacyBotServiceName = ["Athena", "Bot", "Service"].join("");

    expect(entrypoint).not.toContain("export { SessionStore");
    expect(entrypoint).not.toContain("export { RuntimeController");
    expect(entrypoint).not.toContain("export { ExtensionRuntimeManager");
    expect(entrypoint).not.toContain("export { BotModule }");
    expect(entrypoint).not.toContain(legacyBotServiceName);
  });

  it("does not export Delivery", () => {
    const entrypoint = readFileSync(join(process.cwd(), "src", "index.ts"), "utf-8");

    expect(entrypoint).not.toContain("Delivery");
  });

  it("keeps the public bot type surface exported", () => {
    const _types: {
      eventMap: AthenaEventMap;
      presentation: BotPresentation;
      speakElement: SpeakElementDefinition;
      speakPrompt: SpeakElementPromptInfo;
      anomaly: SpeakAnomaly;
    } = null as never;

    void _types;
  });

  it("exports observer registry type surface", () => {
    const _types: {
      observer: EventObserver;
      result: HandleResult;
      observed: ObservedEvent;
      input: ObserverInput;
      source: ObserverSource;
    } = null as never;

    void _types;
  });

  it("does not keep AthenaBot.observe in the source implementation", () => {
    const source = readFileSync(join(process.cwd(), "src", "internal", "bot", "bot.ts"), "utf-8");

    expect(source).not.toContain("observe(session");
    expect(source).not.toContain("observeChatMessage");
  });
});

describe("delivery utility boundaries", () => {
  it("exports delivery helpers from internal delivery", () => {
    expect(typeof createDeliveryEvent).toBe("function");
    expect(typeof createSeededRandom).toBe("function");
    expect(typeof planDeliveryTiming).toBe("function");
    expect(typeof splitDeliverySegments).toBe("function");
  });
});
