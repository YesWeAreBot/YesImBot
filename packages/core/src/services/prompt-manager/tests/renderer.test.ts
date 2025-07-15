import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Logger, Session } from "koishi";
import { Renderer } from "../renderer";
import { SnippetStore } from "../snippet-store";
import { TemplateStore } from "../template-store";

// Mock Logger
const mockLogger = {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
} as unknown as Logger;

describe("Renderer", () => {
    let templateStore: TemplateStore;
    let snippetStore: SnippetStore;
    let renderer: Renderer;

    beforeEach(() => {
        templateStore = new TemplateStore(mockLogger);
        snippetStore = new SnippetStore(mockLogger);
        renderer = new Renderer(mockLogger, templateStore, snippetStore);
    });

    describe("基本渲染", () => {
        it("应该能渲染简单模板", async () => {
            templateStore.registerTemplate({
                name: "simple",
                content: "Hello {{name}}!",
            });
            snippetStore.register("name", () => "World");

            const result = await renderer.render("simple", {});

            expect(result.content).toBe("Hello World!");
            expect(result.templateName).toBe("simple");
            expect(result.snippetResults).toHaveLength(1);
            expect(result.snippetResults[0].key).toBe("name");
            expect(result.snippetResults[0].value).toBe("World");
            expect(result.renderTime).toBeGreaterThan(0);
        });

        it("应该能渲染带条件的模板", async () => {
            templateStore.registerTemplate({
                name: "conditional",
                content: "{{#hasName}}Hello {{name}}!{{/hasName}}{{^hasName}}Hello stranger!{{/hasName}}",
            });
            snippetStore.register("hasName", () => true);
            snippetStore.register("name", () => "Alice");

            const result = await renderer.render("conditional", {});
            expect(result.content).toBe("Hello Alice!");
        });

        it("应该能渲染循环模板", async () => {
            templateStore.registerTemplate({
                name: "loop",
                content: "{{#items}}{{name}}: {{value}}\n{{/items}}",
            });
            snippetStore.register("items", () => [
                { name: "item1", value: "value1" },
                { name: "item2", value: "value2" },
            ]);

            const result = await renderer.render("loop", {});
            expect(result.content).toBe("item1: value1\nitem2: value2\n");
        });

        it("应该能处理嵌套对象", async () => {
            templateStore.registerTemplate({
                name: "nested",
                content: "User: {{user.name}} ({{user.profile.age}})",
            });
            snippetStore.register("user.name", () => "Bob");
            snippetStore.register("user.profile.age", () => 25);

            const result = await renderer.render("nested", {});
            expect(result.content).toBe("User: Bob (25)");
        });

        it("应该能使用自定义作用域", async () => {
            templateStore.registerTemplate({
                name: "custom",
                content: "{{customValue}} - {{snippetValue}}",
            });
            snippetStore.register("snippetValue", () => "from snippet");

            const result = await renderer.render(
                "custom",
                {},
                {
                    customScope: { customValue: "from scope" },
                }
            );

            expect(result.content).toBe("from scope - from snippet");
        });
    });

    describe("模板引用", () => {
        it("应该能处理模板引用", async () => {
            templateStore.registerTemplate({
                name: "header",
                content: "=== {{title}} ===",
            });
            templateStore.registerTemplate({
                name: "page",
                content: "{{>header}}\n{{content}}",
            });

            snippetStore.register("title", () => "Welcome");
            snippetStore.register("content", () => "Hello World!");

            const result = await renderer.render("page", {});
            expect(result.content).toBe("=== Welcome ===\nHello World!");
        });

        it("应该能处理嵌套模板引用", async () => {
            templateStore.registerTemplate({
                name: "base",
                content: "{{>header}}\n{{>body}}\n{{>footer}}",
            });
            templateStore.registerTemplate({
                name: "header",
                content: "Header: {{title}}",
            });
            templateStore.registerTemplate({
                name: "body",
                content: "Body: {{content}}",
            });
            templateStore.registerTemplate({
                name: "footer",
                content: "Footer: {{year}}",
            });

            snippetStore.register("title", () => "Test");
            snippetStore.register("content", () => "Content");
            snippetStore.register("year", () => "2024");

            const result = await renderer.render("base", {});
            expect(result.content).toBe("Header: Test\nBody: Content\nFooter: 2024");
        });

        it("应该能处理不存在的模板引用", async () => {
            templateStore.registerTemplate({
                name: "with-missing",
                content: "{{>missing-template}}",
            });

            const result = await renderer.render("with-missing", {});
            expect(result.content).toContain("Template 'missing-template' not found");
        });
    });

    describe("直接渲染", () => {
        it("应该能直接渲染模板字符串", async () => {
            snippetStore.register("name", () => "Direct");

            const result = await renderer.renderRaw("Hello {{name}}!", {});
            expect(result.content).toBe("Hello Direct!");
            expect(result.templateName).toContain("<raw-template-");
        });

        it("应该能在直接渲染中使用模板引用", async () => {
            templateStore.registerTemplate({
                name: "partial",
                content: "World",
            });

            const result = await renderer.renderRaw("Hello {{>partial}}!", {});
            expect(result.content).toBe("Hello World!");
        });

        it("应该能提取模板字符串中的依赖", async () => {
            snippetStore.register("var1", () => "value1");
            snippetStore.register("var2", () => "value2");

            const result = await renderer.renderRaw("{{var1}} and {{var2}}", {});
            expect(result.content).toBe("value1 and value2");
            expect(result.snippetResults).toHaveLength(2);
        });
    });

    describe("错误处理", () => {
        it("渲染不存在的模板应该抛出错误", async () => {
            await expect(renderer.render("not-exists", {})).rejects.toThrow("模板 'not-exists' 不存在");
        });

        it("应该能处理循环依赖", async () => {
            templateStore.registerTemplate({
                name: "template1",
                content: "{{>template2}}",
            });
            templateStore.registerTemplate({
                name: "template2",
                content: "{{>template1}}",
            });

            await expect(renderer.render("template1", {})).rejects.toThrow("存在循环依赖");
        });

        it("应该能处理片段执行失败", async () => {
            templateStore.registerTemplate({
                name: "error",
                content: "Value: {{errorValue}}",
            });
            snippetStore.register(
                "errorValue",
                () => {
                    throw new Error("Test error");
                },
                { defaultValue: "default" }
            );

            const result = await renderer.render("error", {});
            expect(result.content).toBe("Value: default");
        });

        it("严格模式下片段失败应该抛出错误", async () => {
            templateStore.registerTemplate({
                name: "strict",
                content: "Value: {{errorValue}}",
            });
            snippetStore.register(
                "errorValue",
                () => {
                    throw new Error("Test error");
                },
                { required: true }
            );

            await expect(renderer.render("strict", {}, { strict: true })).rejects.toThrow("片段执行失败");
        });
    });

    describe("上下文处理", () => {
        it("应该能处理 session 上下文", async () => {
            const mockSession = { userId: "123", username: "test" } as Session;
            snippetStore.register("user.id", (context) => context.session?.userId);

            const result = await renderer.renderRaw("User ID: {{user.id}}", { session: mockSession });
            expect(result.content).toBe("User ID: 123");
        });

        it("应该能处理 bot 上下文", async () => {
            const mockBot = { name: "TestBot", version: "1.0" };
            snippetStore.register("bot.name", (context) => context.bot?.user.name);


            const result = await renderer.renderRaw("Bot: {{bot.name}}", { bot: mockBot } as any);
            expect(result.content).toBe("Bot: TestBot");
        });

        it("应该能处理自定义上下文数据", async () => {
            snippetStore.register("custom.data", (context) => context.customData);

            const result = await renderer.renderRaw("Data: {{custom.data}}", { customData: "test data" });
            expect(result.content).toBe("Data: test data");
        });
    });

    describe("辅助函数", () => {
        it("应该提供 _toString 辅助函数", async () => {
            snippetStore.register("object", () => ({ key: "value" }));

            const result = await renderer.renderRaw("{{#object}}{{_toString}}{{/object}}", {});
            expect(result.content).toBe('{"key":"value"}');
        });

        it("应该提供 _renderParams 辅助函数", async () => {
            snippetStore.register("action", () => ({
                params: { param1: "value1", param2: "value2" },
            }));

            const result = await renderer.renderRaw("{{#action}}{{_renderParams}}{{/action}}", {});
            expect(result.content).toContain("<param1>value1</param1>");
            expect(result.content).toContain("<param2>value2</param2>");
        });
    });

    describe("性能和缓存", () => {
        it("应该能使用缓存选项", async () => {
            let callCount = 0;
            snippetStore.register("cached", () => {
                callCount++;
                return "cached value";
            });

            templateStore.registerTemplate({
                name: "cache-test",
                content: "{{cached}} - {{cached}}",
            });

            const result = await renderer.render("cache-test", {});
            expect(result.content).toBe("cached value - cached value");
            expect(callCount).toBe(1); // 只调用一次，第二次使用缓存
        });

        it("应该能禁用缓存", async () => {
            let callCount = 0;
            snippetStore.register("no-cache", () => {
                callCount++;
                return "value";
            });

            templateStore.registerTemplate({
                name: "no-cache-test",
                content: "{{no-cache}} - {{no-cache}}",
            });

            const result = await renderer.render("no-cache-test", {},);
            expect(result.content).toBe("value - value");
            expect(callCount).toBe(2); // 每次都调用
        });

        it("应该能设置超时时间", async () => {
            snippetStore.register("slow", async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return "slow value";
            });

            templateStore.registerTemplate({
                name: "timeout-test",
                content: "{{slow}}",
            });

            const result = await renderer.render("timeout-test", {}, { timeout: 50 });
            expect(result.snippetResults[0].success).toBe(false);
            expect(result.snippetResults[0].error?.message).toContain("超时");
        });
    });

    describe("资源清理", () => {
        it("应该能清理资源", () => {
            renderer.dispose();

            // 验证清理不会抛出错误
            expect(() => renderer.dispose()).not.toThrow();
        });
    });
});
