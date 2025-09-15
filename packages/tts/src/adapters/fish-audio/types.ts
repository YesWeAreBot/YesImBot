export interface ServerTTSRequest {
    text: string;
    temperature?: number;
    top_p?: number;
    references?: ReferenceAudio[];
    reference_id?: string | null;
    prosody?: {
        speed: number;
        volume: number;
    };
    chunk_length?: number;
    normalize?: boolean;
    format?: "wav" | "mp3" | "pcm" | "opus";
    sample_rate?: number;
    opus_bitrate?: -1000 | 24 | 32 | 48 | 64;
    latency?: "normal" | "balanced";
}

export interface ReferenceAudio {
    audio: Buffer;
    text: string;
}
