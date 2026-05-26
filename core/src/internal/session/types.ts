import type { SessionManager } from "@yesimbot/agent/session";

export type ChannelKey = string;

export interface ChannelMeta {
  platform: string;
  channel: string;
  type: "private" | "group";
  current_session: string;
  last_message: string;
  updated_at: string;
  session_count: number;
}

export interface ChannelMapEntry {
  platform: string;
  channelId: string;
}

export interface SessionStoreConfig {
  basePath: string;
  logLevel?: number;
}

export interface GetOrCreateSessionInput {
  platform: string;
  channelId: string;
  type: "private" | "group";
}

export interface NewSessionInput {
  platform: string;
  channelId: string;
  type: "private" | "group";
}

export interface SessionRotatedEvent {
  platform: string;
  channelId: string;
  type: "private" | "group";
  sessionManager: SessionManager;
}

export type SessionRotatedListener = (event: SessionRotatedEvent) => void | Promise<void>;
