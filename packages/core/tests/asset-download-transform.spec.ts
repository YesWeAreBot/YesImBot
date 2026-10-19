import { h } from "koishi";
import { expect, it, vi } from "vitest";

import { AssetService } from "../src/asset/service";

function fixture(head: () => Promise<any>) {
    const service = Object.create(AssetService.prototype) as AssetService;
    const file = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ type: "text/plain", data: Buffer.from("oversized"), filename: "test.txt" }));
    Object.assign(service, {
        maxFileSizeBytes: 4,
        config: { downloadTimeout: 1000 },
        ctx: { http: { head, file } },
        logger: { error: vi.fn<() => void>() },
    });
    return { service, file };
}

it.each(["missing", "understated", "failed"])("rejects actual oversized download with %s HEAD size", async (mode) => {
    const { service, file } = fixture(async () => {
        if (mode === "failed") throw new Error("HEAD unavailable");
        return { get: () => (mode === "missing" ? undefined : "1") };
    });
    await expect((service as any)._downloadResource("https://example.com/file")).rejects.toThrow("超出限制");
    expect(file).toHaveBeenCalledOnce();
});

it("keeps the HEAD size fast rejection", async () => {
    const { service, file } = fixture(async () => ({ get: () => "100" }));
    await expect((service as any)._downloadResource("https://example.com/file")).rejects.toThrow("超出限制");
    expect(file).not.toHaveBeenCalled();
});

it("returns the persisted deduplicated ID from transformAsync", async () => {
    const { service } = fixture(async () => ({}));
    const prepare = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ id: "existing-asset", persisted: Promise.resolve("existing-asset") }));
    Object.assign(service, { _prepareAsset: prepare });
    const elements = h.parse(await service.transformAsync([h("img", { src: "https://example.com/image" })]));
    expect(elements[0].attrs.id).toBe("existing-asset");
});

it("retains the original source when transformAsync preparation fails", async () => {
    const { service } = fixture(async () => ({}));
    Object.assign(service, {
        _prepareAsset: vi.fn<(...args: any[]) => Promise<any>>(async () => {
            throw new Error("download failed");
        }),
    });
    const original = h("img", { src: "https://example.com/image" });
    expect(await service.transformAsync([original])).toBe(original.toString());
});

it("accepts actual download bytes at the configured limit", async () => {
    const { service, file } = fixture(async () => ({ get: () => undefined }));
    file.mockResolvedValue({ type: "text/plain", data: Buffer.from("1234"), filename: "test.txt" });
    expect(await (service as any)._downloadResource("https://example.com/file")).toMatchObject({ data: Buffer.from("1234") });
});
