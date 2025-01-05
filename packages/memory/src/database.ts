import { Context } from "koishi";
import { GuildMemory, MemoryItem, UserMemory } from "./model";

declare module "koishi" {
  interface Tables {
    "yesimbot.memory.guild": GuildMemory;
    "yesimbot.memory.user": UserMemory;
  }
}

export function initDatabase(ctx: Context) {
  ctx.model.extend(
    "yesimbot.memory.guild",
    {
      guildId: "string",
      guildName: "string",
      guildDescription: "string",
      members: "list",
      recentTopics: "list",
    },
    {
      primary: "guildId",
    }
  );

  ctx.model.extend(
    "yesimbot.memory.user",
    {
      userId: "string",
      userName: "string",
      preferences: "list",
      groupSpecific: "list",
    },
    {
      primary: "userId",
    }
  );
}

