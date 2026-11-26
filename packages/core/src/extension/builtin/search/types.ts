export type BackendName = "tavily" | "brave" | "exa" | "firecrawl" | "searxng" | "deepseek" | "anthropic" | "openai";

export type SearchDepth = "basic" | "advanced" | "fast" | "ultra-fast";
export type BraveSafesearch = "off" | "moderate" | "strict";
export type ExaSearchType = "auto" | "fast" | "instant" | "deep-lite" | "deep";
export type SearchContextSize = "low" | "medium" | "high";

export interface EngineBaseConfig {
    /** 实例配置里的选择值，同一插件配置内唯一。 */
    id: string;
    /** 0 表示使用插件级 timeoutMs。 */
    timeoutMs: number;
}

export interface TavilyEngineConfig extends EngineBaseConfig {
    backend: "tavily";
    apiKey: string;
    endpoint: string;
    searchDepth: SearchDepth;
    includeAnswer: boolean;
}

export interface BraveEngineConfig extends EngineBaseConfig {
    backend: "brave";
    apiKey: string;
    endpoint: string;
    country: string;
    searchLang: string;
    safesearch: BraveSafesearch;
    extraSnippets: boolean;
}

export interface ExaEngineConfig extends EngineBaseConfig {
    backend: "exa";
    apiKey: string;
    endpoint: string;
    type: ExaSearchType;
}

export interface FirecrawlEngineConfig extends EngineBaseConfig {
    backend: "firecrawl";
    apiKey: string;
    endpoint: string;
}

export interface SearxngEngineConfig extends EngineBaseConfig {
    backend: "searxng";
    endpoint: string;
    apiKey: string;
    categories: string[];
    language: string;
    safesearch: 0 | 1 | 2;
}

export interface DeepseekEngineConfig extends EngineBaseConfig {
    backend: "deepseek";
    apiKey: string;
    endpoint: string;
    needContent: boolean;
}

export interface AnthropicEngineConfig extends EngineBaseConfig {
    backend: "anthropic";
    apiKey: string;
    endpoint: string;
    model: string;
    maxUses: number;
    maxTokens: number;
    maxContentTokens: number;
    allowedDomains: string[];
    blockedDomains: string[];
}

export interface OpenaiEngineConfig extends EngineBaseConfig {
    backend: "openai";
    apiKey: string;
    endpoint: string;
    model: string;
    searchContextSize: SearchContextSize;
    maxOutputTokens: number;
    allowedDomains: string[];
    blockedDomains: string[];
}

export type EngineConfig =
    | TavilyEngineConfig
    | BraveEngineConfig
    | ExaEngineConfig
    | FirecrawlEngineConfig
    | SearxngEngineConfig
    | DeepseekEngineConfig
    | AnthropicEngineConfig
    | OpenaiEngineConfig;

export interface SearchConfig {
    maxLimit: number;
    timeoutMs: number;
    maxFetchUrls: number;
    totalTimeoutMs: number;
    maxContentChars: number;
    maxSnippetChars: number;
    maxAnswerChars: number;
    blacklist: string[];
}

export interface EngineSearchInput {
    query: string;
    limit: number;
    signal?: AbortSignal;
}

export interface SearchHit {
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
}

export interface EngineSearchResult {
    results: SearchHit[];
    answers?: string[];
}

export interface FetchedPage {
    title: string;
    content: string;
}

export interface SearchEngine {
    readonly id: string;
    readonly backend: BackendName;
    readonly search?: (input: EngineSearchInput) => Promise<EngineSearchResult>;
    readonly fetchPage?: (url: string, signal?: AbortSignal) => Promise<FetchedPage>;
}

export interface SearchOutput {
    results: SearchHit[];
    answers?: string[];
    attempts: SearchAttempt[];
}

export interface SearchAttempt {
    engine: string;
    status: "success" | "empty" | "failed";
    count: number;
    error?: string;
}

export interface FetchResult {
    engine?: string;
    url: string;
    title?: string;
    content?: string;
    error?: string;
}

export interface FetchOutput {
    results: FetchResult[];
}

export type Capability = "search" | "fetch";
