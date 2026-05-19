import { listSessionFiles } from "../channel-store.js";
import { scanJsonlFile, scanJsonlFileReverse } from "../jsonl-parser.js";
// core/src/extension/chat-history/engine/file-scanner.ts
import type { ChannelSummary, ParsedMessage, SearchContext, ScanOptions } from "../types.js";

const DEFAULT_MAX_FILES_PER_CHANNEL = 5;
const DEFAULT_MAX_LINES = 5000;

export interface FileScanOptions extends ScanOptions {
  maxFilesPerChannel?: number;
  reverse?: boolean;
}

export interface ScanResult extends ParsedMessage {
  channelKey: string;
  channelType?: "private" | "group";
}

export class FileScanner {
  constructor(private ctx: SearchContext) {}

  async scan(
    channels: Pick<
      ChannelSummary,
      "channelKey" | "platform" | "channelId" | "type" | "currentSessionId"
    >[],
    options: FileScanOptions,
  ): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const maxFilesPerChannel = options.maxFilesPerChannel ?? DEFAULT_MAX_FILES_PER_CHANNEL;
    const maxHits = options.maxHits ?? this.ctx.maxLimit * 2;
    const reverse = options.reverse ?? false;
    const scanFn = reverse ? scanJsonlFileReverse : scanJsonlFile;

    for (const channel of channels) {
      if (results.length >= maxHits) break;

      const files = await listSessionFiles(
        this.ctx.sessionsDir,
        channel.channelKey,
        channel.currentSessionId,
      );

      // Reverse mode: scan newest files first; forward mode: also newest first
      files.sort((a, b) => b.modified.getTime() - a.modified.getTime());

      const filesToScan = files.slice(0, maxFilesPerChannel);

      for (const file of filesToScan) {
        if (results.length >= maxHits) break;

        const remaining = maxHits - results.length;

        const messages = await scanFn(file.fullPath, {
          ...options,
          maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
          maxHits: remaining,
          isCurrentSession: file.isCurrent,
        });

        for (const msg of messages) {
          results.push({ ...msg, channelKey: channel.channelKey, channelType: channel.type });
        }
      }
    }

    return results;
  }
}
