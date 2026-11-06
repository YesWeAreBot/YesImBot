import Mustache from "mustache";

/**
 * 渲染器接口的渲染选项
 */
export interface RenderOptions {
    /**
     * 兼容旧配置；数据不再递归渲染
     */
    maxDepth?: number;
}

/**
 * 渲染器接口
 * 定义了将模板和作用域结合生成最终字符串的标准方法
 */
export interface IRenderer {
    /**
     * 渲染模板
     * @param templateContent - 模板字符串
     * @param scope - 包含所有动态数据的上下文对象
     * @param partials - 用于模板引用的可重用模板片段 (例如 {{> myPartial}})
     * @param options - 渲染选项，如最大深度
     * @returns 渲染后的字符串
     */
    render(templateContent: string, scope: Record<string, any>, partials?: Record<string, string>, options?: RenderOptions): string;
}

/**
 * 基于 Mustache.js 的默认渲染器实现
 * 只渲染可信模板一次
 */
export class MustacheRenderer implements IRenderer {
    public render(templateContent: string, scope: Record<string, any>, partials?: Record<string, string>, _options?: RenderOptions): string {
        // Templates and partials are trusted code; inserted values are terminal data.
        // Re-rendering the output would interpret user messages and tool results as templates.
        return Mustache.render(templateContent, scope, partials, { escape: (text: string) => text });
    }
}
