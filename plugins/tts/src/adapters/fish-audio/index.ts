import type { Context } from "koishi";
import type { BaseTTSConfig, BaseTTSParams, SynthesisResult } from "../../types";
import type { ReferenceAudio, ServerTTSRequest } from "./types";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import path from "node:path";
import { encode } from "@msgpack/msgpack";
import { Schema } from "koishi";
import { fetch, ProxyAgent } from "undici";
import { TTSAdapter } from "../base";

export interface FishAudioConfig extends BaseTTSConfig, Omit<ServerTTSRequest, "text" | "references"> {
    baseURL: string;
    apiKey?: string;
    model: "speech-1.5" | "speech-1.6" | "s1";
    proxy?: string;

    references?: { audio: string; text: string }[];

    toolDesc: string;
}

export const FishAudioConfig: Schema<FishAudioConfig> = Schema.object({
    baseURL: Schema.string().default("https://api.fish.audio").description("FishAudio API 的基础地址"),
    apiKey: Schema.string().role("secret").required().description("在线服务的 API Key"),
    model: Schema.union(["speech-1.5", "speech-1.6", "s1"]).default("s1").description("使用的模型"),
    proxy: Schema.string().role("link").description("代理地址"),
    chunk_length: Schema.number().default(200).min(100).max(300).description("音频分块长度，控制生成音频的片段大小"),
    format: Schema.union(["wav", "mp3", "pcm", "opus"]).default("wav").description("输出音频格式"),
    normalize: Schema.boolean().description("是否对输入进行标准化处理").default(true),
    top_p: Schema.number().default(0.7).min(0.1).max(1.0).description("采样概率阈值，用于控制生成的多样性"),
    temperature: Schema.number().default(0.7).min(0.1).max(1).description("温度参数，控制生成的随机性"),
    references: Schema.array(
        Schema.object({
            audio: Schema.path({ filters: ["file"] })
                .description("参考音频文件路径")
                .required(),
            text: Schema.string()
                .default("")
                .role("textarea", { rows: [1, 2] })
                .description("参考音频对应的文本内容"),
        }),
    )
        .description("参考音频列表")
        .default([]),
    reference_id: Schema.string().description("参考音频ID").default(null),
    toolDesc: Schema.string()
        .role("textarea", { rows: [3, 6] })
        .default(
            `将文本转换为语音。
**情感标签与控制指令**
**1. 核心语法**
所有控制标签都必须使用英文半角括号 \`()\` 包裹。一个标签会影响其后的所有文本，直到遇到新的标签为止。
- **基本格式**: \`(标签)需要朗读的文本\`
---
**2. 标签完整列表**
**2.1 情感标签 (Emotion Tags)**
- **基础情感**: \`(angry)\`, \`(sad)\`, \`(excited)\`, \`(surprised)\`, \`(satisfied)\`, \`(delighted)\`, \`(scared)\`, \`(worried)\`, \`(upset)\`, \`(nervous)\`, \`(frustrated)\`, \`(depressed)\`, \`(empathetic)\`, \`(embarrassed)\`, \`(disgusted)\`, \`(moved)\`, \`(proud)\`, \`(relaxed)\`, \`(grateful)\`, \`(confident)\`, \`(interested)\`, \`(curious)\`, \`(confused)\`, \`(joyful)\`
- **高级情感**: \`(disdainful)\`, \`(unhappy)\`, \`(anxious)\`, \`(hysterical)\`, \`(indifferent)\`, \`(impatient)\`, \`(guilty)\`, \`(scornful)\`, \`(panicked)\`, \`(furious)\`, \`(reluctant)\`, \`(keen)\`, \`(disapproving)\`, \`(negative)\`, \`(denying)\`, \`(astonished)\`, \`(serious)\`, \`(sarcastic)\`, \`(conciliative)\`, \`(comforting)\`, \`(sincere)\`, \`(sneering)\`, \`(hesitating)\`, \`(yielding)\`, \`(painful)\`, \`(awkward)\`, \`(amused)\`
**2.2 语气标签 (Tone Tags)**
\`(in a hurry tone)\`, \`(shouting)\`, \`(screaming)\`, \`(whispering)\`, \`(soft tone)\`
**2.3 特殊音效标签 (Special Audio Effects)**
\`(laughing)\`, \`(chuckling)\`, \`(sobbing)\`, \`(crying loudly)\`, \`(sighing)\`, \`(panting)\`, \`(groaning)\`, \`(crowd laughing)\`, \`(background laughter)\`, \`(audience laughing)\`
---
**3. 使用规则**
**3.1 情感标签规则**
- **位置**: **必须**置于句首（尤其在英文中）。
- **正确示例**: \`(angry)How could you repay me like this?\`
- **错误示例**: \`I trusted you so much, (angry)how could you repay me like this?\`
**3.2 语气与特殊音效标签规则**
- **位置**: 可置于句中**任意位置**，用于局部调整。
- **示例**:
    - \`Go now! (in a hurry tone) we don't have much time!\`
    - \`Come closer, (whispering) I have a secret to tell you.\`
    - \`The comedian's joke had everyone (crowd laughing) in stitches.\`
**3.3 特殊音效与拟声词**
- 某些音效标签需要后接相应的拟声词以获得最佳效果。
- **示例**:
    - \`(laughing) Ha,ha,ha!\`
    - \`(chuckling) Hmm,hmm.\`
    - \`(crying loudly) waah waah!\`
    - \`(sighing) sigh.\`
---
**4. 高级用法：标签组合**
可以组合使用不同类型的标签，以创造更丰富、更动态的语音效果。
- **示例**: \`(angry)How dare you betray me! (shouting) I trusted you so much, how could you repay me like this?\`
  *(先设定愤怒情绪，再用喊叫语气加强)*
---
**5. 关键注意事项 (Best Practices)**
1.  **严格遵守规则**: 尤其是情感标签必须置于句首的规则。
2.  **优先使用官方标签**: 上述列表中的标签拥有最高的准确率。
3.  **避免自创组合标签**: 不要使用 \`(in a sad and quiet voice)\` 这种形式，模型会直接读出。应组合使用标准标签，如 \`(sad)(soft tone)\`。
4.  **避免标签滥用**: 在短句中过多使用标签可能会干扰模型效果。`,
        )
        .description("工具描述文本，用于指导AI使用情感控制标签生成高质量的文本"),
}).description("Fish Audio 配置");

