import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Logger } from "koishi";
import { SnippetStore } from "../snippet-store";
import { Snippet, RenderContext } from "../types";

// Mock Logger
const mockLogger = {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
} as unknown as Logger;

describe("SnippetStore", () => {
    let snippetStore: SnippetStore;

    beforeEach(() => {
        snippetStore = new SnippetStore(mockLogger, 1000, 100); // 1秒缓存，最多100个条目
    });

    describe("片段注册和管理", () => {
        it("应该能注册片段", () => {
            const provider = (context: RenderContext) => "test value";
            const options = { description: "测试片段" };

            snippetStore.registerSnippet({ key: "test.snippet", provider, options });

            const retrieved = snippetStore.getSnippet("test.snippet");
            expect(retrieved).toEqual({
                key: "test.snippet",
                provider,
                options,
            });
        });

        it("应该能使用便捷方法注册片段", () => {
            const provider = () => "value";
            const options = { description: "test" };

            snippetStore.register("convenient", provider, options);

            const retrieved = snippetStore.getSnippet("convenient");
            expect(retrieved?.key).toBe("convenient");
            expect(retrieved?.provider).toBe(provider);
            expect(retrieved?.options).toBe(options);
        });

        it("应该能覆盖已存在的片段", () => {
            const provider1 = () => "value1";
            const provider2 = () => "value2";

            snippetStore.register("test", provider1);
            snippetStore.register("test", provider2);

            const retrieved = snippetStore.getSnippet("test");
            expect(retrieved?.provider).toBe(provider2);
        });

        it("应该能批量注册片段", () => {
            const snippets: Snippet[] = [
                { key: "snippet1", provider: () => "value1" },
                { key: "snippet2", provider: () => "value2" },
            ];

            snippetStore.registerSnippets(snippets);

            expect(snippetStore.hasSnippet("snippet1")).toBe(true);
            expect(snippetStore.hasSnippet("snippet2")).toBe(true);
        });

        it("应该能获取所有片段键名", () => {
            snippetStore.register("snippet1", () => "value1");
            snippetStore.register("snippet2", () => "value2");

            const keys = snippetStore.getSnippetKeys();
            expect(keys).toContain("snippet1");
            expect(keys).toContain("snippet2");
            expect(keys.length).toBe(2);
        });

        it("应该能获取所有片段", () => {
            const snippet1: Snippet = { key: "snippet1", provider: () => "value1" };
            const snippet2: Snippet = { key: "snippet2", provider: () => "value2" };

            snippetStore.registerSnippet(snippet1);
            snippetStore.registerSnippet(snippet2);

            const snippets = snippetStore.getAllSnippets();
            expect(snippets).toHaveLength(2);
            expect(snippets).toContainEqual(snippet1);
            expect(snippets).toContainEqual(snippet2);
        });

        it("应该能注销片段", () => {
            snippetStore.register("to-remove", () => "value");
            expect(snippetStore.hasSnippet("to-remove")).toBe(true);

            const result = snippetStore.unregisterSnippet("to-remove");
            expect(result).toBe(true);
            expect(snippetStore.hasSnippet("to-remove")).toBe(false);
        });

        it("注销不存在的片段应该返回 false", () => {
            const result = snippetStore.unregisterSnippet("not-exists");
            expect(result).toBe(false);
        });
    });

    describe("片段验证", () => {
        it("应该拒绝空键名的片段", () => {
            expect(() => {
                snippetStore.registerSnippet({ key: "", provider: () => "value" });
            }).toThrow("片段键名不能为空");
        });

        it("应该拒绝无效提供函数的片段", () => {
            expect(() => {
                snippetStore.registerSnippet({ key: "test", provider: "not a function" as any });
            }).toThrow("片段提供函数必须是一个函数");
        });
    });

    describe("片段执行", () => {
        it("应该能执行同步片段", async () => {
            snippetStore.register("sync", () => "sync value");

            const result = await snippetStore.executeSnippet("sync", {});

            expect(result.success).toBe(true);
            expect(result.value).toBe("sync value");
            expect(result.key).toBe("sync");

            expect(result.executionTime).toBeGreaterThan(0);
        });

        it("应该能执行异步片段", async () => {
            snippetStore.register("async", async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return "async value";
            });

            const result = await snippetStore.executeSnippet("async", {});

            expect(result.success).toBe(true);
            expect(result.value).toBe("async value");
        });

        it("应该能处理片段执行错误", async () => {
            snippetStore.register("error", () => {
                throw new Error("Test error");
            });

            const result = await snippetStore.executeSnippet("error", {});

            expect(result.success).toBe(false);
            expect(result.value).toBeUndefined();
            expect(result.error?.message).toBe("Test error");
        });

        it("应该能使用默认值处理错误", async () => {
            snippetStore.register(
                "error-with-default",
                () => {
                    throw new Error("Test error");
                },
                { defaultValue: "default value" }
            );

            const result = await snippetStore.executeSnippet("error-with-default", {});

            expect(result.success).toBe(true);
            expect(result.value).toBe("default value");
            expect(result.error).toBeDefined();
        });

        it("必需片段失败时应该返回失败结果", async () => {
            snippetStore.register(
                "required-error",
                () => {
                    throw new Error("Required error");
                },
                { required: true }
            );

            const result = await snippetStore.executeSnippet("required-error", {});

            expect(result.success).toBe(false);
            expect(result.value).toBeUndefined();
        });

        it("应该能处理不存在的片段", async () => {
            const result = await snippetStore.executeSnippet("not-exists", {});

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("片段 'not-exists' 不存在");
        });

        it("应该能处理超时", async () => {
            snippetStore.register("slow", async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return "slow value";
            });

            const result = await snippetStore.executeSnippet("slow", {}, 50);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("超时");
        });

        it("应该能批量执行片段", async () => {
            snippetStore.register("snippet1", () => "value1");
            snippetStore.register("snippet2", () => "value2");

            const results = await snippetStore.executeSnippets(["snippet1", "snippet2"], {});

            expect(results).toHaveLength(2);
            expect(results[0].key).toBe("snippet1");
            expect(results[0].value).toBe("value1");
            expect(results[1].key).toBe("snippet2");
            expect(results[1].value).toBe("value2");
        });
    });
});
