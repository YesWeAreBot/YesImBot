import { Context, Logger, Schema } from "koishi";
import type { ExtensionContext } from "koishi-plugin-yesimbot";
import type { Element, Fragment } from "koishi";
import z from "zod";

export interface StickerConfig {}

export default class StickerPlugin {
  static name = "yesimbot-sticker";
  static inject = ["yesimbot.extension"];
  static Config: Schema<StickerConfig> = Schema.object({});

  public readonly ctx: Context;
  public readonly config: StickerConfig;
  public readonly logger: Logger;

  constructor(ctx: Context, config: StickerConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.sticker");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  async start(): Promise<void> {
    const logger = this.logger;
    await this.ctx["yesimbot.extension"].registerExtension({
      id: "sticker",
      setup(ctx: ExtensionContext) {
        ctx.on("agent:before-start", (event) => {});
        ctx.platform.registerSpeakElement({
          tag: "sticker",
          syntax: "<sticker id='sticker_id'/>",
          description: "A sticker element",
          transform: (elem: Element, context: { channel: { platform: string; channelId: string; type: "private" | "group" }; session?: unknown }): Fragment => {
            const { id } = elem.attrs;
            return `<img src="https://example.com/stickers/${id}.png" alt="sticker"/>`;
          },
        });
        ctx.tool.register({
          name: "save_sticker",
          description: "Save a sticker",
          inputSchema: z.object({
            id: z.string().describe("The ID of the sticker to save"),
          }),
          execute: async (input) => {
            const { id } = input;
            logger.info(`Saving sticker with ID: ${id}`);
            // Implement sticker saving logic here
            return { success: true };
          },
        });
      },
    });
  }

  async stop(): Promise<void> {
    await this.ctx["yesimbot.extension"].unregisterExtension("sticker");
  }
}
