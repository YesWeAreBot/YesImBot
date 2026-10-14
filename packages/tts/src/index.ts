import { Context } from "koishi";
import { ToolService } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";

import { Config, TTSService } from "./service";
export { Config } from "./service";
export const name = "tts";
export const inject = {
    required: [Services.Tool],
};

export function apply(ctx: Context, config: Config) {
    const logger = ctx.logger("tts");

    ctx.i18n.define("en-US", require("./locales/en-US"));
    ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

    try {
        const ttsService = new TTSService(ctx, config);
        const tool = ttsService.getTool();
        if (tool) {
            const toolService: ToolService = ctx.get(Services.Tool)!;
            const unregisterTool: unknown = toolService.registerTool(tool);
            ctx.on("dispose", () => {
                if (typeof unregisterTool === "function") unregisterTool();
                else if (toolService.getTool(tool.name) === tool) toolService.unregisterTool(tool.name);
            });
            logger.info("TTS tool registered successfully.");
        } else {
            logger.warn("No active TTS provider found, tool not registered.");
        }
    } catch (error) {
        logger.error(`Failed to initialize TTSService: ${error.message}`);
    }
}
