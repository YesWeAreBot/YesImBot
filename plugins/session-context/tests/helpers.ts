import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function channelKeyFor(platform: string, channelId: string): string {
  return createHash("sha256").update(`${platform}:${channelId}`).digest("hex").slice(0, 16);
}

export async function writeJson(baseDir: string, relPath: string, data: unknown): Promise<void> {
  const fullPath = join(baseDir, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
}

export async function writeJsonl(
  baseDir: string,
  relPath: string,
  lines: unknown[],
): Promise<void> {
  const fullPath = join(baseDir, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf-8");
}

export async function writeChannelFixture(
  baseDir: string,
  platform: string,
  channelId: string,
  meta: Record<string, unknown>,
): Promise<string> {
  const channelKey = channelKeyFor(platform, channelId);
  await writeJson(baseDir, "channel-map.json", {
    [channelKey]: { platform, channel: channelId },
  });
  await writeJson(baseDir, `${channelKey}/meta.json`, meta);
  return channelKey;
}
