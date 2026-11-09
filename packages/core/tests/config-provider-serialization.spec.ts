import { Schema } from "koishi";
import { expect, it } from "vitest";

import { Config } from "../src/config";
import { PROVIDER_TYPES } from "../src/model/config";
it.each(PROVIDER_TYPES)("accepts a %s provider through the serialized console schema", (type) => {
    const schema = new Schema(JSON.parse(JSON.stringify(Config)));
    expect(() => schema({ providers: [{ name: "test", type, apiKey: "test", accountId: "account123", models: [{ modelId: "m" }] }] })).not.toThrow();
});
it.each([
    ["Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/", "https://generativelanguage.googleapis.com/v1beta/"],
    ["Qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1/", "https://dashscope.aliyuncs.com/api/v1/"],
    ["Ollama", "http://localhost:11434/v1/", "http://localhost:11434/"],
])("migrates only the former official %s root in console validation", (type, oldURL, expected) => {
    const schema = new Schema(JSON.parse(JSON.stringify(Config)));
    const value = (baseURL: string) => ({ providers: [{ name: "test", type, apiKey: "test", baseURL, models: [{ modelId: "m" }] }] });
    expect(schema(value(oldURL)).providers[0].baseURL).toBe(expected);
    expect(schema(value("https://custom.invalid/api/")).providers[0].baseURL).toBe("https://custom.invalid/api/");
});