export interface FishAudioTTSParams extends BaseTTSParams {}

export class FishAudioAdapter extends TTSAdapter<FishAudioConfig, FishAudioTTSParams> {
    public readonly name = "fish-audio";
    private references: ReferenceAudio[] = [];
    private baseURL: string;

    constructor(ctx: Context, config: FishAudioConfig) {
        super(ctx, config);

        this.baseURL = config.baseURL.endsWith("/v1/tts") ? config.baseURL.replace("/v1/tts", "") : config.baseURL;

        for (const refer of config.references) {
            try {
                const reference_audio = readFileSync(path.join(ctx.baseDir, refer.audio));
                this.references.push({
                    audio: Buffer.from(reference_audio),
                    text: refer.text?.trim() || "",
                });
            } catch (err) {
                ctx.logger.error("参考音频读取失败");
            }
        }
    }

    async synthesize(params: FishAudioTTSParams): Promise<SynthesisResult> {
        const request: ServerTTSRequest = {
            text: params.text,
            chunk_length: this.config.chunk_length,
            format: this.config.format,
            references: this.references,
            reference_id: this.config.reference_id,
            normalize: this.config.normalize,
            top_p: this.config.top_p,
            temperature: this.config.temperature,
        };

        let dispatcher;
        if (this.config.proxy) {
            try {
                dispatcher = new ProxyAgent({ uri: this.config.proxy });
                this.ctx.logger.info(`using proxy: ${this.config.proxy}`);
            } catch (err) {}
        }

        const response = await fetch(`${this.baseURL}/v1/tts`, {
            method: "POST",
            headers: { "Content-Type": "application/msgpack", "authorization": `Bearer ${this.config.apiKey}`, "model": this.config.model },
            body: encode(request),
            dispatcher,
        });

        if (response.ok) {
            const mimeType = response.headers;
            console.log(mimeType);
            const result = await response.arrayBuffer();

            return {
                audio: Buffer.from(result),
                mimeType: response.headers.get("content-type") || "audio/wav",
            };
        } else {
            throw new Error(`${response.status} ${response.statusText}`);
        }
    }

    getToolSchema(): Schema {
        return Schema.object({
            text: Schema.string().required().description("要合成的文本内容"),
        });
    }

    public override getToolDescription(): string {
        return this.config.toolDesc;
    }
}
