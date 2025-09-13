import fs from "fs/promises";
import { Context, Schema } from "koishi";

import { BaseTTSConfig, BaseTTSParams, SynthesisResult } from "../../types";
import { TTSAdapter } from "../base";
import { GradioAPI } from "./gradioApi";
import { ControlMethod, GenSingleParams } from "./types";

export interface IndexTTS2Config extends BaseTTSConfig {
    baseURL: string;
    prompt_audio: string;
    emo_control_method: ControlMethod;
    // ... other default generation parameters can be added here
}

export const IndexTTS2Config: Schema<IndexTTS2Config> = Schema.object({
    baseURL: Schema.string().default("http://127.0.0.1:7860").description("index-tts2 Gradio API 的地址"),
    prompt_audio: Schema.path({ filters: ["file"] })
        .required()
        .description("用于声音克隆的音色参考音频的路径"),
    emo_control_method: Schema.union(Object.values(ControlMethod)).default(ControlMethod.SAME_AS_TIMBRE).description("默认的情感控制方式"),
});

export interface IndexTTS2TTSParams extends BaseTTSParams, Omit<GenSingleParams, "prompt_audio" | "text"> {}

export class IndexTTS2Adapter extends TTSAdapter<IndexTTS2Config, IndexTTS2TTSParams> {
    public readonly name = "index-tts2";
    private api: GradioAPI;

    constructor(ctx: Context, config: IndexTTS2Config) {
        super(ctx, config);
        this.api = new GradioAPI(config.baseURL);
    }

    async synthesize(params: IndexTTS2TTSParams): Promise<SynthesisResult> {
        const fullParams: GenSingleParams = {
            ...params,
            text: params.text,
            prompt_audio: this.config.prompt_audio,
            emo_control_method: params.emo_control_method ?? this.config.emo_control_method,
        };

        try {
            const result = await this.api.generateSingleAudio(fullParams);
            const audio = await fs.readFile(result.path);
            // Assuming the output is wav, but this might need to be configurable
            return { audio, mimeType: "audio/wav" };
        } catch (error) {
            this.ctx.logger.error(`[IndexTTS2] Synthesis failed: ${error.message}`);
            throw error;
        }
    }

    getToolSchema(): Schema {
        return Schema.object({
            text: Schema.string().required().description("要合成的文本内容"),
            emo_control_method: Schema.union(Object.values(ControlMethod))
                .description("情感控制方式")
                .default(this.config.emo_control_method),
            emo_ref_audio: Schema.path({ filters: ["file"] }).description("情感参考音频的路径 (仅在 USE_EMO_REF 模式下需要)"),
            emo_weight: Schema.number().min(0).max(1).description("情感权重 (0-1)"),
            vec_joy: Schema.number().min(0).max(1).description("情感向量 - 喜"),
            vec_angry: Schema.number().min(0).max(1).description("情感向量 - 怒"),
            vec_sad: Schema.number().min(0).max(1).description("情感向量 - 哀"),
            vec_fear: Schema.number().min(0).max(1).description("情感向量 - 惧"),
            vec_disgust: Schema.number().min(0).max(1).description("情感向量 - 厌恶"),
            vec_depressed: Schema.number().min(0).max(1).description("情感向量 - 低落"),
            vec_surprise: Schema.number().min(0).max(1).description("情感向量 - 惊喜"),
            vec_neutral: Schema.number().min(0).max(1).description("情感向量 - 平静"),
            emo_text: Schema.string().description("情感描述文本 (仅在 USE_EMO_TEXT 模式下需要)"),
            emo_random: Schema.boolean().description("是否进行情感随机采样"),
            max_text_tokens_per_segment: Schema.number().description("分句最大Token数"),
            do_sample: Schema.boolean().description("是否进行采样"),
            top_p: Schema.number().description("Top P 采样阈值"),
            top_k: Schema.number().description("Top K 采样阈值"),
            temperature: Schema.number().description("温度参数，控制生成的多样性"),
            length_penalty: Schema.number().description("长度惩罚"),
            num_beams: Schema.number().description("Beam Search 的束数量"),
            repetition_penalty: Schema.number().description("重复惩罚"),
            max_mel_tokens: Schema.number().description("生成的最大 Mel Tokens 数量"),
        });
    }

    public override getToolDescription(): string {
        return `将文本转换为语音。此工具支持通过声音克隆和多种情感控制方式进行精细的语音合成。
- **声音克隆**: 使用预设的音色参考音频进行发音。
- **情感控制**:
  - \`SAME_AS_TIMBRE\`: 情感与音色参考音频相同。
  - \`USE_EMO_REF\`: 使用一个独立的情感参考音频来控制情感。
  - \`USE_EMO_VECTOR\`: 使用具体的情感向量（喜、怒、哀等）进行精确控制。
  - \`USE_EMO_TEXT\`: 使用一段描述性的文本来指导情感。
- 你可以调整各种生成参数来进一步微调语音的风格。`;
    }
}
