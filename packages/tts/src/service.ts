import { Context, Schema, h } from "koishi";
import { Failed, Infer, Success, ToolDefinition } from "koishi-plugin-yesimbot";

import { TTSAdapter } from "./adapters/base";
import { CosyVoiceAdapter, CosyVoiceConfig } from "./adapters/cosyvoice";
import { FishAudioAdapter, FishAudioConfig } from "./adapters/fish-audio";
import { IndexTTS2Adapter, IndexTTS2Config } from "./adapters/index-tts2";
import { OpenAudioAdapter, OpenAudioConfig } from "./adapters/open-audio";
import { BaseTTSParams, SynthesisResult } from "./types";

export const Config = Schema.intersect([
    Schema.object({
        provider: Schema.union(["cosyvoice", "index-tts2", "fish-audio", "open-audio"]).default("cosyvoice").description("选择要使用的 TTS 服务提供商"),
    }),
    Schema.union([
        Schema.object({
            provider: Schema.const("cosyvoice"),
            cosyvoice: CosyVoiceConfig.description("CosyVoice 配置"),
        }),
        Schema.object({
            provider: Schema.const("index-tts2"),
            "index-tts2": IndexTTS2Config,
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
    private stopped = false;

    constructor(
        private ctx: Context,
        private config: Config,
    ) {
        this.adapter = this.createAdapter();

        ctx.on("dispose", async () => {
            this.stopped = true;
            try {
                await this.adapter?.stop();
            } catch (error) {
                ctx.logger.error(error);
            }
        });
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

    public getTool(): ToolDefinition | null {
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
        const { session, text, toolContext } = args;
        if (!session) return Failed("session 不可用");
        const signal = toolContext?.signal ?? args.signal;
        const deadline = toolContext?.deadline ?? args.deadline;
        const allowed = () =>
            !this.stopped &&
            !signal?.aborted &&
            (deadline === undefined || (Number.isFinite(deadline) && Date.now() < deadline)) &&
            (typeof this.ctx.filter !== "function" || this.ctx.filter(session));
        if (!allowed()) return Failed({ name: "TTSUnavailable", message: "TTS 已停止、取消或不在授权范围", retryable: false });
        if (!text?.trim()) return Failed("text is required");

        let result: SynthesisResult | undefined;
        try {
            result = await this.adapter.synthesize({ ...args, signal, deadline });
        } catch {
            // Only synthesis failures may fall back. A send exception does not
            // prove that the platform did not deliver the original message.
            this.ctx.logger.warn("[TTS] 合成失败；未记录文本、凭据或上游错误正文");
        }
        if (!allowed()) return Failed({ name: "TTSUnavailable", message: "TTS 已停止、取消或不在授权范围", retryable: false });
        try {
            const receipt = await session.send(result ? h.audio(result.audio, result.mimeType) : h.text(text));
            if (!Array.isArray(receipt) || !receipt.length || receipt.some((id) => typeof id !== "string" || !id.trim())) {
                return {
                    ...Failed({ name: "DeliveryUnknown", message: "平台未返回有效回执；请核实，勿自动重发", retryable: false }),
                    metadata: { deliveryUnknown: true },
                };
            }
            return Success(result ? { messageIds: receipt } : { fallback: "text", messageIds: receipt, message: "语音不可用，已发送文字。" });
        } catch {
            return {
                ...Failed({ name: "DeliveryUnknown", message: "发送结果不确定；请核实，勿自动重发", retryable: false }),
                metadata: { deliveryUnknown: true },
            };
        }
    }
}
