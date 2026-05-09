import { createHash } from "node:crypto";

export function encodeChannelId(platform: string, channel: string): string {
  return createHash("sha256").update(`${platform}:${channel}`).digest("hex").slice(0, 16);
}
