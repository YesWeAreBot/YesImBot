import { Context, Random, Schema, h } from "koishi";
import { Failed, Infer, Success, ToolDefinition } from "koishi-plugin-yesimbot/services";

import { TTSAdapter } from "./adapters/base";
import { CosyVoiceAdapter, CosyVoiceConfig } from "./adapters/cosyvoice";
import { FishAudioAdapter, FishAudioConfig } from "./adapters/fish-audio";
import { IndexTTS2Adapter, IndexTTS2Config } from "./adapters/index-tts2";
import { OpenAudioAdapter, OpenAudioConfig } from "./adapters/open-audio";
import { BaseTTSParams } from "./types";
import { writeFileSync } from "fs";
import path from "path";

export const Config = Schema.intersect([
    Schema.object({
        provider: Schema.union(["cosyvoice", "index-tts2", "fish-audio", "open-audio"])
            .default("cosyvoice")
            .description("选择要使用的 TTS 服务提供商"),
    }),
    Schema.union([
        Schema.object({
            provider: Schema.const("cosyvoice"),
            cosyvoice: CosyVoiceConfig.description("CosyVoice 配置"),
        }),
        Schema.object({
            provider: Schema.const("index-tts2"),
            "index-tts2": IndexTTS2Config.description("IndexTTS2 配置"),
        }),
        Schema.object({
            provider: Schema.const("fish-audio"),
            "fish-audio": FishAudioConfig,
        }),
        Schema.object({
            provider: Schema.const("open-audio"),
            "open-audio": OpenAudioConfig,
        }),
    ]),
]);

export type Config = {
    provider: "cosyvoice" | "index-tts2" | "fish-audio" | "open-audio";
    cosyvoice: CosyVoiceConfig;
    "index-tts2": IndexTTS2Config;
    "fish-audio": FishAudioConfig;
    "open-audio": OpenAudioConfig;
};

export class TTSService {
    private adapter: TTSAdapter;

    constructor(
        private ctx: Context,
        private config: Config
    ) {
        this.adapter = this.createAdapter();
    }

    private createAdapter(): TTSAdapter {
        const provider = this.config.provider;
        const providerConfig = this.config[provider];

        if (!providerConfig) {
            throw new Error(`TTS provider "${provider}" is not configured.`);
        }

        switch (provider) {
            case "cosyvoice":
                return new CosyVoiceAdapter(this.ctx, providerConfig as CosyVoiceConfig);
            case "index-tts2":
                return new IndexTTS2Adapter(this.ctx, providerConfig as IndexTTS2Config);
            case "fish-audio":
                return new FishAudioAdapter(this.ctx, providerConfig as FishAudioConfig);
            case "open-audio":
                return new OpenAudioAdapter(this.ctx, providerConfig as OpenAudioConfig);
            default:
                throw new Error(`Unknown TTS provider: ${provider}`);
        }
    }

    public getTool(): ToolDefinition {
        if (!this.adapter) {
            return null;
        }

        return {
            name: "send_voice",
            description: this.adapter.getToolDescription(),
            parameters: this.adapter.getToolSchema(),
            execute: this.execute.bind(this),
        };
    }

    private async execute(args: Infer<BaseTTSParams>) {
        const { session, text } = args;

        if (!text?.trim()) {
            return Failed("text is required");
        }

        try {
            const result = await this.adapter.synthesize(args);
            // if (result && result.audio) {
            //     writeFileSync(path.join(this.ctx.baseDir, "cache", `${Random.id(6)}.wav`), result.audio);
            // }
            await session.send(h.audio(result.audio, result.mimeType));
            return Success();
        } catch (err) {
            this.ctx.logger.error(`[TTS] 语音合成或发送失败: ${err.message}`);
            this.ctx.logger.error(err);
            return Failed({ name: "Error", message: `语音合成失败: ${err.message}` });
        }
    }
}
