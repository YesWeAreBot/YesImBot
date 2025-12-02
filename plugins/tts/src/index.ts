/* eslint-disable ts/no-require-imports */
import type { Context } from "koishi";
import { Metadata, Plugin } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import { Config, TTSService } from "./service";

@Metadata({
    name: "tts",
    description: "Text-to-Speech plugin for YesImBot.",
})
export default class TTSPlugin extends Plugin<Config> {
    static inject = [Services.Plugin];
    static readonly Config = Config;
    constructor(ctx: Context, config: Config) {
        super(ctx, config);
        this.logger = ctx.logger("tts");

        ctx.on("ready", async () => {
            ctx.i18n.define("en-US", require("./locales/en-US"));
            ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

            try {
                const ttsService = new TTSService(ctx, config);
                const tool = ttsService.getTool();
                if (tool) {
                    this.addAction(tool);
                    this.logger.info("TTS tool registered successfully.");
                } else {
                    this.logger.warn("No active TTS provider found, tool not registered.");
                }
            } catch (error: any) {
                this.logger.error(`Failed to initialize TTSService: ${error.message}`);
            }
        });
    }
}
