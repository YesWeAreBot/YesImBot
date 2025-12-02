import type { Buffer } from "node:buffer";

/**
 * @enum ControlMethod
 * @description 情感控制方式的枚举
 */
export enum ControlMethod {
    SAME_AS_TIMBRE = "SAME_AS_TIMBRE",
    USE_EMO_REF = "USE_EMO_REF",
    USE_EMO_VECTOR = "USE_EMO_VECTOR",
    USE_EMO_TEXT = "USE_EMO_TEXT",
}

/**
 * @interface GradioFileData
 * @description Gradio API 中文件对象的结构
 */
export interface GradioFileData {
    path: string;
    url?: string;
    size?: number;
    orig_name?: string;
    mime_type?: string;
    is_stream?: boolean;
    meta?: {
        _type: "gradio.FileData";
    };
}

/**
 * @interface GenSingleParams
 * @description 调用 gen_single API 所需的完整参数
 */
export interface GenSingleParams {
    /** 情感控制方式 */
    emo_control_method: string;
    /** 音色参考音频的本地文件路径或 Buffer */
    prompt_audio: string | Buffer;
    /** 要生成的文本 */
    text: string;
    /** 情感参考音频的本地文件路径或 Buffer (仅在特定模式下需要) */
    emo_ref_audio?: string | Buffer;
    /** 情感权重 (0-1) */
    emo_weight?: number;
    /** 情感向量 - 喜 */
    vec_joy?: number;
    /** 情感向量 - 怒 */
    vec_angry?: number;
    /** 情感向量 - 哀 */
    vec_sad?: number;
    /** 情感向量 - 惧 */
    vec_fear?: number;
    /** 情感向量 - 厌恶 */
    vec_disgust?: number;
    /** 情感向量 - 低落 */
    vec_depressed?: number;
    /** 情感向量 - 惊喜 */
    vec_surprise?: number;
    /** 情感向量 - 平静 */
    vec_neutral?: number;
    /** 情感描述文本 */
    emo_text?: string;
    /** 情感随机采样 */
    emo_random?: boolean;
    /** 分句最大Token数 */
    max_text_tokens_per_segment?: number;
    /** 是否进行采样 */
    do_sample?: boolean;
    /** Top P 采样阈值 */
    top_p?: number;
    /** Top K 采样阈值 */
    top_k?: number;
    /** 温度参数，控制生成的多样性 */
    temperature?: number;
    /** 长度惩罚 */
    length_penalty?: number;
    /** Beam Search 的束数量 */
    num_beams?: number;
    /** 重复惩罚 */
    repetition_penalty?: number;
    /** 生成的最大 Mel Tokens 数量 */
    max_mel_tokens?: number;
}

export interface SAME_AS_TIMBRE {
    // emo_control_method: ControlMethod.SAME_AS_TIMBRE;
    do_sample: boolean;
    temperature: number;
    top_p: number;
    top_k: number;
    num_beams: number;
    repetition_penalty: number;
    length_penalty: number;
    max_mel_tokens: number;
    max_text_tokens_per_segment: number;
}

export interface USE_EMO_REF {
    // emo_control_method: ControlMethod.USE_EMO_REF;
    emo_ref_audio: string;
    emo_weight: number;
}

export interface USE_EMO_VECTOR {
    // emo_control_method: ControlMethod.USE_EMO_VECTOR;
    random_emotion_sampling: boolean;
    vec_joy: number;
    vec_angry: number;
    vec_sad: number;
    vec_fear: number;
    vec_disgust: number;
    vec_depressed: number;
    vec_surprise: number;
    vec_neutral: number;
}

// export interface USE_EMO_TEXT {
//     emo_control_method: ControlMethod.USE_EMO_TEXT;
//     emo_text: string;
//     emo_weight: number;
// }

// export type IndexTTS2GenSingleParams = GenSingleParams & (SAME_AS_TIMBRE | USE_EMO_REF | USE_EMO_VECTOR | USE_EMO_TEXT);
export type IndexTTS2GenSingleParams = GenSingleParams & (SAME_AS_TIMBRE | USE_EMO_REF | USE_EMO_VECTOR);

export interface GenSingleEvent {
    event_id: string;
}

/**
 * @interface GradioApiError
 * @description Gradio API 的错误返回结构
 */
export interface GradioApiError {
    error: string;
}
