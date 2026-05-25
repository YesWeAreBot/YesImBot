export interface ChannelIdentifier {
  platform: string;
  channelId: string;
  type: "private" | "group";
}

export type ChannelKey = `${string}:${string}`;
