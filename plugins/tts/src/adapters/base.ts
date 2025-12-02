import type { Awaitable, Context, Schema } from "koishi";
import type { BaseTTSConfig, BaseTTSParams, SynthesisResult } from "../types";

/**
 * Abstract base class for all TTS adapters.
 * Defines the common interface for synthesizing speech and generating tool schemas.
 * @template C - The configuration type for the adapter.
 * @template P - The parameters type for the synthesis tool.
 */
export abstract class TTSAdapter<C extends BaseTTSConfig = BaseTTSConfig, P extends BaseTTSParams = BaseTTSParams> {
    /**
     * The name of the TTS service provider.
     */
    public abstract readonly name: string;

    /**
     * Creates an instance of TTSAdapter.
     * @param ctx - The Koishi context.
     * @param config - The configuration for this adapter.
     */
    constructor(
        protected ctx: Context,
        protected config: C,
    ) {}

    public stop(): Awaitable<void> {}

    /**
     * Synthesizes speech from the given parameters.
     * This method must be implemented by all concrete adapters.
     * @param params - The parameters for speech synthesis, including the text to synthesize.
     * @returns A promise that resolves with the synthesis result.
     */
    abstract synthesize(params: P): Promise<SynthesisResult>;

    /**
     * Generates the Schema for the AI agent's tool.
     * This allows each adapter to define its own set of parameters for the tool.
     * @returns A Koishi Schema object defining the tool's parameters.
     */
    abstract getToolSchema(): Schema;

    /**
     * Provides a description for the AI agent's tool.
     * This can be overridden by adapters to provide more specific instructions.
     * @returns A string containing the tool's description.
     */
    public getToolDescription(): string {
        return `将文本转换为语音进行播放。
- 你应该生成适合朗读、符合口语习惯的自然语言。
- 避免使用表格、代码块、Markdown链接等不适合口述的格式。`;
    }
}
