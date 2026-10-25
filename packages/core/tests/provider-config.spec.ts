import { describe, expect, it } from "vitest";

import { ProviderConfigSchema, PROVIDER_TYPES } from "../src/model/config";
import { ProviderFactoryRegistry } from "../src/model/factories";

const config = (type: string, extra: Record<string, unknown> = {}) => ProviderConfigSchema({ name: "test", type, models: [], ...extra });

describe("provider configuration", () => {
    it("keeps existing Gemini and Anthropic configurations on the compatible protocol", () => {
        expect(config("Google Gemini").protocol).toBe("openai-compatible");
        expect(config("Google Gemini").baseURL).toContain("/openai/");
        expect(config("Anthropic").protocol).toBe("openai-compatible");
        expect(config("Google Gemini", { baseURL: "https://gateway.example/custom/" }).baseURL).toBe("https://gateway.example/custom/");
    });
    it("supplies native roots only when explicitly selected", () => {
        expect(config("Google Gemini", { protocol: "gemini-native" }).baseURL).toBe("https://generativelanguage.googleapis.com/v1beta/");
        expect(config("Anthropic", { protocol: "anthropic-native" }).baseURL).toBe("https://api.anthropic.com/v1/");
        expect(() => config("OpenAI", { protocol: "gemini-native" })).toThrow(/expected|required/);
        expect(() => config("Google Gemini", { protocol: "anthropic-native" })).toThrow(/expected|required/);
    });
    it("does not inject incompatible sampling defaults for native Anthropic", () => {
        const native = config("Anthropic", { protocol: "anthropic-native", models: [{ modelId: "claude" }] });
        expect(native.models[0].parameters?.temperature).toBeUndefined();
        expect(native.models[0].parameters?.topP).toBeUndefined();
        const compatible = config("Anthropic", { models: [{ modelId: "claude" }] });
        expect(compatible.models[0].parameters?.temperature).toBe(0.85);
    });
    it("uses native factory roots when programmatic configs omit baseURL", () => {
        for (const [type, protocol, expected] of [
            ["Google Gemini", "gemini-native", "https://generativelanguage.googleapis.com/v1beta/"],
            ["Anthropic", "anthropic-native", "https://api.anthropic.com/v1/"],
        ] as const) {
            const client = ProviderFactoryRegistry.get(type)!.createClient({ name: "test", type, protocol, apiKey: "test", models: [] });
            expect(client.chat!("test").baseURL).toBe(expected);
        }
    });
    it("requires a Cloudflare account ID and preserves it for the factory", () => {
        expect(() => config("Workers AI")).toThrow(/expected|required/);
        const value = config("Workers AI", { apiKey: "test-key", accountId: "account123" });
        expect(value.accountId).toBe("account123");
        const client = ProviderFactoryRegistry.get(value.type)!.createClient(value);
        expect(client.chat!("test").baseURL).toContain("accounts/account123/");
    });
    it("uses current presets for new local and MiniMax providers", () => {
        expect(config("LM Studio").baseURL).toBe("http://localhost:1234/v1/");
        expect(config("Minimax").baseURL).toBe("https://api.minimax.cn/v1/");
        expect(config("Minimax (International)").baseURL).toBe("https://api.minimax.io/v1/");
    });
    it("supports the corrected Featherless name and the existing saved key", () => {
        for (const type of ["Featherless AI", "Fatherless AI"]) {
            const value = config(type);
            expect(value.baseURL).toBe("https://api.featherless.ai/v1/");
            expect(ProviderFactoryRegistry.get(value.type)?.createClient(value).chat).toBeTypeOf("function");
        }
    });
    it("has a factory for every visible provider preset", () => {
        for (const type of PROVIDER_TYPES) expect(ProviderFactoryRegistry.get(type)).toBeDefined();
    });
});
