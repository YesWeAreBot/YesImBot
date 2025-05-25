import { Context, Session } from 'koishi';

import { Scenario } from '../Scenario';
import { MessageContext, Middleware } from './base';


export interface ErrorContext {
    scenario?: Scenario | object;
    llmResponse?: string | object;
    session?: Session;
    ctx?: Context;
    additionalInfo?: Record<string, any>;
}

export class ErrorHandlingMiddleware implements Middleware {
    name = 'error-handling';

    constructor(
        private logger: Context['logger'],
        private options?: {
            debug: boolean;
            uploadDump: boolean;
        }
    ) { }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        try {
            // 执行后续中间件
            await next();

        } catch (error) {
            // 记录错误日志

            if (this.options.debug) {
                this.logger.error(error.stack);
            } else {
                this.logger.error(`发生未知错误，已跳过回复:`, error.message);
            }

            try {
                if (this.options?.uploadDump) {
                    const errorDump = this.formatErrorDump(error as Error, {
                        // scenario: await ctx.getScenario(),
                        llmResponse: ctx.llmResponse,
                        session: ctx.koishiSession,
                        ctx: ctx.koishiContext,
                        // additionalInfo: ctx.additionalInfo,
                    });
                    const pasteUrl = await this.uploadToPaste(errorDump);
                    if (pasteUrl) {
                        this.logger.info(`Error dump uploaded to: ${pasteUrl}`);
                    }
                }
            } catch (uploadError) {
                this.logger.error(`Error uploading error dump:`, uploadError.message);
            }
        }
    }

    private async uploadToPaste(content: string): Promise<string | null> {
        try {
            const formData = new FormData();
            formData.append('c', content);

            const response = await fetch('https://dump.yesimbot.chat/', {
                method: "POST",
                body: formData
            });

            const data = await response.json();

            if (data && data.url) {
                return data.url;
            } else {
                console.error('Failed to upload to paste:', data.error || `Status: ${response.status}`);
                return null;
            }
        } catch (error) {
            console.error('Error uploading to dump host:', error.message);
            return null;
        }
    }

    private formatErrorDump(error: Error, context: ErrorContext = {}): string {
        let dump = [
            `## YesImBot Error Dump\n\n`,
            `**Timestamp:** ${new Date().toISOString()}\n\n`,
            `### Error Details`,
            `**Type:** ${error.name}`,
            `**Message:** ${error.message}`,
        ];

        if (error.stack) {
            dump.push(...[
                `**Stack Trace:**`,
                `\n\n`,
                `${error.stack}`,
                `\n\n`,
            ]);
        }

        if (context.session) {
            dump.push(...[
                `### Session Context`,
                `**Platform:** ${context.session.platform}`,
                `**User ID:** ${context.session.userId}`,
                `**Channel ID:** ${context.session.channelId}`,
                `**Guild ID:** ${context.session.guildId || 'N/A'}`,
                `**Self ID:** ${context.session.selfId}`,
                `\n`,
            ]);
        }

        if (context.scenario) {
            dump.push(`### Scenario Context (Rendered or Raw)\n`);
            if (context.scenario instanceof Scenario && typeof context.scenario.render === 'function') {
                dump.push(...[
                    `\n\n`,
                    `${context.scenario.render()}`,
                    `\n\n`,
                ]);
            } else {
                dump.push(...[
                    `\n\n`,
                    `json\n${JSON.stringify(context.scenario, null, 2)}`,
                    `\n\n`,
                ]);
            }
        }

        if (context.llmResponse) {
            dump.push(`### LLM Response (if available)\n`);
            if (typeof context.llmResponse === 'string') {
                dump.push(...[
                    `\n\n`,
                    `${context.llmResponse}`,
                    `\n\n`,
                ]);
            } else {
                dump.push(...[
                    `\n\n`,
                    `json\n${JSON.stringify(context.llmResponse, null, 2)}`,
                    `\n\n`,
                ]);
            }
        }

        if (context.additionalInfo) {
            dump.push(...[
                `### Additional Info\n`,
                `\n\n`,
                `json\n${JSON.stringify(context.additionalInfo, null, 2)}`,
                `\n\n`,
            ]);
        }

        return dump.join('\n');
    }
}
