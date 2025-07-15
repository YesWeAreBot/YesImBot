import Mustache from "mustache";
import type { Logger } from "koishi";
import { Template, DependencyResolution, TemplateValidationError } from "./types";

/**
 * 模板存储管理类
 * 负责模板的注册、存储、验证和依赖解析
 */
export class TemplateStore {
    private templates = new Map<string, Template>();
    private dependencyCache = new Map<string, DependencyResolution>();

    constructor(private logger: Logger) {}

    /**
     * 注册模板
     * @param template 模板定义
     * @throws 如果模板验证失败
     */
    public registerTemplate(template: Template): void {
        this.validateTemplate(template);

        const existingTemplate = this.templates.get(template.name);
        if (existingTemplate) {
            this.logger.warn(`模板 '${template.name}' 已存在，将被覆盖`);
        }

        this.templates.set(template.name, { ...template });

        // 清除相关的依赖缓存
        this.clearDependencyCache(template.name);

        this.logger.debug(`模板 '${template.name}' 注册成功`);
    }

    /**
     * 批量注册模板
     * @param templates 模板数组
     */
    public registerTemplates(templates: Template[]): void {
        for (const template of templates) {
            try {
                this.registerTemplate(template);
            } catch (error) {
                this.logger.error(`注册模板 '${template.name}' 失败: ${error.message}`);
            }
        }
    }

    /**
     * 获取模板
     * @param name 模板名称
     * @returns 模板定义或 undefined
     */
    public getTemplate(name: string): Template | undefined {
        return this.templates.get(name);
    }

    /**
     * 检查模板是否存在
     * @param name 模板名称
     * @returns 是否存在
     */
    public hasTemplate(name: string): boolean {
        return this.templates.has(name);
    }

    /**
     * 获取所有模板名称
     * @returns 模板名称数组
     */
    public getTemplateNames(): string[] {
        return Array.from(this.templates.keys());
    }

    /**
     * 获取所有模板
     * @returns 模板数组
     */
    public getAllTemplates(): Template[] {
        return Array.from(this.templates.values());
    }

    /**
     * 注销模板
     * @param name 模板名称
     * @returns 是否成功注销
     */
    public unregisterTemplate(name: string): boolean {
        const template = this.templates.get(name);
        if (!template) {
            return false;
        }

        this.templates.delete(name);
        this.clearDependencyCache(name);

        this.logger.debug(`模板 '${name}' 注销成功`);

        return true;
    }

    /**
     * 解析模板依赖
     * @param templateName 模板名称
     * @returns 依赖解析结果
     */
    public resolveDependencies(templateName: string): DependencyResolution {
        // 检查缓存
        const cached = this.dependencyCache.get(templateName);
        if (cached) {
            return cached;
        }

        const template = this.templates.get(templateName);
        if (!template) {
            throw new Error(`模板 '${templateName}' 不存在`);
        }

        const result = this.analyzeDependencies(template, new Set());
        this.dependencyCache.set(templateName, result);

        return result;
    }

    /**
     * 验证模板
     * @param template 模板定义
     * @throws 如果验证失败
     */
    private validateTemplate(template: Template): void {
        // 验证模板名称
        if (!template.name || typeof template.name !== "string" || template.name.trim() === "") {
            throw new Error(`${TemplateValidationError.INVALID_NAME}: 模板名称不能为空`);
        }

        // 验证模板内容
        if (!template.content || typeof template.content !== "string" || template.content.trim() === "") {
            throw new Error(`${TemplateValidationError.EMPTY_CONTENT}: 模板内容不能为空`);
        }

        // 验证 Mustache 语法
        try {
            Mustache.parse(template.content);
        } catch (error) {
            throw new Error(`${TemplateValidationError.INVALID_MUSTACHE_SYNTAX}: ${error.message}`);
        }
    }

    /**
     * 分析模板依赖
     * @param template 模板定义
     * @param visited 已访问的模板集合（用于检测循环依赖）
     * @returns 依赖解析结果
     */
    private analyzeDependencies(template: Template, visited: Set<string>): DependencyResolution {
        if (visited.has(template.name)) {
            return {
                snippetKeys: [],
                templateRefs: [],
                hasCircularDependency: true,
                dependencyGraph: new Map(),
            };
        }

        visited.add(template.name);

        const snippetKeys = new Set<string>();
        const templateRefs = new Set<string>();
        const dependencyGraph = new Map<string, string[]>();
        let hasCircularDependency = false;

        // 解析 Mustache 模板，提取变量和部分模板引用
        const tokens = Mustache.parse(template.content);
        this.extractDependenciesFromTokens(tokens, snippetKeys, templateRefs);

        // 添加显式依赖
        if (template.dependencies) {
            template.dependencies.forEach((dep) => snippetKeys.add(dep));
        }

        // 递归解析模板引用的依赖
        const currentDeps: string[] = [];
        for (const templateRef of templateRefs) {
            const refTemplate = this.templates.get(templateRef);
            if (refTemplate) {
                currentDeps.push(templateRef);
                const refDeps = this.analyzeDependencies(refTemplate, new Set(visited));
                if (refDeps.hasCircularDependency) {
                    hasCircularDependency = true;
                }
                refDeps.snippetKeys.forEach((key) => snippetKeys.add(key));
                refDeps.templateRefs.forEach((ref) => templateRefs.add(ref));
            }
        }

        dependencyGraph.set(template.name, currentDeps);
        visited.delete(template.name);

        return {
            snippetKeys: Array.from(snippetKeys),
            templateRefs: Array.from(templateRefs),
            hasCircularDependency,
            dependencyGraph,
        };
    }

    /**
     * 从 Mustache tokens 中提取依赖
     * @param tokens Mustache 解析后的 tokens
     * @param snippetKeys 片段键名集合
     * @param templateRefs 模板引用集合
     */
    private extractDependenciesFromTokens(tokens: any[], snippetKeys: Set<string>, templateRefs: Set<string>): void {
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
                        this.extractDependenciesFromTokens(subTokens, snippetKeys, templateRefs);
                    }
                    break;
                case ">": // 部分模板引用 {{>partial}}
                    if (name && typeof name === "string") {
                        templateRefs.add(name);
                    }
                    break;
            }
        }
    }

    /**
     * 清除依赖缓存
     * @param templateName 模板名称，如果不提供则清除所有缓存
     */
    private clearDependencyCache(templateName?: string): void {
        if (templateName) {
            this.dependencyCache.delete(templateName);
            // 清除可能依赖此模板的其他模板的缓存
            for (const [name, deps] of this.dependencyCache.entries()) {
                if (deps.templateRefs.includes(templateName)) {
                    this.dependencyCache.delete(name);
                }
            }
        } else {
            this.dependencyCache.clear();
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        this.templates.clear();
        this.dependencyCache.clear();
    }
}
