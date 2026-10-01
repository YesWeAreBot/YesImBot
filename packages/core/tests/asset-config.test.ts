// Build the core package before running these runtime configuration regressions.
import { expect, it } from "bun:test";
import { Context } from "koishi";
import { Config } from "../lib/config";
import { AssetService } from "../lib/services/assets/service";
import { Services } from "../lib/shared/constants";

const logger = { extend: () => logger, debug() {}, info() {}, success() {}, warn() {}, error() {} };

function assets(config: Config, size = 0) {
    const ctx = new Context();
    ctx[Services.Logger] = { getLogger: () => logger } as any;
    // Only HTTP responses are simulated; the real resource size check runs unchanged.
    ctx.http = {
        head: async () => new Headers({ "content-length": String(size) }),
        file: async () => ({ type: "text/plain", data: Buffer.from("asset"), filename: "asset.txt" }),
    } as any;
    return new AssetService(ctx, config);
}

it("keeps resource size configuration in MB for the caller and service", () => {
    const config = Config({ maxFileSize: 2 });
    const service = assets(config);
    expect(config.maxFileSize).toBe(2);
    expect(service.config.maxFileSize).toBe(2);
});

it("keeps the HTTP limit after constructing again with the same configuration", async () => {
    const config = Config({ maxFileSize: 2 });
    assets(config);
    const reloaded = assets(config, 2 * 1024 * 1024 + 1);
    await expect((reloaded as any)._downloadResource("https://assets.invalid/large")).rejects.toThrow("超出限制");
    expect(config.maxFileSize).toBe(2);
});

it("accepts an HTTP resource whose size exactly equals the configured MiB limit", async () => {
    const service = assets(Config({ maxFileSize: 2 }), 2 * 1024 * 1024);
    expect(await (service as any)._downloadResource("https://assets.invalid/exact")).toEqual({
        type: "text/plain", data: Buffer.from("asset"), filename: "asset.txt",
    });
});
