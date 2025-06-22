import { Context, Session } from "koishi";
import * as os from "os";
import { v4 as uuidv4 } from "uuid";
import type { GenerateTextResult } from "xsai";
import { BaseMiddleware, MiddlewareContext } from ".";

export interface ErrorReportContext {
    originalError: Error;
    llmResponse?: GenerateTextResult;
    koishiContext?: Context;
    koishiSession?: Session;
    additionalInfo?: Record<string, any>;
    errorId?: string;
}

export interface ErrorHandlingConfig {
    Debug?: boolean;
    UploadDump?: boolean;
    PasteServiceUrl?: string;
    IncludeFullSessionContent?: boolean;
}

export class ErrorHandlingMiddleware extends BaseMiddleware<ErrorHandlingConfig> {
    name = "error-handling";

    // 2. 优化构造函数，使用更清晰的选项接口
    constructor(ctx: Context, config: ErrorHandlingConfig) {
        super("error-handling", ctx, config);
    }

    async execute(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> {
        const logger = this.ctx.logger;
        try {
            await next(); // 执行后续中间件
        } catch (error) {
            const errorId = uuidv4(); // 为每个错误生成一个唯一ID

            // 3. 改进本地日志记录，更详细且带有错误ID
            logger.error(`[Error ID: ${errorId}] 发生未知错误，已跳过回复。`);
            logger.error(`Error Type: ${(error as Error).name}`);
            logger.error(`Error Message: ${(error as Error).message}`);

            if (this.config.Debug) {
                logger.error(`Error Stack:`, (error as Error).stack);
            } else {
                logger.error(`For detailed stack trace, enable debug mode.`);
            }

            // 记录触发错误的用户和频道信息
            if (ctx.koishiSession) {
                logger.error(
                    `Triggered by User: ${ctx.koishiSession.userId} (${ctx.koishiSession.platform}) in Channel: ${ctx.koishiSession.channelId}`
                );
            }

            try {
                if (this.config.UploadDump) {
                    const errorDump = await this.formatErrorDump(error as Error, {
                        originalError: error as Error,
                        llmResponse: ctx.llmResponses?.[0],
                        koishiSession: ctx.koishiSession,
                        koishiContext: ctx.koishiContext,
                        // additionalInfo: ctx.additionalInfo, // 如果 MessageContext 有此字段
                        errorId: errorId,
                    });

                    const pasteUrl = await this.uploadToPaste(errorDump);
                    if (pasteUrl) {
                        logger.info(`[Error ID: ${errorId}] Error dump uploaded to: ${pasteUrl}`);
                        // 4. 可以考虑在这里向用户发送一个友好的提示，告知问题已被记录
                        // 例如：ctx.koishiSession?.send('抱歉，程序遇到了一些问题，我们已记录并会尽快处理。');
                    }
                }
            } catch (uploadError) {
                logger.error(`[Error ID: ${errorId}] Error uploading error dump:`, (uploadError as Error).message);
                if (this.config.Debug) {
                    logger.error(`Upload error stack:`, (uploadError as Error).stack);
                }
            }
        }
    }

    private async uploadToPaste(content: string): Promise<string | null> {
        const logger = this.ctx.logger;
        if (!this.config.PasteServiceUrl) {
            logger.warn("No paste service URL configured. Skipping dump upload.");
            return null;
        }

        try {
            const formData = new FormData();
            formData.append("c", content);

            const response = await fetch(this.config.PasteServiceUrl, {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (data && data.url) {
                return data.url;
            } else {
                logger.error(
                    `Failed to upload to paste service (${this.config.PasteServiceUrl}):`,
                    data.error || `Status: ${response.status} - ${response.statusText}`
                );
                return null;
            }
        } catch (error) {
            logger.error(`Error connecting to dump host (${this.config.PasteServiceUrl}):`, (error as Error).message);
            return null;
        }
    }

    // 5. 极大地美化 formatErrorDump 方法
    private async formatErrorDump(error: Error, context: ErrorReportContext): Promise<string> {
        const dumpSections: string[] = [];

        const packageJson = require("../../package.json");

        // --- Header ---
        dumpSections.push(
            `# YesImBot Error Report\n`,
            `**Error ID:** \`${context.errorId || "N/A"}\`\n`,
            `**Timestamp (UTC):** \`${new Date().toISOString()}\`\n`,
            `**Plugin Version:** \`${packageJson.version}\`\n`,
            `---`
        );

        // --- Error Details ---
        dumpSections.push(`## 🔴 Error Details\n`, `**Type:** \`${error.name}\`\n`, `**Message:** \`${error.message}\`\n`);

        if (error.stack) {
            dumpSections.push(`### Stack Trace:\n`, `\`\`\`typescript\n${error.stack}\n\`\`\``);
        }

        // --- System Information ---
        dumpSections.push(
            `\n---\n`,
            `## ⚙️ System Information\n`,
            `**Node.js Version:** \`${process.version}\`\n`,
            `**Platform:** \`${process.platform} (${os.release()})\`\n`,
            `**Architecture:** \`${process.arch}\`\n`,
            `**CPU Cores:** \`${os.cpus().length}\`\n`,
            `**Total Memory:** \`${(os.totalmem() / 1024 ** 3).toFixed(2)} GB\`\n`
        );

        // --- Session Context ---
        if (context.koishiSession) {
            const session = context.koishiSession;
            dumpSections.push(
                `\n---\n`,
                `## 👥 Session Context\n`,
                `**Platform:** \`${session.platform}\`\n`,
                `**User ID:** \`${session.userId}\`\n`,
                `**Channel ID:** \`${session.channelId}\`\n`,
                `**Guild ID:** \`${session.guildId || "N/A"}\`\n`,
                `**Self ID:** \`${session.selfId}\`\n`,
                `**Message ID:** \`${session.messageId || "N/A"}\`\n`
            );

            // 谨慎包含原始消息内容，考虑敏感信息
            if (this.config.IncludeFullSessionContent && session.content) {
                dumpSections.push(`**Original Message Content (potentially sensitive):**\n`, `\`\`\`text\n${session.content}\n\`\`\``);
            } else if (session.content) {
                dumpSections.push(
                    `**Original Message Content (first 100 chars, truncated):**\n`,
                    `\`\`\`text\n${session.content.substring(0, 100)}${session.content.length > 100 ? "..." : ""}\n\`\`\``
                );
            }
        }

        // --- Scenario Context ---
        // if (context.scenario) {
        //     dumpSections.push(`\n---\n`, `## 📜 Scenario Context\n`);
        //     // 检查 Scenario 是否有 render 方法
        //     if (context.scenario instanceof Scenario && typeof (context.scenario as Scenario).render === "function") {
        //         try {
        //             const scenarioContext = JSON.stringify(await context.scenario.render(), null, 2);
        //             dumpSections.push(`\`\`\`markdown\n${scenarioContext}\n\`\`\``);
        //         } catch (e) {
        //             dumpSections.push(
        //                 `*Failed to render scenario: ${(e as Error).message}*\n\`\`\`json\n${JSON.stringify(
        //                     context.scenario,
        //                     null,
        //                     2
        //                 )}\n\`\`\``
        //             );
        //         }
        //     } else {
        //         dumpSections.push(`\`\`\`json\n${JSON.stringify(context.scenario, null, 2)}\n\`\`\``);
        //     }
        // }

        // --- LLM Response ---
        if (context.llmResponse) {
            dumpSections.push(`\n---\n`, `## 🤖 LLM Response\n`);
            if (typeof context.llmResponse?.text === "string") {
                dumpSections.push(`\`\`\`text\n${context.llmResponse.text}\n\`\`\``);
            }
            dumpSections.push(`\n---\n`, `## Raw Response (if available)\n`);
            dumpSections.push(`\`\`\`json\n${JSON.stringify(context.llmResponse, null, 2)}\n\`\`\``);
        }

        // --- Additional Info ---
        if (context.additionalInfo && Object.keys(context.additionalInfo).length > 0) {
            dumpSections.push(
                `\n---\n`,
                `## ➕ Additional Information\n`,
                `\`\`\`json\n${JSON.stringify(context.additionalInfo, null, 2)}\n\`\`\``
            );
        }

        // --- Footer ---
        dumpSections.push(`\n---\n`, `*This report is generated by YesImBot's error handling middleware.*`);

        return dumpSections.join("\n");
    }
}
