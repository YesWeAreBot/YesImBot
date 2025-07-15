import type { Logger } from "koishi";
import Mustache from "mustache";
import { SnippetStore } from "./snippet-store";
import { TemplateStore } from "./template-store";
import { RenderContext, RenderOptions, RenderResult, SnippetExecutionResult } from "./types";

/**
 * Mustache 渲染器类
 * 负责模板渲染、片段注入和模板继承处理
 */
export class Renderer {
    constructor(private logger: Logger, private templateStore: TemplateStore, private snippetStore: SnippetStore) {
        // 禁用 Mustache 的 HTML 转义，使模板内容原样输出
        Mustache.escape = (text) => text;
    }

    /**
     * 渲染模板
     * @param templateName 模板名称
     * @param context 渲染上下文
     * @param options 渲染选项
     * @returns 渲染结果
     */
    public async render(
        templateName: string,
        context: RenderContext,
        options: RenderOptions = {}
    ): Promise<RenderResult> {
        const startTime = Date.now();

        try {
            const template = this.templateStore.getTemplate(templateName);
            if (!template) {
                throw new Error(`模板 '${templateName}' 不存在`);
            }

            // 解析依赖
            const dependencies = this.templateStore.resolveDependencies(templateName);
            if (dependencies.hasCircularDependency) {
                throw new Error(`模板 '${templateName}' 存在循环依赖`);
            }

            // 执行片段
            const snippetResults = await this.executeSnippets(dependencies.snippetKeys, context, options);

            // 构建作用域对象
            const scope = this.buildScope(snippetResults, context, options.customScope);

            // 构建部分模板映射
            const partials = this.buildPartials(dependencies.templateRefs);

            // 渲染模板
            const content = Mustache.render(template.content, scope, partials);

            const renderTime = Date.now() - startTime;
            const result: RenderResult = {
                content,
                templateName,
                snippetResults,
                renderTime,
                context,
            };

            return result;
        } catch (error) {
            const renderTime = Date.now() - startTime;

            throw error;
        }
    }

    /**
     * 直接渲染模板字符串
     * @param templateContent 模板内容
     * @param context 渲染上下文
     * @param options 渲染选项
     * @returns 渲染结果
     */
    public async renderRaw(
        templateContent: string,
        context: RenderContext,
        options: RenderOptions = {}
    ): Promise<RenderResult> {
        const startTime = Date.now();
        const templateName = `<raw-template-${Date.now()}>`;

        try {
            // 解析模板中的变量和部分模板引用
            const snippetKeys = this.extractSnippetKeys(templateContent);
            const templateRefs = this.extractTemplateRefs(templateContent);

            // 执行片段
            const snippetResults = await this.executeSnippets(snippetKeys, context, options);

            // 构建作用域对象
            const scope = this.buildScope(snippetResults, context, options.customScope);

            // 构建部分模板映射
            const partials = this.buildPartials(templateRefs);

            // 渲染模板
            const content = Mustache.render(templateContent, scope, partials);

            const renderTime = Date.now() - startTime;
            const result: RenderResult = {
                content,
                templateName,
                snippetResults,
                renderTime,
                context,
            };

            return result;
        } catch (error) {
            const renderTime = Date.now() - startTime;

            throw error;
        }
    }

    /**
     * 执行片段
     * @param snippetKeys 片段键名数组
     * @param context 渲染上下文
     * @param options 渲染选项
     * @returns 片段执行结果数组
     */
    private async executeSnippets(
        snippetKeys: string[],
        context: RenderContext,
        options: RenderOptions
    ): Promise<SnippetExecutionResult[]> {
        const timeout = options.timeout ?? 5000;

        const results = await this.snippetStore.executeSnippets(snippetKeys, context, timeout);

        // 处理执行失败的片段
        if (options.strict) {
            const failedResults = results.filter((r) => !r.success);
            if (failedResults.length > 0) {
                const errors = failedResults.map((r) => `${r.key}: ${r.error?.message}`).join(", ");
                throw new Error(`片段执行失败: ${errors}`);
            }
        } else {
            // 记录警告
            const failedResults = results.filter((r) => !r.success);
            for (const result of failedResults) {
                this.logger.warn(`片段 '${result.key}' 执行失败: ${result.error?.message}`);
            }
        }

        return results;
    }

