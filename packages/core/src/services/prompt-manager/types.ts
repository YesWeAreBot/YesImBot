import type { Bot, Context, Session } from "koishi";

/**
 * 模板定义接口
 */
export interface Template {
    /** 唯一标识，如 'agent.chat.system' */
    name: string;
    /** Mustache 模板字符串 */
    content: string;
    /** 依赖的片段键名 */
    dependencies?: string[];
}

/**
 * 片段配置选项
 */
export interface SnippetOptions {
    /** 缓存时间（毫秒），0 表示不缓存，-1 表示永久缓存 */
    cacheTTL?: number;
    /** 优先级，数字越大优先级越高 */
    priority?: number;
    /** 是否为必需片段，如果执行失败会抛出错误 */
    required?: boolean;
    /** 默认值，当片段执行失败时使用 */
    defaultValue?: any;
    /** 片段描述 */
    description?: string;
}

/**
 * 渲染上下文接口
 */
export interface RenderContext {
    ctx?: Context;
    /** Koishi Session 对象 */
    session?: Session;
    /** Koishi Bot 实例 */
    bot?: Bot;
    /** 自定义数据 */
    [key: string]: any;
}

/**
 * 片段提供函数类型
 */
export type SnippetProvider = (context: RenderContext) => any | Promise<any>;

/**
 * 片段定义接口
 */
export interface Snippet {
    /** 点分隔键名，如 'user.profile.name' */
    key: string;
    /** 数据提供函数 */
    provider: SnippetProvider;
    /** 配置选项 */
    options?: SnippetOptions;
}

/**
 * 渲染选项接口
 */
export interface RenderOptions {
    /** 渲染超时时间（毫秒） */
    timeout?: number;
    /** 是否严格模式，片段执行失败时抛出错误 */
    strict?: boolean;
    /** 自定义变量作用域 */
    customScope?: Record<string, any>;
}

/**
 * 依赖解析结果接口
 */
export interface DependencyResolution {
    /** 需要的片段键名列表 */
    snippetKeys: string[];
    /** 需要的模板引用列表 */
    templateRefs: string[];
    /** 是否存在循环依赖 */
    hasCircularDependency: boolean;
    /** 依赖图 */
    dependencyGraph: Map<string, string[]>;
}

/**
 * 片段执行结果接口
 */
export interface SnippetExecutionResult {
    /** 片段键名 */
    key: string;
    /** 执行结果值 */
    value: any;
    /** 是否成功 */
    success: boolean;
    /** 错误信息（如果失败） */
    error?: Error;
    /** 执行时间（毫秒） */
    executionTime: number;
}

/**
 * 渲染结果接口
 */
export interface RenderResult {
    /** 渲染后的内容 */
    content: string;
    /** 使用的模板名称 */
    templateName: string;
    /** 片段执行结果 */
    snippetResults: SnippetExecutionResult[];
    /** 渲染时间（毫秒） */
    renderTime: number;
    /** 渲染上下文 */
    context: RenderContext;
}

/**
 * 模板验证错误类型
 */
export enum TemplateValidationError {
    INVALID_NAME = "INVALID_NAME",
    EMPTY_CONTENT = "EMPTY_CONTENT",
    CIRCULAR_DEPENDENCY = "CIRCULAR_DEPENDENCY",
    MISSING_DEPENDENCY = "MISSING_DEPENDENCY",
    INVALID_MUSTACHE_SYNTAX = "INVALID_MUSTACHE_SYNTAX",
}

/**
 * 片段验证错误类型
 */
export enum SnippetValidationError {
    INVALID_KEY = "INVALID_KEY",
    INVALID_PROVIDER = "INVALID_PROVIDER",
    DUPLICATE_KEY = "DUPLICATE_KEY",
}

/**
 * PromptManager 配置接口
 */
export interface PromptManagerConfig {
    /** 默认渲染超时时间（毫秒） */
    defaultTimeout?: number;
    /** 是否启用调试模式 */
    debug?: boolean;
}