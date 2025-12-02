import type { Buffer } from "node:buffer";

/**
 * Result of a synthesis operation.
 */
export interface SynthesisResult {
    /** Buffer containing the audio data. */
    audio: Buffer;
    /** Mime type of the audio data, e.g., 'audio/mpeg'. */
    mimeType: string;
}

/**
 * Base interface for adapter configurations.
 */
export interface BaseTTSConfig {}

/**
 * Common parameters for any TTS tool, including the session.
 */
export interface BaseTTSParams {
    text: string;
}