    /**
     * 构建作用域对象
     * @param snippetResults 片段执行结果
     * @param context 渲染上下文
     * @param customScope 自定义作用域
     * @returns 作用域对象
     */
    private buildScope(
        snippetResults: SnippetExecutionResult[],
        context: RenderContext,
        customScope?: Record<string, any>
    ): Record<string, any> {
        const scope: Record<string, any> = {};

        // 添加片段结果到作用域
        for (const result of snippetResults) {
            if (result.success) {
                this.setNestedProperty(scope, result.key, result.value);
            }
        }

        // 添加上下文数据
        if (context.session) {
            scope.session = context.session;
        }
        if (context.bot) {
            scope.bot = context.bot;
        }

        // 添加自定义作用域
        if (customScope) {
            Object.assign(scope, customScope);
        }

        // 添加辅助函数
        scope._toString = function () {
            return _toString(this);
        };
        scope._renderParams = function () {
            const content = [];
            for (let param of Object.keys(this.params || {})) {
                content.push(`<${param}>${_toString(this.params[param])}</${param}>`);
            }
            return content.join("");
        };

        return scope;
    }

    /**
     * 构建部分模板映射
     * @param templateRefs 模板引用数组
     * @returns 部分模板映射
     */
    private buildPartials(templateRefs: string[]): Record<string, string> {
        const partials: Record<string, string> = {};

        for (const templateRef of templateRefs) {
            const template = this.templateStore.getTemplate(templateRef);
            if (template) {
                partials[templateRef] = template.content;
            } else {
                this.logger.warn(`部分模板 '${templateRef}' 不存在`);
                partials[templateRef] = `{{! Template '${templateRef}' not found }}`;
            }
        }

        return partials;
    }

    /**
     * 从模板内容中提取片段键名
     * @param templateContent 模板内容
     * @returns 片段键名数组
     */
    private extractSnippetKeys(templateContent: string): string[] {
        const snippetKeys = new Set<string>();

        try {
            const tokens = Mustache.parse(templateContent);
            this.extractSnippetKeysFromTokens(tokens, snippetKeys);
        } catch (error) {
            this.logger.warn(`解析模板失败: ${error.message}`);
        }

        return Array.from(snippetKeys);
    }

    /**
     * 从模板内容中提取模板引用
     * @param templateContent 模板内容
     * @returns 模板引用数组
     */
    private extractTemplateRefs(templateContent: string): string[] {
        const templateRefs = new Set<string>();

        try {
            const tokens = Mustache.parse(templateContent);
            this.extractTemplateRefsFromTokens(tokens, templateRefs);
        } catch (error) {
            this.logger.warn(`解析模板失败: ${error.message}`);
        }

        return Array.from(templateRefs);
    }

    /**
     * 从 tokens 中提取片段键名
     * @param tokens Mustache tokens
     * @param snippetKeys 片段键名集合
     */
    private extractSnippetKeysFromTokens(tokens: any[], snippetKeys: Set<string>): void {
        for (const token of tokens) {
            const [type, name, , , subTokens] = token;

            switch (type) {
                case "name": // 变量引用 {{variable}}
                case "&": // 非转义变量引用 {{{variable}}}
                    if (name && typeof name === "string") {
                        snippetKeys.add(name);
                    }
                    break;
                case "#": // 区块开始 {{#section}}
                case "^": // 反向区块 {{^section}}
                    if (name && typeof name === "string") {
                        snippetKeys.add(name);
                    }
                    if (subTokens && Array.isArray(subTokens)) {
                        this.extractSnippetKeysFromTokens(subTokens, snippetKeys);
                    }
                    break;
            }
        }
    }

    /**
     * 从 tokens 中提取模板引用
     * @param tokens Mustache tokens
     * @param templateRefs 模板引用集合
     */
    private extractTemplateRefsFromTokens(tokens: any[], templateRefs: Set<string>): void {
        for (const token of tokens) {
            const [type, name, , , subTokens] = token;

            if (type === ">") {
                // 部分模板引用 {{>partial}}
                if (name && typeof name === "string") {
                    templateRefs.add(name);
                }
            } else if (subTokens && Array.isArray(subTokens)) {
                this.extractTemplateRefsFromTokens(subTokens, templateRefs);
            }
        }
    }

    /**
     * 设置嵌套属性
     * @param obj 目标对象
     * @param path 属性路径（点分隔）
     * @param value 值
     */
    private setNestedProperty(obj: any, path: string, value: any): void {
        const keys = path.split(".");
        let current = obj;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
                current[key] = {};
            }
            current = current[key];
        }

        current[keys[keys.length - 1]] = value;
    }

    /**
     * 清理资源
     */
    public dispose(): void {}
}

/**
 * 辅助函数：将对象转换为字符串
 * @param obj 对象
 * @returns 字符串表示
 */
function _toString(obj: any): string {
    if (typeof obj === "string") return obj;
    if (obj === null || obj === undefined) return "";
    return JSON.stringify(obj);
}
