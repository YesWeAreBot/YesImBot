export type StateScope = "global" | "channel" | "user";

export interface ChannelStateMeta {
  platform: string;
  channelId: string;
  channelName?: string;
  kind?: string;
}

export interface UserStateMeta {
  platform: string;
  userId: string;
  username?: string;
  displayName?: string;
  kind?: string;
}
