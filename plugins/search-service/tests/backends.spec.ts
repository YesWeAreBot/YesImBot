import type { AgentPlugin } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

import SearchService from "../src/index.js";

const CONFIGS = {
  tavily: {
    provider: "tavily",
    tavily: { apiKey: "test", searchEndpoint: "https://example.com/search", extractEndpoint: "https://example.com/extract" },
  },
  searxng: { provider: "searxng", searxng: { endpoint: "https://example.com" } },
} as const;

async function withPlugin<T>(provider: keyof typeof CONFIGS, pick: (plugin: AgentPlugin) => T): Promise<T> {
  const serviceLogger = { error: vi.fn(), info: vi.fn() };
  const ctx = { logger: vi.fn(() => serviceLogger), on: vi.fn(), yesimbot: { agent: { use: vi.fn(() => () => undefined) } } };
  const service = new SearchService(ctx as never, CONFIGS[provider] as never);

  await service.start();
  try {
    const plugin = service.setup({} as never, {} as never);
    if (!plugin) throw new Error("expected an agent plugin");
    return pick(plugin);
  } finally {
    await service.stop();
  }
}

describe("search backend tool names", () => {
  it("registers tavily_web_search and tavily_web_scrape", async () => {
    const names = await withPlugin("tavily", async (plugin) => Object.keys((await plugin.extendTools?.()) ?? {}));
    expect(names).toEqual(["tavily_web_search", "tavily_web_scrape"]);
  });

  it("registers searxng_web_search without a scrape tool", async () => {
    const names = await withPlugin("searxng", async (plugin) => Object.keys((await plugin.extendTools?.()) ?? {}));
    expect(names).toEqual(["searxng_web_search"]);
  });

  it("describes the selected backend's concrete tool names", async () => {
    const tavily = await withPlugin("tavily", (plugin) => (plugin.extendInstructions as () => string)());
    const searxng = await withPlugin("searxng", (plugin) => (plugin.extendInstructions as () => string)());
    expect(tavily).toContain("`tavily_web_search`");
    expect(tavily).toContain("`tavily_web_scrape`");
    expect(searxng).toContain("`searxng_web_search`");
  });
});
