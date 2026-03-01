import type { Schema } from "koishi";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  limit?: number;
  [key: string]: unknown;
}

export interface SearchBackend {
  readonly name: string;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  getParameterSchema(): Record<string, Schema>;
}

export interface SearchPluginConfig {
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  defaultLimit?: number;
  jinaApiKey?: string;
}
