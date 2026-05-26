import sanitize from "sanitize-filename";

export function encodeChannelId(platform: string, channel: string): string {
  const sanitizedPlatform = sanitize(platform);
  const sanitizedChannel = sanitize(channel);
  return `${sanitizedPlatform}_${sanitizedChannel}`;
}
