import { describe, expect, it } from "bun:test";

import { Config } from "../src/Config";

describe("MCP command transformation configuration", () => {
    it("inherits global false when the server override is omitted", () => {
        const config = Config({
            mcpServers: { server: { command: "npx" } },
            globalSettings: { enableCommandTransform: false },
        });

        expect(config.mcpServers.server.enableCommandTransform ?? config.globalSettings.enableCommandTransform).toBe(false);
        expect(config.globalSettings.enableCommandTransform).toBe(false);
    });

    it.each([true, false])("preserves an explicit server override of %s", (enabled) => {
        const config = Config({
            mcpServers: { server: { command: "npx", enableCommandTransform: enabled } },
            globalSettings: { enableCommandTransform: !enabled },
        });

        expect(config.mcpServers.server.enableCommandTransform).toBe(enabled);
    });

    it("keeps the global default enabled when no override is configured", () => {
        const config = Config({ mcpServers: { server: { command: "npx" } } });
        expect(config.globalSettings.enableCommandTransform).toBe(true);
        expect(config.mcpServers.server.enableCommandTransform ?? config.globalSettings.enableCommandTransform).toBe(true);
    });

    it.each([true, false])("retains explicit inheritance after saving with global %s", (enabled) => {
        const input = { mcpServers: { server: { command: "npx", enableCommandTransform: undefined } }, globalSettings: { enableCommandTransform: enabled } };
        const config = Config(Config.simplify(input));
        expect(config.mcpServers.server.enableCommandTransform ?? config.globalSettings.enableCommandTransform).toBe(enabled);
    });
});
