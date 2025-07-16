import Mustache from "mustache";

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
     * @returns 渲染后的字符串
     */
    render(templateContent: string, scope: Record<string, any>, partials?: Record<string, string>): string;
}

/**
 * 基于 Mustache.js 的默认渲染器实现
 */
export class MustacheRenderer implements IRenderer {
    public render(templateContent: string, scope: Record<string, any>, partials?: Record<string, string>): string {
        // 默认禁用 Mustache 的 HTML 转义功能。
        // 这对于生成 XML (如 Claude Prompt) 或纯文本非常重要，
        // 避免 <tag> 被错误地转义为 <tag>。
        return Mustache.render(templateContent, scope, partials, { escape: (text) => text });
    }
}
