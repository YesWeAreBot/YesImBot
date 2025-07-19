import { test, expect, describe, beforeEach, mock } from "bun:test";
import { IRenderer, PromptService } from "../src/services/prompt";
import { Context } from "koishi";

// Mock一个自定义渲染器，用于测试renderer的可替换性
class MockRenderer implements IRenderer {
    render(templateContent: string, scope: Record<string, any>): string {
        // 简单地将 scope 转换成 JSON 字符串，以区分于 Mustache 的行为
        return `MockRendered: ${templateContent} with ${JSON.stringify(scope)}`;
    }
}

describe("通用提示词构建服务 (PromptService)", () => {
    let promptService: PromptService;

    // 在每个测试用例运行前，都创建一个新的 PromptService 实例，确保测试隔离
    beforeEach(() => {
        promptService = new PromptService(new Context(), {});
    });

    describe("初始化与注册", () => {
        test("应该能成功注册并获取一个模板", async () => {
            console.log("测试: 注册并渲染一个简单模板");
            const templateName = "test.simple";
            const templateContent = "你好, {{name}}!";
            promptService.registerTemplate(templateName, templateContent);

            const result = await promptService.render(templateName, { name: "世界" });
            expect(result).toBe("你好, 世界!");
        });

        test("应该能成功注册一个同步 Snippet", async () => {
            console.log("测试: 注册并使用同步 Snippet");
            promptService.registerSnippet("context.platform", () => "Bun");
            promptService.registerTemplate("test.snippet.sync", "运行在 {{context.platform}} 环境");

            const result = await promptService.render("test.snippet.sync");
            expect(result).toBe("运行在 Bun 环境");
        });

        test("应该能成功注册一个异步 Snippet", async () => {
            console.log("测试: 注册并使用异步 Snippet");
            promptService.registerSnippet("data.user", async () => {
                await new Promise((resolve) => setTimeout(resolve, 10)); // 模拟异步IO
                return { name: "异步用户" };
            });
            promptService.registerTemplate("test.snippet.async", "欢迎, {{data.user.name}}");

            const result = await promptService.render("test.snippet.async");
            expect(result).toBe("欢迎, 异步用户");
        });

        test("应该允许使用自定义渲染器", async () => {
            console.log("测试: 使用自定义渲染器进行初始化");
            const customRenderer = new MockRenderer();
            const customPromptService = new PromptService(new Context(), { renderer: customRenderer });

            customPromptService.registerTemplate("custom.test", "模板内容");
            const result = await customPromptService.render("custom.test", { key: "value" });

            expect(result).toBe('MockRendered: 模板内容 with {"key":"value"}');
        });
    });

    describe("核心渲染功能", () => {
        test("渲染时应正确合并 initialScope 和 Snippet 数据", async () => {
            console.log("测试: 渲染作用域合并");
            // 初始作用域传入的数据
            const initialScope = { request: { id: "req-123" } };

            // Snippet 生成的数据
            promptService.registerSnippet("context.time", () => "2023-01-01");

            promptService.registerTemplate("test.scope.merge", "请求ID: {{request.id}}, 时间: {{context.time}}");

            const result = await promptService.render("test.scope.merge", initialScope);
            expect(result).toBe("请求ID: req-123, 时间: 2023-01-01");
        });

        test("Snippet 应该能够访问 initialScope 中的数据", async () => {
            console.log("测试: Snippet 访问初始作用域数据");
            promptService.registerSnippet("user.details", async (scope) => {
                if (scope.userId === "u-001") {
                    return { name: "张三" };
                }
                return { name: "未知用户" };
            });

            promptService.registerTemplate("test.snippet.dependency", "用户名: {{user.details.name}}");

            const result = await promptService.render("test.snippet.dependency", { userId: "u-001" });
            expect(result).toBe("用户名: 张三");
        });

        test("Snippet 应该能够访问其他 Snippet 生成的数据", async () => {
            console.log("测试: Snippet 之间的依赖关系");
            // 注意：Snippet 的执行顺序当前是基于 Map 的插入顺序，测试依赖于此
            promptService.registerSnippet("system.config", () => ({ theme: "dark" }));
            promptService.registerSnippet("ui.themeName", (scope) => {
                return `当前主题是 ${scope.system.config.theme}`;
            });

            promptService.registerTemplate("test.snippet.chain", "{{ui.themeName}}");

            const result = await promptService.render("test.snippet.chain");
            expect(result).toBe("当前主题是 dark");
        });
    });

    describe("结构化与组合", () => {
        test("应该支持通过 Partials 实现模板的组合与复用", async () => {
            console.log("测试: 模板组合 (Partials)");
            promptService.registerTemplate("partial.user", "用户: {{user.name}}");
            promptService.registerTemplate("main.ticket", "--- Ticket ---\n{{> partial.user}}\n内容: {{content}}");

            const result = await promptService.render("main.ticket", {
                user: { name: "李四" },
                content: "这是一个测试工单。",
            });

            expect(result).toContain("用户: 李四");
            expect(result).toContain("内容: 这是一个测试工单。");
            expect(result).toBe("--- Ticket ---\n用户: 李四\n内容: 这是一个测试工单。");
        });

        test("应该能生成结构化的 XML 提示词，且不转义特殊字符", async () => {
            console.log("测试: 生成结构化 XML 提示词");
            const toolList = [{ name: "calculator" }];
            promptService.registerSnippet("tools.xml", () => {
                return toolList.map((t) => `<tool><name>${t.name}</name></tool>`).join("\n");
            });

            promptService.registerTemplate(
                "claude.prompt",
                "<prompt><tools>{{tools.xml}}</tools><query>{{query}}</query></prompt>"
            );

            const result = await promptService.render("claude.prompt", { query: "1+1=?" });

            const expected = "<prompt><tools><tool><name>calculator</name></tool></tools><query>1+1=?</query></prompt>";
            expect(result).toBe(expected);
        });

        test("应该能处理 Mustache 的循环和条件逻辑", async () => {
            console.log("测试: Mustache 的列表循环和条件渲染");
            promptService.registerTemplate(
                "list.template",
                "可用工具:\n{{#tools}}\n- {{name}}\n{{/tools}}\n{{^tools}}没有可用工具。{{/tools}}"
            );

            // Case 1: 有工具
            const resultWithTools = await promptService.render("list.template", {
                tools: [{ name: "搜索" }, { name: "计算" }],
            });
            expect(resultWithTools).toBe("可用工具:\n\n- 搜索\n\n- 计算\n");

            // Case 2: 没有工具
            const resultWithoutTools = await promptService.render("list.template", { tools: [] });
            expect(resultWithoutTools).toBe("可用工具:\n没有可用工具。");
        });
    });

    describe("错误处理与边缘情况", () => {
        test("当渲染一个不存在的模板时，应该抛出错误", async () => {
            console.log("测试: 渲染不存在的模板");
            const renderPromise = promptService.render("nonexistent.template");

            // Bun test 使用 expect().toThrow() 来断言异常
            expect(renderPromise).rejects.toThrow('[PromptService] Template "nonexistent.template" not found.');
        });

        test("当 Snippet 执行失败时，应该捕获错误、打印日志，并注入 null", async () => {
            console.log("测试: Snippet 执行失败的场景");
            const consoleErrorSpy = mock(console.error);

            const errorMessage = "数据库连接失败";
            promptService.registerSnippet("db.user", () => {
                throw new Error(errorMessage);
            });
            promptService.registerTemplate("error.template", "用户信息: {{db.user.name}}");

            const result = await promptService.render("error.template");

            // 因为 db.user 为 null，Mustache 渲染 `{{db.user.name}}` 为空字符串
            expect(result).toBe("用户信息: ");

            // 验证 console.error 被调用
            expect(consoleErrorSpy).toHaveBeenCalled();
            // 验证错误信息包含我们抛出的内容
            const firstCallArgs = consoleErrorSpy.mock.calls[0];
            expect(firstCallArgs[0]).toBe('[PromptService] Error executing snippet "db.user":');
            expect(firstCallArgs[1].message).toBe(errorMessage);

            // 清理 mock
            consoleErrorSpy.mockRestore();
        });

        test("当模板引用的变量或 Snippet 不存在时，应该渲染为空字符串", async () => {
            console.log("测试: 引用不存在的变量");
            promptService.registerTemplate("missing.var", "值: [{{missing.value}}]");
            const result = await promptService.render("missing.var");
            expect(result).toBe("值: []");
        });
    });
});
