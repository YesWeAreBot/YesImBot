import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  getChannelInstructionsDir,
  getChannelMetaPath,
  getGlobalInstructionsDir,
  getUserInstructionsDir,
  getUserMetaPath,
} from "./layout";
import type { ChannelStateMeta, UserStateMeta } from "./types";

export class InstructionStateService {
  constructor(private readonly basePath: string) {}

  getGlobalInstructionsDir(): string {
    return getGlobalInstructionsDir(this.basePath);
  }

  getChannelInstructionsDir(platform: string, channelId: string): string {
    return getChannelInstructionsDir(this.basePath, platform, channelId);
  }

  getUserInstructionsDir(platform: string, userId: string): string {
    return getUserInstructionsDir(this.basePath, platform, userId);
  }

  ensureGlobalState(): string {
    const dir = this.getGlobalInstructionsDir();
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  ensureChannelState(platform: string, channelId: string): string {
    const dir = this.getChannelInstructionsDir(platform, channelId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  ensureUserState(platform: string, userId: string): string {
    const dir = this.getUserInstructionsDir(platform, userId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  writeChannelMeta(meta: ChannelStateMeta): string {
    const path = getChannelMetaPath(this.basePath, meta.platform, meta.channelId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    return path;
  }

  writeUserMeta(meta: UserStateMeta): string {
    const path = getUserMetaPath(this.basePath, meta.platform, meta.userId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    return path;
  }
}
