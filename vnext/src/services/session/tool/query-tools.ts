import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import type { AthenaToolDefinition, ChannelContext } from "./tool-types";

const GET_GROUP_MEMBERS_PARAMS = Type.Object({});
const GET_CHANNEL_INFO_PARAMS = Type.Object({});

interface GroupMember {
  userId: string;
  nickname: string;
}

interface GetGroupMembersDetails {
  count: number;
  members: GroupMember[];
}

interface ChannelInfoDetails {
  name: string;
  topic?: string;
  description?: string;
}

type GetGroupMembersResult = AgentToolResult<GetGroupMembersDetails> & { isError?: boolean };
type GetChannelInfoResult = AgentToolResult<ChannelInfoDetails> & { isError?: boolean };

export function createGetGroupMembersTool(channelCtx: ChannelContext): AthenaToolDefinition {
  const definition: ToolDefinition = {
    name: "get_group_members",
    label: "Get Group Members",
    description: "List group members in the current channel with user ID and nickname",
    promptSnippet: "get_group_members() — list members in the current group",
    parameters: GET_GROUP_MEMBERS_PARAMS,
    async execute(): Promise<GetGroupMembersResult> {
      if (!channelCtx.bot) {
        return {
          content: [{ type: "text", text: "Bot instance not available" }],
          details: { count: 0, members: [] },
          isError: true,
        };
      }

      try {
        const memberList = await channelCtx.bot.getGuildMemberList(channelCtx.channelId);
        const members = memberList.data.map((member) => {
          const userId = member.user?.id ?? "unknown";
          const nickname =
            member.nick ?? member.user?.nick ?? member.user?.name ?? member.user?.id ?? "unknown";

          return {
            userId,
            nickname,
          };
        });

        return {
          content: [{ type: "text", text: `Retrieved ${members.length} group member(s)` }],
          details: { count: members.length, members },
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to fetch group members: ${errorMessage}` }],
          details: { count: 0, members: [] },
          isError: true,
        };
      }
    },
  };

  return {
    definition,
    meta: { terminal: false },
  };
}

export function createGetChannelInfoTool(channelCtx: ChannelContext): AthenaToolDefinition {
  const definition: ToolDefinition = {
    name: "get_channel_info",
    label: "Get Channel Info",
    description: "Get metadata about the current channel",
    promptSnippet: "get_channel_info() — fetch current channel metadata",
    parameters: GET_CHANNEL_INFO_PARAMS,
    async execute(): Promise<GetChannelInfoResult> {
      if (!channelCtx.bot) {
        return {
          content: [{ type: "text", text: "Bot instance not available" }],
          details: { name: "unknown" },
          isError: true,
        };
      }

      try {
        const channel = await channelCtx.bot.getChannel(channelCtx.channelId);
        const raw = channel as unknown as Record<string, unknown>;
        const details: ChannelInfoDetails = {
          name: typeof channel.name === "string" && channel.name ? channel.name : "unknown",
        };

        if (typeof raw.topic === "string" && raw.topic) {
          details.topic = raw.topic;
        }

        if (typeof raw.description === "string" && raw.description) {
          details.description = raw.description;
        }

        return {
          content: [{ type: "text", text: `Retrieved channel info for ${details.name}` }],
          details,
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to fetch channel info: ${errorMessage}` }],
          details: { name: "unknown" },
          isError: true,
        };
      }
    },
  };

  return {
    definition,
    meta: { terminal: false },
  };
}
