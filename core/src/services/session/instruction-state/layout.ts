import { Buffer } from "node:buffer";
import { join } from "node:path";

export const PERSONA_FILE = "PERSONA.md";
export const AGENTS_FILE = "AGENTS.md";
export const TOOLS_FILE = "TOOLS.md";
export const USER_FILE = "USER.md";
export const META_FILE = "meta.json";

export function encodeStateKey(rawKey: string): string {
  return Buffer.from(rawKey, "utf8").toString("base64url");
}

export function decodeStateKey(encodedKey: string): string {
  return Buffer.from(encodedKey, "base64url").toString("utf8");
}

export function getStateRoot(basePath: string): string {
  return join(basePath, "state");
}

export function getGlobalStateDir(basePath: string): string {
  return join(getStateRoot(basePath), "global");
}

export function getGlobalInstructionsDir(basePath: string): string {
  return join(getGlobalStateDir(basePath), "instructions");
}

export function getChannelsStateDir(basePath: string): string {
  return join(getStateRoot(basePath), "channels");
}

export function getUsersStateDir(basePath: string): string {
  return join(getStateRoot(basePath), "users");
}

export function getChannelStateDir(basePath: string, platform: string, channelId: string): string {
  return join(getChannelsStateDir(basePath), platform, encodeStateKey(channelId));
}

export function getUserStateDir(basePath: string, platform: string, userId: string): string {
  return join(getUsersStateDir(basePath), platform, encodeStateKey(userId));
}

export function getChannelInstructionsDir(
  basePath: string,
  platform: string,
  channelId: string,
): string {
  return join(getChannelStateDir(basePath, platform, channelId), "instructions");
}

export function getUserInstructionsDir(basePath: string, platform: string, userId: string): string {
  return join(getUserStateDir(basePath, platform, userId), "instructions");
}

export function getChannelMetaPath(basePath: string, platform: string, channelId: string): string {
  return join(getChannelStateDir(basePath, platform, channelId), META_FILE);
}

export function getUserMetaPath(basePath: string, platform: string, userId: string): string {
  return join(getUserStateDir(basePath, platform, userId), META_FILE);
}
