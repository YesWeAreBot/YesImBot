import { describe, expect, it } from "vitest";

import { ProviderConfigSchema, PROVIDER_TYPES } from "../src/model/config";
import { ProviderFactoryRegistry } from "../src/model/factories";
import { createNativeFetch } from "../src/model/native-fetch";
import { ProviderInstance } from "../src/model/provider-instance";

const config = (type: string, extra: Record<string, unknown> = {}) => ProviderConfigSchema({ name: "test", type, models: [], ...extra });

describe("provider configuration", () => {
    it("selects native Gemini and Anthropic by provider type without a protocol selector", () => {
        expect(config("Google Gemini").baseURL).toBe("https://generativelanguage.googleapis.com/v1beta/");
        expect(config("Anthropic").baseURL).toBe("https://api.anthropic.com/v1/");
        expect(config("Google Gemini").protocol).toBeUndefined();
        expect(config("Anthropic").protocol).toBeUndefined();
        expect(config("Google Gemini", { baseURL: "https://gateway.example/custom/" }).baseURL).toBe("https://gateway.example/custom/");
    });
    it("offers compatible routing through the explicit compatible provider", () => {
        const value = config("OpenAI Compatible", { baseURL: "https://gateway.example/openai/" });
        expect(value.baseURL).toBe("https://gateway.example/openai/");
    });
    it("does not inject incompatible sampling defaults for Anthropic", () => {
        const native = config("Anthropic", { models: [{ modelId: "claude" }] });
        expect(native.models[0].parameters?.temperature).toBeUndefined();
        expect(native.models[0].parameters?.topP).toBeUndefined();
        const compatible = config("OpenAI Compatible", { models: [{ modelId: "claude" }] });
        expect(compatible.models[0].parameters?.temperature).toBe(0.85);
    });
    it("uses native factory roots when programmatic configs omit baseURL", () => {
        for (const [type, expected] of [
            ["Google Gemini", "https://generativelanguage.googleapis.com/v1beta/"],
            ["Anthropic", "https://api.anthropic.com/v1/"],
        ] as const) {
            const client = ProviderFactoryRegistry.get(type)!.createClient({ name: "test", type, apiKey: "test", models: [] });
            expect(client.chat!("test").baseURL).toBe(expected);
        }
    });
    it("uses dedicated Ollama and Qwen roots rather than compatibility paths", () => {
        expect(config("Ollama").baseURL).toBe("http://localhost:11434/");
        expect(config("Qwen").baseURL).toBe("https://dashscope.aliyuncs.com/api/v1/");
    });
    it("disables unsupported LM Studio native function calling by default", () => {
        const value = config("LM Studio", { models: [{ modelId: "local" }] });
        expect(value.models[0].disableNativeToolCalling).toBe(true);
        expect(value.models[0].abilities).not.toContain("函数调用");
    });
    it("keeps legacy LM Studio models on JSON actions when client tools cannot be represented", () => {
        const value = config("LM Studio", { models: [{ modelId: "local", disableNativeToolCalling: false }] });
        const client = ProviderFactoryRegistry.get(value.type)!.createClient(value);
        const logger = { debug() {}, info() {}, warn() {}, error() {} };
        const instance = new ProviderInstance({ yesimbot: {} } as any, value, client, { getLogger: () => logger } as any);
        expect(instance.getChatModel("local")?.config.disableNativeToolCalling).toBe(true);
    });
    it("requires a Cloudflare account ID and preserves it for the factory", () => {
        expect(() => config("Workers AI")).toThrow(/expected|required/);
        const value = config("Workers AI", { apiKey: "test-key", accountId: "account123" });
        expect(value.accountId).toBe("account123");
        const client = ProviderFactoryRegistry.get(value.type)!.createClient(value);
        expect(client.chat!("test").baseURL).toContain("accounts/account123/");
    });
    it("uses current presets for new local and MiniMax providers", () => {
        expect(config("LM Studio").baseURL).toBe("http://localhost:1234/");
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
    it("routes each dedicated provider through its real native endpoint without a protocol setting", async () => {
        const cases = [
            ["Google Gemini", "test", "/v1beta/models/test:generateContent"],
            ["Anthropic", "test", "/v1/messages"],
            ["Ollama", "test", "/api/chat"],
            ["Qwen", "test", "/api/v1/services/aigc/text-generation/generation"],
            ["Workers AI", "@cf/meta/test", "/client/v4/accounts/account123/ai/run/@cf/meta/test"],
            ["LM Studio", "test", "/api/v1/chat"],
        ] as const;
        for (const [type, model, path] of cases) {
            const value = config(type, { accountId: "account123", models: [{ modelId: model }] });
            const client = ProviderFactoryRegistry.get(value.type)!.createClient(value);
            const options = client.chat!(model);
            let sent: URL | undefined;
            const transport = (async (url: RequestInfo | URL) => {
                sent = new URL(String(url));
                return new Response("test rejection", { status: 429 });
            }) as typeof fetch;
            const response = await createNativeFetch(value, transport)(new URL("chat/completions", options.baseURL), {
                method: "POST",
                body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
            });
            expect(response.status).toBe(429);
            expect(sent?.pathname).toBe(path);
        }
    });
    it("does not preflight or rewrite configured compatibility paths", () => {
        for (const [type, baseURL] of [
            ["Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/"],
            ["Qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1/"],
            ["Ollama", "http://localhost:11434/v1/"],
            ["LM Studio", "http://localhost:1234/v1/"],
        ]) {
            const value = config(type, { baseURL });
            expect(() => createNativeFetch(value, fetch)).not.toThrow();
            expect(value.baseURL).toBe(baseURL);
            expect(createNativeFetch(config("OpenAI Compatible", { baseURL }), fetch)).toBe(fetch);
        }
    });
    it("has a factory for every visible provider preset", () => {
        for (const type of PROVIDER_TYPES) expect(ProviderFactoryRegistry.get(type)).toBeDefined();
    });
});
