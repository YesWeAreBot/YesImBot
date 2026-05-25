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

describe("Athena Bot public API boundary", () => {
  it("exports the Athena Bot interaction surface from the core entrypoint", () => {
    const entrypoint = readFileSync(join(process.cwd(), "src", "index.ts"), "utf-8");

    expect(entrypoint).toContain('export { AthenaBotService } from "./bot/service.js";');
    expect(entrypoint).toContain('export { AthenaBot } from "./bot/athena-bot.js";');
    expect(entrypoint).toContain(
      'export { createAthenaEvent, isAthenaEvent, serializeAthenaEvent } from "./bot/events.js";',
    );
    expect(entrypoint).toContain("AthenaEventMap");
    expect(entrypoint).toContain("BotPresentation");
    expect(entrypoint).toContain("EventObserver");
    expect(entrypoint).toContain("HandleResult");
    expect(entrypoint).toContain("ObservedEvent");
    expect(entrypoint).toContain("ObserverInput");
    expect(entrypoint).toContain("ObserverSource");
    expect(entrypoint).toContain("SpeakElementDefinition");
    expect(entrypoint).toContain("SpeakElementPromptInfo");
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
    const source = readFileSync(join(process.cwd(), "src", "bot", "athena-bot.ts"), "utf-8");

    expect(source).not.toContain("observe(session");
    expect(source).not.toContain("observeChatMessage");
  });
});
