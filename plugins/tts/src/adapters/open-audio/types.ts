import type { Buffer } from "node:buffer";

export interface ServerTTSRequest {
    text: string;
    chunk_length?: number;
    format?: "wav" | "mp3" | "pcm";
    references?: ServerReferenceAudio[];
    reference_id?: string | null;
    seed?: number | null;
    use_memory_cache?: "on" | "off";
    normalize?: boolean;
    streaming?: boolean;
    max_new_tokens?: number;
    top_p?: number;
    repetition_penalty?: number;
    temperature?: number;
}

export interface ServerReferenceAudio {
    audio: Buffer;
    text: string;
}
