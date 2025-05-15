import { Context, Session } from 'koishi';

import { Scenario } from '../Scenario';
import { ConversationState, MessageContext, Middleware, MiddlewareManager } from './base';
import { CheckReplyConditionMiddleware } from './CheckReplyCondition';


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
        private middlewareManager: MiddlewareManager,
        private options?: {
            uploadDump?: boolean;
        }
    ) { }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        try {
            // 执行后续中间件
            await next();
        } catch (error) {
            // 记录错误日志
            this.logger.error(`Error in session ${ctx.koishiSession.id}:`, error.message);
            this.logger.error(`Error stack trace:`, error.stack);

            try {
                if (this.options?.uploadDump) {
                    const errorDump = this.formatErrorDump(error as Error, {
                        scenario: await ctx.getScenario(),
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

            // 重置会话状态
            await ctx.transitionTo(ConversationState.IDLE);

            // 释放频道处理状态
            const checkReplyConditionMiddleware = this.middlewareManager.getMiddleware('check-reply-condition') as CheckReplyConditionMiddleware;
            if (checkReplyConditionMiddleware) {
                checkReplyConditionMiddleware.releaseChannelState(ctx.koishiSession.channelId);
            }
        }
    }

    private async uploadToPaste(content: string): Promise<string | null> {
        try {
            const formData = new FormData();
            formData.append('c', content);

            const response = await fetch('https://dump.thfls.club/', {
                method: 'POST',
                body: formData,
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            })

            const data = await response.json();

            if (data && data.url) {
                return data.url;
            } else {
                console.error('Failed to upload to paste:', data.error || `Status: ${response.status}`);
                return null;
            }
        } catch (error) {
            const err = error as any;
            console.error('Error uploading to dump host:', err.message || err);
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
            dump.concat([
                `**Stack Trace:**`,
                `\n\n`,
                `${error.stack}`,
                `\n\n`,
            ]);
        }

        if (context.session) {
            dump.concat([
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
                dump.concat([
                    `\n\n`,
                    `${context.scenario.render()}`,
                    `\n\n`,
                ]);
            } else {
                dump.concat([
                    `\n\n`,
                    `json\n${JSON.stringify(context.scenario, null, 2)}`,
                    `\n\n`,
                ]);
            }
        }

        if (context.llmResponse) {
            dump.push(`### LLM Response (if available)\n`);
            if (typeof context.llmResponse === 'string') {
                dump.concat([
                    `\n\n`,
                    `${context.llmResponse}`,
                    `\n\n`,
                ]);
            } else {
                dump.concat([
                    `\n\n`,
                    `json\n${JSON.stringify(context.llmResponse, null, 2)}`,
                    `\n\n`,
                ]);
            }
        }

        if (context.additionalInfo) {
            dump.concat([
                `### Additional Info\n`,
                `\n\n`,
                `json\n${JSON.stringify(context.additionalInfo, null, 2)}`,
                `\n\n`,
            ]);
        }

        return dump.join('\n');
    }

    private async handleGlobalError(
        error: Error,
        context: ErrorContext = {}
    ) {
        const { ctx } = context;
        const logger = ctx && ctx.logger ? ctx.logger('yesimbot:error') : console;

        logger.error(`[GlobalErrorHandler] An error occurred: ${error.message}`);
        if (error.stack) {
            logger.error(error.stack);
        }

        const dumpContent = this.formatErrorDump(error, context);

        logger.info('[GlobalErrorHandler] Generated Error Dump (first 1000 chars):\n', dumpContent.substring(0, 1000) + (dumpContent.length > 1000 ? '...' : ''));

        const pasteUrl = await this.uploadToPaste(dumpContent);

        if (pasteUrl) {
            logger.info(`[GlobalErrorHandler] Error dump uploaded to: ${pasteUrl}`);
        } else {
            logger.warn('[GlobalErrorHandler] Failed to upload error dump to pastebin.');
        }
        return pasteUrl;
    }
}