import { Context, Session, Universal } from "koishi";
import { HistoryChannelData, HistoryChannelType } from "./types";

export const HISTORY_CHANNELS = "worldstate.history_channels";
export const MESSAGE_KEY_MIGRATION = { platform: "", channelId: "" };

declare module "koishi" {
    interface Tables {
        [HISTORY_CHANNELS]: HistoryChannelData;
    }
}

export function sessionChannelType(session: Session): HistoryChannelType | undefined {
    if (session.event?.channel?.type !== undefined) {
        return session.event.channel.type === Universal.Channel.Type.DIRECT ? "private" : "guild";
    }
    if (typeof session.isDirect === "boolean") return session.isDirect ? "private" : "guild";
}

export function registerChannelModel(ctx: Context): void {
    ctx.model.extend(HISTORY_CHANNELS, {
        platform: "string(255)",
        channelId: "string(255)",
        channelType: "string(16)",
        messageKeyVersion: { type: "unsigned", initial: 0 },
    }, { primary: ["platform", "channelId"] });
}
