import type { Context } from "koishi";
import type { BaseTTSConfig, BaseTTSParams, SynthesisResult } from "../../types";
import type { GenSingleParams, IndexTTS2GenSingleParams } from "./types";

import { Buffer } from "node:buffer";
import { Schema } from "koishi";
import { TTSAdapter } from "../base";
import { GradioAPI } from "./gradioApi";
import { ControlMethod } from "./types";

export interface IndexTTS2Config extends BaseTTSConfig, Omit<IndexTTS2GenSingleParams, "emo_control_method" | "prompt_audio" | "text"> {
    baseURL: string;
    apiLang: "en-US" | "zh-CN";
    prompt_audio: string;
    emo_control_method: string;
}

export const IndexTTS2Config: Schema<IndexTTS2Config> = Schema.intersect([
    Schema.object({
        baseURL: Schema.string().default("http://127.0.0.1:7860").description("index-tts2 Gradio API 的地址"),
        apiLang: Schema.union(["en-US", "zh-CN"]).default("en-US").description("API 后端使用的语音"),
        prompt_audio: Schema.path({ filters: ["file"] })
            .required()
            .description("用于声音克隆的音色参考音频的路径"),
        emo_control_method: Schema.union([
            Schema.const(ControlMethod.SAME_AS_TIMBRE).description("与音色参考音频相同"),
            Schema.const(ControlMethod.USE_EMO_REF).description("使用情感参考音频"),
            Schema.const(ControlMethod.USE_EMO_VECTOR).description("使用情感向量控制"),
            // Schema.const(ControlMethod.USE_EMO_TEXT).description("使用情感描述文本控制"),
        ])
            .default(ControlMethod.SAME_AS_TIMBRE)
            .description("默认的情感控制方式") as Schema<string>,
        advanced: Schema.object({
            do_sample: Schema.boolean().default(true).description("是否进行采样"),
            top_p: Schema.number().min(0).max(1).default(0.8).role("slider").step(0.01).description("Top P 采样阈值"),
            top_k: Schema.number().min(0).max(100).default(30).description("Top K 采样阈值"),
            temperature: Schema.number().min(0.1).max(2.0).default(0.8).role("slider").step(0.01).description("温度参数，控制生成的多样性"),
            length_penalty: Schema.number().min(0).max(2.0).default(0).role("slider").step(0.01).description("长度惩罚"),
            num_beams: Schema.number().min(1).max(10).default(3).step(1),
            repetition_penalty: Schema.number().min(1).max(20).default(10).role("slider").step(0.1).description("重复惩罚"),
            max_mel_tokens: Schema.number().min(50).max(1815).default(1500).description("生成的最大 Tokens 数量"),
            max_text_tokens_per_segment: Schema.number().min(20).max(600).default(120).description("分句最大Token数"),
        })
            .collapse()
            .description("高级参数设置"),
    }).description("IndexTTS2 配置"),

    Schema.union([
        Schema.object({
            emo_control_method: Schema.const(ControlMethod.SAME_AS_TIMBRE),
        }),
        Schema.object({
            emo_control_method: Schema.const(ControlMethod.USE_EMO_REF),
            emo_ref_audio: Schema.path({ filters: ["file"] })
                .required()
                .description("情感参考音频的路径 (仅在 USE_EMO_REF 模式下需要)"),
            emo_weight: Schema.number().min(0).max(1).default(0.5).role("slider").step(0.01).description("情感权重 (0-1)"),
        }),
        Schema.object({
            emo_control_method: Schema.const(ControlMethod.USE_EMO_VECTOR),
            vec_joy: Schema.number().min(0).max(1).default(0).role("slider").step(0.05).description("情感向量 - 喜"),
            vec_angry: Schema.number().min(0).max(1).default(0).role("slider").step(0.05).description("情感向量 - 怒"),
            vec_sad: Schema.number().min(0).max(1).default(0).role("slider").step(0.05).description("情感向量 - 哀"),
            vec_fear: Schema.number().min(0).max(1).default(0).role("slider").step(0.05).description("情感向量 - 惧"),
            vec_disgust: Schema.number().min(0).max(1).default(0).role("slider").step(0.05).description("情感向量 - 厌恶"),
            vec_depressed: Schema.number().min(0).max(1).default(0).role("slider").step(0.05).description("情感向量 - 低落"),
            vec_surprise: Schema.number().min(0).max(1).default(0).role("slider").step(0.05).description("情感向量 - 惊喜"),
            vec_neutral: Schema.number().min(0).max(1).default(1).role("slider").step(0.05).description("情感向量 - 平静"),
        }),
        // Schema.object({
        //     emo_control_method: Schema.const(ControlMethod.USE_EMO_TEXT),
        //     emo_text: Schema.string().required().description("默认情感描述文本。此参数可被覆盖"),
        //     emo_weight: Schema.number().min(0).max(1).default(0.5).role("slider").step(0.01).description("情感权重 (0-1)"),
        // }),
    ]),
]);

export interface IndexTTS2TTSParams extends BaseTTSParams {}

export class IndexTTS2Adapter extends TTSAdapter<IndexTTS2Config, IndexTTS2TTSParams> {
    public readonly name = "index-tts2";
    private api: GradioAPI;

    constructor(ctx: Context, config: IndexTTS2Config) {
        super(ctx, config);
        this.api = new GradioAPI(ctx, config.baseURL);
    }

    async synthesize(params: IndexTTS2TTSParams): Promise<SynthesisResult> {
        const {
            advanced,
            baseURL, // 排除不需要传给后端的字段
            prompt_audio,
            emo_control_method,
            ...controlSpecific // 判别联合字段：emo_ref_audio/emo_weight 或 vec_* 等
        } = this.config as any;

        const emo_control_method_text = this.ctx.i18n
            .render([this.config.apiLang], [`indextts.${this.config.emo_control_method}`], {})
            .join("");
        const fullParams: GenSingleParams = {
            ...controlSpecific,
            text: params.text,
            prompt_audio,
            emo_control_method: emo_control_method_text,
            ...(advanced ?? {}),
        };

        try {
            const result = await this.api.generateSingleAudio(fullParams);

            const audio = await this.ctx.http(result.url, { responseType: "arraybuffer" });

            return { audio: Buffer.from(audio.data), mimeType: "audio/wav" };
        } catch (error: any) {
            this.ctx.logger.error(`[IndexTTS2] Synthesis failed: ${error.message}`);
            throw error;
        }
    }

    getToolSchema(): Schema {
        const baseSchema = Schema.object({
            text: Schema.string().min(1).max(500).description("要合成的文本"),
        });
        switch (this.config.emo_control_method) {
            case ControlMethod.SAME_AS_TIMBRE:
                return baseSchema;
            case ControlMethod.USE_EMO_REF:
                return baseSchema;
            case ControlMethod.USE_EMO_VECTOR:
                return baseSchema;
            // case ControlMethod.USE_EMO_TEXT:
            //     return baseSchema.set("emo_text", Schema.string().default(this.config.emo_text).description("情感描述文本"));
        }
    }

    public override getToolDescription(): string {
        const description = super.getToolDescription();
        return description;
    }
}
