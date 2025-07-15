import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Context, Logger } from "koishi";
import { PromptManager } from "../index";
import { Template, Snippet, RenderContext } from "../types";

// Mock Logger
const mockLogger = {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
} as unknown as Logger;

// Mock Context
// const mockContext = {
//     logger: mockLogger,
// } as unknown as Context;

const mockContext = new Context();

describe("PromptManager", () => {
    let promptManager: PromptManager;

    beforeEach(() => {
        promptManager = new PromptManager(mockContext, {
            debug: true,
        });
    });

    afterEach(() => {
        promptManager.dispose();
    });

    describe("模板管理", () => {
        it("应该能注册和获取模板", () => {
            const template: Template = {
                name: "test.template",
                content: "Hello {{name}}!",
            };

            promptManager.registerTemplate(template.name, template.content, template.dependencies);

            const retrieved = promptManager.getTemplate("test.template");
            expect(retrieved).toEqual(template);
        });

        it("应该能检查模板是否存在", () => {
            promptManager.registerTemplate("exists", "content");

            expect(promptManager.hasTemplate("exists")).toBe(true);
            expect(promptManager.hasTemplate("not-exists")).toBe(false);
        });

        it("应该能获取所有模板名称", () => {
            promptManager.registerTemplate("template1", "content1");
            promptManager.registerTemplate("template2", "content2");

            const names = promptManager.getTemplateNames();
            expect(names).toContain("template1");
            expect(names).toContain("template2");
            expect(names.length).toBe(2);
        });

        it("应该能注销模板", () => {
            promptManager.registerTemplate("to-remove", "content");
            expect(promptManager.hasTemplate("to-remove")).toBe(true);

            const result = promptManager.unregisterTemplate("to-remove");
            expect(result).toBe(true);
            expect(promptManager.hasTemplate("to-remove")).toBe(false);
        });

        it("注销不存在的模板应该返回 false", () => {
            const result = promptManager.unregisterTemplate("not-exists");
            expect(result).toBe(false);
        });

        it("应该能批量注册模板", () => {
            const templates: Template[] = [
                { name: "template1", content: "content1" },
                { name: "template2", content: "content2" },
            ];

            promptManager.registerTemplates(templates);

            expect(promptManager.hasTemplate("template1")).toBe(true);
            expect(promptManager.hasTemplate("template2")).toBe(true);
        });
    });

    describe("片段管理", () => {
        it("应该能注册和获取片段", () => {
            const provider = (context: RenderContext) => "test value";
            const options = { description: "测试片段" };

            promptManager.registerSnippet("test.snippet", provider, options);

            const retrieved = promptManager.getSnippet("test.snippet");
            expect(retrieved).toEqual({
                key: "test.snippet",
                provider,
                options,
            });
        });

        it("应该能检查片段是否存在", () => {
            promptManager.registerSnippet("exists", () => "value");

            expect(promptManager.hasSnippet("exists")).toBe(true);
            expect(promptManager.hasSnippet("not-exists")).toBe(false);
        });

        it("应该能获取所有片段键名", () => {
            promptManager.registerSnippet("snippet1", () => "value1");
            promptManager.registerSnippet("snippet2", () => "value2");

            const keys = promptManager.getSnippetKeys();
            expect(keys).toContain("snippet1");
            expect(keys).toContain("snippet2");
            expect(keys.length).toBe(2);
        });

        it("应该能注销片段", () => {
            promptManager.registerSnippet("to-remove", () => "value");
            expect(promptManager.hasSnippet("to-remove")).toBe(true);

            const result = promptManager.unregisterSnippet("to-remove");
            expect(result).toBe(true);
            expect(promptManager.hasSnippet("to-remove")).toBe(false);
        });

        it("注销不存在的片段应该返回 false", () => {
            const result = promptManager.unregisterSnippet("not-exists");
            expect(result).toBe(false);
        });

        it("应该能批量注册片段", () => {
            const snippets: Snippet[] = [
                { key: "snippet1", provider: () => "value1" },
                { key: "snippet2", provider: () => "value2" },
            ];

            promptManager.registerSnippets(snippets);

            expect(promptManager.hasSnippet("snippet1")).toBe(true);
            expect(promptManager.hasSnippet("snippet2")).toBe(true);
        });
    });

    describe("模板渲染", () => {
        it("应该能渲染简单模板", async () => {
            promptManager.registerTemplate("simple", "Hello {{name}}!");
            promptManager.registerSnippet("name", () => "World");

            const result = await promptManager.render("simple");

            expect(result.content).toBe("Hello World!");
            expect(result.templateName).toBe("simple");
            expect(result.snippetResults).toHaveLength(1);
            expect(result.snippetResults[0].key).toBe("name");
            expect(result.snippetResults[0].value).toBe("World");
            expect(result.snippetResults[0].success).toBe(true);
        });

        it("应该能渲染带条件的模板", async () => {
            promptManager.registerTemplate(
                "conditional",
                "{{#hasName}}Hello {{name}}!{{/hasName}}{{^hasName}}Hello stranger!{{/hasName}}"
            );
            promptManager.registerSnippet("hasName", () => true);
            promptManager.registerSnippet("name", () => "Alice");

            const result = await promptManager.render("conditional");
            expect(result.content).toBe("Hello Alice!");
        });

        it("应该能处理嵌套对象", async () => {
            promptManager.registerTemplate("nested", "User: {{user.name}} ({{user.age}})");
            promptManager.registerSnippet("user.name", () => "Bob");
            promptManager.registerSnippet("user.age", () => 25);

            const result = await promptManager.render("nested");
            expect(result.content).toBe("User: Bob (25)");
        });

        it("应该能处理异步片段", async () => {
            promptManager.registerTemplate("async", "Result: {{asyncValue}}");
            promptManager.registerSnippet("asyncValue", async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return "async result";
            });

            const result = await promptManager.render("async");
            expect(result.content).toBe("Result: async result");
        });

        it("应该能处理片段执行失败", async () => {
            promptManager.registerTemplate("error", "Value: {{errorValue}}");
            promptManager.registerSnippet(
                "errorValue",
                () => {
                    throw new Error("Test error");
                },
                { defaultValue: "default" }
            );

            const result = await promptManager.render("error");
            expect(result.content).toBe("Value: default");
            expect(result.snippetResults[0].success).toBe(true);
            expect(result.snippetResults[0].value).toBe("default");
            expect(result.snippetResults[0].error).toBeDefined();
        });

        it("严格模式下片段失败应该抛出错误", async () => {
            promptManager.registerTemplate("strict", "Value: {{errorValue}}");
            promptManager.registerSnippet(
                "errorValue",
                () => {
                    throw new Error("Test error");
                },
                { required: true }
            );

            await expect(promptManager.render("strict", {}, { strict: true })).rejects.toThrow("片段执行失败");
        });

        it("应该能使用自定义作用域", async () => {
            promptManager.registerTemplate("custom", "{{customValue}} - {{name}}");
            promptManager.registerSnippet("name", () => "test");

            const result = await promptManager.render(
                "custom",
                {},
                {
                    customScope: { customValue: "custom" },
                }
            );

            expect(result.content).toBe("custom - test");
        });
    });

    describe("直接渲染", () => {
        it("应该能直接渲染模板字符串", async () => {
            promptManager.registerSnippet("name", () => "Direct");

            const result = await promptManager.renderRaw("Hello {{name}}!");
            expect(result.content).toBe("Hello Direct!");
        });

        it("应该能处理模板引用", async () => {
            promptManager.registerTemplate("partial", "World");

            const result = await promptManager.renderRaw("Hello {{>partial}}!");
            expect(result.content).toBe("Hello World!");
        });
    });

    describe("错误处理", () => {
        it("渲染不存在的模板应该抛出错误", async () => {
            await expect(promptManager.render("not-exists")).rejects.toThrow("模板 'not-exists' 不存在");
        });

        it("应该能处理无效的 Mustache 语法", () => {
            expect(() => {
                promptManager.registerTemplate("invalid", "{{#unclosed");
            }).toThrow();
        });

        it("应该能处理片段超时", async () => {
            promptManager.registerTemplate("timeout", "{{slowValue}}");
            promptManager.registerSnippet("slowValue", async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return "slow";
            });

            const result = await promptManager.render("timeout", {}, { timeout: 50 });
            expect(result.snippetResults[0].success).toBe(false);
            expect(result.snippetResults[0].error?.message).toContain("超时");
        });
    });

    describe("模板继承和引用", () => {
        it("应该能处理模板引用", async () => {
            promptManager.registerTemplate("header", "=== {{title}} ===");
            promptManager.registerTemplate("page", "{{>header}}\n{{content}}");

            promptManager.registerSnippet("title", () => "Welcome");
            promptManager.registerSnippet("content", () => "Hello World!");

            const result = await promptManager.render("page");
            expect(result.content).toBe("=== Welcome ===\nHello World!");
        });

        it("应该能处理嵌套模板引用", async () => {
            promptManager.registerTemplate("base", "{{>header}}\n{{>body}}\n{{>footer}}");
            promptManager.registerTemplate("header", "Header: {{title}}");
            promptManager.registerTemplate("body", "Body: {{content}}");
            promptManager.registerTemplate("footer", "Footer: {{year}}");

            promptManager.registerSnippet("title", () => "Test");
            promptManager.registerSnippet("content", () => "Content");
            promptManager.registerSnippet("year", () => "2024");

            const result = await promptManager.render("base");
            expect(result.content).toBe("Header: Test\nBody: Content\nFooter: 2024");
        });

        it("应该能处理不存在的模板引用", async () => {
            promptManager.registerTemplate("with-missing", "{{>missing-template}}");

            const result = await promptManager.render("with-missing");
            expect(result.content).toContain("Template 'missing-template' not found");
        });
    });
});
