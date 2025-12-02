import type { Context } from "koishi";
import type { GenSingleEvent, GenSingleParams, GradioApiError, GradioFileData } from "./types";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";

export class GradioAPI {
    constructor(
        public ctx: Context,
        private baseURL: string,
    ) {}

    /**
     * 将本地文件上传到 Gradio 服务器
     * @param {string | Buffer} file - 文件路径或文件 Buffer
     * @param {string} filename - 定义一个文件名 (即便是 Buffer 也需要)
     * @returns {Promise<string>} 返回在服务器上的文件路径
     * @throws 如果上传失败则抛出错误
     */
    private async uploadToGradio(file: string | Buffer, filename: string): Promise<string> {
        const fileBuffer = Buffer.isBuffer(file) ? file : await fs.readFile(file);
        const blob = new Blob([Buffer.from(fileBuffer)], { type: "audio/wav" });

        const formData = new FormData();
        formData.append("files", blob, filename);

        const uploadId = Math.random().toString(36).substring(2); // 生成一个随机的 upload_id

        try {
            const response = await this.ctx.http.post<string[] | { path: string }[]>(
                `${this.baseURL}/gradio_api/upload?upload_id=${uploadId}`,
                formData,
                { responseType: "json", timeout: 60_000 },
            );
            if (Array.isArray(response) && response.length > 0) {
                const first = response[0] as unknown;
                if (typeof first === "string")
                    return first;
                if (first && typeof (first as any).path === "string")
                    return (first as any).path;
            }
            throw new Error("上传成功，但未返回有效的文件路径");
        } catch (error: any) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`文件上传失败: ${msg}`);
        }
    }

    private async submitSingleAudio(params: GenSingleParams): Promise<string> {
        // 1. 上传必要的音频文件
        const promptAudioPath = await this.uploadToGradio(params.prompt_audio, "prompt_audio.wav");

        let emoRefAudioPath: string | null = null;
        if (params.emo_ref_audio) {
            emoRefAudioPath = await this.uploadToGradio(params.emo_ref_audio, "emo_ref_audio.wav");
        }

        // 2. 构建 API 请求体 (data 数组)
        // 必须严格按照 API 定义的 24 个参数顺序和类型来填充
        const dataPayload = [
            params.emo_control_method, // [0] 情感控制方式
            { path: promptAudioPath, meta: { _type: "gradio.FileData" } }, // [1] 音色参考音频
            params.text, // [2] 文本
            emoRefAudioPath ? { path: emoRefAudioPath, meta: { _type: "gradio.FileData" } } : null, // [3] 情感参考音频
            params.emo_weight ?? 1, // [4] 情感权重
            params.vec_joy ?? 0, // [5] 喜
            params.vec_angry ?? 0, // [6] 怒
            params.vec_sad ?? 0, // [7] 哀
            params.vec_fear ?? 0, // [8] 惧
            params.vec_disgust ?? 0, // [9] 厌恶
            params.vec_depressed ?? 0, // [10] 低落
            params.vec_surprise ?? 0, // [11] 惊喜
            params.vec_neutral ?? 0, // [12] 平静
            params.emo_text ?? "Hello!!", // [13] 情感描述文本
            params.emo_random ?? true, // [14] 情感随机采样
            params.max_text_tokens_per_segment ?? 120, // [15] 分句最大Token数
            params.do_sample ?? true, // [16] do_sample
            params.top_p ?? 0.8, // [17] top_p
            params.top_k ?? 30, // [18] top_k
            params.temperature ?? 0.8, // [19] temperature
            params.length_penalty ?? 0, // [20] length_penalty
            params.num_beams ?? 3, // [21] num_beams
            params.repetition_penalty ?? 1, // [22] repetition_penalty (注意：示例中是0.1，但通常默认是1)
            params.max_mel_tokens ?? 1500, // [23] max_mel_tokens
        ];

        try {
            const result = await this.ctx.http.post<GenSingleEvent | GradioApiError>(
                `${this.baseURL}/gradio_api/call/gen_single`,
                { data: dataPayload },
                { responseType: "json", timeout: 120_000 },
            );

            if ("error" in result) {
                throw new Error(`Gradio API 返回错误: ${result.error}`);
            }

            // 4. 解析并返回结果
            if (result.event_id) {
                return result.event_id;
            } else {
                throw new Error("API 返回了非预期的格式");
            }
        } catch (error: any) {
            throw new Error(`API 请求失败: ${error.message}`);
        }
    }

    private async getTask(event_id: string): Promise<GradioFileData> {
        const sseText = await this.ctx.http.get<string>(`${this.baseURL}/gradio_api/call/gen_single/${event_id}`, {
            responseType: "text",
            timeout: 120_000,
        });

        const event = this.extractEventData(sseText);

        if (Array.isArray(event) && event.length > 0) {
            return event[0].value as GradioFileData;
        } else {
            throw new Error("API 返回了非预期的格式");
        }
    }

    public async generateSingleAudio(params: GenSingleParams): Promise<GradioFileData> {
        const event_id = await this.submitSingleAudio(params);
        return await this.getTask(event_id);
    }

    private extractEventData(sseData: string, targetEvent: string = "complete"): { visible: boolean; value: GradioFileData }[] {
        const lines = sseData.trim().split("\n");

        let currentEvent: string | null = null;
        let currentData: string | null = null;

        for (const line of lines) {
            if (line.startsWith("event: ")) {
                currentEvent = line.substring(7);
            } else if (line.startsWith("data: ")) {
                currentData = line.substring(6);

                if (currentEvent === targetEvent && currentData && currentData !== "null") {
                    try {
                        return JSON.parse(currentData);
                    } catch (error: any) {
                        console.warn(`Failed to parse data for event ${targetEvent}:`, currentData);
                    }
                }
            }
        }
    }
}
