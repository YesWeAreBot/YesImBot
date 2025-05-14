import axios from 'axios';
import FormData from 'form-data';
import { Context, Session } from 'koishi';
import { Scenario } from '../Scenario'; 

async function uploadToPaste(content: string): Promise<string | null> {
    try {
        const form = new FormData();
        form.append('c', content);

        const response = await axios.post<{ url?: string; error?: string; status?: number }>(
            'https://dump.thfls.club/',
            form,
            { headers: form.getHeaders() } 
        );

        if (response.data && response.data.url) {
            return response.data.url;
        } else {
            console.error('Failed to upload to dump host:', response.data.error || `Status: ${response.status}`);
            return null;
        }
    } catch (error) {
        const err = error as any;
        console.error('Error uploading to dump host:', err.message || err);
        return null;
    }
}

export interface ErrorContext {
    scenario?: Scenario | object;
    llmResponse?: string | object;
    session?: Session;
    ctx?: Context;
    additionalInfo?: Record<string, any>;
}

function formatErrorDump(error: Error, context: ErrorContext = {}): string {
    let dump = `## YesImBot Error Dump\n\n`;
    dump += `**Timestamp:** ${new Date().toISOString()}\n\n`;

    dump += `### Error Details\n`;
    dump += `**Type:** ${error.name}\n`;
    dump += `**Message:** ${error.message}\n`;
    if (error.stack) {
        dump += `**Stack Trace:**\n\
\
\
${error.stack}\n\
\
\
`;
    }
    dump += `\n`;

    if (context.session) {
        dump += `### Session Context\n`;
        dump += `**Platform:** ${context.session.platform}\n`;
        dump += `**User ID:** ${context.session.userId}\n`;
        dump += `**Channel ID:** ${context.session.channelId}\n`;
        dump += `**Guild ID:** ${context.session.guildId || 'N/A'}\n`;
        dump += `**Self ID:** ${context.session.selfId}\n`;
        dump += `\n`;
    }

    if (context.scenario) {
        dump += `### Scenario Context (Rendered or Raw)\n`;
        if (context.scenario instanceof Scenario && typeof context.scenario.render === 'function') {
             dump += `\
\
\
${context.scenario.render()}\n\
\
\
`;
        } else {
             dump += `\
\
\
json
${JSON.stringify(context.scenario, null, 2)}
\
\
\
`;
        }
        dump += `\n`;
    }

    if (context.llmResponse) {
        dump += `### LLM Response (if available)\n`;
        if (typeof context.llmResponse === 'string') {
            dump += `\
\
\
${context.llmResponse}\n\
\
\
`;
        } else {
            dump += `\
\
\
json
${JSON.stringify(context.llmResponse, null, 2)}
\
\
\
`;
        }
        dump += `\n`;
    }
    
    if (context.additionalInfo) {
        dump += `### Additional Info\n`;
        dump += `\
\
\
json
${JSON.stringify(context.additionalInfo, null, 2)}
\
\
\
`;
        dump += `\n`;
    }

    return dump;
}

export async function handleGlobalError(
    error: Error,
    context: ErrorContext = {}
): Promise<string | null> {
    const { ctx } = context;
    const logger = ctx && ctx.logger ? ctx.logger('yesimbot:error') : console;

    logger.error(`[GlobalErrorHandler] An error occurred: ${error.message}`);
    if (error.stack) {
        logger.error(error.stack);
    }

    const dumpContent = formatErrorDump(error, context);
    
    logger.info('[GlobalErrorHandler] Generated Error Dump (first 1000 chars):\n', dumpContent.substring(0, 1000) + (dumpContent.length > 1000 ? '...' : ''));

    const pasteUrl = await uploadToPaste(dumpContent);

    if (pasteUrl) {
        logger.info(`[GlobalErrorHandler] Error dump uploaded to: ${pasteUrl}`);
    } else {
        logger.warn('[GlobalErrorHandler] Failed to upload error dump to pastebin.');
    }
    return pasteUrl;
}

let handlersRegistered = false;

export function registerGlobalErrorHandlers(ctx?: Context) {
    if (handlersRegistered) {
        if(ctx) ctx.logger.warn('[GlobalErrorHandler] Global error handlers already registered.');
        else console.warn('[GlobalErrorHandler] Global error handlers already registered.');
        return;
    }

    process.on('unhandledRejection', (reason, promise) => {
        const error = reason instanceof Error ? reason : new Error(`Unhandled Rejection: ${String(reason)}`);
        const logger = ctx && ctx.logger ? ctx.logger('yesimbot:error') : console;
        logger.error('Unhandled Rejection at:', promise, 'reason:', error);
        handleGlobalError(error, { ctx, additionalInfo: { type: 'unhandledRejection', promiseOrigin: String(promise) } });
    });

    process.on('uncaughtException', (error, origin) => {
        const logger = ctx && ctx.logger ? ctx.logger('yesimbot:error') : console;
        logger.error('Uncaught Exception:', error, 'Origin:', origin);
        handleGlobalError(error, { ctx, additionalInfo: { type: 'uncaughtException', origin } });
    });
    
    handlersRegistered = true;
    if (ctx) {
        ctx.logger.info('[GlobalErrorHandler] Registered global error handlers for unhandledRejection and uncaughtException.');
    } else {
        console.log('[GlobalErrorHandler] Registered global error handlers for unhandledRejection and uncaughtException.');
    }
}

