import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Logger } from "koishi";
import { TemplateStore } from "../template-store";
import { Template } from "../types";

// Mock Logger
const mockLogger = {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
} as unknown as Logger;

describe("TemplateStore", () => {
    let templateStore: TemplateStore;

    beforeEach(() => {
        templateStore = new TemplateStore(mockLogger);
    });

    describe("模板注册和管理", () => {
        it("应该能注册模板", () => {
            const template: Template = {
                name: "test.template",
                content: "Hello {{name}}!",
            };

            templateStore.registerTemplate(template);
            const retrieved = templateStore.getTemplate("test.template");

            expect(retrieved).toEqual(template);
        });

        it("应该能覆盖已存在的模板", () => {
            const template1: Template = {
                name: "test",
                content: "content1",
            };
            const template2: Template = {
                name: "test",
                content: "content2",
            };

            templateStore.registerTemplate(template1);
            templateStore.registerTemplate(template2);

            const retrieved = templateStore.getTemplate("test");
            expect(retrieved?.content).toBe("content2");
        });

        it("应该能批量注册模板", () => {
            const templates: Template[] = [
                { name: "template1", content: "content1" },
                { name: "template2", content: "content2" },
            ];

            templateStore.registerTemplates(templates);

            expect(templateStore.hasTemplate("template1")).toBe(true);
            expect(templateStore.hasTemplate("template2")).toBe(true);
        });

        it("应该能获取所有模板名称", () => {
            templateStore.registerTemplate({ name: "template1", content: "content1" });
            templateStore.registerTemplate({ name: "template2", content: "content2" });

            const names = templateStore.getTemplateNames();
            expect(names).toContain("template1");
            expect(names).toContain("template2");
            expect(names.length).toBe(2);
        });

        it("应该能获取所有模板", () => {
            const template1: Template = { name: "template1", content: "content1" };
            const template2: Template = { name: "template2", content: "content2" };

            templateStore.registerTemplate(template1);
            templateStore.registerTemplate(template2);

            const templates = templateStore.getAllTemplates();
            expect(templates).toHaveLength(2);
            expect(templates).toContainEqual(template1);
            expect(templates).toContainEqual(template2);
        });

        it("应该能注销模板", () => {
            templateStore.registerTemplate({ name: "to-remove", content: "content" });
            expect(templateStore.hasTemplate("to-remove")).toBe(true);

            const result = templateStore.unregisterTemplate("to-remove");
            expect(result).toBe(true);
            expect(templateStore.hasTemplate("to-remove")).toBe(false);
        });

        it("注销不存在的模板应该返回 false", () => {
            const result = templateStore.unregisterTemplate("not-exists");
            expect(result).toBe(false);
        });
    });

    describe("模板验证", () => {
        it("应该拒绝空名称的模板", () => {
            expect(() => {
                templateStore.registerTemplate({ name: "", content: "content" });
            }).toThrow("模板名称不能为空");
        });

        it("应该拒绝空内容的模板", () => {
            expect(() => {
                templateStore.registerTemplate({ name: "test", content: "" });
            }).toThrow("模板内容不能为空");
        });

        it("应该拒绝无效的 Mustache 语法", () => {
            expect(() => {
                templateStore.registerTemplate({ name: "test", content: "{{#unclosed" });
            }).toThrow("INVALID_MUSTACHE_SYNTAX");
        });

        it("应该接受有效的 Mustache 语法", () => {
            expect(() => {
                templateStore.registerTemplate({
                    name: "valid",
                    content: "{{name}} {{#items}}{{.}}{{/items}} {{>partial}}",
                });
            }).not.toThrow();
        });
    });

    describe("依赖解析", () => {
        it("应该能解析简单变量依赖", () => {
            templateStore.registerTemplate({
                name: "simple",
                content: "Hello {{name}} and {{age}}!",
            });

            const deps = templateStore.resolveDependencies("simple");
            expect(deps.snippetKeys).toContain("name");
            expect(deps.snippetKeys).toContain("age");
            expect(deps.hasCircularDependency).toBe(false);
        });

        it("应该能解析区块依赖", () => {
            templateStore.registerTemplate({
                name: "blocks",
                content: "{{#users}}{{name}}{{/users}} {{^empty}}Not empty{{/empty}}",
            });

            const deps = templateStore.resolveDependencies("blocks");
            expect(deps.snippetKeys).toContain("users");
            expect(deps.snippetKeys).toContain("empty");
        });

        it("应该能解析模板引用", () => {
            templateStore.registerTemplate({
                name: "main",
                content: "{{>header}} {{>footer}}",
            });

            const deps = templateStore.resolveDependencies("main");
            expect(deps.templateRefs).toContain("header");
            expect(deps.templateRefs).toContain("footer");
        });

        it("应该能解析嵌套模板依赖", () => {
            templateStore.registerTemplate({
                name: "header",
                content: "Title: {{title}}",
            });
            templateStore.registerTemplate({
                name: "main",
                content: "{{>header}} Content: {{content}}",
            });

            const deps = templateStore.resolveDependencies("main");
            expect(deps.snippetKeys).toContain("title");
            expect(deps.snippetKeys).toContain("content");
            expect(deps.templateRefs).toContain("header");
        });

        it("应该能处理显式依赖", () => {
            templateStore.registerTemplate({
                name: "explicit",
                content: "Content",
                dependencies: ["explicit.dep1", "explicit.dep2"],
            });

            const deps = templateStore.resolveDependencies("explicit");
            expect(deps.snippetKeys).toContain("explicit.dep1");
            expect(deps.snippetKeys).toContain("explicit.dep2");
        });

        it("应该能检测循环依赖", () => {
            templateStore.registerTemplate({
                name: "template1",
                content: "{{>template2}}",
            });
            templateStore.registerTemplate({
                name: "template2",
                content: "{{>template1}}",
            });

            const deps = templateStore.resolveDependencies("template1");
            expect(deps.hasCircularDependency).toBe(true);
        });

        it("应该缓存依赖解析结果", () => {
            templateStore.registerTemplate({
                name: "cached",
                content: "{{value}}",
            });

            // 第一次解析
            const deps1 = templateStore.resolveDependencies("cached");
            // 第二次解析应该使用缓存
            const deps2 = templateStore.resolveDependencies("cached");

            expect(deps1).toBe(deps2); // 应该是同一个对象引用
        });

        it("模板更新时应该清除依赖缓存", () => {
            templateStore.registerTemplate({
                name: "changing",
                content: "{{value1}}",
            });

            const deps1 = templateStore.resolveDependencies("changing");
            expect(deps1.snippetKeys).toContain("value1");

            // 更新模板
            templateStore.registerTemplate({
                name: "changing",
                content: "{{value2}}",
            });

            const deps2 = templateStore.resolveDependencies("changing");
            expect(deps2.snippetKeys).toContain("value2");
            expect(deps2.snippetKeys).not.toContain("value1");
        });
    });
});
